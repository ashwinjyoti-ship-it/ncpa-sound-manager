import assert from 'node:assert/strict';
import { test } from 'node:test';

import app from '../dist/_worker.js';

const events = [
  { crew: 'Naren, Sandeep', foh_crew: 'Naren', stage_crew: 'Sandeep', program: 'Show A', venue: 'JBT', event_date: '2026-09-01' },
];

function stubDb() {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async all() {
          if (/FROM events/.test(sql)) return { results: events };
          if (/FROM sound_crew/.test(sql)) return { results: ['Naren','Sandeep','Coni','Nazar'].map(name => ({ name })) };
          if (/crew_unavailability/.test(sql)) return { results: [{ name: 'Nazar', unavailable_date: '2026-09-01' }] };
          return { results: [] };
        },
      };
    },
  };
}

const env = (extra = {}) => ({ DB: stubDb(), DB_CREW: stubDb(), AGENT_API_KEY: 'secret', ...extra });
const get = (path, headers = {}, e = env()) =>
  app.fetch(new Request('https://x.test' + path, { headers }), e);
const auth = { Authorization: 'Bearer secret' };

test('rejects missing / wrong key, 503 when unconfigured', async () => {
  assert.equal((await get('/api/agent/crew-availability?date=2026-09-01')).status, 401);
  assert.equal((await get('/api/agent/crew-availability?date=2026-09-01', { Authorization: 'Bearer nope' })).status, 401);
  assert.equal((await get('/api/agent/crew-availability?date=2026-09-01', auth, env({ AGENT_API_KEY: undefined }))).status, 503);
});

test('POST is refused', async () => {
  const r = await app.fetch(new Request('https://x.test/api/agent/crew-availability', { method: 'POST', headers: auth }), env());
  assert.equal(r.status, 405);
});

test('validates dates', async () => {
  assert.equal((await get('/api/agent/crew-availability', auth)).status, 400);
  assert.equal((await get('/api/agent/crew-availability?date=2026-13-45', auth)).status, 400);
  assert.equal((await get('/api/agent/crew-availability?start=2026-01-01&end=2026-03-01', auth)).status, 400);
});

test('single date matches the modal endpoint', async () => {
  const r = await get('/api/agent/crew-availability?date=2026-09-01', auth);
  assert.equal(r.status, 200);
  const j = await r.json();
  const modal = await (await get('/api/crew-availability?dates=2026-09-01')).json();
  assert.deepEqual(j.available, modal.available);
  assert.deepEqual(j.assigned, modal.assigned);
  assert.deepEqual(j.unavailable, modal.unavailable);
  assert.deepEqual(j.assigned, ['Naren', 'Sandeep']);
  assert.deepEqual(j.unavailable, ['Nazar']);
  assert.deepEqual(j.available, ['Coni']);
  assert.equal(j.shows[0].program, 'Show A');
});

test('range returns one entry per day', async () => {
  const j = await (await get('/api/agent/crew-availability?start=2026-09-01&end=2026-09-02', auth)).json();
  assert.equal(j.days.length, 2);
  assert.deepEqual(j.days[1].assigned, []);
});
