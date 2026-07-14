import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'inherit' })

const worker = await import(`${pathToFileURL(`${process.cwd()}/dist/_worker.js`).href}?rider-notes-test=${Date.now()}`)

const approvedSession = {
  id: 1,
  email: 'approved@example.com',
  role: 'user',
  status: 'approved',
}

function createDbRecorder() {
  const calls = []
  let nextId = 100

  return {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          const call = { sql, args }
          calls.push(call)

          return {
            async first() {
              if (/FROM sessions s\s+JOIN users u ON s\.user_id = u\.id/i.test(sql)) {
                return approvedSession
              }
              if (/SELECT id, show_group_id FROM events/i.test(sql)) {
                return null
              }
              return null
            },
            async all() {
              return { results: [] }
            },
            async run() {
              return { success: true, meta: { last_row_id: nextId++ } }
            },
          }
        },
      }
    },
  }
}

async function routeRequest(path, options = {}, db = createDbRecorder()) {
  const response = await worker.default.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        cookie: 'session_token=valid-session',
        ...(options.headers || {}),
      },
    }),
    {
      DB: db,
      DB_CREW: db,
      AI: null,
      VECTORIZE: null,
      ANTHROPIC_API_KEY: '',
    },
  )

  return { response, body: await response.json().catch(() => null), db }
}

function eventInsertCalls(db) {
  return db.calls.filter((call) => /INSERT INTO events/i.test(call.sql))
}

test('single-date event creates persist rider and notes', async () => {
  const { response, body, db } = await routeRequest('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      event_date: '2026-01-10',
      program: 'Rider Show',
      venue: 'Tata Theatre',
      rider: 'https://example.com/rider.pdf',
      notes: 'Private setup notes',
    }),
  })

  assert.equal(response.status, 201)
  assert.equal(body.success, true)

  const [insert] = eventInsertCalls(db)
  assert.match(insert.sql, /rider,\s*notes/i)
  assert.equal(insert.args[9], 'https://example.com/rider.pdf')
  assert.equal(insert.args[10], 'Private setup notes')
})

test('multi-date event creates persist rider and notes on every date', async () => {
  const { response, body, db } = await routeRequest('/api/events/multi-date', {
    method: 'POST',
    body: JSON.stringify({
      dates: ['2026-02-10', '2026-02-11', '2026-02-12'],
      program: 'Touring Show',
      venue: 'Experimental Theatre',
      rider: 'https://example.com/tour-rider.pdf',
      notes: 'Same notes for all nights',
    }),
  })

  assert.equal(response.status, 201)
  assert.equal(body.success, true)

  const inserts = eventInsertCalls(db)
  assert.equal(inserts.length, 3)
  for (const insert of inserts) {
    assert.match(insert.sql, /rider,\s*notes/i)
    assert.equal(insert.args[9], 'https://example.com/tour-rider.pdf')
    assert.equal(insert.args[10], 'Same notes for all nights')
  }
})

test('bulk manual inserts persist rider and notes for extended dates', async () => {
  const { response, body, db } = await routeRequest('/api/events/bulk', {
    method: 'POST',
    body: JSON.stringify({
      source: 'manual',
      events: [
        {
          event_date: '2026-03-11',
          program: 'Extended Show',
          venue: 'Jamshed Bhabha Theatre',
          rider: 'https://example.com/extended-rider.pdf',
          notes: 'Copy these details',
        },
      ],
    }),
  })

  assert.equal(response.status, 201)
  assert.equal(body.success, true)

  const [insert] = eventInsertCalls(db)
  assert.match(insert.sql, /rider,\s*notes/i)
  assert.equal(insert.args[9], 'https://example.com/extended-rider.pdf')
  assert.equal(insert.args[10], 'Copy these details')
})

test('event updates preserve rider and notes when omitted', async () => {
  const { response, body, db } = await routeRequest('/api/events/42', {
    method: 'PUT',
    body: JSON.stringify({
      event_date: '2026-04-10',
      program: 'Preserve Metadata',
      venue: 'Tata Theatre',
    }),
  })

  assert.equal(response.status, 200)
  assert.equal(body.success, true)

  const update = db.calls.find((call) => /UPDATE events\s+SET/i.test(call.sql))
  assert.match(update.sql, /rider = CASE WHEN \? THEN \? ELSE rider END/i)
  assert.match(update.sql, /notes = CASE WHEN \? THEN \? ELSE notes END/i)
  assert.equal(update.args[9], 0)
  assert.equal(update.args[10], null)
  assert.equal(update.args[11], 0)
  assert.equal(update.args[12], null)
})

test('event updates can still explicitly clear rider and notes', async () => {
  const { response, body, db } = await routeRequest('/api/events/42', {
    method: 'PUT',
    body: JSON.stringify({
      event_date: '2026-04-10',
      program: 'Clear Metadata',
      venue: 'Tata Theatre',
      rider: null,
      notes: '',
    }),
  })

  assert.equal(response.status, 200)
  assert.equal(body.success, true)

  const update = db.calls.find((call) => /UPDATE events\s+SET/i.test(call.sql))
  assert.equal(update.args[9], 1)
  assert.equal(update.args[10], null)
  assert.equal(update.args[11], 1)
  assert.equal(update.args[12], null)
})
