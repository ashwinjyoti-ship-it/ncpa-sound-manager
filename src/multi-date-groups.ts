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

/** Siblings for edit modal: same show_group_id, or inferred consecutive cluster (2+). */
export function findMultiDateSiblings<T extends GroupableEvent & { id: number }>(
  event: T,
  allEvents: T[]
): T[] {
  if (event.show_group_id) {
    return allEvents.filter(
      e => e.id !== event.id && e.show_group_id === event.show_group_id
    )
  }
  const key = programVenueKey(event.program, event.venue)
  const peers = allEvents.filter(
    e => e.id !== event.id && programVenueKey(e.program, e.venue) === key
  )
  const cluster = [event, ...peers].sort((a, b) => a.event_date.localeCompare(b.event_date))
  const fullClusters = clusterConsecutive(cluster)
  const mine = fullClusters.find(c => c.some(e => e.id === event.id))
  if (!mine || mine.length < 2) return []
  return mine.filter(e => e.id !== event.id)
}

export function datesAreConsecutive(dates: string[]): boolean {
  if (dates.length < 2) return false
  const sorted = [...dates].sort()
  for (let i = 1; i < sorted.length; i++) {
    if (!isConsecutiveDate(sorted[i - 1], sorted[i])) return false
  }
  return true
}

/** Assign a shared show_group_id to each multi-date cluster (2+ consecutive dates) in a batch. */
export function assignGroupIdsByIndex<T extends GroupableEvent>(rows: T[]): (string | null)[] {
  const ids: (string | null)[] = rows.map(() => null)
  for (const cluster of findMultiDateClusters(rows)) {
    const gid = generateShowGroupId()
    for (const row of cluster) {
      const idx = rows.findIndex(
        r => r.event_date === row.event_date && r.program === row.program && r.venue === row.venue
      )
      if (idx >= 0) ids[idx] = gid
    }
  }
  return ids
}
