import assert from 'node:assert/strict';

import worker from '../dist/_worker.js';

function createD1Stub() {
  const state = {
    nextEventId: 2,
    events: [
      {
        id: 1,
        event_date: '2026-06-15',
        program: 'Existing Show',
        venue: 'Tata Theatre',
        team: 'Original Team',
        sound_requirements: null,
        call_time: null,
        crew: 'Naren',
        foh_crew: 'Naren',
        stage_crew: null,
        requirements_updated: 0
      }
    ],
    sessions: new Map([
      ['valid-token', {
        user_id: 7,
        email: 'approved@example.com',
        role: 'user',
        status: 'approved',
        expires_at: '2999-01-01T00:00:00.000Z'
      }],
      ['admin-token', {
        user_id: 1,
        email: 'admin@example.com',
        role: 'admin',
        status: 'approved',
        expires_at: '2999-01-01T00:00:00.000Z'
      }],
      ['expired-token', {
        user_id: 8,
        email: 'expired@example.com',
        role: 'user',
        status: 'approved',
        expires_at: '2000-01-01T00:00:00.000Z'
      }]
    ])
  };

  return {
    state,
    prepare(sql) {
      return new Statement(state, sql);
    }
  };
}

class Statement {
  constructor(state, sql) {
    this.state = state;
    this.sql = sql;
    this.normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    const sql = this.normalizedSql;

    if (sql.includes('from sessions s') && sql.includes('join users u')) {
      const token = this.args[0];
      const session = this.state.sessions.get(token);
      if (!session) return null;
      if (sql.includes('datetime(s.expires_at) > datetime')) {
        return Date.parse(session.expires_at) > Date.now() ? session : null;
      }
      return session;
    }

    if (sql.includes('select id from events') && sql.includes('where event_date = ? and program = ? and venue = ?')) {
      const [eventDate, program, venue] = this.args;
      return this.state.events.find(event =>
        event.event_date === eventDate &&
        event.program === program &&
        event.venue === venue
      ) || null;
    }

    if (sql.includes('select count(*) as count from events') && sql.includes("strftime('%y-%m', event_date) = ?")) {
      return { count: countEventsInMonth(this.state.events, this.args[0]) };
    }

    if (sql.includes('select count(*) as count from events') && sql.includes("strftime('%Y-%m', event_date) = ?".toLowerCase())) {
      return { count: countEventsInMonth(this.state.events, this.args[0]) };
    }

    return null;
  }

  async all() {
    return { results: [] };
  }

  async run() {
    const sql = this.normalizedSql;

    if (sql.startsWith('insert into events')) {
      const id = this.state.nextEventId++;
      this.state.events.push({
        id,
        event_date: this.args[0],
        program: this.args[1],
        venue: this.args[2],
        team: this.args[3] ?? null,
        sound_requirements: this.args[4] ?? null,
        call_time: this.args[5] ?? null,
        crew: this.args[6] ?? null,
        foh_crew: this.args[7] ?? null,
        stage_crew: this.args[8] ?? null,
        requirements_updated: this.args[9] ?? 0,
        source: this.args[10] ?? null
      });
      return { success: true, meta: { last_row_id: id, changes: 1 } };
    }

    if (sql.startsWith('update events set event_date = ?')) {
      const id = Number(this.args[12]);
      const event = this.state.events.find(item => item.id === id);
      if (event) {
        event.event_date = this.args[0];
        event.program = this.args[1];
        event.venue = this.args[2];
        event.team = this.args[3] ?? null;
        event.sound_requirements = this.args[4] ?? null;
        event.call_time = this.args[5] ?? null;
        event.crew = this.args[6] ?? null;
        event.foh_crew = this.args[7] ?? null;
        event.stage_crew = this.args[8] ?? null;
        event.rider = this.args[9] ?? null;
        event.notes = this.args[10] ?? null;
        event.requirements_updated = this.args[11] ?? 0;
      }
      return { success: true, meta: { changes: event ? 1 : 0 } };
    }

    if (sql.startsWith('update events set foh_crew = ?')) {
      const [fohCrew, stageCrew, crew, ...ids] = this.args;
      for (const event of this.state.events) {
        if (ids.includes(event.id)) {
          event.foh_crew = fohCrew;
          event.stage_crew = stageCrew;
          event.crew = crew;
        }
      }
      return { success: true, meta: { changes: ids.length } };
    }

    if (sql.startsWith('update events set crew = ?, foh_crew = ?, stage_crew = ?')) {
      const [crew, fohCrew, stageCrew, id] = this.args;
      const event = this.state.events.find(item => item.id === id);
      if (event) {
        event.crew = crew;
        event.foh_crew = fohCrew;
        event.stage_crew = stageCrew;
      }
      return { success: true, meta: { changes: event ? 1 : 0 } };
    }

    if (sql.startsWith('delete from events where id = ?')) {
      const id = Number(this.args[0]);
      const before = this.state.events.length;
      this.state.events = this.state.events.filter(event => event.id !== id);
      return { success: true, meta: { changes: before - this.state.events.length } };
    }

    if (sql.startsWith('delete from events') && sql.includes("strftime('%y-%m', event_date) = ?")) {
      return deleteMonth(this.state, this.args[0]);
    }

    if (sql.startsWith('delete from events') && sql.includes("strftime('%Y-%m', event_date) = ?".toLowerCase())) {
      return deleteMonth(this.state, this.args[0]);
    }

    return { success: true, meta: { changes: 0 } };
  }
}

function countEventsInMonth(events, monthKey) {
  return events.filter(event => event.event_date.startsWith(monthKey)).length;
}

function deleteMonth(state, monthKey) {
  const before = state.events.length;
  state.events = state.events.filter(event => !event.event_date.startsWith(monthKey));
  return { success: true, meta: { changes: before - state.events.length } };
}

async function request(env, path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return worker.fetch(new Request(`https://example.test${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }), env, {});
}

async function assertAnonymousMutationRejected(method, path, body) {
  const db = createD1Stub();
  const before = JSON.stringify(db.state.events);
  const response = await request({ DB: db }, path, { method, body });
  const payload = await response.json();

  assert.equal(response.status, 401, `${method} ${path} should reject anonymous writes`);
  assert.equal(payload.success, false);
  assert.equal(payload.error, 'Not authenticated');
  assert.equal(JSON.stringify(db.state.events), before, `${method} ${path} should not mutate events`);
}

await assertAnonymousMutationRejected('POST', '/api/events', {
  event_date: '2026-06-20',
  program: 'Unauthorized Create',
  venue: 'Tata Theatre'
});

await assertAnonymousMutationRejected('PUT', '/api/events/1', {
  event_date: '2026-06-16',
  program: 'Unauthorized Edit',
  venue: 'JBT',
  team: 'Changed Team',
  sound_requirements: '',
  call_time: '',
  crew: '',
  foh_crew: '',
  stage_crew: ''
});

await assertAnonymousMutationRejected('PUT', '/api/events/bulk-crew', {
  ids: [1],
  foh_crew: 'Coni',
  stage_crew: ['Naren']
});

await assertAnonymousMutationRejected('POST', '/api/events/bulk-assign', {
  eventIds: [1],
  crew: 'Coni'
});

await assertAnonymousMutationRejected('POST', '/api/events/update-status', {
  eventIds: [1],
  status: 'cancelled'
});

await assertAnonymousMutationRejected('DELETE', '/api/events/1');

await assertAnonymousMutationRejected('POST', '/api/events/bulk-delete', {
  month: 6,
  year: 2026
});

await assertAnonymousMutationRejected('POST', '/api/events/bulk', {
  events: [{
    event_date: '2026-06-21',
    program: 'Unauthorized Import',
    venue: 'JBT'
  }]
});

await assertAnonymousMutationRejected('POST', '/api/admin/backfill-embeddings', {
  batch_size: 1
});

{
  const db = createD1Stub();
  const before = JSON.stringify(db.state.events);
  const response = await request({ DB: db }, '/api/events', {
    method: 'POST',
    headers: { cookie: 'session_token=expired-token' },
    body: {
      event_date: '2026-06-22',
      program: 'Expired Session Create',
      venue: 'Tata Theatre'
    }
  });
  const payload = await response.json();

  assert.equal(response.status, 401, 'expired session should reject event creation');
  assert.equal(payload.success, false);
  assert.equal(payload.error, 'Invalid or expired session');
  assert.equal(JSON.stringify(db.state.events), before, 'expired session should not mutate events');
}

{
  const db = createD1Stub();
  const response = await request({ DB: db }, '/api/events', {
    method: 'POST',
    headers: { cookie: 'session_token=valid-token' },
    body: {
      event_date: '2026-06-22',
      program: 'Authenticated Create',
      venue: 'Tata Theatre'
    }
  });

  assert.equal(response.status, 201, 'valid session should still allow event creation');
  assert.equal(db.state.events.length, 2);
  assert.equal(db.state.events[1].program, 'Authenticated Create');
}

console.log('event auth regression tests passed');
