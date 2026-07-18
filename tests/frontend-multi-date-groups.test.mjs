import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const appSource = readFileSync(new URL('../public/static/app.js', import.meta.url), 'utf8')
const helperSource = appSource.split("document.addEventListener('DOMContentLoaded'")[0]
const browserHelpers = {}
runInNewContext(
  `${helperSource}
  globalThis.browserHelpers = { findMultiDateSiblings };`,
  browserHelpers,
)

test('browser fallback ignores legacy group IDs shared across TET and TT', () => {
  const experimental = {
    id: 1,
    event_date: '2026-07-18',
    program: 'Visiting Company',
    venue: 'TET',
    show_group_id: 'legacy-cross-venue-group',
  }
  const tata = {
    id: 2,
    event_date: '2026-07-19',
    program: 'Visiting Company',
    venue: 'TT',
    show_group_id: 'legacy-cross-venue-group',
  }

  const siblings = browserHelpers.browserHelpers.findMultiDateSiblings(
    experimental,
    [experimental, tata],
  )

  assert.equal(siblings.length, 0)
})

test('browser fallback preserves valid normalized venue groups', () => {
  const first = {
    id: 1,
    event_date: '2026-07-18',
    program: 'Visiting Company',
    venue: 'TET',
    show_group_id: 'valid-group',
  }
  const second = {
    id: 2,
    event_date: '2026-07-20',
    program: 'Visiting Company',
    venue: 'Experimental Theatre',
    show_group_id: 'valid-group',
  }

  const siblings = browserHelpers.browserHelpers.findMultiDateSiblings(
    first,
    [first, second],
  )

  assert.equal(siblings.map((event) => event.id).join(','), '2')
})
