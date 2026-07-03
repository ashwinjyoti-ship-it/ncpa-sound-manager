/** Consecutive multi-date show grouping (one DB row per date). */

export type GroupableEvent = {
  id?: number
  event_date: string
  program: string
  venue: string
  show_group_id?: string | null
  foh_crew?: string | null
  stage_crew?: string | null | unknown[]
  crew?: string | null
}

export function generateShowGroupId(): string {
  return crypto.randomUUID()
}

export function addDaysUtc(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isConsecutiveDate(prev: string, next: string): boolean {
  return addDaysUtc(prev, 1) === next
}

/** Normalize venue for grouping only (stored value unchanged). */
export function venueGroupKey(venue: string): string {
  const v = (venue || '').trim()
  const upper = v.toUpperCase()
  if (upper === 'JBT MUSEUM' || upper.startsWith('JBT MUSEUM ')) return 'JBT Museum'
  if (v === 'TET' || v === 'TT' || v === 'Tata Theatre') return 'TT'
  return v
}

export function programVenueKey(program: string, venue: string): string {
  return `${(program || '').trim()}|${venueGroupKey(venue)}`
}

export function eventHasCrew(e: GroupableEvent): boolean {
  const sc = e.stage_crew
  if (Array.isArray(sc)) return sc.some(Boolean) || !!String(e.foh_crew || '').trim() || !!String(e.crew || '').trim()
  return !!String(e.foh_crew || '').trim() || !!String(sc || '').trim() || !!String(e.crew || '').trim()
}

/** Split sorted same program+venue rows into consecutive-date clusters. */
export function clusterConsecutive<T extends GroupableEvent>(rows: T[]): T[][] {
  if (rows.length === 0) return []
  const sorted = [...rows].sort((a, b) => a.event_date.localeCompare(b.event_date))
  const clusters: T[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (isConsecutiveDate(prev.event_date, cur.event_date)) {
      clusters[clusters.length - 1].push(cur)
    } else {
      clusters.push([cur])
    }
  }
  return clusters
}

/** Group batch rows by program+venue, then consecutive dates. Keeps only runs of 2+. */
export function findMultiDateClusters<T extends GroupableEvent>(rows: T[]): T[][] {
  const byKey = new Map<string, T[]>()
  for (const row of rows) {
    const key = programVenueKey(row.program, row.venue)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(row)
  }
  const multi: T[][] = []
  for (const group of byKey.values()) {
    for (const cluster of clusterConsecutive(group)) {
      if (cluster.length >= 2) multi.push(cluster)
    }
  }
  return multi
}

/** Copy crew from first row with crew to empty rows in each multi-date cluster. */
export function applyCrewPropagationInBatch<T extends GroupableEvent>(rows: T[]): T[] {
  const out = rows.map(r => ({ ...r }))
  const index = new Map(out.map((r, i) => [r, i]))
  for (const cluster of findMultiDateClusters(out)) {
    const source = cluster.find(eventHasCrew)
    if (!source) continue
    const foh = source.foh_crew ?? null
    const stage = Array.isArray(source.stage_crew)
      ? (source.stage_crew as string[]).filter(Boolean).join(', ')
      : (source.stage_crew as string) || null
    const combined = [foh, stage].filter(Boolean).join(', ') || source.crew || null
    for (const row of cluster) {
      if (eventHasCrew(row)) continue
      const i = index.get(row)!
      out[i] = { ...out[i], foh_crew: foh, stage_crew: stage, crew: combined }
    }
  }
  return out
}

/**
 * Siblings for edit modal: union of same show_group_id and inferred consecutive
 * cluster (2+). Both signals are combined (not "ID if present, else dates") so a
 * show_group_id that has drifted out of sync with the actual consecutive run
 * (e.g. a partial re-upload minted a new id for a subset of an existing run)
 * doesn't orphan the rows left behind on the old id.
 */
export function findMultiDateSiblings<T extends GroupableEvent & { id: number }>(
  event: T,
  allEvents: T[]
): T[] {
  const byGroupId = event.show_group_id
    ? allEvents.filter(e => e.id !== event.id && e.show_group_id === event.show_group_id)
    : []

  const key = programVenueKey(event.program, event.venue)
  const peers = allEvents.filter(
    e => e.id !== event.id && programVenueKey(e.program, e.venue) === key
  )
  const cluster = [event, ...peers].sort((a, b) => a.event_date.localeCompare(b.event_date))
  const fullClusters = clusterConsecutive(cluster)
  const mine = fullClusters.find(c => c.some(e => e.id === event.id))
  const byDate = (!mine || mine.length < 2) ? [] : mine.filter(e => e.id !== event.id)

  const merged = new Map<number, T>()
  for (const e of byGroupId) merged.set(e.id, e)
  for (const e of byDate) merged.set(e.id, e)
  return [...merged.values()]
}

export function datesAreConsecutive(dates: string[]): boolean {
  if (dates.length < 2) return false
  const sorted = [...dates].sort()
  for (let i = 1; i < sorted.length; i++) {
    if (!isConsecutiveDate(sorted[i - 1], sorted[i])) return false
  }
  return true
}

/**
 * Assign a shared show_group_id to each multi-date cluster (2+ consecutive dates)
 * in a batch, tracking clusters by original row index (not by field re-lookup) so
 * duplicate date/program/venue rows in the same batch can't collide on one slot.
 *
 * Pass `resolveExistingGroupId` to reuse an id already established in the DB for
 * part of a cluster (e.g. a run that's only partially represented in this batch)
 * instead of always minting a fresh one and fragmenting the run.
 */
export function assignGroupIdsByIndex<T extends GroupableEvent>(
  rows: T[],
  resolveExistingGroupId?: (cluster: T[]) => string | null | undefined
): (string | null)[] {
  const ids: (string | null)[] = rows.map(() => null)
  const byKey = new Map<string, number[]>()
  rows.forEach((row, i) => {
    const key = programVenueKey(row.program, row.venue)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(i)
  })

  for (const indices of byKey.values()) {
    const sorted = [...indices].sort((a, b) => rows[a].event_date.localeCompare(rows[b].event_date))
    let start = 0
    for (let k = 1; k <= sorted.length; k++) {
      const atEnd = k === sorted.length || !isConsecutiveDate(rows[sorted[k - 1]].event_date, rows[sorted[k]].event_date)
      if (atEnd) {
        const clusterIndices = sorted.slice(start, k)
        if (clusterIndices.length >= 2) {
          const cluster = clusterIndices.map(i => rows[i])
          const gid = resolveExistingGroupId?.(cluster) || generateShowGroupId()
          for (const i of clusterIndices) ids[i] = gid
        }
        start = k
      }
    }
  }
  return ids
}
