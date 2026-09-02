import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const appSource = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')
const helperSource = appSource.slice(
  appSource.indexOf('function formTextValue'),
  appSource.indexOf('// Normalize venue display'),
)

function loadHelpers() {
  const context = { console }
  vm.createContext(context)
  vm.runInContext(helperSource, context, { filename: 'public/static/app.js' })
  return context
}

test('cleared rider stays in the edit payload as an empty string, not null', () => {
  const { formTextValue, buildEventMutationFields } = loadHelpers()

  assert.equal(formTextValue(''), '')
  assert.equal(formTextValue(null), '')
  assert.equal(formTextValue(undefined), '')
  assert.equal(formTextValue('https://example.com/rider.pdf'), 'https://example.com/rider.pdf')

  const payload = buildEventMutationFields(
    {
      event_date: '2026-09-02',
      program: 'Show',
      venue: 'TT',
      team: '',
      sound_requirements: '',
      call_time: '',
      rider: '',
      notes: '',
    },
    { crew: null, foh_crew: null, stage_crew: null },
  )

  assert.equal(payload.rider, '')
  assert.equal(payload.notes, '')
  assert.match(JSON.stringify(payload), /"rider":""/)
  assert.doesNotMatch(JSON.stringify(payload), /"rider":null/)

  // The previous `data.rider || null` collapsed a cleared field to null.
  assert.equal('' || null, null)
})

test('rider chip list ignores empty comma-separated leftover URLs', () => {
  const { riderUrls } = loadHelpers()

  assert.equal(JSON.stringify(riderUrls(null)), '[]')
  assert.equal(JSON.stringify(riderUrls('')), '[]')
  assert.equal(JSON.stringify(riderUrls('   ')), '[]')
  assert.equal(
    JSON.stringify(riderUrls('https://example.com/a.pdf, , https://example.com/b.pdf,')),
    JSON.stringify(['https://example.com/a.pdf', 'https://example.com/b.pdf']),
  )
})
