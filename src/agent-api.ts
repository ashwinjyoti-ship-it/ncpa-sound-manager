// Read-only API for AI agents. Protected by a Bearer API key stored as the
// AGENT_API_KEY secret in Cloudflare (never committed).
import type { Hono } from 'hono'
import { classifyDates, loadAvailabilityData } from './crew-availability'

type Bindings = {
  DB: D1Database
  DB_CREW: D1Database
  AGENT_API_KEY?: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 31

function validDate(s: string | undefined): s is string {
  if (!s || !DATE_RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(start + 'T00:00:00Z')
  const last = new Date(end + 'T00:00:00Z')
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

// Constant-time string compare (hash-free, length-independent loop).
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export function setupAgentApi(app: Hono<{ Bindings: Bindings }>) {
  app.use('/api/agent/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'OPTIONS') {
      return c.json({ success: false, error: 'Read-only API: GET only' }, 405)
    }
    if (c.req.method === 'OPTIONS') return next()
    const key = c.env.AGENT_API_KEY
    if (!key) return c.json({ success: false, error: 'Agent API not configured' }, 503)
    const header = c.req.header('Authorization') || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token || !safeEqual(token, key)) {
      return c.json({ success: false, error: 'Invalid or missing API key' }, 401)
    }
    await next()
  })

  // GET /api/agent/crew-availability?date=YYYY-MM-DD
  // GET /api/agent/crew-availability?start=YYYY-MM-DD&end=YYYY-MM-DD  (max 31 days)
  app.get('/api/agent/crew-availability', async (c) => {
    const date = c.req.query('date')
    const start = c.req.query('start')
    const end = c.req.query('end')

    let dates: string[]
    if (date) {
      if (!validDate(date)) return c.json({ success: false, error: 'date must be YYYY-MM-DD' }, 400)
      dates = [date]
    } else if (start && end) {
      if (!validDate(start) || !validDate(end)) {
        return c.json({ success: false, error: 'start and end must be YYYY-MM-DD' }, 400)
      }
      if (end < start) return c.json({ success: false, error: 'end must not be before start' }, 400)
      dates = datesBetween(start, end)
      if (dates.length > MAX_RANGE_DAYS) {
        return c.json({ success: false, error: `Range too long (max ${MAX_RANGE_DAYS} days)` }, 400)
      }
    } else {
      return c.json({ success: false, error: 'Provide ?date=YYYY-MM-DD or ?start=...&end=...' }, 400)
    }

    try {
      const data = await loadAvailabilityData(c.env.DB, c.env.DB_CREW, dates)
      const day = (d: string) => ({
        date: d,
        ...classifyDates(data, [d]),
        shows: data.shows
          .filter(s => s.event_date === d)
          .map(s => ({ program: s.program, venue: s.venue, crew: s.crew, foh_crew: s.foh_crew, stage_crew: s.stage_crew })),
      })
      if (date) return c.json({ success: true, ...day(date) })
      return c.json({ success: true, start, end, days: dates.map(day) })
    } catch (err: any) {
      return c.json({ success: false, error: err.message }, 500)
    }
  })
}
