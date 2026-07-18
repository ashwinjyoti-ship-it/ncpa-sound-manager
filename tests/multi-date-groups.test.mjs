import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findMultiDateSiblings } from '../src/multi-date-groups.ts'

test('legacy shared group IDs do not link TET and TT events', () => {
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

  const siblings = findMultiDateSiblings(experimental, [experimental, tata])

  assert.deepEqual(siblings, [])
})

test('shared group IDs still link same-program and same-venue events', () => {
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

  const siblings = findMultiDateSiblings(first, [first, second])

  assert.deepEqual(siblings.map((event) => event.id), [2])
})
