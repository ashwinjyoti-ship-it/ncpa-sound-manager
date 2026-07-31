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

type SqlToken = {
  type: 'identifier' | 'string' | 'punctuation' | 'other'
  value: string
  quoted?: boolean
}

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = []

  for (let index = 0; index < sql.length;) {
    const char = sql[index]
    if (/\s/.test(char)) {
      index++
      continue
    }

    if (char === "'") {
      let value = ''
      index++
      while (index < sql.length) {
        if (sql[index] !== "'") {
          value += sql[index++]
          continue
        }
        if (sql[index + 1] === "'") {
          value += "'"
          index += 2
          continue
        }
        index++
        break
      }
      tokens.push({ type: 'string', value })
      continue
    }

    if (char === '"' || char === '`' || char === '[') {
      const closing = char === '[' ? ']' : char
      let value = ''
      index++
      while (index < sql.length) {
        if (sql[index] !== closing) {
          value += sql[index++]
          continue
        }
        if (closing !== ']' && sql[index + 1] === closing) {
          value += closing
          index += 2
          continue
        }
        index++
        break
      }
      tokens.push({ type: 'identifier', value, quoted: true })
      continue
    }

    if (/[a-z_]/i.test(char)) {
      let value = char
      index++
      while (index < sql.length && /[a-z0-9_$]/i.test(sql[index])) {
        value += sql[index++]
      }
      tokens.push({ type: 'identifier', value })
      continue
    }

    if ('(),.'.includes(char)) {
      tokens.push({ type: 'punctuation', value: char })
      index++
      continue
    }

    tokens.push({ type: 'other', value: char })
    index++
  }

  return tokens
}

function isKeyword(token: SqlToken | undefined, keyword: string): boolean {
  return token?.type === 'identifier' && !token.quoted && token.value.toLowerCase() === keyword
}

function afterClosingParenthesis(tokens: SqlToken[], start: number): number {
  if (tokens[start]?.value !== '(') return -1

  let depth = 0
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].value === '(') depth++
    if (tokens[index].value === ')') {
      depth--
      if (depth === 0) return index + 1
    }
  }
  return -1
}

function collectTopLevelCteNames(tokens: SqlToken[]): Set<string> | null {
  const names = new Set<string>()
  if (!isKeyword(tokens[0], 'with')) return names

  let cursor = 1
  if (isKeyword(tokens[cursor], 'recursive')) cursor++

  while (cursor < tokens.length) {
    const name = tokens[cursor]
    if (name?.type !== 'identifier') return null
    cursor++

    if (tokens[cursor]?.value === '(') {
      cursor = afterClosingParenthesis(tokens, cursor)
      if (cursor < 0) return null
    }
    if (!isKeyword(tokens[cursor], 'as')) return null
    cursor++

    if (isKeyword(tokens[cursor], 'not')) cursor++
    if (isKeyword(tokens[cursor], 'materialized')) cursor++
    if (tokens[cursor]?.value !== '(') return null

    names.add(name.value.toLowerCase())
    cursor = afterClosingParenthesis(tokens, cursor)
    if (cursor < 0) return null

    if (tokens[cursor]?.value !== ',') break
    cursor++
  }

  return names
}

function validateAllowedTables(sql: string): { ok: true } | { ok: false; error: string } {
  const tokens = tokenizeSql(sql)
  const cteNames = collectTopLevelCteNames(tokens)
  const rejection = {
    ok: false as const,
    error: `Only the ${Array.from(ALLOWED_QUERY_TABLES).join(' and ')} tables are allowed`
  }
  if (!cteNames) return rejection

  let depth = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.value === '(') {
      depth++
      continue
    }
    if (token.value === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (isKeyword(token, 'with') && index !== 0 && depth > 0) {
      return rejection
    }
  }

  const fromDepths = new Set<number>()
  const clauseEndKeywords = new Set([
    'where', 'group', 'having', 'order', 'limit', 'union', 'except', 'intersect', 'window'
  ])
  depth = 0

  const sourceIsAllowed = (sourceIndex: number): boolean => {
    const source = tokens[sourceIndex]
    if (!source) return false
    if (source.value === '(') {
      return isKeyword(tokens[sourceIndex + 1], 'select')
    }
    if (source.type !== 'identifier') return false
    if (tokens[sourceIndex + 1]?.value === '.' || tokens[sourceIndex + 1]?.value === '(') {
      return false
    }

    const name = source.value.toLowerCase()
    if (/^(pragma_|sqlite_)/.test(name) || name === 'dbstat') return false
    return ALLOWED_QUERY_TABLES.has(name) || cteNames.has(name)
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.value === '(') {
      depth++
      continue
    }
    if (token.value === ')') {
      fromDepths.delete(depth)
      depth = Math.max(0, depth - 1)
      continue
    }

    if (token.type === 'identifier' && !token.quoted) {
      const keyword = token.value.toLowerCase()
      if (clauseEndKeywords.has(keyword)) {
        fromDepths.delete(depth)
        continue
      }
      if (keyword === 'from') {
        fromDepths.add(depth)
        if (!sourceIsAllowed(index + 1)) return rejection
        continue
      }
      if (keyword === 'join') {
        if (!sourceIsAllowed(index + 1)) return rejection
        continue
      }
    }

    if (token.value === ',' && fromDepths.has(depth) && !sourceIsAllowed(index + 1)) {
      return rejection
    }
  }

  return { ok: true }
}

// ============================================
// Crew availability tool
// ============================================
// Mirrors the classification logic behind GET /api/crew-availability (the
// same data the calendar's day-availability modal shows), so Ask AI can give
// the identical assigned/unavailable/available breakdown instead of guessing
// from the events table alone.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function executeCrewAvailabilityTool(
  datesInput: unknown,
  db: D1Database,
  dbCrew: D1Database
): Promise<{ content: string; isError: boolean }> {
  const rawDates = Array.isArray(datesInput)
    ? datesInput.map((d) => String(d).trim()).filter(Boolean)
    : typeof datesInput === 'string'
      ? datesInput.split(',').map((d) => d.trim()).filter(Boolean)
      : []

  if (!rawDates.length) {
    return { content: 'No valid dates provided. Pass one or more YYYY-MM-DD dates.', isError: true }
  }

  const dates = rawDates.filter((d) => DATE_RE.test(d))
  const invalidDates = rawDates.filter((d) => !DATE_RE.test(d))

  if (!dates.length) {
    return {
      content: `No date in a recognized format. Rejected: ${JSON.stringify(invalidDates)}. Dates must be 'YYYY-MM-DD'.`,
      isError: true
    }
  }

  const ph = dates.map(() => '?').join(',')

  try {
    const soundRows = await db.prepare(
      `SELECT crew, foh_crew, stage_crew, program, venue, event_date
       FROM events WHERE event_date IN (${ph})`
    ).bind(...dates).all()

    const parseCSV = (s: string | null): string[] => {
      if (!s) return []
      return s.split(',').map((m) => m.trim())
        .filter((m) => m && m.toLowerCase() !== 'null' && m.toLowerCase() !== 'undefined')
    }

    const assignedByDate = new Map<string, Set<string>>()
    const showsByDate = new Map<string, any[]>()
    for (const row of soundRows.results as any[]) {
      const date = row.event_date as string
      if (!assignedByDate.has(date)) assignedByDate.set(date, new Set())
      const set = assignedByDate.get(date)!
      parseCSV(row.crew).forEach((m) => set.add(m))
      parseCSV(row.foh_crew).forEach((m) => set.add(m))
      parseCSV(row.stage_crew).forEach((m) => set.add(m))
      if (!showsByDate.has(date)) showsByDate.set(date, [])
      showsByDate.get(date)!.push(row)
    }

    const rosterRows = await dbCrew.prepare(`SELECT name FROM crew ORDER BY name`).all()
    let roster = (rosterRows.results as any[]).map((r) => r.name as string).filter(Boolean)
    if (!roster.length) {
      roster = [
        'Naren', 'Sandeep', 'Coni', 'NS', 'Aditya',
        'Viraj', 'Shridhar', 'Nazar', 'Omkar', 'Akshay',
        'OC1', 'OC2', 'OC3'
      ]
    }

    const crewRows = await dbCrew.prepare(
      `SELECT DISTINCT c.name, cu.unavailable_date
       FROM crew_unavailability cu
       JOIN crew c ON c.id = cu.crew_id
       WHERE cu.unavailable_date IN (${ph})`
    ).bind(...dates).all()

    const unavailByDate = new Map<string, Set<string>>()
    for (const row of crewRows.results as any[]) {
      const date = row.unavailable_date as string
      if (!unavailByDate.has(date)) unavailByDate.set(date, new Set())
      unavailByDate.get(date)!.add(row.name as string)
    }

    const byDate: Record<string, any> = {}
    for (const date of dates) {
      const assignedSet = assignedByDate.get(date) || new Set<string>()
      const unavailSet = unavailByDate.get(date) || new Set<string>()

      const everyone: string[] = [...roster]
      assignedSet.forEach((n) => { if (!everyone.includes(n)) everyone.push(n) })

      byDate[date] = {
        available: everyone.filter((m) => !assignedSet.has(m) && !unavailSet.has(m)),
        assigned: everyone.filter((m) => assignedSet.has(m)),
        unavailable_or_blocked: everyone.filter((m) => unavailSet.has(m) && !assignedSet.has(m)),
        shows: showsByDate.get(date) || []
      }
    }

    return {
      content: JSON.stringify({
        by_date: byDate,
        ...(invalidDates.length ? { rejected_dates: invalidDates } : {})
      }),
      isError: false
    }
  } catch (error: any) {
    return { content: `Crew availability lookup error: ${error.message}`, isError: true }
  }
}

async function executeQueryTool(sql: string, db: D1Database): Promise<{ content: string; isError: boolean }> {
  const validation = validateReadOnlySql(sql)
  if (!validation.ok) {
    return { content: `SQL rejected: ${validation.error}`, isError: true }
  }

  const tableValidation = validateAllowedTables(validation.sql)
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

You have two tools: query_database and get_crew_availability. Use them for every factual answer - never answer about events or crew status from memory. Run as many tool calls as you need (you may call several to cross-check or aggregate).

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
- 'Free'/'available' dates for a venue = calendar dates in the range with no event rows for that venue.
- CREW AVAILABILITY: a crew member's status on a date is NOT just "are they in an events row". There are three possible states: assigned (on a show that day, per events.crew/foh_crew/stage_crew), unavailable/blocked (on leave, off, or otherwise blocked - tracked separately in the crew scheduling system, NOT in the events table), and available (neither of the above). Never infer "available" just because someone isn't on a show - they may be blocked/on leave. ALWAYS use the get_crew_availability tool (not query_database/SQL) to answer any question about who is free, available, on leave, blocked, or off on a given date, or about a specific person's availability/status on a date - it returns the correct three-way breakdown. This is exactly the same data the calendar's day-availability popup shows.

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

    const { resolveAnthropicApiKey } = await import('./settings-endpoints')
    const { key: apiKey } = await resolveAnthropicApiKey(c.env.DB, c.env.ANTHROPIC_API_KEY)
    if (!apiKey) {
      return c.json({ success: false, error: 'AI is not configured (missing API key). Add it in Settings.' }, 500)
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
      },
      {
        name: 'get_crew_availability',
        description:
          'Get the assigned / unavailable (blocked, on leave, off) / available breakdown for every crew member, ' +
          'computed separately for each date requested - the same data shown by the calendar\'s day-availability ' +
          'popup. Returns { by_date: { "YYYY-MM-DD": { assigned, unavailable_or_blocked, available, shows } } }, ' +
          'one entry per date - never assume a status from one date applies to another date in the same call. ' +
          'Dates must be in exact YYYY-MM-DD format; any date that isn\'t is reported back under rejected_dates ' +
          'and excluded from by_date rather than silently treated as "everyone available" - resolve those with ' +
          'the user or from context before re-calling. Always use this (not query_database) for questions about ' +
          'who is free, on leave, blocked, or off, or about a specific person\'s status, on a given date.',
        input_schema: {
          type: 'object',
          properties: {
            dates: {
              type: 'array',
              items: { type: 'string' },
              description: "One or more dates in exact 'YYYY-MM-DD' format."
            }
          },
          required: ['dates']
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
          toolCallCount++
          let content: string
          let isError: boolean

          if (toolUse.name === 'get_crew_availability') {
            const dates = toolUse.input?.dates
            executedQueries.push(`get_crew_availability(${JSON.stringify(dates)})`)
            console.log(`AI crew-availability [${toolCallCount}]: ${JSON.stringify(dates)}`)
            ;({ content, isError } = await executeCrewAvailabilityTool(dates, c.env.DB, c.env.DB_CREW))
          } else {
            const sql = String(toolUse.input?.sql || '')
            executedQueries.push(sql)
            console.log(`AI SQL [${toolCallCount}]: ${sql.slice(0, 200)}`)
            ;({ content, isError } = await executeQueryTool(sql, c.env.DB))
          }

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
