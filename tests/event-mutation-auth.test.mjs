import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'inherit' })

const worker = await import(`${pathToFileURL(`${process.cwd()}/dist/_worker.js`).href}?auth-test=${Date.now()}`)

function createStatement(sql, calls, session) {
  const execute = {
    async first() {
      if (sql.includes('FROM sessions')) return session
      if (sql.includes('COUNT(*) as count FROM events')) return { count: 2 }
      return null
    },
    async all() {
      return { results: [{ id: 1, program: 'Public Event' }] }
    },
    async run() {
      return { success: true, meta: { last_row_id: 123 } }
    }
  }

  return {
    ...execute,
    bind(...args) {
      calls.push({ sql, args })
      return execute
    }
  }
}

function createEnv({ session = null } = {}) {
  const calls = []
  const DB = {
    prepare(sql) {
      return createStatement(sql, calls, session)
    }
  }

  return {
    env: {
      DB,
      DB_CREW: DB,
      AI: null,
      VECTORIZE: null,
      ANTHROPIC_API_KEY: ''
    },
    calls
  }
}

async function request(path, options = {}, envOptions = {}) {
  const { env, calls } = createEnv(envOptions)
  const response = await worker.default.fetch(new Request(`http://localhost${path}`, options), env)
  return { response, calls, body: await response.json().catch(() => null) }
}

test('event reads remain public', async () => {
  const { response, body } = await request('/api/events')

  assert.equal(response.status, 200)
  assert.equal(body.success, true)
  assert.equal(body.data[0].program, 'Public Event')
})

const eventMutationRequests = [
  {
    name: 'create event',
    path: '/api/events',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_date: '2026-01-10', program: 'New Show', venue: 'Tata Theatre' })
    }
  },
  {
    name: 'bulk crew propagation',
    path: '/api/events/bulk-crew',
    options: {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [1, 2], foh_crew: 'Naren', stage_crew: ['Coni'] })
    }
  },
  {
    name: 'update event',
    path: '/api/events/1',
    options: {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_date: '2026-01-10', program: 'Updated Show', venue: 'Tata Theatre' })
    }
  },
  {
    name: 'delete event',
    path: '/api/events/1',
    options: { method: 'DELETE' }
  },
  {
    name: 'bulk month delete',
    path: '/api/events/bulk-delete',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ month: 1, year: 2026 })
    }
  },
  {
    name: 'bulk import',
    path: '/api/events/bulk',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ event_date: '2026-01-10', program: 'Imported Show', venue: 'Tata Theatre' }] })
    }
  },
  {
    name: 'bulk crew assignment',
    path: '/api/events/bulk-assign',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventIds: [1, 2], crew: 'Naren' })
    }
  },
  {
    name: 'bulk status update',
    path: '/api/events/update-status',
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventIds: [1, 2], status: 'complete' })
    }
  }
]

for (const mutation of eventMutationRequests) {
  test(`${mutation.name} requires a session before touching event rows`, async () => {
    const { response, body, calls } = await request(mutation.path, mutation.options)

    assert.equal(response.status, 401)
    assert.equal(body.success, false)
    assert.equal(body.error, 'Not authenticated')
    assert.equal(calls.length, 0)
  })
}

test('invalid sessions cannot mutate events', async () => {
  const { response, body, calls } = await request('/api/events/bulk-delete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'session_token=expired-token'
    },
    body: JSON.stringify({ month: 1, year: 2026 })
  })

  assert.equal(response.status, 401)
  assert.equal(body.success, false)
  assert.equal(body.error, 'Invalid or expired session')
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /FROM sessions/)
  assert.match(calls[0].sql, /datetime\(s\.expires_at\) > datetime\('now'\)/)
})

test('auth session lookups normalize ISO expiry timestamps', async () => {
  const { response, body, calls } = await request('/api/auth/me', {
    headers: { cookie: 'session_token=expired-token' }
  })

  assert.equal(response.status, 401)
  assert.equal(body.success, false)
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /FROM sessions/)
  assert.match(calls[0].sql, /datetime\(s\.expires_at\) > datetime\('now'\)/)
})

test('embedding backfill requires a session before reading or updating events', async () => {
  const { response, body, calls } = await request('/api/admin/backfill-embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batch_size: 1 })
  })

  assert.equal(response.status, 401)
  assert.equal(body.success, false)
  assert.equal(body.error, 'Not authenticated')
  assert.equal(calls.length, 0)
})

test('embedding backfill requires an admin session', async () => {
  const session = { user_id: 7, email: 'crew@example.com', role: 'user', status: 'approved' }
  const { response, body, calls } = await request('/api/admin/backfill-embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'session_token=user-token'
    },
    body: JSON.stringify({ batch_size: 1 })
  }, { session })

  assert.equal(response.status, 403)
  assert.equal(body.success, false)
  assert.equal(body.error, 'Admin access required')
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /FROM sessions/)
})

test('approved sessions can still perform event mutations', async () => {
  const session = { user_id: 7, email: 'crew@example.com', role: 'user', status: 'approved' }
  const { response, body, calls } = await request('/api/events/bulk-delete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'session_token=valid-token'
    },
    body: JSON.stringify({ month: 1, year: 2026 })
  }, { session })

  assert.equal(response.status, 200)
  assert.equal(body.success, true)
  assert.equal(body.deleted, 2)
  assert.match(calls[0].sql, /FROM sessions/)
  assert.ok(calls.some(call => call.sql.includes('DELETE FROM events')))
})
