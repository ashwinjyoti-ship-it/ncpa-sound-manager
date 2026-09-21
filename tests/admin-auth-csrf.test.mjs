import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'inherit' })

const worker = await import(
  `${pathToFileURL(`${process.cwd()}/dist/_worker.js`).href}?admin-csrf=${Date.now()}`
)

const adminSession = {
  id: 1,
  email: 'ashwinjyoti@gmail.com',
  role: 'admin',
  status: 'approved',
  password_hash: 'unused-in-csrf-tests'
}

function createEnv() {
  const calls = []
  const users = new Map([
    [42, { id: 42, email: 'attacker@example.com', status: 'pending' }]
  ])

  const executeFor = (sql, args) => ({
    async first() {
      if (sql.includes('FROM sessions')) return adminSession
      if (sql.includes('FROM users') && sql.includes('WHERE id = ?')) {
        return { id: adminSession.id, password_hash: 'abc' }
      }
      return null
    },
    async all() {
      if (sql.includes("status = 'pending'")) {
        return { results: [...users.values()].filter((u) => u.status === 'pending') }
      }
      return { results: [] }
    },
    async run() {
      if (/UPDATE users[\s\S]*status = 'approved'/i.test(sql)) {
        const [, userId] = args
        const id = Number(userId)
        const row = users.get(id)
        if (row) row.status = 'approved'
        calls.push({ type: 'approve', userId: id, approvedBy: args[0] })
        return { success: true }
      }
      if (/DELETE FROM users WHERE id = \?/i.test(sql)) {
        const [userId] = args
        const id = Number(userId)
        users.delete(id)
        calls.push({ type: 'reject', userId: id })
        return { success: true }
      }
      if (/UPDATE users SET password_hash/i.test(sql)) {
        calls.push({ type: 'password', userId: Number(args[1]) })
        return { success: true }
      }
      return { success: true }
    }
  })

  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return executeFor(sql, args)
        }
      }
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
    calls,
    users
  }
}

async function request(path, { origin, method = 'POST' } = {}) {
  const { env, calls, users } = createEnv()
  const headers = {
    cookie: 'session_token=admin-session'
  }
  if (origin) headers.origin = origin

  const response = await worker.default.fetch(
    new Request(`http://localhost${path}`, { method, headers }),
    env
  )
  return {
    response,
    calls,
    users,
    body: await response.json().catch(() => null)
  }
}

const csrfMutations = [
  {
    name: 'approve pending user',
    path: '/api/admin/approve-user/42',
    mutationType: 'approve'
  },
  {
    name: 'reject/delete user',
    path: '/api/admin/reject-user/42',
    mutationType: 'reject'
  }
]

for (const mutation of csrfMutations) {
  test(`cross-site ${mutation.name} is rejected (SameSite=None CSRF)`, async () => {
    const { response, body, calls, users } = await request(mutation.path, {
      origin: 'https://attacker.example'
    })

    assert.equal(response.status, 403)
    assert.equal(body.success, false)
    assert.match(body.error, /origin/i)
    assert.equal(calls.length, 0)
    assert.equal(users.get(42)?.status, 'pending')
  })

  test(`same-origin admin ${mutation.name} still works`, async () => {
    const { response, body, calls } = await request(mutation.path, {
      origin: 'http://localhost'
    })

    assert.equal(response.status, 200)
    assert.equal(body.success, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].type, mutation.mutationType)
    assert.equal(calls[0].userId, 42)
  })
}

test('cross-site change-password is rejected before DB writes', async () => {
  const { response, body, calls } = await request('/api/auth/change-password', {
    origin: 'https://attacker.example'
  })

  assert.equal(response.status, 403)
  assert.match(body.error, /origin/i)
  assert.equal(calls.length, 0)
})

test('event delete still rejects cross-site while admin approve is gated the same way', async () => {
  const { env } = createEnv()
  const eventDelete = await worker.default.fetch(
    new Request('http://localhost/api/events/1', {
      method: 'DELETE',
      headers: {
        cookie: 'session_token=admin-session',
        origin: 'https://attacker.example'
      }
    }),
    env
  )
  const approve = await worker.default.fetch(
    new Request('http://localhost/api/admin/approve-user/42', {
      method: 'POST',
      headers: {
        cookie: 'session_token=admin-session',
        origin: 'https://attacker.example'
      }
    }),
    env
  )

  assert.equal(eventDelete.status, 403)
  assert.equal(approve.status, 403)
})
