import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const appSource = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')
const helperSource = appSource.slice(
  appSource.indexOf('var DAY_AVAIL_START_DATE'),
  appSource.indexOf('function closeDayAvailModal'),
)
const browserHelpers = {}
runInNewContext(
  `${helperSource}
  globalThis.browserHelpers = { isDayAvailEnabled, DAY_AVAIL_START_DATE };`,
  browserHelpers,
)

const { isDayAvailEnabled, DAY_AVAIL_START_DATE } = browserHelpers.browserHelpers

test('day crew availability starts on 2026-08-01', () => {
  assert.equal(DAY_AVAIL_START_DATE, '2026-08-01')
})

test('dates through July 2026 do not enable day crew availability', () => {
  assert.equal(isDayAvailEnabled('2026-07-31'), false)
  assert.equal(isDayAvailEnabled('2026-01-01'), false)
  assert.equal(isDayAvailEnabled('2025-12-31'), false)
})

test('dates from August 2026 onwards enable day crew availability', () => {
  assert.equal(isDayAvailEnabled('2026-08-01'), true)
  assert.equal(isDayAvailEnabled('2026-08-15'), true)
  assert.equal(isDayAvailEnabled('2027-01-01'), true)
})
