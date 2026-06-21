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
      return this.db.session
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
  constructor({ monthEventCount = 2, session = null } = {}) {
    this.monthEventCount = monthEventCount
    this.session = session
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
    session: { user_id: 1, email: 'admin@example.com', role: 'admin' }
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

