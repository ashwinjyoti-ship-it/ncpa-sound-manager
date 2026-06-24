import assert from 'node:assert/strict'
import test from 'node:test'

import app from '../dist/_worker.js'

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.params = []
  }

  bind(...params) {
    this.params = params
    return this
  }

  async first() {
    if (this.sql.includes('COUNT(*) as count FROM events')) {
      return { count: this.db.monthEventCount }
    }
    if (this.sql.includes('FROM sessions')) {
      const session = this.db.sessions.get(this.params[0])
      if (!session) return null

      if (this.sql.includes("u.status = 'approved'") && session.status !== 'approved') {
        return null
      }

      if (this.sql.includes('datetime(s.expires_at)')) {
        return new Date(session.expires_at) > new Date(this.db.now) ? session : null
      }

      const sqliteNow = this.db.now.replace('T', ' ').replace(/\.\d{3}Z$/, '')
      return session.expires_at > sqliteNow ? session : null
    }
    return null
  }

  async all() {
    return { results: [] }
  }

  async run() {
    if (this.sql.includes('DELETE FROM events')) {
      this.db.deletedEvents = true
    }
    return { success: true }
  }
}

class FakeD1 {
  constructor({ monthEventCount = 2, sessions = {}, now = '2026-06-21T11:00:00.000Z' } = {}) {
    this.monthEventCount = monthEventCount
    this.sessions = new Map(Object.entries(sessions))
    this.now = now
    this.deletedEvents = false
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

test('bulk month delete rejects requests without an approved session before deleting events', async () => {
  const db = new FakeD1()

  const response = await app.request('/api/events/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month: 6, year: 2026 })
  }, { DB: db })

  assert.equal(response.status, 401)
  assert.equal(db.deletedEvents, false)
})

test('single event delete rejects requests without an approved session before deleting events', async () => {
  const db = new FakeD1()

  const response = await app.request('/api/events/123', {
    method: 'DELETE'
  }, { DB: db })

  assert.equal(response.status, 401)
  assert.equal(db.deletedEvents, false)
})

test('bulk month delete still deletes events for an approved session', async () => {
  const db = new FakeD1({
    sessions: {
      'valid-token': {
        user_id: 1,
        email: 'admin@example.com',
        role: 'admin',
        status: 'approved',
        expires_at: '2026-06-22T11:00:00.000Z'
      }
    }
  })

  const response = await app.request('/api/events/bulk-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'session_token=valid-token'
    },
    body: JSON.stringify({ month: 6, year: 2026 })
  }, { DB: db })

  assert.equal(response.status, 200)
  assert.equal(db.deletedEvents, true)
})

test('bulk month delete rejects expired sessions before deleting events', async () => {
  const db = new FakeD1({
    sessions: {
      'expired-token': {
        user_id: 1,
        email: 'admin@example.com',
        role: 'admin',
        status: 'approved',
        expires_at: '2026-06-21T10:00:00.000Z'
      }
    }
  })

  const response = await app.request('/api/events/bulk-delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'session_token=expired-token'
    },
    body: JSON.stringify({ month: 6, year: 2026 })
  }, { DB: db })

  assert.equal(response.status, 401)
  assert.equal(db.deletedEvents, false)
})

