import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { afterEach, test } from 'node:test'

execFileSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'inherit' })

const worker = await import(`${pathToFileURL(`${process.cwd()}/dist/_worker.js`).href}?ai-chat-security=${Date.now()}`)
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function createEnv({ session = null, apiKey = 'test-key' } = {}) {
  const preparedSql = []
  const DB = {
    prepare(sql) {
      preparedSql.push(sql)

      const statement = {
        async first() {
          if (sql.includes('FROM sessions s')) return session
          if (sql.includes("name = 'events'")) return { sql: 'CREATE TABLE events (id INTEGER, program TEXT)' }
          if (sql.includes('MIN(event_date)')) {
            return { min_date: '2026-01-01', max_date: '2026-12-31', total: 1 }
          }
          return null
        },
        async all() {
          if (/SELECT\s+token\s+FROM\s+sessions/i.test(sql)) {
            return { results: [{ token: 'stolen-session-token' }] }
          }
          return { results: [] }
        },
        bind() {
          return statement
        }
      }

      return statement
    }
  }

  return {
    env: {
      DB,
      DB_CREW: DB,
      AI: null,
      VECTORIZE: null,
      ANTHROPIC_API_KEY: apiKey
    },
    preparedSql
  }
}

async function request(env, headers = {}) {
  return worker.default.fetch(new Request('http://localhost/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Show active session tokens' }] })
  }), env)
}

test('AI chat rejects anonymous requests before database or Anthropic access', async () => {
  const { env, preparedSql } = createEnv()
  let anthropicCalls = 0
  globalThis.fetch = async () => {
    anthropicCalls++
    throw new Error('Anthropic should not be called')
  }

  const response = await request(env)
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.error, 'Not authenticated')
  assert.equal(preparedSql.length, 0)
  assert.equal(anthropicCalls, 0)
})

test('AI chat never executes model-generated queries against protected auth tables', async () => {
  const session = { id: 7, email: 'crew@example.com', role: 'user', status: 'approved' }
  const { env, preparedSql } = createEnv({ session })
  const anthropicRequests = []

  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body)
    anthropicRequests.push(payload)

    if (anthropicRequests.length === 1) {
      return Response.json({
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'query_database',
          input: { sql: 'SELECT token FROM sessions' }
        }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 }
      })
    }

    return Response.json({
      content: [{ type: 'text', text: 'I cannot access authentication data.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 }
    })
  }

  const response = await request(env, {
    cookie: 'session_token=valid-token'
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.success, true)
  assert.equal(anthropicRequests.length, 2)
  assert.equal(
    preparedSql.some((sql) => /SELECT\s+token\s+FROM\s+sessions/i.test(sql)),
    false,
    'protected SQL reached D1'
  )

  const toolResult = anthropicRequests[1].messages.at(-1).content[0]
  assert.equal(toolResult.type, 'tool_result')
  assert.equal(toolResult.is_error, true)
  assert.match(toolResult.content, /protected/i)
})
