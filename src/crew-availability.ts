// Shared crew-availability logic. This is the single source of truth behind
// the calendar's day-availability modal (GET /api/crew-availability) and the
// read-only agent API (GET /api/agent/crew-availability), so both always agree.
import { getActiveCrewNames } from './crew-endpoints'

export type ShowRow = {
  crew: string | null
  foh_crew: string | null
  stage_crew: string | null
  program: string
  venue: string
  event_date: string
}

export type AvailabilityData = {
  roster: string[]
  shows: ShowRow[]
  assignedByDate: Map<string, Set<string>>
  unavailByDate: Map<string, Set<string>>
}

export type Classified = {
  available: string[]
  assigned: string[]
  unavailable: string[]
}

const parseCSV = (s: string | null): string[] => {
  if (!s) return []
  return s.split(',').map(m => m.trim())
    .filter(m => m && m.toLowerCase() !== 'null' && m.toLowerCase() !== 'undefined')
}

export async function loadAvailabilityData(
  db: D1Database,
  dbCrew: D1Database,
  dates: string[]
): Promise<AvailabilityData> {
  const ph = dates.map(() => '?').join(',')

  const soundRows = await db.prepare(
    `SELECT crew, foh_crew, stage_crew, program, venue, event_date
     FROM events WHERE event_date IN (${ph})`
  ).bind(...dates).all()
  const shows = soundRows.results as unknown as ShowRow[]

  const assignedByDate = new Map<string, Set<string>>()
  for (const row of shows) {
    if (!assignedByDate.has(row.event_date)) assignedByDate.set(row.event_date, new Set())
    const set = assignedByDate.get(row.event_date)!
    for (const f of [row.crew, row.foh_crew, row.stage_crew]) parseCSV(f).forEach(m => set.add(m))
  }

  // Crew roster is local to this app (Settings > Crew).
  const roster = await getActiveCrewNames(db)

  // Day-off data lives in the shared crew DB; cross-referenced by name.
  const crewRows = await dbCrew.prepare(
    `SELECT DISTINCT c.name, cu.unavailable_date
     FROM crew_unavailability cu
     JOIN crew c ON c.id = cu.crew_id
     WHERE cu.unavailable_date IN (${ph})`
  ).bind(...dates).all()
  const unavailByDate = new Map<string, Set<string>>()
  for (const row of crewRows.results as any[]) {
    if (!unavailByDate.has(row.unavailable_date)) unavailByDate.set(row.unavailable_date, new Set())
    unavailByDate.get(row.unavailable_date)!.add(row.name as string)
  }

  return { roster, shows, assignedByDate, unavailByDate }
}

// Classify crew for a set of dates (union across the dates, as the modal and
// the Add Show form do). Anyone assigned on a show is never hidden, even if
// they are not on the roster.
export function classifyDates(data: AvailabilityData, dates: string[]): Classified {
  const assignedSet = new Set<string>()
  const unavailSet = new Set<string>()
  for (const d of dates) {
    data.assignedByDate.get(d)?.forEach(n => assignedSet.add(n))
    data.unavailByDate.get(d)?.forEach(n => unavailSet.add(n))
  }
  const everyone: string[] = [...data.roster]
  assignedSet.forEach(n => { if (!everyone.includes(n)) everyone.push(n) })

  return {
    available: everyone.filter(m => !assignedSet.has(m) && !unavailSet.has(m)),
    assigned: everyone.filter(m => assignedSet.has(m)),
    unavailable: everyone.filter(m => unavailSet.has(m) && !assignedSet.has(m)),
  }
}
