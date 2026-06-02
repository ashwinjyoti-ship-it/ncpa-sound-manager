import { describe, expect, it } from 'vitest'
import { buildCrewWorkload } from './rag-utils'

describe('buildCrewWorkload', () => {
  it('counts role-specific crew when the legacy crew field is null', () => {
    const workload = buildCrewWorkload([
      {
        crew: null,
        foh_crew: 'Naren',
        stage_crew: 'Viraj, Akshay',
      },
    ])

    expect(workload).toEqual({
      Naren: 1,
      Viraj: 1,
      Akshay: 1,
    })
  })

  it('does not double-count crew when both legacy and role-specific fields are present', () => {
    const workload = buildCrewWorkload([
      {
        crew: 'Naren, Viraj',
        foh_crew: 'Naren',
        stage_crew: 'Viraj',
      },
    ])

    expect(workload).toEqual({
      Naren: 1,
      Viraj: 1,
    })
  })
})
