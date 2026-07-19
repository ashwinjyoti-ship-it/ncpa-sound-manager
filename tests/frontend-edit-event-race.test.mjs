import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const appSource = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')
const editHelpers = appSource.slice(
  appSource.indexOf('var _crewRosterCache'),
  appSource.indexOf('async function handleEditEvent'),
)

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('condition was not reached')
}

function createEditorContext(events) {
  const elements = new Map()
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        classList: { add() {}, remove() {} },
        dataset: {},
        innerHTML: '',
        style: {},
        textContent: '',
        value: '',
      })
    }
    return elements.get(id)
  }
  const singleDateRadio = { checked: false, value: 'single' }
  const rosterRequests = []
  const context = {
    API_BASE: '/api',
    addShowEscHtml: (value) => value,
    allEvents: [],
    axios: {
      async get(url) {
        const id = Number(url.split('/').pop())
        return { data: { success: true, data: events[id], multi_date_siblings: [] } }
      },
    },
    closeEventModal() {},
    console,
    document: {
      getElementById: element,
      querySelector(selector) {
        if (selector === '#editEventForm .stage-crew-grid') return element('stageCrewGrid')
        if (selector === 'input[name="editDateType"][value="single"]') return singleDateRadio
        if (selector === 'input[name="editDateType"]:checked') return singleDateRadio
        return null
      },
      querySelectorAll() {
        return []
      },
    },
    eventHasCrew: () => false,
    fetch() {
      const request = deferred()
      rosterRequests.push(request)
      return request.promise
    },
    findMultiDateSiblings: () => [],
    showNotification() {},
    toggleEditDateFields() {},
  }
  vm.createContext(context)
  vm.runInContext(editHelpers, context, { filename: 'public/static/app.js' })
  return { context, elements, rosterRequests }
}

test('a stale roster response cannot mix the first event crew into the second editor', async () => {
  const events = {
    1: {
      id: 1,
      event_date: '2026-07-19',
      program: 'First show',
      venue: 'TET',
      foh_crew: 'Alice',
    },
    2: {
      id: 2,
      event_date: '2026-07-20',
      program: 'Second show',
      venue: 'TT',
      foh_crew: 'Bob',
    },
  }
  const { context, elements, rosterRequests } = createEditorContext(events)

  const firstEdit = context.editEventFromModal(1)
  await waitFor(() => rosterRequests.length === 1)
  const secondEdit = context.editEventFromModal(2)
  await waitFor(() => rosterRequests.length === 2)

  rosterRequests[1].resolve({
    json: async () => ({ success: true, roster: ['Alice', 'Bob'] }),
  })
  await secondEdit

  rosterRequests[0].resolve({
    json: async () => ({ success: true, roster: ['Alice', 'Bob'] }),
  })
  await firstEdit

  assert.equal(elements.get('editEventId').value, 2)
  assert.equal(elements.get('editProgram').value, 'Second show')
  assert.equal(elements.get('editFohCrew').value, 'Bob')
})
