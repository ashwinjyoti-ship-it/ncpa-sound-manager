// Configurable crew roster — owned locally by this app, independent from the
// external ncpa-crew-db used by the separate Crew-Assignment-Automation app.
// Mirrors the venues pattern in settings-endpoints.ts: a small table with a
// public read endpoint plus /api/admin/crew CRUD for the Settings UI.
import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
}

export type CrewRow = {
  id: number
  name: string
  active: number
  sort_order: number
  include_in_ai: number
  created_at?: string
  updated_at?: string
}

// Fallback used only if the crew table is missing/empty (e.g. a fresh local
// DB before migrations run). Not hit in normal operation.
export const DEFAULT_CREW: Array<{ name: string; sort_order: number; include_in_ai: number }> = [
  { name: 'Ashwin', sort_order: 5, include_in_ai: 0 },
  { name: 'Naren', sort_order: 10, include_in_ai: 1 },
  { name: 'Sandeep', sort_order: 20, include_in_ai: 1 },
  { name: 'Coni', sort_order: 30, include_in_ai: 1 },
  { name: 'NS', sort_order: 40, include_in_ai: 1 },
  { name: 'Aditya', sort_order: 50, include_in_ai: 1 },
  { name: 'Viraj', sort_order: 60, include_in_ai: 1 },
  { name: 'Shridhar', sort_order: 70, include_in_ai: 1 },
  { name: 'Nazar', sort_order: 80, include_in_ai: 1 },
  { name: 'Omkar', sort_order: 90, include_in_ai: 1 },
  { name: 'Akshay', sort_order: 100, include_in_ai: 1 },
  { name: 'OC1', sort_order: 110, include_in_ai: 1 },
  { name: 'OC2', sort_order: 120, include_in_ai: 1 },
  { name: 'OC3', sort_order: 130, include_in_ai: 1 },
]

export async function getActiveCrew(db: D1Database): Promise<CrewRow[]> {
  try {
    const { results } = await db.prepare(`
      SELECT id, name, active, sort_order, include_in_ai, created_at, updated_at
      FROM crew
      WHERE active = 1
      ORDER BY sort_order ASC, name ASC
    `).all()
    if (results && results.length > 0) {
      return results as CrewRow[]
    }
  } catch {
    // Table may not exist yet on an old local DB
  }
  return DEFAULT_CREW.map((m, i) => ({
    id: -(i + 1),
    name: m.name,
    active: 1,
    sort_order: m.sort_order,
    include_in_ai: m.include_in_ai,
  }))
}

/** Active crew names, in display order — used to render checkboxes/selects. */
export async function getActiveCrewNames(db: D1Database): Promise<string[]> {
  const crew = await getActiveCrew(db)
  return crew.map((m) => m.name)
}

/** Active crew names as a Set — used for membership checks in Add/Edit pickers. */
export async function getActiveCrewNameSet(db: D1Database): Promise<Set<string>> {
  return new Set(await getActiveCrewNames(db))
}

/**
 * Active crew names eligible for AI auto-suggestions / crew stats, as a Set.
 * Excludes anyone with include_in_ai = 0 (e.g. the team head, who is a valid
 * checkbox pick but shouldn't be learned from or counted in workload stats).
 */
export async function getAiEligibleCrewNameSet(db: D1Database): Promise<Set<string>> {
  const crew = await getActiveCrew(db)
  return new Set(crew.filter((m) => m.include_in_ai !== 0).map((m) => m.name))
}

export function setupCrewEndpoints(app: Hono<{ Bindings: Bindings }>) {
  // Public: active crew roster for the Edit/Add Show checkbox + FOH pickers
  app.get('/api/crew-roster', async (c) => {
    try {
      const roster = await getActiveCrewNames(c.env.DB)
      return c.json({ success: true, roster })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })

  // All crew including inactive (Settings UI)
  app.get('/api/admin/crew', async (c) => {
    try {
      const { results } = await c.env.DB.prepare(`
        SELECT id, name, active, sort_order, include_in_ai, created_at, updated_at
        FROM crew
        ORDER BY sort_order ASC, name ASC
      `).all()

      return c.json({ success: true, crew: results || [] })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })

  app.post('/api/admin/crew', async (c) => {
    try {
      const body = await c.req.json()
      const name = String(body.name || '').trim()
      const sortOrder = Number.isFinite(Number(body.sort_order ?? body.sortOrder))
        ? Number(body.sort_order ?? body.sortOrder)
        : 100
      const active = body.active === 0 || body.active === false ? 0 : 1
      const includeInAi = body.include_in_ai === 0 || body.include_in_ai === false ? 0 : 1

      if (!name) {
        return c.json({ success: false, error: 'Crew name is required' }, 400)
      }

      const result = await c.env.DB.prepare(`
        INSERT INTO crew (name, sort_order, active, include_in_ai, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(name, sortOrder, active, includeInAi).run()

      return c.json({
        success: true,
        crewMember: { id: result.meta.last_row_id, name, sort_order: sortOrder, active, include_in_ai: includeInAi },
      })
    } catch (error: any) {
      const msg = String(error?.message || error)
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        return c.json({ success: false, error: 'A crew member with this name already exists' }, 409)
      }
      return c.json({ success: false, error: msg }, 500)
    }
  })

  app.put('/api/admin/crew/:id', async (c) => {
    try {
      const id = Number(c.req.param('id'))
      if (!Number.isFinite(id)) {
        return c.json({ success: false, error: 'Invalid crew id' }, 400)
      }

      const existing = await c.env.DB.prepare(
        `SELECT id, name, active, sort_order, include_in_ai FROM crew WHERE id = ?`
      ).bind(id).first() as CrewRow | null

      if (!existing) {
        return c.json({ success: false, error: 'Crew member not found' }, 404)
      }

      const body = await c.req.json()
      const name = body.name !== undefined ? String(body.name).trim() : existing.name
      const sortOrder = body.sort_order !== undefined || body.sortOrder !== undefined
        ? Number(body.sort_order ?? body.sortOrder)
        : existing.sort_order
      const active = body.active !== undefined
        ? (body.active === 0 || body.active === false ? 0 : 1)
        : existing.active
      const includeInAi = body.include_in_ai !== undefined
        ? (body.include_in_ai === 0 || body.include_in_ai === false ? 0 : 1)
        : existing.include_in_ai

      if (!name) {
        return c.json({ success: false, error: 'Crew name is required' }, 400)
      }

      await c.env.DB.prepare(`
        UPDATE crew
        SET name = ?, sort_order = ?, active = ?, include_in_ai = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(name, sortOrder, active, includeInAi, id).run()

      return c.json({
        success: true,
        crewMember: { id, name, sort_order: sortOrder, active, include_in_ai: includeInAi },
      })
    } catch (error: any) {
      const msg = String(error?.message || error)
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        return c.json({ success: false, error: 'A crew member with this name already exists' }, 409)
      }
      return c.json({ success: false, error: msg }, 500)
    }
  })

  // Soft-delete (deactivate) by default; ?hard=1 permanently removes the row.
  // Events store crew as plain name strings (not foreign keys), so removing a
  // name here never touches past event records either way.
  app.delete('/api/admin/crew/:id', async (c) => {
    try {
      const id = Number(c.req.param('id'))
      if (!Number.isFinite(id)) {
        return c.json({ success: false, error: 'Invalid crew id' }, 400)
      }

      const hard = c.req.query('hard') === '1'

      if (hard) {
        await c.env.DB.prepare(`DELETE FROM crew WHERE id = ?`).bind(id).run()
      } else {
        await c.env.DB.prepare(`
          UPDATE crew SET active = 0, updated_at = datetime('now') WHERE id = ?
        `).bind(id).run()
      }

      return c.json({ success: true, deleted: hard ? 'hard' : 'soft' })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })
}
