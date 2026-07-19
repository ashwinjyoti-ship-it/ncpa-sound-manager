import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function loadBrowserScript(relativePath) {
  const blobs = [];
  const links = [];
  const documentStub = {
    readyState: 'loading',
    body: {
      appendChild(element) {
        links.push(element);
      },
      removeChild() {}
    },
    addEventListener() {},
    getElementById() {
      return {
        classList: { add() {}, remove() {}, toggle() {} },
        style: {},
        value: '',
        addEventListener() {},
        appendChild() {},
        querySelectorAll() {
          return [];
        }
      };
    },
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      return {
        tagName,
        style: {},
        setAttribute(name, value) {
          this[name] = value;
        },
        click() {
          this.clicked = true;
        },
        appendChild() {},
        querySelectorAll() {
          return [];
        }
      };
    }
  };

  const context = {
    Blob: class {
      constructor(parts, options = {}) {
        this.parts = parts;
        this.options = options;
        blobs.push(this);
      }
    },
    URL: {
      createObjectURL() {
        return 'blob:test';
      },
      revokeObjectURL() {}
    },
    alert() {},
    axios: {},
    console,
    document: documentStub,
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    setTimeout() {},
    showNotification() {},
    window: {
      addEventListener() {},
      removeEventListener() {}
    },
    __blobs: blobs,
    __links: links
  };
  context.window.window = context.window;
  context.window.document = documentStub;
  context.window.localStorage = context.localStorage;

  vm.createContext(context);
  vm.runInContext(readFileSync(relativePath, 'utf8'), context, { filename: relativePath });
  return context;
}

test('monthly CSV download flattens multiline fields into one physical row per event', () => {
  const { convertEventsToCSV } = loadBrowserScript('public/static/app.js');

  const csv = convertEventsToCSV([
    {
      event_date: '2026-01-10',
      program: 'Concert',
      venue: 'Tata Theatre',
      team: 'Music',
      sound_requirements: 'Line one\nLine two\tTabbed',
      call_time: '10:30',
      crew: 'Asha\r\nBala'
    }
  ]);

  assert.equal(csv.split('\n').length, 2);
  assert.match(csv, /Line one Line two Tabbed/);
  assert.match(csv, /Asha Bala/);
});

test('v4.1 CSV export flattens multiline fields into one physical row per event', () => {
  const context = loadBrowserScript('public/static/v41-features.js');

  context.exportEventsToCSV([
    {
      id: 101,
      event_date: '2026-01-10',
      program: 'Concert\nWith encore',
      venue: 'Jamshed Bhabha Theatre',
      team: 'Music',
      sound_requirements: 'Patch list\r\nMonitor notes',
      call_time: '10:30',
      crew: 'Asha\tBala',
      status: 'confirmed',
      tags: '',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z'
    }
  ], 'selected_events');

  const blob = context.__blobs[context.__blobs.length - 1];
  const csv = blob.parts.join('');
  assert.equal(csv.split('\n').length, 2);
  assert.match(csv, /Concert With encore/);
  assert.match(csv, /Patch list Monitor notes/);
});

test('iCalendar export rolls two-hour duration across midnight for late call times', () => {
  const { convertEventsToICalendar } = loadBrowserScript('public/static/app.js');

  const ics = convertEventsToICalendar([
    {
      id: 7,
      event_date: '2026-01-31',
      program: 'Late show',
      venue: 'Experimental Theatre',
      call_time: '23:30'
    }
  ]);

  assert.match(ics, /DTSTART:20260131T233000/);
  assert.match(ics, /DTEND:20260201T013000/);
  assert.doesNotMatch(ics, /DTEND:20260131T253000/);
});
