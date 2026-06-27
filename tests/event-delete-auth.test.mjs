import assert from 'node:assert/strict';
import { test } from 'node:test';

import app from '../dist/_worker.js';

function createDb({ authenticated = false, eventCount = 2 } = {}) {
  const statements = [];

  return {
    statements,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async first() {
          statements.push({ type: 'first', sql, params: this.params });

          if (sql.includes('FROM sessions')) {
            return authenticated
              ? { id: 1, email: 'admin@example.com', role: 'admin', status: 'approved' }
              : null;
          }

          if (sql.includes('COUNT(*) as count')) {
            return { count: eventCount };
          }

          return null;
        },
        async all() {
          statements.push({ type: 'all', sql, params: this.params });
          return { results: [] };
        },
        async run() {
          statements.push({ type: 'run', sql, params: this.params });
          return { success: true, meta: { changes: 1, last_row_id: 1 } };
        }
      };

      return statement;
    }
  };
}

function createEnv(db) {
  return {
    DB: db,
    DB_CREW: createDb(),
    AI: null,
    VECTORIZE: null,
    ANTHROPIC_API_KEY: ''
  };
}

function deleteRuns(db) {
  return db.statements.filter((statement) => (
    statement.type === 'run' && /\bDELETE\s+FROM\b/i.test(statement.sql)
  ));
}

test('rejects anonymous single-event deletes before mutating events', async () => {
  const db = createDb();
  const response = await app.fetch(
    new Request('http://localhost/api/events/123', { method: 'DELETE' }),
    createEnv(db)
  );

  assert.equal(response.status, 401);
  assert.equal(deleteRuns(db).length, 0);
});

test('rejects anonymous bulk month deletes before mutating events', async () => {
  const db = createDb();
  const response = await app.fetch(
    new Request('http://localhost/api/events/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ month: 6, year: 2026 })
    }),
    createEnv(db)
  );

  assert.equal(response.status, 401);
  assert.equal(deleteRuns(db).length, 0);
});

test('allows authenticated destructive event deletes', async () => {
  const db = createDb({ authenticated: true });
  const response = await app.fetch(
    new Request('http://localhost/api/events/123', {
      method: 'DELETE',
      headers: { cookie: 'session_token=valid-token' }
    }),
    createEnv(db)
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.ok(deleteRuns(db).some((statement) => statement.sql.includes('DELETE FROM events WHERE id = ?')));
});
