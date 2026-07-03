import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'

type AuthBindings = {
  DB: D1Database
}

type AuthContext = Context<{ Bindings: AuthBindings }>

type AuthSession = {
  id: number
  email: string
  role: string
  status: string
}

async function getAuthenticatedSession(c: AuthContext): Promise<AuthSession | Response> {
  const token = getCookie(c, 'session_token')

  if (!token) {
    return c.json({ success: false, error: 'Not authenticated' }, 401)
  }

  // Session cookie is SameSite=None, so reject cross-site requests before
  // trusting it — otherwise any site can ride an approved session's cookie.
  const origin = c.req.header('Origin')
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ success: false, error: 'Invalid request origin' }, 403)
  }

  const session = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.role, u.status
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
  `).bind(token).first() as AuthSession | null

  if (!session) {
    return c.json({ success: false, error: 'Invalid or expired session' }, 401)
  }

  return session
}

function isResponse(value: AuthSession | Response): value is Response {
  return value instanceof Response
}

export async function requireAuthenticatedUser(c: AuthContext): Promise<Response | null> {
  const session = await getAuthenticatedSession(c)
  if (isResponse(session)) return session

  if (session.status !== 'approved') {
    return c.json({ success: false, error: 'Account is not approved' }, 403)
  }

  return null
}

export async function requireAdminUser(c: AuthContext): Promise<Response | null> {
  const session = await getAuthenticatedSession(c)
  if (isResponse(session)) return session

  if (session.status !== 'approved') {
    return c.json({ success: false, error: 'Account is not approved' }, 403)
  }

  if (session.role !== 'admin') {
    return c.json({ success: false, error: 'Admin access required' }, 403)
  }

  return null
}
