import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadBrowserApp() {
  const element = () => ({
    addEventListener() {},
    appendChild() {},
    classList: { add() {}, remove() {}, toggle() {} },
    closest() { return null; },
    remove() {},
    removeChild() {},
    setAttribute() {},
    style: {},
  });

  const sandbox = {
    alert(message) {
      throw new Error(String(message));
    },
    Blob: class Blob {},
    clearInterval,
    clearTimeout,
    console,
    document: {
      addEventListener() {},
      body: element(),
      createElement: element,
      getElementById() { return element(); },
      querySelectorAll() { return []; },
    },
    sessionStorage: {
      getItem() { return null; },
      setItem() {},
    },
    setInterval,
    setTimeout,
    URL: {
      createObjectURL() { return 'blob:test'; },
      revokeObjectURL() {},
    },
    window: {
      addEventListener() {},
      innerWidth: 1024,
    },
  };
  sandbox.window.window = sandbox.window;

  vm.createContext(sandbox);
  vm.runInContext(readFileSync('public/static/app.js', 'utf8'), sandbox, {
    filename: 'public/static/app.js',
  });
  return sandbox;
}

test('iCalendar export preserves hour-only PM call times extracted from imports', () => {
  const { convertEventsToICalendar, extractCallTime } = loadBrowserApp();
  const callTime = extractCallTime('Sound at 7pm');

  assert.equal(callTime, '7 PM (Sound)');

  const ics = convertEventsToICalendar([
    {
      id: 1,
      event_date: '2026-06-24',
      program: 'Evening Concert',
      venue: 'Tata Theatre',
      call_time: callTime,
    },
  ]);

  assert.match(ics, /DTSTART:20260624T190000/);
  assert.doesNotMatch(ics, /DTSTART:20260624T090000/);
});
