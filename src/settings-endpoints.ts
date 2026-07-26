// Configurable venues + app settings (Anthropic API key for Word parse / AI)
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { requireAdminUser } from './auth-utils'

type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY?: string
}

export type VenueRow = {
  id: number
  code: string
  display_name: string
  sort_order: number
  active: number
  created_at?: string
  updated_at?: string
}

export const DEFAULT_VENUES: Array<{ code: string; display_name: string; sort_order: number }> = [
  { code: 'JBT Museum', display_name: 'JBT Museum', sort_order: 10 },
  { code: 'JBT', display_name: 'Jamshed Bhabha Theatre', sort_order: 20 },
  { code: 'TET', display_name: 'Experimental Theatre', sort_order: 30 },
  { code: 'GDT', display_name: 'Godrej Dance Theatre', sort_order: 40 },
  { code: 'LT', display_name: 'Little Theatre', sort_order: 50 },
  { code: 'SVR', display_name: 'Sea View Room', sort_order: 60 },
  { code: 'TT', display_name: 'Tata Theatre', sort_order: 70 },
  { code: 'DP Art Gallery', display_name: 'Dilip Piramal Art Gallery', sort_order: 80 },
  { code: 'Others', display_name: 'Others', sort_order: 90 },
]

const ANTHROPIC_KEY = 'anthropic_api_key'

function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 8) return '••••••••'
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`
}

export async function getActiveVenues(db: D1Database): Promise<VenueRow[]> {
  try {
    const { results } = await db.prepare(`
      SELECT id, code, display_name, sort_order, active, created_at, updated_at
      FROM venues
      WHERE active = 1
      ORDER BY sort_order ASC, code ASC
    `).all()
    if (results && results.length > 0) {
      return results as VenueRow[]
    }
  } catch {
    // Table may not exist yet on an old local DB
  }
  return DEFAULT_VENUES.map((v, i) => ({
    id: -(i + 1),
    code: v.code,
    display_name: v.display_name,
    sort_order: v.sort_order,
    active: 1,
  }))
}

export async function getActiveVenueCodes(db: D1Database): Promise<string[]> {
  const venues = await getActiveVenues(db)
  return venues.map((v) => v.code)
}

/** Prefer Settings-stored key; fall back to Cloudflare env secret. */
export async function resolveAnthropicApiKey(
  db: D1Database,
  envKey?: string
): Promise<{ key: string | null; source: 'settings' | 'environment' | null }> {
  try {
    const row = await db.prepare(
      `SELECT value FROM app_settings WHERE key = ?`
    ).bind(ANTHROPIC_KEY).first() as { value: string } | null

    if (row?.value?.trim()) {
      return { key: row.value.trim(), source: 'settings' }
    }
  } catch {
    // ignore missing table
  }

  if (envKey?.trim()) {
    return { key: envKey.trim(), source: 'environment' }
  }

  return { key: null, source: null }
}

async function syncVenueAlias(db: D1Database, code: string, displayName: string) {
  try {
    await db.prepare(`
      INSERT OR IGNORE INTO venue_aliases (canonical_name, alias) VALUES (?, ?)
    `).bind(displayName, code).run()
    if (code !== displayName) {
      await db.prepare(`
        INSERT OR IGNORE INTO venue_aliases (canonical_name, alias) VALUES (?, ?)
      `).bind(displayName, displayName).run()
    }
  } catch {
    // venue_aliases may be unavailable; non-fatal
  }
}

export function setupSettingsEndpoints(app: Hono<{ Bindings: Bindings }>) {
  // Public: active venues for dropdowns / filters
  app.get('/api/venues', async (c) => {
    try {
      const venues = await getActiveVenues(c.env.DB)
      return c.json({ success: true, venues })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })

  // Admin: all venues including inactive
  app.get('/api/admin/venues', async (c) => {
    const authError = await requireAdminUser(c as any)
    if (authError) return authError

    try {
      const { results } = await c.env.DB.prepare(`
        SELECT id, code, display_name, sort_order, active, created_at, updated_at
        FROM venues
        ORDER BY sort_order ASC, code ASC
      `).all()

      return c.json({ success: true, venues: results || [] })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })

  app.post('/api/admin/venues', async (c) => {
    const authError = await requireAdminUser(c as any)
    if (authError) return authError

    try {
      const body = await c.req.json()
      const code = String(body.code || '').trim()
      const displayName = String(body.display_name || body.displayName || code).trim()
      const sortOrder = Number.isFinite(Number(body.sort_order ?? body.sortOrder))
        ? Number(body.sort_order ?? body.sortOrder)
        : 100
      const active = body.active === 0 || body.active === false ? 0 : 1

      if (!code) {
        return c.json({ success: false, error: 'Venue code is required' }, 400)
      }

      const result = await c.env.DB.prepare(`
        INSERT INTO venues (code, display_name, sort_order, active, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).bind(code, displayName || code, sortOrder, active).run()

      await syncVenueAlias(c.env.DB, code, displayName || code)

      return c.json({
        success: true,
        venue: {
          id: result.meta.last_row_id,
          code,
          display_name: displayName || code,
          sort_order: sortOrder,
          active,
        },
      })
    } catch (error: any) {
      const msg = String(error?.message || error)
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        return c.json({ success: false, error: 'A venue with this code already exists' }, 409)
      }
      return c.json({ success: false, error: msg }, 500)
    }
  })

  app.put('/api/admin/venues/:id', async (c) => {
    const authError = await requireAdminUser(c as any)
    if (authError) return authError

    try {
      const id = Number(c.req.param('id'))
      if (!Number.isFinite(id)) {
        return c.json({ success: false, error: 'Invalid venue id' }, 400)
      }

      const existing = await c.env.DB.prepare(
        `SELECT id, code, display_name, sort_order, active FROM venues WHERE id = ?`
      ).bind(id).first() as VenueRow | null

      if (!existing) {
        return c.json({ success: false, error: 'Venue not found' }, 404)
      }

      const body = await c.req.json()
      const code = body.code !== undefined ? String(body.code).trim() : existing.code
      const displayName = body.display_name !== undefined || body.displayName !== undefined
        ? String(body.display_name ?? body.displayName).trim()
        : existing.display_name
      const sortOrder = body.sort_order !== undefined || body.sortOrder !== undefined
        ? Number(body.sort_order ?? body.sortOrder)
        : existing.sort_order
      const active = body.active !== undefined
        ? (body.active === 0 || body.active === false ? 0 : 1)
        : existing.active

      if (!code) {
        return c.json({ success: false, error: 'Venue code is required' }, 400)
      }

      await c.env.DB.prepare(`
        UPDATE venues
        SET code = ?, display_name = ?, sort_order = ?, active = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(code, displayName || code, sortOrder, active, id).run()

      await syncVenueAlias(c.env.DB, code, displayName || code)

      return c.json({
        success: true,
        venue: {
          id,
          code,
          display_name: displayName || code,
          sort_order: sortOrder,
          active,
        },
      })
    } catch (error: any) {
      const msg = String(error?.message || error)
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        return c.json({ success: false, error: 'A venue with this code already exists' }, 409)
      }
      return c.json({ success: false, error: msg }, 500)
    }
  })

  // Soft-delete (deactivate) by default; ?hard=1 permanently removes the row
  app.delete('/api/admin/venues/:id', async (c) => {
    const authError = await requireAdminUser(c as any)
    if (authError) return authError

    try {
      const id = Number(c.req.param('id'))
      if (!Number.isFinite(id)) {
        return c.json({ success: false, error: 'Invalid venue id' }, 400)
      }

      const hard = c.req.query('hard') === '1'

      if (hard) {
        await c.env.DB.prepare(`DELETE FROM venues WHERE id = ?`).bind(id).run()
      } else {
        await c.env.DB.prepare(`
          UPDATE venues SET active = 0, updated_at = datetime('now') WHERE id = ?
        `).bind(id).run()
      }

      return c.json({ success: true, deleted: hard ? 'hard' : 'soft' })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })

  // Admin settings (Anthropic / Word document API key)
  app.get('/api/admin/settings', async (c) => {
    const authError = await requireAdminUser(c as any)
    if (authError) return authError

    try {
      const resolved = await resolveAnthropicApiKey(c.env.DB, c.env.ANTHROPIC_API_KEY)
      let settingsValue = ''
      try {
        const row = await c.env.DB.prepare(
          `SELECT value FROM app_settings WHERE key = ?`
        ).bind(ANTHROPIC_KEY).first() as { value: string } | null
        settingsValue = row?.value || ''
      } catch {
        // ignore
      }

      return c.json({
        success: true,
        settings: {
          anthropic_api_key: {
            configured: Boolean(resolved.key),
            source: resolved.source,
            masked: resolved.key ? maskSecret(resolved.key) : '',
            has_settings_value: Boolean(settingsValue.trim()),
            has_environment_value: Boolean(c.env.ANTHROPIC_API_KEY?.trim()),
          },
        },
      })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })

  app.put('/api/admin/settings', async (c) => {
    const authError = await requireAdminUser(c as any)
    if (authError) return authError

    try {
      const body = await c.req.json()
      const token = getCookie(c, 'session_token')
      let updatedBy = 'admin'
      if (token) {
        const session = await c.env.DB.prepare(`
          SELECT u.email
          FROM sessions s
          JOIN users u ON s.user_id = u.id
          WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
        `).bind(token).first() as { email: string } | null
        if (session?.email) updatedBy = session.email
      }

      if (body.anthropic_api_key !== undefined || body.clear_anthropic_api_key === true) {
        const value = String(body.anthropic_api_key ?? '').trim()

        if (!value || body.clear_anthropic_api_key === true) {
          await c.env.DB.prepare(`
            DELETE FROM app_settings WHERE key = ?
          `).bind(ANTHROPIC_KEY).run()
        } else {
          await c.env.DB.prepare(`
            INSERT INTO app_settings (key, value, updated_at, updated_by)
            VALUES (?, ?, datetime('now'), ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at,
              updated_by = excluded.updated_by
          `).bind(ANTHROPIC_KEY, value, updatedBy).run()
        }
      }

      const resolved = await resolveAnthropicApiKey(c.env.DB, c.env.ANTHROPIC_API_KEY)

      return c.json({
        success: true,
        settings: {
          anthropic_api_key: {
            configured: Boolean(resolved.key),
            source: resolved.source,
            masked: resolved.key ? maskSecret(resolved.key) : '',
            has_settings_value: resolved.source === 'settings',
            has_environment_value: Boolean(c.env.ANTHROPIC_API_KEY?.trim()),
          },
        },
      })
    } catch (error: any) {
      return c.json({ success: false, error: error.message }, 500)
    }
  })
}
