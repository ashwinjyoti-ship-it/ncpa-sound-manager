import assert from 'node:assert/strict';
import { test } from 'node:test';

import app from '../dist/_worker.js';

const jsonRequest = (url, body, init = {}) =>
  new Request(url, {
    method: init.method || 'POST',
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
    body: JSON.stringify(body),
  });

function createDbStub() {
  const state = {
    events: [
      { id: 1, event_date: '2026-06-01' },
      { id: 2, event_date: '2026-06-15' },
      { id: 3, event_date: '2026-07-01' },
    ],
    event_conflicts: [{ event_id_1: 1, event_id_2: 2 }],
    calendar_sync: [{ event_id: 1 }],
    assignment_recommendations: [{ event_id: 2 }],
    sessions: [{ token: 'valid-session' }],
  };

  const idsForMonth = (monthKey) =>
    new Set(
      state.events
        .filter((event) => event.event_date.startsWith(monthKey))
        .map((event) => event.id),
    );

  const db = {
    state,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (/FROM sessions s\s+JOIN users u ON s\.user_id = u\.id/i.test(sql)) {
                const [token] = params;
                return state.sessions.some((session) => session.token === token)
                  ? {
                      id: 1,
                      email: 'approved@example.com',
                      role: 'user',
                      status: 'approved',
                    }
                  : null;
              }
              if (/SELECT COUNT\(\*\) as count FROM events/i.test(sql)) {
                const [monthKey] = params;
                return {
                  count: state.events.filter((event) =>
                    event.event_date.startsWith(monthKey),
                  ).length,
                };
              }
              return null;
            },
            async all() {
              if (/SELECT id FROM events WHERE strftime\('%Y-%m', event_date\) = \?/i.test(sql)) {
                const [monthKey] = params;
                return {
                  results: state.events
                    .filter((event) => event.event_date.startsWith(monthKey))
                    .map((event) => ({ id: event.id })),
                };
              }
              throw new Error(`Unexpected all SQL: ${sql}`);
            },
            async run() {
              if (/DELETE FROM event_conflicts WHERE event_id_1 = \?/i.test(sql)) {
                const [id1, id2] = params;
                state.event_conflicts = state.event_conflicts.filter(
                  (row) => row.event_id_1 !== id1 && row.event_id_2 !== id2,
                );
                return { success: true };
              }
              if (/DELETE FROM calendar_sync WHERE event_id = \?/i.test(sql)) {
                const [id] = params;
                state.calendar_sync = state.calendar_sync.filter(
                  (row) => row.event_id !== id,
                );
                return { success: true };
              }
              if (/DELETE FROM assignment_recommendations WHERE event_id = \?/i.test(sql)) {
                const [id] = params;
                state.assignment_recommendations =
                  state.assignment_recommendations.filter((row) => row.event_id !== id);
                return { success: true };
              }
              if (/DELETE FROM events WHERE id = \?/i.test(sql)) {
                const [id] = params;
                state.events = state.events.filter((event) => event.id !== id);
                return { success: true };
              }

              if (/DELETE FROM event_conflicts\s+WHERE event_id_1 IN/i.test(sql)) {
                const [monthKey] = params;
                const ids = idsForMonth(monthKey);
                state.event_conflicts = state.event_conflicts.filter(
                  (row) => !ids.has(row.event_id_1) && !ids.has(row.event_id_2),
                );
                return { success: true };
              }
              if (/DELETE FROM calendar_sync\s+WHERE event_id IN/i.test(sql)) {
                const [monthKey] = params;
                const ids = idsForMonth(monthKey);
                state.calendar_sync = state.calendar_sync.filter(
                  (row) => !ids.has(row.event_id),
                );
                return { success: true };
              }
              if (/DELETE FROM assignment_recommendations\s+WHERE event_id IN/i.test(sql)) {
                const [monthKey] = params;
                const ids = idsForMonth(monthKey);
                state.assignment_recommendations =
                  state.assignment_recommendations.filter((row) => !ids.has(row.event_id));
                return { success: true };
              }
              if (/DELETE FROM events\s+WHERE strftime\('%Y-%m', event_date\) = \?/i.test(sql)) {
                const [monthKey] = params;
                state.events = state.events.filter(
                  (event) => !event.event_date.startsWith(monthKey),
                );
                return { success: true };
              }

              throw new Error(`Unexpected run SQL: ${sql}`);
            },
          };
        },
      };
    },
  };

  return db;
}

test('bulk month delete rejects anonymous requests without removing events', async () => {
  const db = createDbStub();

  const response = await app.fetch(
    jsonRequest('http://localhost/api/events/bulk-delete', { month: 6, year: 2026 }),
    { DB: db },
  );

  assert.equal(response.status, 401);
  assert.equal(db.state.events.length, 3);
  assert.deepEqual(
    db.state.events.map((event) => event.id),
    [1, 2, 3],
  );
});

test('bulk month delete allows approved sessions to delete the selected month', async () => {
  const db = createDbStub();

  const response = await app.fetch(
    jsonRequest(
      'http://localhost/api/events/bulk-delete',
      { month: 6, year: 2026 },
      {
        headers: {
          cookie: 'session_token=valid-session',
          origin: 'http://localhost',
        },
      },
    ),
    { DB: db },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.deleted, 2);
  assert.deepEqual(
    db.state.events.map((event) => event.id),
    [3],
  );
  assert.deepEqual(db.state.event_conflicts, []);
  assert.deepEqual(db.state.calendar_sync, []);
  assert.deepEqual(db.state.assignment_recommendations, []);
});

test('bulk month delete rejects cross-site requests even with a valid session cookie', async () => {
  const db = createDbStub();

  const response = await app.fetch(
    jsonRequest(
      'http://localhost/api/events/bulk-delete',
      { month: 6, year: 2026 },
      {
        headers: {
          cookie: 'session_token=valid-session',
          origin: 'https://attacker.example',
        },
      },
    ),
    { DB: db },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(
    db.state.events.map((event) => event.id),
    [1, 2, 3],
  );
});

test('single event delete rejects anonymous requests without removing the event', async () => {
  const db = createDbStub();

  const response = await app.fetch(
    new Request('http://localhost/api/events/1', { method: 'DELETE' }),
    { DB: db },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(
    db.state.events.map((event) => event.id),
    [1, 2, 3],
  );
});

test('single event delete allows approved sessions to remove the event and dependencies', async () => {
  const db = createDbStub();

  const response = await app.fetch(
    new Request('http://localhost/api/events/1', {
      method: 'DELETE',
      headers: { cookie: 'session_token=valid-session' },
    }),
    { DB: db },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    db.state.events.map((event) => event.id),
    [2, 3],
  );
  assert.deepEqual(db.state.event_conflicts, []);
  assert.deepEqual(db.state.calendar_sync, []);
  assert.deepEqual(db.state.assignment_recommendations, [{ event_id: 2 }]);
});
