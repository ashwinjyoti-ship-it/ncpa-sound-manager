// A narrow MCP endpoint for agents: read shows, set their crew, add a
// maintenance day. It cannot touch anything else. Access is by a revocable key
// that an admin creates in Settings, carried in the connector URL or as a
// Bearer token.
import type { Context, Hono } from 'hono'
import { requireAdminUser } from './auth-utils'
import { getActiveCrewNames } from './crew-endpoints'
import { broadcastUpsertByIds } from './event-sync'

type Bindings = {
  DB: D1Database
  EVENT_SYNC: DurableObjectNamespace
}
type Ctx = Context<{ Bindings: Bindings }>
type Args = Record<string, unknown>
type Crew = { foh_crew: string | null; stage_crew: string | null; crew: string | null }

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const MAINTENANCE_PROGRAM = 'Maintenance and Cleaning'
const DATE = /^\d{4}-\d{2}-\d{2}$/

class ToolError extends Error {}

const nameList = { type: 'array', items: { type: 'string' } }

const TOOLS = [
  {
    name: 'list_shows',
    description: 'Shows between two dates (inclusive) with their current crew, plus the crew roster.',
    inputSchema: {
      type: 'object',
      properties: { start: { type: 'string', description: 'YYYY-MM-DD' }, end: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['start', 'end']
    }
  },
  {
    name: 'set_crew',
    description: 'Replace the crew on one show. event_date must match the show, as a guard against a wrong id. Pass empty lists to leave the show open. foh normally holds one name.',
    inputSchema: {
      type: 'object',
      properties: { event_id: { type: 'integer' }, event_date: { type: 'string' }, foh: nameList, stage: nameList },
      required: ['event_id', 'event_date', 'foh', 'stage']
    }
  },
  {
    name: 'add_maintenance_day',
    description: 'Add a Maintenance and Cleaning record for a date. Does nothing if that date already has one.',
    inputSchema: {
      type: 'object',
      properties: { event_date: { type: 'string' }, foh: nameList, stage: nameList },
      required: ['event_date', 'foh', 'stage']
    }
  }
]

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function newKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
}

function requireDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE.test(value)) throw new ToolError(`${field} must be YYYY-MM-DD`)
  return value
}

async function buildCrew(db: D1Database, args: Args): Promise<Crew> {
  const roster = await getActiveCrewNames(db)
  const known = new Map(roster.map(name => [name.toLowerCase(), name]))
  const parse = (field: 'foh' | 'stage') => {
    const value = args[field]
    if (!Array.isArray(value)) throw new ToolError(`${field} must be a list of names`)
    return value.map(entry => {
      const name = known.get(String(entry).trim().toLowerCase())
      if (!name) throw new ToolError(`"${entry}" is not on the crew roster (${roster.join(', ')})`)
      return name
    })
  }
  const foh = parse('foh')
  const stage = parse('stage')
  const all = [...foh, ...stage]
  if (new Set(all).size !== all.length) throw new ToolError('A name appears more than once')
  const join = (names: string[]) => names.join(', ') || null
  return { foh_crew: join(foh), stage_crew: join(stage), crew: join(all) }
}

function logChange(db: D1Database, linkId: number, event: { id: number; event_date: string; program: string }, before: Crew | null, after: Crew) {
  return db.prepare(`
    INSERT INTO agent_crew_changes (link_id, event_id, event_date, program, before_json, after_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(linkId, event.id, event.event_date, event.program, before && JSON.stringify(before), JSON.stringify(after))
}

async function listShows(c: Ctx, args: Args) {
  const start = requireDate(args.start, 'start')
  const end = requireDate(args.end, 'end')
  const { results } = await c.env.DB.prepare(`
    SELECT id, event_date, program, venue, team, sound_requirements, call_time, foh_crew, stage_crew, crew
    FROM events WHERE event_date BETWEEN ? AND ? ORDER BY event_date, venue, id
  `).bind(start, end).all()
  return { shows: results, roster: await getActiveCrewNames(c.env.DB) }
}

async function setCrew(c: Ctx, args: Args, linkId: number) {
  if (!Number.isInteger(args.event_id)) throw new ToolError('event_id must be a whole number')
  const date = requireDate(args.event_date, 'event_date')
  const show = await c.env.DB.prepare(
    'SELECT id, event_date, program, foh_crew, stage_crew, crew FROM events WHERE id = ?'
  ).bind(args.event_id).first<{ id: number; event_date: string; program: string } & Crew>()
  if (!show) throw new ToolError('No show with that id')
  if (show.event_date !== date) throw new ToolError(`Show ${show.id} is on ${show.event_date}, not ${date}. Nothing changed.`)

  const after = await buildCrew(c.env.DB, args)
  const before: Crew = { foh_crew: show.foh_crew, stage_crew: show.stage_crew, crew: show.crew }
  const changed = (Object.keys(after) as (keyof Crew)[]).some(key => (before[key] || null) !== after[key])
  if (changed) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE events SET foh_crew = ?, stage_crew = ?, crew = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(after.foh_crew, after.stage_crew, after.crew, show.id),
      logChange(c.env.DB, linkId, show, before, after)
    ])
    await broadcastUpsertByIds(c.env, c.env.DB, [show.id])
  }
  return { event_id: show.id, event_date: date, program: show.program, changed, before, after }
}

async function addMaintenanceDay(c: Ctx, args: Args, linkId: number) {
  const date = requireDate(args.event_date, 'event_date')
  const crew = await buildCrew(c.env.DB, args)
  const existing = await c.env.DB.prepare(
    "SELECT id FROM events WHERE event_date = ? AND lower(program) LIKE 'maintenance%'"
  ).bind(date).first<{ id: number }>()
  if (existing) return { event_id: existing.id, added: false }

  const inserted = await c.env.DB.prepare(`
    INSERT INTO events (event_date, program, venue, team, foh_crew, stage_crew, crew, requirements_updated, source)
    VALUES (?, ?, 'Other', 'Others', ?, ?, ?, 0, 'manual')
  `).bind(date, MAINTENANCE_PROGRAM, crew.foh_crew, crew.stage_crew, crew.crew).run()
  const id = Number(inserted.meta.last_row_id)
  await logChange(c.env.DB, linkId, { id, event_date: date, program: MAINTENANCE_PROGRAM }, null, crew).run()
  await broadcastUpsertByIds(c.env, c.env.DB, [id])
  return { event_id: id, added: true }
}

const HANDLERS: Record<string, (c: Ctx, args: Args, linkId: number) => Promise<unknown>> = {
  list_shows: listShows,
  set_crew: setCrew,
  add_maintenance_day: addMaintenanceDay
}

async function findLink(c: Ctx): Promise<number | null> {
  const key = c.req.param('key') || c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!key) return null
  const link = await c.env.DB.prepare(
    'SELECT id FROM agent_links WHERE key_hash = ? AND revoked_at IS NULL'
  ).bind(await sha256(key)).first<{ id: number }>()
  if (!link) return null
  await c.env.DB.prepare('UPDATE agent_links SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').bind(link.id).run()
  return link.id
}

async function handleMcp(c: Ctx) {
  const linkId = await findLink(c)
  if (linkId === null) return c.json({ error: 'Unknown or revoked agent link' }, 401)

  const message = await c.req.json().catch(() => null)
  if (!message || typeof message.method !== 'string') {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400)
  }
  const { id, method, params } = message
  if (id === undefined) return c.body(null, 202)

  const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id, result })
  const fail = (code: number, text: string) => c.json({ jsonrpc: '2.0', id, error: { code, message: text } })

  if (method === 'initialize') {
    const asked = params?.protocolVersion
    return reply({
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'ncpa-sound-crew', version: '1.0.0' }
    })
  }
  if (method === 'ping') return reply({})
  if (method === 'tools/list') return reply({ tools: TOOLS })
  if (method === 'tools/call') {
    const handler = Object.hasOwn(HANDLERS, params?.name) ? HANDLERS[params.name] : undefined
    if (!handler) return fail(-32602, 'Unknown tool')
    const respond = (text: string, isError: boolean) => reply({ content: [{ type: 'text', text }], isError })
    try {
      return respond(JSON.stringify(await handler(c, params.arguments || {}, linkId)), false)
    } catch (error) {
      if (error instanceof ToolError) return respond(error.message, true)
      console.error('agent connector tool failed:', error)
      return respond('The calendar could not complete that request', true)
    }
  }
  return fail(-32601, 'Method not found')
}

export function setupAgentConnector(app: Hono<any>) {
  app.post('/api/agent/mcp', handleMcp)
  app.post('/api/agent/mcp/:key', handleMcp)
  app.get('/api/agent/mcp', c => c.body(null, 405))
  app.get('/api/agent/mcp/:key', c => c.body(null, 405))

  app.get('/api/admin/agent-links', async (c: Ctx) => {
    const authError = await requireAdminUser(c)
    if (authError) return authError
    const links = await c.env.DB.prepare(
      'SELECT id, label, created_at, last_used_at FROM agent_links WHERE revoked_at IS NULL ORDER BY id'
    ).all()
    const changes = await c.env.DB.prepare(
      'SELECT event_date, program, before_json, after_json, created_at FROM agent_crew_changes ORDER BY id DESC LIMIT 20'
    ).all()
    return c.json({ success: true, links: links.results, changes: changes.results })
  })

  app.post('/api/admin/agent-links', async (c: Ctx) => {
    const authError = await requireAdminUser(c)
    if (authError) return authError
    const body = await c.req.json().catch(() => ({}))
    const label = String(body.label || '').trim().slice(0, 60)
    if (!label) return c.json({ success: false, error: 'Give the link a name' }, 400)
    const key = newKey()
    await c.env.DB.prepare('INSERT INTO agent_links (label, key_hash) VALUES (?, ?)').bind(label, await sha256(key)).run()
    return c.json({ success: true, url: `${new URL(c.req.url).origin}/api/agent/mcp/${key}` }, 201)
  })

  app.delete('/api/admin/agent-links/:id', async (c: Ctx) => {
    const authError = await requireAdminUser(c)
    if (authError) return authError
    await c.env.DB.prepare('UPDATE agent_links SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?').bind(c.req.param('id')).run()
    return c.json({ success: true })
  })
}
