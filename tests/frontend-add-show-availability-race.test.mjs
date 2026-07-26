import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const appSource = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')
const availabilityHelpers = appSource.slice(
  appSource.indexOf('var _addShowAvailTimer'),
  appSource.indexOf('// DAY CREW AVAILABILITY MODAL'),
)

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createAvailabilityContext() {
  const input = () => ({ addEventListener() {}, value: '' })
  const singleDate = input()
  const elements = new Map([
    ['singleDate', singleDate],
    ['startDate', input()],
    ['endDate', input()],
    ['addShowCrewCard', { style: {} }],
    ['addShowCrewBody', { innerHTML: '' }],
  ])
  const requests = []
  const timers = []
  const context = {
    clearTimeout() {},
    console,
    document: {
      addEventListener(event, callback) {
        if (event === 'DOMContentLoaded') callback()
      },
      getElementById(id) {
        return elements.get(id) || null
      },
      querySelector(selector) {
        if (selector === 'input[name="dateType"]:checked') {
          return { value: 'single' }
        }
        return null
      },
      querySelectorAll() {
        return []
      },
    },
    fetch(url) {
      const request = deferred()
      requests.push({ request, url })
      return request.promise
    },
    setTimeout(callback) {
      timers.push(callback)
      return timers.length
    },
  }
  vm.createContext(context)
  vm.runInContext(availabilityHelpers, context, { filename: 'public/static/app.js' })
  return { context, elements, requests, singleDate, timers }
}

test('an older Add Show availability response cannot overwrite the latest date', async () => {
  const { context, elements, requests, singleDate, timers } = createAvailabilityContext()

  singleDate.value = '2026-08-01'
  context.schedAddShowAvailCheck()
  const firstCheck = timers[0]()

  singleDate.value = '2026-08-02'
  context.schedAddShowAvailCheck()
  const secondCheck = timers[1]()

  requests[1].request.resolve({
    json: async () => ({
      success: true,
      dates: ['2026-08-02'],
      available: ['Bob'],
      assigned: [],
      unavailable: [],
      conflicts: [],
    }),
  })
  await secondCheck

  requests[0].request.resolve({
    json: async () => ({
      success: true,
      dates: ['2026-08-01'],
      available: ['Alice'],
      assigned: [],
      unavailable: [],
      conflicts: [],
    }),
  })
  await firstCheck

  assert.match(elements.get('addShowCrewBody').innerHTML, /Bob/)
  assert.doesNotMatch(elements.get('addShowCrewBody').innerHTML, /Alice/)
})

test('changing Add Show dates immediately removes crew rendered for the previous date', async () => {
  const { context, elements, requests, singleDate, timers } = createAvailabilityContext()

  singleDate.value = '2026-08-01'
  context.schedAddShowAvailCheck()
  const firstCheck = timers[0]()
  requests[0].request.resolve({
    json: async () => ({
      success: true,
      dates: ['2026-08-01'],
      available: ['Alice'],
      assigned: [],
      unavailable: [],
      conflicts: [],
    }),
  })
  await firstCheck
  assert.match(elements.get('addShowCrewBody').innerHTML, /Alice/)

  singleDate.value = '2026-08-02'
  context.schedAddShowAvailCheck()

  assert.doesNotMatch(
    elements.get('addShowCrewBody').innerHTML,
    /Alice/,
    'the previous date remained selectable while the new request was debounced',
  )
})
