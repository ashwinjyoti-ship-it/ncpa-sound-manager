// Ask AI Chat Endpoint - Version 5.0
// Agentic chat: Claude writes its own read-only SQL against the events database,
// so it can answer anything about crew, dates, venues, equipment and other fields
// in natural language, and ask clarifying questions when a query is ambiguous.

import type { Context } from 'hono'
import type { Env } from './types'

const CLAUDE_MODEL = 'claude-opus-4-8'
const MAX_TOOL_ITERATIONS = 10
const MAX_RESULT_ROWS = 300
const MAX_RESULT_CHARS = 30000
const MAX_HISTORY_MESSAGES = 30
const ALLOWED_QUERY_TABLES = new Set(['events', 'venue_aliases'])

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: any
}

interface AnthropicResponse {
  content: AnthropicContentBlock[]
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number }
  error?: { type: string; message: string }
}

// ============================================
// Read-only SQL guard
// ============================================

export function validateReadOnlySql(sql: string): { ok: true; sql: string } | { ok: false; error: string } {
  // Strip comments so keywords can't hide inside them
  let cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim()

  // Allow a single trailing semicolon, nothing else
  cleaned = cleaned.replace(/;+\s*$/, '').trim()
  if (cleaned.length === 0) {
    return { ok: false, error: 'Empty SQL statement' }
  }
  if (cleaned.includes(';')) {
    return { ok: false, error: 'Only a single SQL statement is allowed' }
  }
  if (!/^(select|with)\b/i.test(cleaned)) {
    return { ok: false, error: 'Only SELECT queries are allowed' }
  }

  // SQLite allows WITH ... INSERT/UPDATE/DELETE, so block write keywords anywhere.
  // REPLACE( ) as a string function is fine; REPLACE INTO is not.
  const forbidden = [
    /\binsert\b/i,
    /\bupdate\b/i,
    /\bdelete\b/i,
    /\bdrop\b/i,
    /\balter\b/i,
    /\bcreate\s+(table|index|view|trigger|virtual)\b/i,
    /\breplace\s+into\b/i,
    /\bpragma\b/i,
    /\battach\b/i,
    /\bdetach\b/i,
    /\bvacuum\b/i,
    /\breindex\b/i
  ]
  for (const pattern of forbidden) {
    if (pattern.test(cleaned)) {
      return { ok: false, error: 'Only read-only SELECT queries are allowed' }
    }
  }

  // Keep result sets bounded unless the query already limits itself
  if (!/\blimit\b/i.test(cleaned)) {
    cleaned = `${cleaned} LIMIT ${MAX_RESULT_ROWS}`
  }

  return { ok: true, sql: cleaned }
}

function stripSqlStringLiterals(sql: string): string {
  let result = ''

  for (let index = 0; index < sql.length; index++) {
    if (sql[index] !== "'") {
      result += sql[index]
      continue
    }

    result += ' '
    index++
    while (index < sql.length) {
      if (sql[index] !== "'") {
        result += ' '
        index++
        continue
      }
      if (sql[index + 1] === "'") {
        result += '  '
        index += 2
        continue
      }
      result += ' '
      break
    }
  }

  return result
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function validateAllowedTables(
  sql: string,
  db: D1Database
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const schema = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type IN ('table', 'view')`
    ).all<{ name: string }>()
    const sqlWithoutStrings = stripSqlStringLiterals(sql)
    const databaseObjects = (schema.results || [])
      .map((row) => String(row.name || '').toLowerCase())
      .filter((name) => name && !ALLOWED_QUERY_TABLES.has(name))

    databaseObjects.push('sqlite_master', 'sqlite_schema', 'sqlite_temp_master', 'sqlite_temp_schema')

    for (const name of new Set(databaseObjects)) {
      const escapedName = escapeRegExp(name)
      const identifierPattern = new RegExp(`(^|[^a-z0-9_])${escapedName}([^a-z0-9_]|$)`, 'i')
      const singleQuotedIdentifier = new RegExp(`'${escapedName.replace(/'/g, "''")}'`, 'i')

      if (identifierPattern.test(sqlWithoutStrings) || singleQuotedIdentifier.test(sql)) {
        return {
          ok: false,
          error: `Only the ${Array.from(ALLOWED_QUERY_TABLES).join(' and ')} tables are allowed`
        }
      }
    }

    return { ok: true }
  } catch {
    return { ok: false, error: 'Unable to verify allowed database tables' }
  }
}

async function executeQueryTool(sql: string, db: D1Database): Promise<{ content: string; isError: boolean }> {
  const validation = validateReadOnlySql(sql)
  if (!validation.ok) {
    return { content: `SQL rejected: ${validation.error}`, isError: true }
  }

  const tableValidation = await validateAllowedTables(validation.sql, db)
  if (!tableValidation.ok) {
    return { content: `SQL rejected: ${tableValidation.error}`, isError: true }
  }

  try {
    const result = await db.prepare(validation.sql).all()
    let rows = (result.results || []) as Record<string, unknown>[]
    let truncated = false

    if (rows.length > MAX_RESULT_ROWS) {
      rows = rows.slice(0, MAX_RESULT_ROWS)
      truncated = true
    }

    let payload = JSON.stringify({ row_count: rows.length, truncated, rows })
    while (payload.length > MAX_RESULT_CHARS && rows.length > 1) {
      rows = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)))
      truncated = true
      payload = JSON.stringify({ row_count: rows.length, truncated, rows })
    }

    return { content: payload, isError: false }
  } catch (error: any) {
    return { content: `SQL error: ${error.message}`, isError: true }
  }
}

// ============================================
// System prompt with live schema
// ============================================

async function buildSystemPrompt(db: D1Database): Promise<string> {
  const today = new Date().toISOString().split('T')[0]

  let eventsSchema = ''
  let venues = ''
  let teams = ''
  let dateRange = ''

  try {
    const schemaRow = await db.prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'`
    ).first<{ sql: string }>()
    eventsSchema = schemaRow?.sql || ''
  } catch { /* schema block is best-effort */ }

  try {
    const venueRows = await db.prepare(
      `SELECT venue, COUNT(*) as n FROM events GROUP BY venue ORDER BY n DESC LIMIT 40`
    ).all()
    venues = (venueRows.results || []).map((r: any) => `${r.venue} (${r.n})`).join(', ')
  } catch { /* best-effort */ }

  try {
    const teamRows = await db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(team), ''), 'Unassigned') as team, COUNT(*) as n
       FROM events GROUP BY 1 ORDER BY n DESC LIMIT 20`
    ).all()
    teams = (teamRows.results || []).map((r: any) => `${r.team} (${r.n})`).join(', ')
  } catch { /* best-effort */ }

  try {
    const rangeRow = await db.prepare(
      `SELECT MIN(event_date) as min_date, MAX(event_date) as max_date, COUNT(*) as total FROM events`
    ).first<{ min_date: string; max_date: string; total: number }>()
    if (rangeRow) {
      dateRange = `${rangeRow.min_date} to ${rangeRow.max_date} (${rangeRow.total} events total)`
    }
  } catch { /* best-effort */ }

  return `You are the Ask AI assistant for the NCPA (National Centre for the Performing Arts, Mumbai) Sound Crew event management app. You answer questions about scheduled events: dates, venues, programs, crew assignments, teams, call times, sound/equipment requirements, availability, workload, and anything else stored in the database.

CURRENT DATE: ${today}

You have one tool: query_database. It runs read-only SQLite SELECT queries against the live database. Use it for every factual answer - never answer about events from memory. Run as many queries as you need (you may run several to cross-check or aggregate).

DATABASE SCHEMA (the "events" table is the main table):
${eventsSchema || 'Use standard columns: id, event_date, program, venue, team, sound_requirements, call_time, crew, foh_crew, stage_crew, rider, notes, show_group_id, created_at, updated_at'}

Other useful table: venue_aliases(canonical_name, alias) - maps short names like 'TT' or 'JBT' to canonical venue names.

DATA CONVENTIONS:
- event_date is 'YYYY-MM-DD'. Use date ranges or strftime('%Y-%m', event_date) for months.
- Venue names in events.venue are inconsistent (e.g. 'Tata Theatre', 'TATA', 'TT' may all appear). Known venues by event count: ${venues || 'query venue_aliases and GROUP BY venue to discover them'}. When filtering by venue, match ALL aliases: venue LIKE patterns for each alias from venue_aliases (or use OR of LIKEs). Main venues: Tata Theatre (TT), Jamshed Bhabha Theatre (JBT), Experimental Theatre (ET/TET), Godrej Dance Theatre (GDT), Little Theatre (LT), Sea View Room (SVR), JBT Museum.
- Crew columns: 'crew' (legacy comma-separated list), 'foh_crew' (front-of-house, usually one name), 'stage_crew' (comma-separated). Some months use only 'crew', others use foh_crew/stage_crew. To find a person's events, check all three with LIKE: (COALESCE(crew,'') LIKE '%Name%' OR COALESCE(foh_crew,'') LIKE '%Name%' OR COALESCE(stage_crew,'') LIKE '%Name%'). Known crew members: Ashwin, Naren, Sandeep, Coni, Nikhil, NS, Aditya, Viraj, Shridhar, Nazar, Omkar, Akshay, OC1, OC2, OC3.
- Teams in the data: ${teams || 'query GROUP BY team to discover'}.
- Equipment/technical needs live in sound_requirements, rider and notes (free text - search with LIKE, case-insensitively via LOWER()).
- Event data currently spans: ${dateRange || 'unknown - query MIN/MAX event_date'}.
- 'Free'/'available' dates for a venue = calendar dates in the range with no event rows for that venue. For a crew member, 'free' = no event rows mentioning them that day.

ANSWERING RULES:
1. Be concise and direct. Lead with the answer (an exact count, a date list, a name), then minimal supporting detail.
2. For lists of events, format each as: date - program - venue - crew (only include fields that are relevant to the question). Use markdown bullet lists. Bold key numbers and names with **bold**.
3. Use exact numbers from query results. Never estimate.
4. If a question is genuinely ambiguous (e.g. "December 25" could mean Dec 25th or Dec 2025, or an unknown person/venue name), ask ONE short clarifying question instead of guessing. If the ambiguity is minor, state your assumption and answer.
5. If a query returns nothing, say so plainly and suggest what you did find nearby (e.g. adjacent months) if helpful.
6. Dates in answers: human-readable (e.g. "Sat, 5 Dec 2026"). Collapse consecutive free dates into ranges.
7. If the user asks you to modify data, explain that you have read-only access; changes must be made in the app.
8. Keep answers under ~150 words unless the user asks for a detailed breakdown or a long list.`
}

// ============================================
// Chat handler
// ============================================

export async function handleAIChat(c: Context<{ Bindings: Env }>) {
  const startTime = Date.now()

  try {
    const body = await c.req.json().catch(() => ({}))
    const rawMessages: unknown = body.messages

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return c.json({ success: false, error: 'messages array is required' }, 400)
    }

    // Sanitize client-held history: alternating-ish user/assistant text turns only
    const history: ChatMessage[] = rawMessages
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))

    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      return c.json({ success: false, error: 'Last message must be from the user' }, 400)
    }

    const apiKey = c.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return c.json({ success: false, error: 'AI is not configured (missing API key)' }, 500)
    }

    const systemPrompt = await buildSystemPrompt(c.env.DB)

    const tools = [
      {
        name: 'query_database',
        description:
          'Run a read-only SQLite SELECT query against the NCPA events database and get rows back as JSON. ' +
          'Call this whenever you need facts about events, crew, venues, dates, teams or requirements. ' +
          'Only single SELECT/WITH statements are allowed; results are capped at 300 rows.',
        input_schema: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'A single SQLite SELECT statement.' }
          },
          required: ['sql']
        }
      }
    ]

    // Conversation for the API: sanitized history, then tool turns appended in the loop
    const messages: any[] = history.map((m) => ({ role: m.role, content: m.content }))

    let answer = ''
    let toolCallCount = 0
    let totalTokens = 0
    const executedQueries: string[] = []

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages
        })
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        console.error(`Claude API error ${response.status}: ${errText.slice(0, 500)}`)
        throw new Error(`Claude API error: ${response.status}`)
      }

      const result: AnthropicResponse = await response.json()
      totalTokens += (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0)

      const textParts = result.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text as string)
      const toolUses = result.content.filter((b) => b.type === 'tool_use')

      if (result.stop_reason === 'tool_use' && toolUses.length > 0) {
        // Execute all requested queries, return all results in one user turn
        messages.push({ role: 'assistant', content: result.content })

        const toolResults: any[] = []
        for (const toolUse of toolUses) {
          const sql = String(toolUse.input?.sql || '')
          executedQueries.push(sql)
          toolCallCount++
          console.log(`AI SQL [${toolCallCount}]: ${sql.slice(0, 200)}`)
          const { content, isError } = await executeQueryTool(sql, c.env.DB)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content,
            is_error: isError
          })
        }
        messages.push({ role: 'user', content: toolResults })
        continue
      }

      // end_turn, max_tokens, refusal, etc. - take whatever text we have and stop
      answer = textParts.join('\n\n').trim()
      if (!answer && result.stop_reason === 'refusal') {
        answer = "I can't help with that request."
      }
      break
    }

    if (!answer) {
      answer = 'Sorry, I ran out of steps while researching that. Try asking a more specific question.'
    }

    return c.json({
      success: true,
      answer,
      metadata: {
        model: CLAUDE_MODEL,
        tool_calls: toolCallCount,
        queries: executedQueries,
        response_time_ms: Date.now() - startTime,
        token_count: totalTokens
      }
    })
  } catch (error: any) {
    console.error('AI chat failed:', error)
    return c.json(
      {
        success: false,
        error: 'AI chat failed',
        details: error.message,
        metadata: { response_time_ms: Date.now() - startTime }
      },
      500
    )
  }
}
