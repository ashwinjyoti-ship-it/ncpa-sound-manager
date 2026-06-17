import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import type { Env } from './types'
import { handleRAGQuery } from './rag-endpoint'
import { generateEventEmbedding } from './rag-utils'
import { backfillEmbeddings } from './backfill-embeddings'
import {
  setupFilteringEndpoints,
  setupBulkAssignment,
  setupDashboardEndpoints,
  setupExportEndpoints
} from './v41-endpoints'
import { setupCrewAssignmentEngine } from './crew-assignment-engine'
import { setupAuthEndpoints } from './auth-endpoints'
import { setupCrewStatsEndpoints } from './crew-stats-endpoints'

type Bindings = {
  DB: D1Database;
  DB_CREW: D1Database;
  AI: any;
  VECTORIZE: any; // Vectorize enabled for semantic search
  ANTHROPIC_API_KEY: string;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for all routes (Safari compatibility)
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400,
  credentials: false
}))

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// ─── GET /api/crew-availability ───────────────────────────────────────────────
app.get('/api/crew-availability', async (c) => {
  const datesParam = c.req.query('dates')
  if (!datesParam) return c.json({ success: false, error: 'dates param required' }, 400)

  const dates = datesParam.split(',').map(d => d.trim()).filter(Boolean)
  if (!dates.length) return c.json({ success: false, error: 'no valid dates' }, 400)

  const ph = dates.map(() => '?').join(',')

  try {
    const soundRows = await c.env.DB.prepare(
      `SELECT crew, foh_crew, stage_crew, program, venue, event_date
       FROM events WHERE event_date IN (${ph})`
    ).bind(...dates).all()

    const assignedSet = new Set<string>()
    const parseCSV = (s: string | null) => {
      if (!s) return
      s.split(',').map(m => m.trim()).filter(Boolean).forEach(m => assignedSet.add(m))
    }
    for (const row of soundRows.results as any[]) {
      parseCSV(row.crew)
      parseCSV(row.foh_crew)
      parseCSV(row.stage_crew)
    }

    const crewRows = await c.env.DB_CREW.prepare(
      `SELECT DISTINCT c.name
       FROM crew_unavailability cu
       JOIN crew c ON c.id = cu.crew_id
       WHERE cu.unavailable_date IN (${ph})`
    ).bind(...dates).all()

    const unavailSet = new Set<string>(crewRows.results.map((r: any) => r.name as string))

    const VALID_CREW = [
      'Naren', 'Sandeep', 'Coni', 'Nikhil', 'NS', 'Aditya',
      'Viraj', 'Shridhar', 'Nazar', 'Omkar', 'Akshay',
      'OC1', 'OC2', 'OC3'
    ]

    const available   = VALID_CREW.filter(m => !assignedSet.has(m) && !unavailSet.has(m))
    const assigned    = VALID_CREW.filter(m => assignedSet.has(m))
    const unavailable = VALID_CREW.filter(m => unavailSet.has(m) && !assignedSet.has(m))

    return c.json({
      success: true, available, assigned, unavailable,
      conflicts: soundRows.results, dates
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})


// ============================================
// API ROUTES
// ============================================

// Get all events
app.get('/api/events', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM events ORDER BY event_date ASC
    `).all()
    
    return c.json({ success: true, data: results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Get events by date range (for calendar view)
app.get('/api/events/range', async (c) => {
  try {
    const startDate = c.req.query('start')
    const endDate = c.req.query('end')
    
    if (!startDate || !endDate) {
      return c.json({ success: false, error: 'Start and end dates required' }, 400)
    }
    
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM events 
      WHERE event_date >= ? AND event_date <= ?
      ORDER BY event_date ASC
    `).bind(startDate, endDate).all()
    
    return c.json({ success: true, data: results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})



// ============================================
// GOOGLE SHEETS AUTO-SYNC: CSV EXPORT ENDPOINT
// ============================================
// Permanent URL for Google Sheets IMPORTDATA() function
// Usage in Google Sheets: =IMPORTDATA("https://ncpa-sound.pages.dev/api/export/latest-csv")
// Auto-refreshes every hour
app.get('/api/export/latest-csv', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT
        event_date as "Date",
        program as "Program",
        venue as "Venue",
        team as "Team",
        crew as "Crew",
        sound_requirements as "Sound Requirements",
        call_time as "Call Time",
        status as "Status",
        rider as "Rider"
      FROM events
      ORDER BY event_date ASC
    `).all()

    if (!results || results.length === 0) {
      return new Response('Date,Program,Venue,Team,Crew,Sound Requirements,Call Time,Status,Rider 1,Rider 2,Rider 3\n', {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'inline; filename="ncpa-events-latest.csv"',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      })
    }
    
    // Helper to escape CSV values
    const escapeCSV = (val: any): string => {
      if (val === null || val === undefined) return ''
      const str = String(val)
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }
    
    // Split rider into up to 3 individual URL columns for Sheets auto-linking
    const splitRider = (val: any): [string, string, string] => {
      const urls = val ? String(val).split(',').map((u: string) => u.trim()).filter(Boolean) : []
      return [escapeCSV(urls[0] || ''), escapeCSV(urls[1] || ''), escapeCSV(urls[2] || '')]
    }

    // Build CSV header
    const headers = ['Date', 'Program', 'Venue', 'Team', 'Crew', 'Sound Requirements', 'Call Time', 'Status', 'Rider 1', 'Rider 2', 'Rider 3']
    const csvRows = [headers.join(',')]

    // Add data rows
    results.forEach((row: any) => {
      const [rider1, rider2, rider3] = splitRider(row.Rider)
      const values = [
        escapeCSV(row.Date),
        escapeCSV(row.Program),
        escapeCSV(row.Venue),
        escapeCSV(row.Team),
        escapeCSV(row.Crew),
        escapeCSV(row['Sound Requirements']),
        escapeCSV(row['Call Time']),
        escapeCSV(row.Status || 'confirmed'),
        rider1, rider2, rider3
      ]
      csvRows.push(values.join(','))
    })
    
    const csv = csvRows.join('\n')
    
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'inline; filename="ncpa-events-latest.csv"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================
// MONTHLY CSV EXPORT (Manual month selection)
// ============================================
// For early month preparation (e.g., upload Jan data in Dec, populate sheet in Dec)
// Usage: =IMPORTDATA("https://ncpa-sound.pages.dev/api/export/csv?month=2026-01")
// Column order: Date, Crew, Program, Venue, Team, Sound Requirements, Call Time
app.get('/api/export/csv', async (c) => {
  try {
    const month = c.req.query('month') // Format: YYYY-MM (e.g., "2026-01")
    
    if (!month) {
      return c.json({ 
        success: false, 
        error: 'Month parameter required. Use: ?month=YYYY-MM (e.g., ?month=2026-01)' 
      }, 400)
    }
    
    // Validate format
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ 
        success: false, 
        error: 'Invalid month format. Use: YYYY-MM (e.g., 2026-01)' 
      }, 400)
    }
    
    const { results } = await c.env.DB.prepare(`
      SELECT
        event_date as "Date",
        foh_crew as "FOH",
        stage_crew as "Stage",
        crew as "Crew",
        program as "Program",
        venue as "Venue",
        team as "Team",
        sound_requirements as "Sound Requirements",
        call_time as "Call Time",
        rider as "Rider"
      FROM events
      WHERE strftime('%Y-%m', event_date) = ?
      ORDER BY event_date ASC
    `).bind(month).all()

    // Helper to escape CSV values
    const escapeCSV = (val: any): string => {
      if (val === null || val === undefined) return ''
      const str = String(val)
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }
    // Split rider into up to 3 individual URL columns for Sheets auto-linking
    const splitRider = (val: any): [string, string, string] => {
      const urls = val ? String(val).split(',').map((u: string) => u.trim()).filter(Boolean) : []
      return [escapeCSV(urls[0] || ''), escapeCSV(urls[1] || ''), escapeCSV(urls[2] || '')]
    }

    // Column order: Date, FOH, Stage, Program, Venue, Team, Sound Requirements, Call Time, Rider 1-3
    // For events without foh_crew/stage_crew (pre-May data), fall back to crew in Stage column.
    const headers = ['Date', 'FOH', 'Stage', 'Program', 'Venue', 'Team', 'Sound Requirements', 'Call Time', 'Rider 1', 'Rider 2', 'Rider 3']
    const csvRows = [headers.join(',')]

    // Add data rows
    results.forEach((row: any) => {
      let formattedDate = row.Date
      if (row.Date) {
        const dateMatch = row.Date.match(/^(\d{4})-(\d{2})-(\d{2})/)
        if (dateMatch) {
          const [, year, month, day] = dateMatch
          formattedDate = `${day}/${month}/${year}`
        }
      }
      // For old events without foh/stage split, show legacy crew in Stage column
      const foh = row.FOH || ''
      const stage = row.Stage || (!row.FOH && !row.Stage ? row.Crew : '') || ''
      const [rider1, rider2, rider3] = splitRider(row.Rider)
      const values = [
        escapeCSV(formattedDate),
        escapeCSV(foh),
        escapeCSV(stage),
        escapeCSV(row.Program),
        escapeCSV(row.Venue),
        escapeCSV(row.Team),
        escapeCSV(row['Sound Requirements']),
        escapeCSV(row['Call Time']),
        rider1, rider2, rider3
      ]
      csvRows.push(values.join(','))
    })
    
    const csv = csvRows.join('\n')
    
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `inline; filename="ncpa-events-${month}.csv"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================
// SHORT NOTICE REPORT EXPORT
// ============================================
// Returns manually-entered events in the requested date range where the
// notice period (show date minus creation date) is strictly less than 14 days.
// Minimum acceptable gap is 14 days; anything below is a short-notice protocol break.
// Bulk-imported events (source != 'manual') are excluded.
// Query params: ?month=YYYY-MM  OR  ?start=YYYY-MM-DD&end=YYYY-MM-DD
app.get('/api/export/short-notice-report', async (c) => {
  try {
    const month = c.req.query('month')
    const start = c.req.query('start')
    const end   = c.req.query('end')

    let startDate: string, endDate: string, filenameSuffix: string

    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return c.json({ success: false, error: 'Invalid month format. Use YYYY-MM (e.g. 2026-03)' }, 400)
      }
      const [y, m] = month.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      startDate = `${month}-01`
      endDate   = `${month}-${String(lastDay).padStart(2, '0')}`
      filenameSuffix = month
    } else if (start && end) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return c.json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD (e.g. 2026-03-01)' }, 400)
      }
      if (start > end) {
        return c.json({ success: false, error: 'start date must be on or before end date' }, 400)
      }
      startDate = start; endDate = end
      filenameSuffix = `${start}_to_${end}`
    } else {
      return c.json({ success: false, error: 'Provide either ?month=YYYY-MM or ?start=YYYY-MM-DD&end=YYYY-MM-DD' }, 400)
    }

    const { results } = await c.env.DB.prepare(`
      SELECT
        program,
        created_at,
        event_date,
        team,
        CAST(JULIANDAY(event_date) - JULIANDAY(DATE(created_at)) AS INTEGER) AS notice_period
      FROM events
      WHERE source = 'manual'
        AND event_date >= ?
        AND event_date <= ?
        AND CAST(JULIANDAY(event_date) - JULIANDAY(DATE(created_at)) AS INTEGER) < 14
      ORDER BY event_date ASC
    `).bind(startDate, endDate).all()

    const fmtDMY = (raw: any): string => {
      const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(raw || '')
    }
    const escCSV = (val: any): string => {
      const s = String(val ?? '')
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? `"${s.replace(/"/g, '""')}"` : s
    }

    const csvRows = [
      ['Program Name', 'Record Creation Date', 'Show Date', 'Curation Team', 'Notice Period (days)'].join(','),
      ...(results as any[]).map(r =>
        [escCSV(r.program), escCSV(fmtDMY(r.created_at)), escCSV(fmtDMY(r.event_date)), escCSV(r.team), escCSV(r.notice_period)].join(',')
      )
    ]

    return new Response(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="short-notice-report-${filenameSuffix}.csv"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*'
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================
// V4.1 ENHANCED API ENDPOINTS (Must be before /:id catch-all route)
// ============================================
setupFilteringEndpoints(app)
setupBulkAssignment(app)
setupDashboardEndpoints(app)
setupExportEndpoints(app)
setupCrewAssignmentEngine(app)
setupAuthEndpoints(app)
setupCrewStatsEndpoints(app)

// Get single event (This must be AFTER specific routes like /filter-options)
app.get('/api/events/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const result = await c.env.DB.prepare(`
      SELECT * FROM events WHERE id = ?
    `).bind(id).first()
    
    if (!result) {
      return c.json({ success: false, error: 'Event not found' }, 404)
    }
    
    return c.json({ success: true, data: result })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Create new event
app.post('/api/events', async (c) => {
  try {
    const body = await c.req.json()
    const { event_date, program, venue, team, sound_requirements, call_time, crew, foh_crew, stage_crew } = body
    
    if (!event_date || !program || !venue) {
      return c.json({ success: false, error: 'Date, program, and venue are required' }, 400)
    }
    
    // Check if sound_requirements is filled
    const requirements_updated = sound_requirements && sound_requirements.trim() !== '' ? 1 : 0

    // Compute FOH + Stage crew, falling back to legacy crew field
    const stageCrew = Array.isArray(stage_crew)
      ? (stage_crew as string[]).filter(Boolean).join(', ')
      : (stage_crew as string || '')
    const fohCrew = (foh_crew as string || '')
    const allCrew = [fohCrew, stageCrew].filter(Boolean).join(', ') || crew || null
    
    const result = await c.env.DB.prepare(`
      INSERT INTO events (event_date, program, venue, team, sound_requirements, call_time, crew, foh_crew, stage_crew, requirements_updated, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event_date,
      program,
      venue,
      team || null,
      sound_requirements || null,
      call_time || null,
      allCrew,
      fohCrew || null,
      stageCrew || null,
      requirements_updated,
      'manual'
    ).run()

    const eventId = result.meta.last_row_id
    
    // Generate embedding for semantic search (Version 4.0)
    try {
      if (c.env.AI && c.env.VECTORIZE) {
        const event = { id: eventId, event_date, program, venue, team, sound_requirements, call_time, crew, created_at: new Date().toISOString() }
        const { text, vector, metadata } = await generateEventEmbedding(event, c.env.AI)
        
        // Store in Vectorize
        await c.env.VECTORIZE.insert([{
          id: `event-${eventId}`,
          values: vector,
          metadata
        }])
        
        // Store embedding metadata in DB
        await c.env.DB.prepare(`
          INSERT INTO event_embeddings (event_id, embedding_text, metadata_json, vector_id)
          VALUES (?, ?, ?, ?)
        `).bind(eventId, text, JSON.stringify(metadata), `event-${eventId}`).run()
        
        // Update event with embedding_id
        await c.env.DB.prepare(`
          UPDATE events SET embedding_id = ? WHERE id = ?
        `).bind(`event-${eventId}`, eventId).run()
        
        console.log(`✅ Generated embedding for event ${eventId}`)
      }
    } catch (embError) {
      console.warn('⚠️ Embedding generation failed (non-critical):', embError)
    }
    
    return c.json({ 
      success: true, 
      data: { 
        id: eventId,
        event_date,
        program,
        venue,
        team,
        sound_requirements,
        call_time,
        crew: allCrew,
        foh_crew: fohCrew || null,
        stage_crew: stageCrew || null,
        requirements_updated
      }
    }, 201)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Bulk-update crew fields across multiple events (for multi-date show propagation)
app.put('/api/events/bulk-crew', async (c) => {
  try {
    const { ids, foh_crew, stage_crew } = await c.req.json()
    if (!Array.isArray(ids) || ids.length === 0)
      return c.json({ success: false, error: 'ids array required' }, 400)

    const stageCrew = Array.isArray(stage_crew)
      ? (stage_crew as string[]).filter(Boolean).join(', ')
      : (stage_crew as string || '')
    const fohCrew  = (foh_crew as string || '')
    const combined = [fohCrew, stageCrew].filter(Boolean).join(', ') || null
    const ph       = ids.map(() => '?').join(',')

    await c.env.DB.prepare(
      `UPDATE events SET foh_crew = ?, stage_crew = ?, crew = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id IN (${ph})`
    ).bind(fohCrew || null, stageCrew || null, combined, ...ids).run()

    return c.json({ success: true, updated: ids.length })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Update event
app.put('/api/events/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { event_date, program, venue, team, sound_requirements, call_time, crew, foh_crew, stage_crew, rider, notes } = body

    // Check if sound_requirements is filled
    const requirements_updated = sound_requirements && sound_requirements.trim() !== '' ? 1 : 0

    // Normalise crew strings: convert arrays (empty or otherwise) to string/null
    // so D1 never receives a raw JS array and stores an empty BLOB
    const normStr = (v: any): string | null => {
      if (Array.isArray(v)) return v.filter(Boolean).join(', ') || null
      return (v as string) || null
    }
    const normStageCrew = normStr(stage_crew)
    const normFohCrew   = normStr(foh_crew)

    // Build combined crew string from FOH + Stage for backward-compat columns
    let combinedCrew = crew || null
    if (foh_crew !== undefined || stage_crew !== undefined) {
      const parts = [normFohCrew, normStageCrew].filter(Boolean).join(', ')
      combinedCrew = parts || null
    }

    await c.env.DB.prepare(`
      UPDATE events
      SET event_date = ?,
          program = ?,
          venue = ?,
          team = ?,
          sound_requirements = ?,
          call_time = ?,
          crew = ?,
          foh_crew = ?,
          stage_crew = ?,
          rider = ?,
          notes = ?,
          requirements_updated = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      event_date,
      program,
      venue,
      team || null,
      sound_requirements || null,
      call_time || null,
      combinedCrew,
      normFohCrew,
      normStageCrew,
      rider || null,
      notes || null,
      requirements_updated,
      id
    ).run()

    return c.json({ success: true, message: 'Event updated successfully' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Remove dependent rows before deleting events (FK tables lack ON DELETE CASCADE)
async function deleteEventDependencies(db: D1Database, eventId: number) {
  await db.prepare(`
    DELETE FROM event_conflicts WHERE event_id_1 = ? OR event_id_2 = ?
  `).bind(eventId, eventId).run()
  await db.prepare(`
    DELETE FROM calendar_sync WHERE event_id = ?
  `).bind(eventId).run()
  await db.prepare(`
    DELETE FROM assignment_recommendations WHERE event_id = ?
  `).bind(eventId).run()
}

async function deleteMonthEventDependencies(db: D1Database, monthKey: string) {
  await db.prepare(`
    DELETE FROM event_conflicts
    WHERE event_id_1 IN (SELECT id FROM events WHERE strftime('%Y-%m', event_date) = ?)
       OR event_id_2 IN (SELECT id FROM events WHERE strftime('%Y-%m', event_date) = ?)
  `).bind(monthKey, monthKey).run()
  await db.prepare(`
    DELETE FROM calendar_sync
    WHERE event_id IN (SELECT id FROM events WHERE strftime('%Y-%m', event_date) = ?)
  `).bind(monthKey).run()
  await db.prepare(`
    DELETE FROM assignment_recommendations
    WHERE event_id IN (SELECT id FROM events WHERE strftime('%Y-%m', event_date) = ?)
  `).bind(monthKey).run()
}

// Delete event
app.delete('/api/events/:id', async (c) => {
  try {
    const id = Number(c.req.param('id'))
    if (!id) {
      return c.json({ success: false, error: 'Invalid event id' }, 400)
    }

    await deleteEventDependencies(c.env.DB, id)
    await c.env.DB.prepare(`
      DELETE FROM events WHERE id = ?
    `).bind(id).run()
    
    return c.json({ success: true, message: 'Event deleted successfully' })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Bulk delete events by date range
app.post('/api/events/bulk-delete', async (c) => {
  try {
    const body = await c.req.json()
    const month = Number(body.month)
    const year = Number(body.year)
    
    if (!month || !year || month < 1 || month > 12) {
      return c.json({ success: false, error: 'Month and year are required' }, 400)
    }
    
    const monthKey = `${year}-${String(month).padStart(2, '0')}`
    
    // Count events first
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM events 
      WHERE strftime('%Y-%m', event_date) = ?
    `).bind(monthKey).first()
    
    const count = countResult?.count || 0
    
    if (count === 0) {
      return c.json({ success: true, deleted: 0, message: 'No events found for this month' })
    }
    
    await deleteMonthEventDependencies(c.env.DB, monthKey)
    await c.env.DB.prepare(`
      DELETE FROM events 
      WHERE strftime('%Y-%m', event_date) = ?
    `).bind(monthKey).run()
    
    return c.json({ 
      success: true, 
      deleted: count,
      message: `Deleted ${count} events from ${monthKey}` 
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Bulk upload events (for CSV/Word import with duplicate detection)
app.post('/api/events/bulk', async (c) => {
  try {
    const body = await c.req.json()
    const { events } = body
    
    if (!Array.isArray(events) || events.length === 0) {
      return c.json({ success: false, error: 'Events array is required' }, 400)
    }
    
    // Track results and skipped duplicates
    const inserted = []
    const skipped = []
    const invalid = []
    
    for (const event of events) {
      const { event_date, program, team, sound_requirements, call_time, crew, foh_crew, stage_crew } = event
      let { venue } = event

      // Validate required fields
      if (!event_date || !program || !venue) {
        invalid.push({ ...event, reason: 'Missing required fields (date, program, or venue)' })
        continue
      }

      // Normalise JBT Museum variants only (e.g. "JBT Museum 7pm", "JBT Museum 9am to 8pm").
      // All other venues are stored exactly as received — nothing else is touched.
      const venueUpper = venue.trim().toUpperCase()
      if (venueUpper === 'JBT MUSEUM' || venueUpper.startsWith('JBT MUSEUM ') || venueUpper.startsWith('JBT MUSEUM\t')) {
        venue = 'JBT Museum'
      }

      // Check for duplicate: same date + program + venue
      // This prevents re-importing events that already exist (from manual entry or previous imports)
      const existing = await c.env.DB.prepare(`
        SELECT id FROM events
        WHERE event_date = ? AND program = ? AND venue = ?
        LIMIT 1
      `).bind(event_date, program, venue).first()

      if (existing) {
        // Duplicate found — if CSV has crew, update the existing record's crew fields
        if (crew && crew.trim()) {
          await c.env.DB.prepare(`
            UPDATE events SET crew = ?, foh_crew = ?, stage_crew = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).bind(crew.trim(), foh_crew || null, stage_crew || null, existing.id).run()
          inserted.push({ id: existing.id, ...event, _action: 'crew_updated' })
        } else {
          skipped.push({
            ...event,
            reason: 'Duplicate with no crew to update',
            existing_id: existing.id
          })
        }
        continue
      }

      // Not a duplicate - insert new event
      const requirements_updated = sound_requirements && sound_requirements.trim() !== '' ? 1 : 0

      const result = await c.env.DB.prepare(`
        INSERT INTO events (event_date, program, venue, team, sound_requirements, call_time, crew, foh_crew, stage_crew, requirements_updated, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        event_date,
        program,
        venue,
        team || null,
        sound_requirements || null,
        call_time || null,
        crew || null,
        foh_crew || null,
        stage_crew || null,
        requirements_updated,
        'import_word'
      ).run()

      inserted.push({ id: result.meta.last_row_id, ...event })
    }
    
    // Build detailed response message
    const crewUpdated = inserted.filter((e: any) => e._action === 'crew_updated').length
    const newInserts = inserted.length - crewUpdated
    let message = newInserts > 0 ? `${newInserts} events uploaded successfully` : ''
    if (crewUpdated > 0) {
      message += (message ? ', ' : '') + `${crewUpdated} crew assignments updated`
    }
    if (skipped.length > 0) {
      message += `, ${skipped.length} skipped`
    }
    if (invalid.length > 0) {
      message += `, ${invalid.length} invalid entries ignored`
    }
    
    return c.json({ 
      success: true, 
      message,
      data: inserted,
      skipped: skipped.length > 0 ? skipped : undefined,
      invalid: invalid.length > 0 ? invalid : undefined,
      stats: {
        total_processed: events.length,
        inserted: inserted.length,
        skipped: skipped.length,
        invalid: invalid.length
      }
    }, 201)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Analytics endpoint for AI queries
app.get('/api/analytics/stats', async (c) => {
  try {
    // Get date range from query (default to last 6 months)
    const endDate = new Date().toISOString().split('T')[0]
    const startDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    
    const start = c.req.query('start') || startDate
    const end = c.req.query('end') || endDate
    
    // Total events count
    const totalResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM events
      WHERE event_date >= ? AND event_date <= ?
    `).bind(start, end).first()
    
    // Events by venue
    const venueStats = await c.env.DB.prepare(`
      SELECT venue, COUNT(*) as count 
      FROM events
      WHERE event_date >= ? AND event_date <= ?
      GROUP BY venue
      ORDER BY count DESC
    `).bind(start, end).all()
    
    // Events by crew
    const crewStats = await c.env.DB.prepare(`
      SELECT crew, COUNT(*) as count 
      FROM events
      WHERE crew IS NOT NULL AND crew != '' AND event_date >= ? AND event_date <= ?
      GROUP BY crew
      ORDER BY count DESC
    `).bind(start, end).all()
    
    return c.json({ 
      success: true, 
      data: {
        total: totalResult?.total || 0,
        venueStats: venueStats.results || [],
        crewStats: crewStats.results || []
      }
    })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// ============================================
// INTENT CLASSIFIER - Analyzes query intent
// ============================================
function classifyIntent(query: string, pastContext: any[]) {
  const lowerQuery = query.toLowerCase()
  
  // Extract learned preferences from past context
  const learnedPreferences: any[] = []
  pastContext.forEach(ctx => {
    if (ctx.context_data) {
      try {
        const data = JSON.parse(ctx.context_data)
        if (data.venues) learnedPreferences.push({ type: 'venue_preference', value: data.venues })
        if (data.time) learnedPreferences.push({ type: 'time_preference', value: data.time })
      } catch (e) {
        // Ignore parse errors
      }
    }
  })
  
  // Detect venues mentioned
  const venues = {
    jbt: /jbt(?! museum)/i.test(lowerQuery) || lowerQuery.includes('jamshed') || lowerQuery.includes('bhabha'),
    tata: lowerQuery.includes('tata') || lowerQuery.includes('tt '),
    tet: lowerQuery.includes('tet') || lowerQuery.includes('experimental'),
    all: lowerQuery.includes('all venues') || lowerQuery.includes('no events')
  }
  
  // Detect intent type
  const intentTypes = {
    availability: lowerQuery.includes('free') || lowerQuery.includes('available') || 
                  lowerQuery.includes('maintenance') || lowerQuery.includes('schedule'),
    workshop: lowerQuery.includes('workshop') || lowerQuery.includes('training'),
    eventQuery: lowerQuery.includes('show') || lowerQuery.includes('event') || 
                lowerQuery.includes('program') || lowerQuery.includes('performance'),
    crewQuery: lowerQuery.includes('crew') && !lowerQuery.includes('workshop'),
    dateQuery: lowerQuery.includes('when') || lowerQuery.includes('which date') || 
               lowerQuery.includes('what day')
  }
  
  // Determine if clarification is needed
  let needsClarification = false
  let clarificationMessage = ''
  let suggestedQueries: string[] = []
  let intentType = 'general'
  
  // Case 1: Workshop/availability query without specific venue
  if ((intentTypes.workshop || intentTypes.availability) && !venues.jbt && !venues.tata && !venues.tet && !venues.all) {
    // Check if we have learned preferences
    const venuePreference = learnedPreferences.find(p => p.type === 'venue_preference')
    
    if (venuePreference) {
      // Apply learned preference
      console.log('Applying learned venue preference:', venuePreference.value)
      venues.jbt = venuePreference.value.includes('JBT')
      venues.tata = venuePreference.value.includes('Tata')
      venues.tet = venuePreference.value.includes('TET')
      intentType = 'availability_with_learned_preference'
    } else {
      needsClarification = true
      intentType = 'ambiguous_availability'
      clarificationMessage = "I'd be happy to help you find dates! Could you clarify:\n\n1. Which venue(s) do you need? (JBT, Tata Theatre, Experimental Theatre, or all venues?)\n2. Do you need the entire venue free, or just no events scheduled?\n3. Any specific time requirements (morning, afternoon, evening)?\n\nI'll remember your preference for next time!"
      suggestedQueries = [
        'When are JBT and Tata both free in November?',
        'Days with no events in any venue in November',
        'When is Experimental Theatre available in November?'
      ]
    }
  }
  // Case 2: Multi-venue availability
  else if ((venues.jbt && venues.tata) || (venues.jbt && venues.tet) || (venues.tata && venues.tet)) {
    intentType = 'multi_venue_availability'
  }
  // Case 3: All venues free (no events at all)
  else if (venues.all || (lowerQuery.includes('no events') && lowerQuery.includes('day'))) {
    intentType = 'all_venues_free'
  }
  // Case 4: Single venue availability
  else if (venues.jbt || venues.tata || venues.tet) {
    intentType = 'single_venue_availability'
  }
  // Case 5: Event query
  else if (intentTypes.eventQuery) {
    intentType = 'event_search'
  }
  // Case 6: Crew query
  else if (intentTypes.crewQuery) {
    intentType = 'crew_search'
  }
  
  return {
    type: intentType,
    needsClarification,
    clarificationMessage,
    suggestedQueries,
    context: {
      venues,
      intentTypes,
      query: query
    },
    learnedPreferences
  }
}

// ============================================
// RAG QUERY ENDPOINT (Version 4.0 - Claude Sonnet 4 + Vectorize)
// ============================================
app.post('/api/ai/rag', handleRAGQuery)

// ============================================
// EMBEDDING BACKFILL ENDPOINT (Admin Only)
// ============================================
app.post('/api/admin/backfill-embeddings', async (c) => {
  try {
    const { batch_size } = await c.req.json().catch(() => ({ batch_size: 50 }))
    
    const result = await backfillEmbeddings(c, batch_size || 50)
    
    return c.json(result)
  } catch (error: any) {
    return c.json({
      success: false,
      error: 'Backfill failed',
      details: error.message
    }, 500)
  }
})

// AI Query endpoint - Intelligent data analysis with Claude (Legacy)
app.post('/api/ai/query', async (c) => {
  try {
    const body = await c.req.json()
    const { query, session_id } = body
    
    if (!query) {
      return c.json({ success: false, error: 'Query is required' }, 400)
    }
    
    // Generate session ID if not provided
    const sessionId = session_id || `session_${Date.now()}_${Math.random().toString(36).substring(7)}`
    
    // Get relevant events from the database
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    const sixMonthsAhead = new Date()
    sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6)
    
    const allEvents = await c.env.DB.prepare(`
      SELECT event_date, program, venue, crew, team 
      FROM events 
      WHERE event_date >= ? AND event_date <= ?
      ORDER BY event_date ASC
    `).bind(
      threeMonthsAgo.toISOString().split('T')[0],
      sixMonthsAhead.toISOString().split('T')[0]
    ).all()
    
    // ============================================
    // INTENT CLASSIFIER - Determines query intent
    // ============================================
    const lowerQuery = query.toLowerCase()
    
    // Check context memory for similar past queries
    const pastContext = await c.env.DB.prepare(`
      SELECT intent, context_data, resolved 
      FROM query_context 
      WHERE session_id = ? AND resolved = 1 
      ORDER BY created_at DESC 
      LIMIT 5
    `).bind(sessionId).all()
    
    // Intent classification
    const intent = classifyIntent(lowerQuery, pastContext.results)
    
    // Store query context
    await c.env.DB.prepare(`
      INSERT INTO query_context (session_id, query_text, intent, context_data, resolved)
      VALUES (?, ?, ?, ?, 0)
    `).bind(
      sessionId,
      query,
      intent.type,
      JSON.stringify(intent.context)
    ).run()
    
    // Handle ambiguous queries using intent classification
    if (intent.needsClarification) {
      // Store clarification request
      await c.env.DB.prepare(`
        UPDATE query_context 
        SET context_data = ? 
        WHERE session_id = ? AND query_text = ?
      `).bind(
        JSON.stringify({ ...intent.context, clarification_requested: true }),
        sessionId,
        query
      ).run()
      
      return c.json({
        success: true,
        query: query,
        session_id: sessionId,
        data: [],
        clarification_needed: true,
        question: intent.clarificationMessage,
        intent: intent.type,
        suggested_queries: intent.suggestedQueries,
        method: 'Clarification Request'
      })
    }
    
    // If we have context from learning, apply it
    if (intent.learnedPreferences && intent.learnedPreferences.length > 0) {
      console.log('Applying learned preferences:', intent.learnedPreferences)
    }
    
    // Smart detection: Handle "both venues free" or "JBT and Tata" queries directly in code
    // Also apply learned venue preferences
    let hasJBT = /jbt(?! museum)/i.test(lowerQuery) || lowerQuery.includes('jamshed') || lowerQuery.includes('bhabha')
    let hasTata = lowerQuery.includes('tata')
    let hasAvailability = lowerQuery.includes('free') || lowerQuery.includes('available') || lowerQuery.includes('maintenance') || lowerQuery.includes('schedule') || lowerQuery.includes('workshop')
    
    // Apply learned preferences if available
    if (intent.type === 'availability_with_learned_preference' && intent.context.venues) {
      hasJBT = intent.context.venues.jbt
      hasTata = intent.context.venues.tata
      hasAvailability = true  // Force availability check when using learned preferences
      console.log('Applied learned venue preferences: JBT=', hasJBT, 'Tata=', hasTata)
    }
    
    const isBothFreeQuery = hasJBT && hasTata && hasAvailability
    
    if (isBothFreeQuery) {
      // Extract month from query (default to current month if not specified)
      const monthMatch = query.match(/november|december|january|february|march|april|may|june|july|august|september|october/i)
      const targetMonth = monthMatch ? monthMatch[0].toLowerCase() : null
      
      // Generate all dates in target month
      const today = new Date()
      let year = today.getFullYear()
      const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
      const monthIndex = targetMonth ? monthNames.indexOf(targetMonth) : today.getMonth()
      
      // If target month is in the past, use next year
      if (monthIndex < today.getMonth()) {
        year++
      }
      
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
      const allDatesInMonth = []
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, monthIndex, day)
        allDatesInMonth.push(date.toISOString().split('T')[0])
      }
      
      // Filter events for JBT and Tata in that month
      // Note: Venue formats can be "JBT", "JBT 5pm", "Jamshed Bhabha Theatre", etc.
      const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
      
      const jbtEvents = allEvents.results.filter((e: any) => {
        const venue = e.venue?.toLowerCase() || ''
        const dateMatches = e.event_date.startsWith(monthPrefix)
        // Match: "JBT", "JBT 5pm", "Jamshed Bhabha", etc.
        // But NOT: "TET & JBT Museum" (that's TET, not JBT)
        const isJBT = (venue.startsWith('jbt') || venue.includes('jamshed') || venue.includes('bhabha')) &&
                      !venue.startsWith('tet') &&
                      !venue.includes('museum')
        return isJBT && dateMatches
      })
      
      const tataEvents = allEvents.results.filter((e: any) => {
        const venue = e.venue?.toLowerCase() || ''
        const dateMatches = e.event_date.startsWith(monthPrefix)
        // Match: "TT", "TT 6pm", "Tata Theatre", etc.
        const isTata = venue.startsWith('tt') || venue.includes('tata theatre')
        return isTata && dateMatches
      })
      
      // Find dates where both are free
      const jbtDates = new Set(jbtEvents.map((e: any) => e.event_date))
      const tataDates = new Set(tataEvents.map((e: any) => e.event_date))
      
      const freeDates = allDatesInMonth
        .filter(date => !jbtDates.has(date) && !tataDates.has(date))
        .map(date => ({
          event_date: date,
          program: 'Both venues free for maintenance',
          venue: 'JBT & Tata Theatre',
          crew: '',
          team: ''
        }))
      
      // Mark query as resolved and store learned context
      await c.env.DB.prepare(`
        UPDATE query_context 
        SET resolved = 1, context_data = ?
        WHERE session_id = ? AND query_text = ?
      `).bind(
        JSON.stringify({
          venues: ['JBT', 'Tata'],
          intent: 'multi_venue_availability',
          successful: true,
          result_count: freeDates.length
        }),
        sessionId,
        query
      ).run()
      
      return c.json({
        success: true,
        query: query,
        session_id: sessionId,
        data: freeDates,
        explanation: `Code analysis found ${freeDates.length} dates where both venues are free`,
        method: 'Smart Code Analysis',
        learned: true
      })
    }
    
    // Handle "completely free" or "no events" queries (all venues)
    const isCompletelyFreeQuery = (lowerQuery.includes('no events') || lowerQuery.includes('completely free') || 
                                   lowerQuery.includes('all venues') || lowerQuery.includes('no shows')) &&
                                   (lowerQuery.includes('day') || lowerQuery.includes('date'))
    
    if (isCompletelyFreeQuery) {
      // Extract month from query
      const monthMatch = query.match(/november|december|january|february|march|april|may|june|july|august|september|october/i)
      const targetMonth = monthMatch ? monthMatch[0].toLowerCase() : null
      
      const today = new Date()
      let year = today.getFullYear()
      const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
      const monthIndex = targetMonth ? monthNames.indexOf(targetMonth) : today.getMonth()
      
      if (monthIndex < today.getMonth()) {
        year++
      }
      
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
      const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
      
      // Get all event dates in the month
      const eventDates = new Set(
        allEvents.results
          .filter((e: any) => e.event_date.startsWith(monthPrefix))
          .map((e: any) => e.event_date)
      )
      
      // Find dates with no events at all
      const completelyFreeDates = []
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, monthIndex, day).toISOString().split('T')[0]
        if (!eventDates.has(date)) {
          completelyFreeDates.push({
            event_date: date,
            program: 'No events scheduled - Perfect for crew workshop',
            venue: 'All venues available',
            crew: '',
            team: ''
          })
        }
      }
      
      // Mark query as resolved and store learned context
      await c.env.DB.prepare(`
        UPDATE query_context 
        SET resolved = 1, context_data = ?
        WHERE session_id = ? AND query_text = ?
      `).bind(
        JSON.stringify({
          venues: ['All'],
          intent: 'all_venues_free',
          successful: true,
          result_count: completelyFreeDates.length
        }),
        sessionId,
        query
      ).run()
      
      return c.json({
        success: true,
        query: query,
        session_id: sessionId,
        data: completelyFreeDates,
        explanation: `Found ${completelyFreeDates.length} days with no events scheduled in any venue`,
        method: 'Smart Code Analysis',
        learned: true
      })
    }
    
    // Handle single venue availability queries
    const hasTET = lowerQuery.includes('tet') || lowerQuery.includes('experimental')
    const singleVenueQuery = (hasJBT && !hasTata && !hasTET) || 
                             (!hasJBT && hasTata && !hasTET) || 
                             (!hasJBT && !hasTata && hasTET)
    
    if (singleVenueQuery && hasAvailability) {
      // Determine which venue
      let venueName = ''
      let venueFilter: (venue: string) => boolean
      
      if (hasJBT) {
        venueName = 'JBT'
        venueFilter = (v: string) => {
          const lv = v.toLowerCase()
          return (lv.startsWith('jbt') || lv.includes('jamshed') || lv.includes('bhabha')) && !lv.startsWith('tet') && !lv.includes('museum')
        }
      } else if (hasTata) {
        venueName = 'Tata Theatre'
        venueFilter = (v: string) => {
          const lv = v.toLowerCase()
          return lv.startsWith('tt') || lv.includes('tata theatre')
        }
      } else if (hasTET) {
        venueName = 'Experimental Theatre'
        venueFilter = (v: string) => {
          const lv = v.toLowerCase()
          return lv.startsWith('tet') || lv.includes('experimental')
        }
      } else {
        // Should not reach here
        venueFilter = () => false
      }
      
      // Extract month
      const monthMatch = query.match(/november|december|january|february|march|april|may|june|july|august|september|october/i)
      const targetMonth = monthMatch ? monthMatch[0].toLowerCase() : null
      
      const today = new Date()
      let year = today.getFullYear()
      const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
      const monthIndex = targetMonth ? monthNames.indexOf(targetMonth) : today.getMonth()
      
      if (monthIndex < today.getMonth()) {
        year++
      }
      
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
      const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`
      
      // Get events for this venue in this month
      const venueEvents = allEvents.results.filter((e: any) => {
        const dateMatches = e.event_date.startsWith(monthPrefix)
        const venueMatches = venueFilter(e.venue || '')
        return dateMatches && venueMatches
      })
      
      const eventDates = new Set(venueEvents.map((e: any) => e.event_date))
      
      // Find free dates
      const freeDates = []
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, monthIndex, day).toISOString().split('T')[0]
        if (!eventDates.has(date)) {
          freeDates.push({
            event_date: date,
            program: `No event scheduled at ${venueName}`,
            venue: venueName,
            crew: '',
            team: ''
          })
        }
      }
      
      // Mark as resolved
      await c.env.DB.prepare(`
        UPDATE query_context 
        SET resolved = 1, context_data = ?
        WHERE session_id = ? AND query_text = ?
      `).bind(
        JSON.stringify({
          venues: [venueName],
          intent: 'single_venue_availability',
          successful: true,
          result_count: freeDates.length
        }),
        sessionId,
        query
      ).run()
      
      return c.json({
        success: true,
        query: query,
        session_id: sessionId,
        data: freeDates,
        explanation: `Found ${freeDates.length} free dates for ${venueName} in ${monthNames[monthIndex]}`,
        method: 'Smart Code Analysis',
        learned: true
      })
    }
    
    // For other queries, use AI (with minimal context)
    const today = new Date()
    const currentMonth = today.toLocaleString('default', { month: 'long' })
    const currentYear = today.getFullYear()
    const apiKey = c.env.ANTHROPIC_API_KEY
    
    // Let Claude ANALYZE the data directly, not generate SQL
    const prompt = `You are an intelligent data analyst for NCPA Sound Crew event management.

CURRENT CONTEXT:
- Today's date: ${today.toISOString().split('T')[0]}
- Current month: ${currentMonth} ${currentYear}

COMPLETE EVENT DATABASE (simplified for analysis):
${allEvents.results.map((e: any) => `${e.event_date}|${e.venue}|${e.program}`).join('\n')}

USER QUESTION: "${query}"

INSTRUCTIONS:
Analyze the complete event data above and answer the user's question intelligently.

VENUE NAME MATCHING:
- "Tata" / "Tata Theatre" / "TT" → Match any venue containing "Tata"
- "JBT" / "Jamshed Bhabha" / "Bhabha" → Match "Jamshed Bhabha Theatre"
- "Experimental" / "Exp" / "ET" → Match "Experimental Theatre"
- Be flexible with venue names (case-insensitive, partial matches)

FOR SINGLE VENUE "FREE DATES" QUESTIONS:
Example: "Which dates no events at Tata?"
1. List ALL dates in November 2025 (Nov 1-30)
2. Check which dates have events at Tata Theatre
3. Return dates that DON'T have Tata events
4. Format: [{"event_date": "2025-11-03", "program": "No event scheduled", "venue": "Tata Theatre"}]

FOR MULTIPLE VENUE "BOTH FREE" QUESTIONS:
Example: "Closest date when JBT and Tata both free?"
1. List ALL dates in November 2025
2. For each date, check if EITHER venue has an event
3. Return dates where BOTH venues are free (no JBT event AND no Tata event)
4. Sort by date (closest first)
5. Format: [{"event_date": "2025-11-03", "program": "Both venues free for maintenance", "venue": "JBT & Tata Theatre"}]

FOR REGULAR EVENT QUERIES:
Example: "Show all events at Tata" or "Events tomorrow"
1. Filter events matching the criteria
2. Return matching events from database
3. Format: [{"event_date": "...", "program": "...", "venue": "...", "crew": "..."}]

OUTPUT FORMAT:
- Return ONLY a valid JSON array, nothing else
- No markdown, no explanations, no code blocks
- Just pure JSON: [{"event_date": "...", "program": "...", "venue": "..."}]
- Include relevant fields: event_date, program, venue (and crew/team if relevant)
- Sort results by date (earliest first)

EXAMPLES:

Q: "Which dates no events at Tata?"
A: [{"event_date":"2025-11-01","program":"No event scheduled","venue":"Tata Theatre"},{"event_date":"2025-11-03","program":"No event scheduled","venue":"Tata Theatre"}]

Q: "Closest date JBT and Tata both free?"
A: [{"event_date":"2025-11-05","program":"Both venues free for maintenance","venue":"JBT & Tata Theatre"}]

Q: "Events tomorrow"
A: [{"event_date":"2025-11-02","program":"Classical Concert","venue":"Tata Theatre","crew":"Ashwin"}]

NOW ANALYZE AND RESPOND:
JSON ARRAY:`
    
    // Use Cloudflare Workers AI for fast, local processing (no external API)
    let aiResponse: string
    
    try {
      // Try Cloudflare AI first (built-in, fast, no CPU timeout)
      if (c.env.AI) {
        const aiResult = await c.env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
          prompt: prompt,
          max_tokens: 1024
        })
        aiResponse = aiResult.response || aiResult.text || JSON.stringify(aiResult)
      } else {
        // Fallback to Anthropic if AI binding not available
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-20241022',
            max_tokens: 2048,
            messages: [{
              role: 'user',
              content: prompt
            }]
          })
        })
        
        if (!response.ok) {
          const error = await response.text()
          console.error('Anthropic API error:', error)
          return c.json({ 
            success: false, 
            error: 'Anthropic API error',
            status: response.status,
            details: error.substring(0, 500)
          }, 500)
        }
        
        const aiResult = await response.json()
        aiResponse = aiResult.content[0].text
      }
    } catch (aiError: any) {
      console.error('AI processing error:', aiError)
      return c.json({ 
        success: false, 
        error: 'AI processing failed',
        details: aiError.message
      }, 500)
    }
    
    aiResponse = aiResponse.trim()
    
    // Clean up response - remove markdown if present
    aiResponse = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    
    console.log('AI Response:', aiResponse)
    
    // Parse the JSON array from AI
    let results = []
    try {
      // Try to extract JSON if AI added extra text
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0])
      } else {
        results = JSON.parse(aiResponse)
      }
      
      // Validate it's an array
      if (!Array.isArray(results)) {
        console.error('AI response is not an array:', results)
        return c.json({ 
          success: false, 
          error: 'AI returned invalid format',
          debug: aiResponse.substring(0, 200)
        }, 500)
      }
      
    } catch (parseError: any) {
      console.error('Failed to parse AI response:', parseError)
      console.error('Raw AI response:', aiResponse)
      return c.json({ 
        success: false, 
        error: 'AI returned unparseable data: ' + parseError.message,
        debug: aiResponse.substring(0, 200)
      }, 500)
    }
    
    // Ensure results have required fields
    results = results.map(r => ({
      event_date: r.event_date || r.date || '',
      program: r.program || r.title || 'Event',
      venue: r.venue || '',
      crew: r.crew || '',
      team: r.team || ''
    }))
    
    return c.json({ 
      success: true,
      query: query,
      data: results,
      explanation: `AI analyzed ${allEvents.results.length} events and found ${results.length} results`,
      method: c.env.AI ? 'AI Analysis (Cloudflare Llama 3.1)' : 'AI Analysis (Claude Haiku)'
    })
    
  } catch (error: any) {
    console.error('AI query error:', error)
    return c.json({ 
      success: false, 
      error: 'AI query failed',
      details: error.message,
      stack: error.stack?.substring(0, 300)
    }, 500)
  }
})

// Helper function: Parse a chunk of text with Claude
async function parseChunkWithClaude(chunk: string, contextHint: string, apiKey: string, chunkNumber: number, totalChunks: number): Promise<any[]> {
  const prompt = `You are parsing section ${chunkNumber} of ${totalChunks} from an NCPA Sound Crew event schedule document. Extract ALL events from this section and return them as a JSON array.${contextHint}

Document section:
${chunk}

Parse ALL events and extract the following fields for EACH event:
- event_date: Date in YYYY-MM-DD format (USE THE MONTH AND YEAR FROM THE CONTEXT ABOVE)
- program: SHORT name only — max 5-7 words, the core event title. Remove: "An NCPA Presentation", duration like "(90 mins)", organizer in brackets like "[Nooshin/Team]", subtitles after colons, sponsor info. Example: "Saz-e-Bahar" not "Saz-e-Bahar: Festival of Indian Instrumental Music An NCPA Presentation Supported by Citi Day 1"
- venue: Full venue name from the VENUE CODE MAPPING below
- team: Curator/team name if mentioned (often in brackets like [Dr.Swapno/Team], [Nooshin/Team])
- sound_requirements: Include ONLY these audio items: microphones (cordless/lapel/headset/foot/podium), mic stands, monitors, speakers, laptops for playback, aux/audio input, "NCPA basic sound", audio recording. Nothing else — no projectors, screens, video, lighting, AC, stage, chairs, catering, parking, green room, ushers. If in doubt, leave it out. If requirements say "to follow" or "will follow", leave empty.
- call_time: Extract ONLY the time when the SOUND TEAM must be ready. Valid patterns only: "sound to be ready by [TIME]", "connections to be ready by [TIME]", "NCPA basic sound to be ready by [TIME]", "Sound Check at [TIME]". Do NOT use general setup times, technician arrival times, or event start times.
- crew: Always return empty string ""

CRITICAL DATE INSTRUCTIONS:
1. Look for day names (Mon, Tue, Wed, Thu, Fri, Sat, Sun) followed by dates (Thu 4th, Fri 5th, Wed 1st, Sat 7th, etc.)
2. USE THE MONTH AND YEAR FROM THE CONTEXT provided in the filename above
3. ALWAYS use the context month/year — never guess the month
4. MULTI-DAY EVENTS: When an event spans multiple dates (e.g. "Thu 2nd & Fri 3rd & Sat 4th & Sun 5th" or "Sun 12th & Mon 13th"), create a SEPARATE event entry for EACH individual date. All fields are identical — only event_date changes.
5. Treat "&", "and", "to" between dates as indicators of multi-day spans.

VENUE CODE MAPPING (always use these exact full names):
- TT → "Tata Theatre"
- TET → "Experimental Theatre"
- JBT → "Jamshed Bhabha Theatre"
- GDT → "Godrej Dance Theatre"
- LT or Little → "Little Theatre"
- DPAG → "Dilip Piramal Art Gallery"
- OAP → "Open Air Plaza"
- Stuart Liff or Stuart Liff Lib → "Stuart Liff Library"
- Experimental Theatre or Exp → "Experimental Theatre"

Return ONLY a valid JSON array, nothing else. No explanations, no markdown, just the JSON array.

CRITICAL JSON REQUIREMENTS:
- Use double quotes for all strings
- Escape any quotes inside strings with backslash
- No trailing commas
- No newlines inside string values (replace with spaces)

Example format (multi-day event creates separate entries, crew always empty):
[
  {
    "event_date": "2026-04-02",
    "program": "The Monk & The Warrior",
    "venue": "Experimental Theatre",
    "team": "Bruce/Rajeshri",
    "sound_requirements": "",
    "call_time": "",
    "crew": ""
  },
  {
    "event_date": "2026-04-03",
    "program": "The Monk & The Warrior",
    "venue": "Experimental Theatre",
    "team": "Bruce/Rajeshri",
    "sound_requirements": "",
    "call_time": "",
    "crew": ""
  },
  {
    "event_date": "2026-04-10",
    "program": "Page to Stage: Some of My Ghazals",
    "venue": "Little Theatre",
    "team": "Dr.Sujata/Team",
    "sound_requirements": "2 cordless headset mics, 2 cordless mics, 1 mic stand, 1 monitor, 1 podium mic",
    "call_time": "",
    "crew": ""
  },
  {
    "event_date": "2026-04-11",
    "program": "Merry Go Round",
    "venue": "Tata Theatre",
    "team": "Nooshin/Team",
    "sound_requirements": "NCPA basic sound",
    "call_time": "2:00 PM",
    "crew": ""
  }
]

If no events found, return: []`
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })
  })
  
  if (!response.ok) {
    const error = await response.text()
    console.error(`Chunk ${chunkNumber} AI error:`, error)
    throw new Error(`AI parsing failed for chunk ${chunkNumber}`)
  }
  
  const aiResult = await response.json()
  let aiResponse = aiResult.content[0].text.trim()
  
  // Remove markdown code blocks if present
  aiResponse = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '')
  
  // Parse JSON response with better error handling
  try {
    // Try to find JSON array in response
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[0]
      
      // Clean up common JSON issues
      let cleanedJson = jsonStr
        // Remove trailing commas before ] or }
        .replace(/,(\s*[\]}])/g, '$1')
        // Fix unescaped newlines in strings (replace with space)
        .replace(/("[^"]*)\n([^"]*")/g, '$1 $2')
      
      return JSON.parse(cleanedJson)
    } else {
      // Try parsing directly
      return JSON.parse(aiResponse)
    }
  } catch (parseError: any) {
    console.error(`Failed to parse chunk ${chunkNumber} response:`, parseError.message)
    console.error(`Response preview:`, aiResponse.substring(0, 200))
    return []
  }
}

// Helper function: Remove duplicate events
function deduplicateEvents(events: any[]): any[] {
  const seen = new Set()
  const unique = []
  
  for (const event of events) {
    // Create unique key from date + program + venue
    const key = `${event.event_date}|${event.program}|${event.venue}`.toLowerCase()
    
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(event)
    }
  }
  
  return unique
}

// AI-powered Word document parser with chunked processing
app.post('/api/ai/parse-word', async (c) => {
  try {
    const body = await c.req.json()
    const { text, filename } = body
    
    if (!text) {
      return c.json({ success: false, error: 'Document text is required' }, 400)
    }
    
    // Get API key from environment
    const apiKey = c.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return c.json({ success: false, error: 'AI service not configured' }, 500)
    }
    
    // Extract month/year context from filename if available
    let contextHint = ''
    if (filename) {
      const monthMatch = filename.match(/(january|february|march|april|may|june|july|august|september|october|november|december)/i)
      const yearMatch = filename.match(/20\d{2}/)
      if (monthMatch || yearMatch) {
        contextHint = `\n\nContext from filename: ${monthMatch?.[0] || ''} ${yearMatch?.[0] || ''}`
      }
    }
    
    console.log(`📄 Processing Word document: ${text.length} characters`)
    
    // CHUNKED PROCESSING: Split document into manageable chunks
    // Using larger chunks (18K) and smarter splitting to avoid cutting events
    const CHUNK_SIZE = 18000 // Characters per chunk (increased for better event capture)
    const chunks: string[] = []
    
    if (text.length <= CHUNK_SIZE) {
      // Small document - process in one chunk
      chunks.push(text)
    } else {
      // Large document - split intelligently at event boundaries
      for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        let chunkEnd = Math.min(i + CHUNK_SIZE, text.length)
        
        // If not at end of document, try to find a good split point
        if (chunkEnd < text.length) {
          // Look for a day pattern (Mon/Tue/Wed etc) in the next 500 chars
          const searchArea = text.substring(chunkEnd, Math.min(chunkEnd + 500, text.length))
          const dayMatch = searchArea.match(/\n(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}(st|nd|rd|th)/i)
          
          if (dayMatch && dayMatch.index !== undefined) {
            // Split at the start of the next event
            chunkEnd += dayMatch.index
          }
        }
        
        chunks.push(text.substring(i, chunkEnd))
      }
    }
    
    console.log(`📊 Split into ${chunks.length} chunks for processing (avg ${Math.round(text.length / chunks.length)} chars each)`)
    
    // Process each chunk with Claude
    const allEvents: any[] = []
    
    for (let i = 0; i < chunks.length; i++) {
      console.log(`🤖 Processing chunk ${i + 1}/${chunks.length}...`)
      
      try {
        const chunkEvents = await parseChunkWithClaude(
          chunks[i],
          contextHint,
          apiKey,
          i + 1,
          chunks.length
        )
        
        console.log(`✅ Chunk ${i + 1}: Found ${chunkEvents.length} events`)
        allEvents.push(...chunkEvents)
        
      } catch (chunkError: any) {
        console.error(`❌ Chunk ${i + 1} failed:`, chunkError.message)
        // Continue processing other chunks even if one fails
      }
    }
    
    // Validate and clean events
    let validEvents = allEvents.filter(event => {
      return event.event_date && event.program && event.venue
    })
    
    // Remove duplicates (events that appear in multiple chunks)
    validEvents = deduplicateEvents(validEvents)
    
    // Sort by date
    validEvents.sort((a, b) => {
      return a.event_date.localeCompare(b.event_date)
    })
    
    console.log(`✅ Successfully parsed ${validEvents.length} unique events from ${chunks.length} chunks`)
    
    return c.json({ 
      success: true,
      events: validEvents,
      message: `Found ${validEvents.length} events in document (processed in ${chunks.length} chunks)`,
      chunks: chunks.length,
      totalEvents: allEvents.length,
      uniqueEvents: validEvents.length
    })
    
  } catch (error: any) {
    console.error('Word parsing error:', error)
    return c.json({ success: false, error: error.message || 'Failed to parse document' }, 500)
  }
})

// ============================================
// FRONTEND ROUTES
// ============================================

// Minimal Safari test page with NO external dependencies
app.get('/safari-test', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Safari Test</title>
        <style>
          body {
            font-family: 'Manrope', Arial, sans-serif;
            padding: 40px;
            background: #f8f9fc;
          }
          .box {
            background: rgba(255,255,255,0.80);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            padding: 20px;
            border-radius: 20px;
            outline: 1px solid rgba(173,179,184,0.18);
            box-shadow: inset 1px 1px 0 rgba(255,255,255,0.55), 0 8px 32px rgba(45,51,56,0.07);
          }
          .success { color: #A8C3A0; font-weight: bold; }
          .error { color: #c0717a; font-weight: bold; }
        </style>
        <script>
          console.log('✅ TEST 1: JavaScript is executing');
          
          function runTests() {
            console.log('✅ TEST 2: Functions work');
            
            var result = document.getElementById('result');
            result.innerHTML = '<p class="success">✅ JavaScript is working!</p>';
            result.innerHTML += '<p>✅ DOM manipulation works</p>';
            result.innerHTML += '<p>✅ Browser: ' + navigator.userAgent + '</p>';
            
            console.log('✅ TEST 3: DOM manipulation successful');
          }
          
          window.onload = function() {
            console.log('✅ TEST 4: Window.onload fired');
            runTests();
          };
        </script>
    </head>
    <body>
        <div class="box">
            <h1>🦁 Safari Test Page</h1>
            <p>This page has NO external scripts, NO CDN, NO dependencies.</p>
            <p>If you see green checkmarks below, JavaScript is working:</p>
            <div id="result">
                <p class="error">❌ JavaScript not running (if you see this red message)</p>
            </div>
            <hr>
            <p><strong>Check Safari Console:</strong></p>
            <p>Right-click → Inspect Element → Console tab</p>
            <p>You should see messages starting with "✅ TEST"</p>
        </div>
    </body>
    </html>
  `)
})

app.get('/', (c) => {
  // Set Content Security Policy for Safari compatibility and iframe embedding
  c.header('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdn.sheetjs.com https://api.anthropic.com; " +
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com; " +
    "font-src 'self' https://cdn.jsdelivr.net data:; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://api.anthropic.com; " +
    "worker-src 'self' blob:; " +
    "frame-ancestors 'self' https://ncpa-sound-admin.pages.dev https://*.ncpa-sound-admin.pages.dev;"
  )
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
        <title>NCPA Sound Crew - Event Schedule & Technical Dashboard</title>
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://cdn.sheetjs.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com; font-src 'self' https://cdn.jsdelivr.net data:; img-src 'self' data: https:; connect-src 'self' https://api.anthropic.com;">
        <!-- PWA -->
        <link rel="manifest" href="/manifest.json">
        <meta name="theme-color" content="#465080">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
        <meta name="apple-mobile-web-app-title" content="NCPA Sound">
        <link rel="apple-touch-icon" href="/icon.svg">
        <script>
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
          }
        </script>
        <script>
          // Safari compatibility test
          console.log('🦁 Safari: Page loaded at ' + new Date().toISOString());
          console.log('🦁 Safari: User Agent:', navigator.userAgent);
          console.log('🦁 Safari: Testing JavaScript execution...');
        </script>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fontsource/manrope@5.0.8/index.css" rel="stylesheet">
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          body {
            font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #f8f9fc;
          }

          /* ── Glassmorphism utilities ── */
          .glass-surface {
            background: rgba(248, 249, 252, 0.80);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            box-shadow: inset 1px 1px 0 rgba(255,255,255,0.55), 0 8px 32px rgba(45,51,56,0.06);
          }

          .glass-card {
            background: rgba(255, 255, 255, 0.70);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            outline: 1px solid rgba(173,179,184,0.15);
            box-shadow: inset 1px 1px 0 rgba(255,255,255,0.50);
          }

          /* ── Primary button — liquid glass ── */
          .btn-primary {
            background: linear-gradient(135deg, rgba(152,162,215,0.88) 0%, rgba(70,80,128,0.92) 100%);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.35);
            box-shadow: 0 2px 8px rgba(70,80,128,0.25), inset 0 1px 0 rgba(255,255,255,0.40);
            color: #ffffff;
            border-radius: 1.5rem;
            transition: all 0.18s ease;
          }
          .btn-primary:hover {
            opacity: 0.90;
            box-shadow: 0 4px 12px rgba(70,80,128,0.30), inset 0 1px 0 rgba(255,255,255,0.45);
          }

          /* ── Glass button — Apple liquid glass secondary ── */
          .btn-glass {
            background: rgba(255,255,255,0.52);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.65);
            box-shadow: 0 1px 3px rgba(45,51,56,0.08), inset 0 1px 0 rgba(255,255,255,0.72);
            border-radius: 10px;
            color: #2d3338;
            transition: all 0.18s ease;
          }
          .btn-glass:hover {
            background: rgba(255,255,255,0.72);
            box-shadow: 0 2px 6px rgba(45,51,56,0.10), inset 0 1px 0 rgba(255,255,255,0.80);
          }

          /* ── Tabs — iOS segmented control ── */
          .tab-active {
            background: rgba(255,255,255,0.82);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            color: #465080;
            box-shadow: 0 1px 4px rgba(45,51,56,0.12), inset 0 1px 0 rgba(255,255,255,0.80);
            outline: 1px solid rgba(173,179,184,0.18);
          }

          .event-card-green {
            background: rgba(240,253,244,0.70);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-left: 4px solid rgba(74,172,100,0.60);
            box-shadow: 0 2px 12px rgba(45,51,56,0.06);
            outline: 1px solid rgba(173,179,184,0.12);
          }

          .event-card-peach {
            background: rgba(254,242,242,0.70);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border-left: 4px solid rgba(220,88,88,0.55);
            box-shadow: 0 2px 12px rgba(45,51,56,0.06);
            outline: 1px solid rgba(173,179,184,0.12);
          }

          .calendar-day {
            min-height: 120px;
            outline: 1px solid rgba(173,179,184,0.15);
            background: rgba(255,255,255,0.68);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
          }

          #desktopCalendarLayout {
            align-items: flex-start;
            flex: 1;
            min-height: 0;
          }

          #desktopCalendarMain {
            flex: 1;
            min-width: 0;
            min-height: 0;
            overflow-y: auto;
            max-height: calc(100vh - 180px);
          }

          #todaySidebar {
            flex-shrink: 0;
            width: 280px;
            max-width: 30%;
            min-width: 260px;
            display: flex;
            flex-direction: column;
            align-self: flex-start;
            position: sticky;
            top: 0;
            z-index: 6;
            padding: 0.75rem 0.75rem 0.5rem;
            background: rgba(255,255,255,0.68);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            outline: 1px solid rgba(173,179,184,0.15);
            border-right: 1px solid rgba(173,179,184,0.15);
          }

          #todaySidebarClock {
            flex: 0 0 auto;
            min-height: 90px;
            padding: 0.65rem 1rem 0.7rem;
            margin-bottom: 0.5rem;
            border-radius: 1.25rem;
            background: linear-gradient(135deg, rgba(152,162,215,0.82) 0%, rgba(70,80,128,0.88) 100%);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.38);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.42),
              0 8px 24px rgba(45,51,56,0.14),
              0 3px 10px rgba(70,80,128,0.18);
            display: flex;
            flex-direction: column;
            justify-content: center;
          }

          #todaySidebarDayNumber {
            font-size: 1.75rem;
            font-weight: 700;
            line-height: 1;
            color: #ffffff;
          }

          #todaySidebarDateLabel {
            font-size: 0.7rem;
            font-weight: 600;
            color: rgba(255,255,255,0.90);
            margin-top: 0.2rem;
            line-height: 1.2;
          }

          #todaySidebarTime {
            font-size: 1.05rem;
            font-weight: 700;
            font-family: ui-monospace, 'SF Mono', 'Cascadia Code', monospace;
            color: #ffffff;
            letter-spacing: 0.06em;
            margin-top: 0.35rem;
            font-variant-numeric: tabular-nums;
          }

          #todaySidebarEventsPanel {
            flex: 0 0 auto;
            width: 100%;
            height: auto;
            min-height: 2.75rem;
            display: flex;
            flex-direction: column;
            margin-top: 0.35rem;
            border-radius: 1rem;
            background: rgba(255,255,255,0.50);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(152,162,215,0.38);
            border-bottom: 2px solid rgba(70,80,128,0.52);
            box-shadow:
              inset 0 1px 0 rgba(255,255,255,0.65),
              0 8px 24px rgba(45,51,56,0.12),
              0 3px 10px rgba(70,80,128,0.10);
            overflow: visible;
            padding: 0.5rem 0.55rem 0.85rem;
          }

          #todaySidebarEvents {
            padding: 0;
          }

          #todaySidebarEvents .event-card-green,
          #todaySidebarEvents .event-card-peach {
            font-size: 0.75rem;
            padding: 6px 8px;
            margin-bottom: 6px;
            line-height: 1.35;
          }

          #todaySidebarEvents .event-card-green:last-child,
          #todaySidebarEvents .event-card-peach:last-child {
            margin-bottom: 0;
          }

          #todaySidebarEmpty {
            color: #5a6065;
            font-size: 0.875rem;
            padding: 0.5rem 0;
          }
          
          /* Mobile-optimized event cards */
          @media (max-width: 767px) {
            .calendar-day {
              min-height: 80px;
            }

            #calendarGrid .event-card-green, #calendarGrid .event-card-peach {
              font-size: 0.7rem;
              padding: 3px 4px;
              margin-bottom: 3px;
              line-height: 1.3;
            }

            /* Mobile agenda view styles */
            .mobile-day-header {
              position: sticky;
              top: 52px;
              z-index: 5;
              padding: 10px 12px 8px;
              font-size: 0.85rem;
              font-weight: 600;
              color: #5a6065;
              background: rgba(248,249,252,0.90);
              backdrop-filter: blur(8px);
              -webkit-backdrop-filter: blur(8px);
              border-bottom: 1px solid rgba(173,179,184,0.18);
              border-radius: 8px 8px 0 0;
            }
            .mobile-day-header.today {
              color: #465080;
              background: rgba(152,162,215,0.12);
              border-left: 3px solid #98A2D7;
            }
          .mobile-event-card {
            padding: 12px 16px;
            border-radius: 10px;
            margin-bottom: 8px;
            font-size: 0.875rem;
            line-height: 1.45;
            cursor: pointer;
            transition: transform 0.12s ease, box-shadow 0.12s ease;
          }
          .mobile-event-card.event-card-green,
          .mobile-event-card.event-card-peach {
            border: 1px solid rgba(255,255,255,0.10) !important;
            border-left-width: 4px !important;
            box-shadow: 0 10px 22px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.08) !important;
            backdrop-filter: blur(18px) saturate(135%) !important;
            -webkit-backdrop-filter: blur(18px) saturate(135%) !important;
            transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease, filter 0.18s ease !important;
          }
          .mobile-event-card.event-card-green {
            border-left-color: var(--ncpa-amber) !important;
          }
          .mobile-event-card.event-card-peach {
            border-left-color: var(--ncpa-terracotta) !important;
          }
          .mobile-event-card:hover,
          .mobile-event-card:focus {
            transform: translateY(-1px);
            box-shadow: 0 14px 28px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.06) inset !important;
            outline: none;
          }
          .mobile-event-program {
            color: var(--ncpa-text-bright) !important;
          }
          .mobile-event-venue,
          .mobile-event-crew {
            color: var(--ncpa-text-secondary) !important;
          }
          .mobile-event-foh {
            color: var(--ncpa-amber-light) !important;
          }
          .mobile-event-stage {
            color: var(--ncpa-text-secondary) !important;
          }
          .mobile-event-card:active {
            transform: scale(0.985);
          }
            .mobile-no-shows {
              text-align: center;
              padding: 14px 12px;
              color: #9ca3af;
              font-size: 0.8rem;
              font-style: italic;
            }

            /* Larger touch targets for buttons only, not event cards */
            button:not(.nav-tab):not(.nav-action) {
              min-height: 44px;
            }

            .nav-tab,
            .nav-action {
              min-height: unset !important;
            }

            /* Hide Dashboard tab on mobile */
            #dashboardTab {
              display: none !important;
            }

            /* More readable event text on mobile */
            .event-card-green p, .event-card-peach p {
              line-height: 1.3;
              margin-bottom: 0.15rem;
            }

            /* Better icon spacing on mobile */
            .event-card-green i, .event-card-peach i {
              width: 12px;
              text-align: center;
            }
          }
          
          .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
            background-color: rgba(45,51,56,0.38);
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
          }

          .modal.active {
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .modal-content {
            background: rgba(248, 249, 252, 0.88);
            backdrop-filter: blur(24px);
            -webkit-backdrop-filter: blur(24px);
            padding: 30px;
            border-radius: 20px;
            max-width: 700px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: inset 1px 1px 0 rgba(255,255,255,0.60), 0 24px 64px rgba(45,51,56,0.08);
            outline: 1px solid rgba(173,179,184,0.18);
          }

          .event-detail-modal {
            display: flex;
            flex-direction: column;
            width: 520px;
            height: 520px;
            max-width: min(520px, 92vw);
            max-height: min(520px, 92vh);
            padding: 0;
            overflow: hidden;
            border-radius: 28px;
            background: rgba(248, 249, 252, 0.92);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            box-shadow: inset 1px 1px 0 rgba(255,255,255,0.55), 0 8px 32px rgba(45,51,56,0.06), 0 0 0 1px rgba(152, 162, 215, 0.18);
            outline: 1px solid rgba(152, 162, 215, 0.22);
          }

          .event-detail-header {
            flex-shrink: 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px 10px;
            border-bottom: 1px solid rgba(173,179,184,0.16);
          }

          .event-detail-header h2 {
            font-size: 1.25rem;
            font-weight: 700;
            color: #2d3338;
            margin: 0;
          }

          .event-detail-close {
            flex-shrink: 0;
            width: 2rem;
            height: 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 9999px;
            border: 1px solid rgba(173,179,184,0.25);
            background: rgba(255,255,255,0.55);
            color: #5a6065;
            font-size: 1.25rem;
            line-height: 1;
            cursor: pointer;
          }

          .event-detail-close:hover {
            color: #2d3338;
            background: rgba(255,255,255,0.85);
          }

          .event-detail-body {
            flex: 1;
            min-height: 0;
            overflow: hidden;
            padding: 12px 20px 8px;
          }

          .event-detail-stack {
            display: flex;
            flex-direction: column;
            gap: 10px;
            height: 100%;
          }

          .event-detail-hero {
            flex-shrink: 0;
          }

          .event-detail-program .event-detail-value {
            font-size: 1rem;
            line-height: 1.3;
          }

          .event-detail-field {
            margin-bottom: 6px;
          }

          .event-detail-field:last-child {
            margin-bottom: 0;
          }

          .event-detail-label {
            display: block;
            font-size: 0.62rem;
            font-weight: 700;
            letter-spacing: 0.07em;
            text-transform: uppercase;
            color: #7280a8;
            margin-bottom: 2px;
          }

          .event-detail-value {
            font-size: 0.84rem;
            font-weight: 600;
            color: #2d3338;
            line-height: 1.35;
            margin: 0;
          }

          .event-detail-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px 14px;
            flex-shrink: 0;
          }

          .event-detail-sound {
            grid-column: 1 / -1;
            padding: 12px 14px;
            border-radius: 0.9rem;
            background: rgba(152,162,215,0.08);
            border-left: 3px solid #98A2D7;
          }

          .event-detail-col {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-width: 0;
          }

          .event-detail-clamp {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            word-break: break-word;
          }

          .event-detail-sound-value {
            display: block;
            max-height: 260px;
            overflow-y: auto;
            padding-right: 6px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            word-break: break-word;
          }

          .event-detail-crew {
            flex-shrink: 0;
            padding: 8px 10px;
            border-radius: 0.75rem;
            background: rgba(152,162,215,0.10);
            border-left: 3px solid #98A2D7;
          }

          .event-detail-crew .event-detail-value {
            font-size: 0.8rem;
          }

          .event-detail-notes {
            flex-shrink: 0;
          }

          .event-detail-created {
            flex-shrink: 0;
            font-size: 0.68rem;
            color: #8b9196;
            margin-top: auto;
            padding-top: 4px;
          }

          .event-detail-rider {
            margin-top: 2px;
          }

          .event-detail-rider a {
            font-size: 0.72rem;
            color: #465080;
            font-weight: 600;
          }

          .event-detail-footer {
            flex-shrink: 0;
            display: flex;
            justify-content: flex-end;
            align-items: center;
            gap: 0.5rem;
            padding: 10px 20px 16px;
            border-top: 1px solid rgba(173,179,184,0.16);
          }

          .event-detail-footer .event-detail-login {
            width: 100%;
            text-align: center;
            font-size: 0.8rem;
            color: #5a6065;
            margin: 0;
          }

          .event-detail-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            padding: 0;
            border-radius: 999px;
            font-size: 0.8rem;
            font-weight: 600;
            border: 0;
            cursor: pointer;
            transition: background 0.15s ease;
            background: transparent !important;
            box-shadow: none !important;
            line-height: 0;
            user-select: none;
          }

          .event-detail-btn .modal-img {
            height: 44px;
            width: auto;
            display: block;
          }

          /* Modal action buttons (Edit modal + delete confirm) */
          .modal-img-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 auto;
            width: auto;
            min-width: auto;
            background: transparent !important;
            border: 0 !important;
            padding: 0 !important;
            line-height: 0;
            box-shadow: none !important;
            cursor: pointer;
            user-select: none;
            overflow: visible;
          }

          .modal-img-btn:hover {
            filter: brightness(1.03);
          }

          .modal-img {
            height: 44px;
            width: auto;
            max-width: none;
            flex-shrink: 0;
            object-fit: contain;
            display: block;
          }

          /* Desktop: scroll calendar grid only; keep Today sidebar fixed */
          @media (min-width: 768px) {
            #calendarView {
              overflow: visible;
              display: flex;
              flex-direction: column;
              max-height: none !important;
            }
          }

          table th {
            position: sticky;
            top: 0;
            background: linear-gradient(135deg, #98A2D7 0%, #465080 100%);
            color: white;
            z-index: 10;
          }

          .editable-cell {
            cursor: text;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }

          .editable-cell:hover {
            background-color: #ebeef3;
          }

          /* Make table cells wrap text instead of expanding */
          table.table-fixed td {
            word-wrap: break-word;
            overflow-wrap: break-word;
            white-space: normal;
          }

          .editable-cell input,
          .editable-cell textarea {
            width: 100%;
            border: 1px solid rgba(173,179,184,0.25);
            padding: 4px 8px;
            border-radius: 0.75rem;
            font-size: 14px;
            background: rgba(255,255,255,0.7);
          }

          .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(152, 162, 215, 0.3);
            border-radius: 50%;
            border-top-color: #98A2D7;
            animation: spin 1s ease-in-out infinite;
          }
          
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          
          /* Mobile Responsiveness */
          @media (max-width: 767px) {
            .container {
              padding: 0.75rem !important;
            }

            header .container > .flex,
            header .flex-1 {
              min-width: 0;
            }

            #userMenu button {
              max-width: 44px;
              padding-left: 0.65rem !important;
              padding-right: 0.65rem !important;
              overflow: hidden;
            }

            #userEmailDisplay,
            #adminBadge {
              display: none !important;
            }

            .flex.space-x-3, .flex.space-x-6 {
              flex-wrap: wrap;
              gap: 0.5rem;
            }

            #searchInput {
              width: 100% !important;
              max-width: 200px;
            }

            table {
              font-size: 0.75rem !important;
            }

            .modal-content {
              width: 95% !important;
              margin: 1rem;
              max-height: 90vh !important;
            }

            .event-detail-modal {
              width: 95% !important;
              height: auto !important;
              min-height: 420px;
              max-width: none !important;
              max-height: 90vh !important;
              border-radius: 24px !important;
            }

            .event-detail-header {
              padding: 24px 20px 6px !important;
            }

            .event-detail-header h2 {
              font-size: 24px !important;
              margin-top: 36px !important;
            }

            .event-detail-status {
              left: 20px !important;
              top: 24px !important;
            }

            .event-detail-body {
              overflow-y: auto;
              padding: 0 20px 22px !important;
            }

            .event-detail-grid {
              grid-template-columns: 1fr !important;
              gap: 14px 0 !important;
            }

            .event-detail-footer {
              padding: 18px 20px 22px !important;
            }

            .event-detail-program .event-detail-value {
              font-size: 20px !important;
            }

            .hidden-mobile {
              display: none !important;
            }
          }

          /* ── Crew Availability Pill Styles ── */
          .avail-loading{display:flex;align-items:center;gap:10px;padding:8px 0;color:#7280a8;font-size:14px}
          @keyframes avail-spin{to{transform:rotate(360deg)}}
          .avail-spinner{width:18px;height:18px;border:2px solid rgba(107,119,192,.2);border-top-color:#6B77C0;border-radius:50%;animation:avail-spin .65s linear infinite;flex-shrink:0}
          .avail-cbox{background:rgba(192,100,60,.07);border:1px solid rgba(192,100,60,.20);border-radius:8px;padding:10px 13px;margin-bottom:12px;font-size:12.5px;color:#8b3b1a;line-height:1.5}
          .avail-cbox strong{font-weight:700;display:block;margin-bottom:4px}
          .avail-citem{padding-left:12px;margin-top:3px}
          .avail-role-hdr{display:flex;align-items:center;gap:8px;margin-bottom:8px;margin-top:4px}
          .avail-role-label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#3D4675}
          .avail-role-badge{font-size:10.5px;padding:2px 8px;border-radius:20px;font-weight:600}
          .avail-badge-foh{background:rgba(107,119,192,.13);color:#3D4675}
          .avail-badge-stage{background:rgba(168,195,160,.25);color:#6E9966}
          .avail-role-hint{font-size:11.5px;color:#7280a8;margin-bottom:9px}
          .avail-pill-grid{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:4px}
          .avail-cpill{position:relative}
          .avail-cpill input{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
          .avail-cpill label{display:inline-flex;align-items:center;padding:7px 13px;border-radius:24px;border:1.5px solid rgba(107,119,192,.18);background:rgba(255,255,255,.75);cursor:pointer;font-size:13px;font-weight:500;color:#1e2545;transition:all .14s;user-select:none;line-height:1}
          .avail-foh-pill input:checked+label{background:#6B77C0;border-color:#3D4675;color:#fff;box-shadow:0 3px 10px rgba(107,119,192,.35)}
          .avail-stage-pill input:checked+label{background:#A8C3A0;border-color:#6E9966;color:#253a1f;box-shadow:0 3px 10px rgba(110,153,102,.30)}
          .avail-none-pill label{color:#7280a8;font-style:italic}
          .avail-none-pill input:checked+label{background:rgba(160,160,170,.12);border-color:rgba(160,160,170,.35);color:#7280a8;box-shadow:none}
          .avail-divider{height:1px;background:rgba(107,119,192,.18);margin:14px 0}
          .avail-excl-hdr{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7280a8;margin-bottom:8px}
          .avail-excl-grid{display:flex;flex-wrap:wrap;gap:6px}
          .avail-etag{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500}
          .avail-etag-a{background:rgba(192,80,60,.08);color:#8b3020;border:1px solid rgba(192,80,60,.15)}
          .avail-etag-b{background:rgba(140,140,155,.10);color:#777;border:1px solid rgba(140,140,155,.20)}
          .avail-no-crew{text-align:center;padding:20px 0 8px;color:#7280a8;font-size:14px}

          /* ── Landscape phone: collapse all chrome, maximise calendar rows ── */
          @media (orientation: landscape) and (max-height: 500px) {
            /* Thin the sticky app header to ~28px */
            header .container {
              padding-top: 0.2rem !important;
              padding-bottom: 0.2rem !important;
            }
            header h1 { font-size: 0.8rem !important; }

            /* Hide the mobile action bar — saves ~36px */
            #mobileActionBar { display: none !important; }

            /* Squeeze the outer content container vertical padding */
            #mainContent {
              padding-top: 0.15rem !important;
              padding-bottom: 0.15rem !important;
            }

            /* Compact calendar sticky section (month nav + day names) */
            #calendarView .sticky {
              padding: 0.2rem 0.5rem 0 !important;
            }
            #calendarView .sticky .flex.justify-between {
              margin-bottom: 0.2rem !important;
            }
            #currentMonthYear { font-size: 0.85rem !important; }
            #monthEventCount { display: none !important; }
            #calendarView .sticky .grid > div {
              padding-top: 0.1rem !important;
              padding-bottom: 0.1rem !important;
              font-size: 0.6rem !important;
            }

            /* Compact scrollable grid area */
            #calendarView > div:last-child { padding: 0.2rem !important; }

            /* Shorter calendar cells */
            .calendar-day { min-height: 55px !important; }

            /* Tighter event cards */
            .event-card-green, .event-card-peach {
              padding: 2px 3px !important;
              margin-bottom: 2px !important;
              font-size: 0.6rem !important;
              line-height: 1.15 !important;
            }
          }

          /* ── Mobile Week Agenda View ── */
          .mobile-day-header {
            position: sticky;
            top: 48px;
            z-index: 5;
            padding: 10px 4px 6px;
            margin-bottom: 8px;
            border-bottom: 1px solid rgba(173,179,184,0.18);
            background: rgba(248,249,252,0.90);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            font-size: 0.85rem;
            font-weight: 700;
            color: #5a6065;
            letter-spacing: 0.02em;
          }
          .mobile-day-header.today {
            color: #465080;
          }
          .mobile-day-header.today::before {
            content: '';
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #98A2D7;
            margin-right: 6px;
            vertical-align: middle;
          }
          .mobile-event-card {
            padding: 12px 14px;
            border-radius: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: transform 0.12s ease, box-shadow 0.12s ease;
          }
          .mobile-event-card:active {
            transform: scale(0.985);
          }
          .mobile-event-card .program {
            font-size: 0.95rem;
            font-weight: 600;
            color: #1f2937;
            line-height: 1.35;
            margin-bottom: 4px;
          }
          .mobile-event-card .meta {
            font-size: 0.8rem;
            color: #6b7280;
            line-height: 1.4;
          }
          .mobile-event-card .meta i {
            width: 14px;
            text-align: center;
            margin-right: 4px;
          }
          .mobile-event-card .crew-foh {
            color: #1d4ed8;
          }
          .mobile-event-card .crew-stage {
            color: #15803d;
          }
          .mobile-no-shows {
            text-align: center;
            padding: 14px 0;
            color: #9ca3af;
            font-size: 0.85rem;
          }
          .mobile-no-shows i {
            display: block;
            margin-bottom: 4px;
            font-size: 1.1rem;
          }

          :root {
            --ncpa-bg: #1C1917;
            --ncpa-bg-2: #221E1B;
            --ncpa-bg-3: #2A211C;
            --ncpa-panel: rgba(41, 37, 36, 0.22);
            --ncpa-panel-soft: rgba(41, 37, 36, 0.14);
            --ncpa-panel-deep: rgba(28, 25, 23, 0.18);
            --ncpa-panel-modal: rgba(60, 52, 46, 0.28);
            --ncpa-chip: rgba(255, 255, 255, 0.08);
            --ncpa-border: rgba(255, 255, 255, 0.10);
            --ncpa-border-strong: rgba(255, 255, 255, 0.15);
            --ncpa-amber: #E0A458;
            --ncpa-amber-light: #F0B978;
            --ncpa-terracotta: #C75B39;
            --ncpa-terracotta-light: #E8825F;
            --ncpa-green: #5C9D6F;
            --ncpa-green-light: #7DC491;
            --ncpa-text: #F5F1EA;
            --ncpa-text-bright: #F8F4EE;
            --ncpa-text-secondary: #C9C0B4;
            --ncpa-text-muted: #A8A29E;
            --ncpa-text-dim: #9C948A;
            --ncpa-text-dark: #1C1917;
          }

          body {
            background:
              radial-gradient(900px 600px at 12% -5%, rgba(224,164,88,0.22), transparent 60%),
              radial-gradient(900px 700px at 95% 10%, rgba(199,91,57,0.28), transparent 55%),
              radial-gradient(800px 800px at 70% 110%, rgba(224,164,88,0.14), transparent 60%),
              linear-gradient(135deg, var(--ncpa-bg) 0%, var(--ncpa-bg-2) 45%, var(--ncpa-bg-3) 100%) !important;
            color: var(--ncpa-text);
            font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
            position: relative;
            overflow-x: hidden;
          }

          body > .min-h-screen {
            position: relative;
            z-index: 1;
          }

          html::before,
          body::before,
          body::after {
            content: "";
            position: fixed;
            z-index: 0;
            pointer-events: none;
            filter: blur(1px);
            transform: translate3d(0,0,0) scale(1);
            mix-blend-mode: screen;
          }

          body::before {
            width: min(58vw, 760px);
            height: min(52vw, 620px);
            left: -8vw;
            top: -7vh;
            background: radial-gradient(circle at 45% 45%, rgba(224,164,88,0.34), rgba(224,164,88,0.14) 38%, transparent 70%);
            opacity: 0.72;
            animation: ncpaAmberDrift 18s ease-in-out infinite;
          }

          body::after {
            width: min(62vw, 880px);
            height: min(54vw, 660px);
            right: -10vw;
            top: -5vh;
            background: radial-gradient(circle at 52% 46%, rgba(199,91,57,0.30), rgba(199,91,57,0.12) 40%, transparent 72%);
            opacity: 0.66;
            animation: ncpaTerracottaDrift 18s ease-in-out infinite;
            animation-delay: -5.5s;
          }

          html::before {
            width: min(64vw, 840px);
            height: min(48vw, 620px);
            left: 30vw;
            bottom: -16vh;
            background: radial-gradient(circle at 50% 52%, rgba(240,185,120,0.24), rgba(150,80,48,0.13) 42%, transparent 72%);
            opacity: 0.62;
            animation: ncpaRustDrift 18s ease-in-out infinite;
            animation-delay: -9s;
          }

          @keyframes ncpaAmberDrift {
            0%, 100% {
              transform: translate3d(0, 0, 0) scale(1);
              opacity: 0.6;
            }
            50% {
              transform: translate3d(60px, 80px, 0) scale(1.06);
              opacity: 1;
            }
          }

          @keyframes ncpaTerracottaDrift {
            0%, 100% {
              transform: translate3d(0, 0, 0) scale(1.02);
              opacity: 0.6;
            }
            50% {
              transform: translate3d(-58px, 74px, 0) scale(1.08);
              opacity: 1;
            }
          }

          @keyframes ncpaRustDrift {
            0%, 100% {
              transform: translate3d(0, 0, 0) scale(1);
              opacity: 0.6;
            }
            50% {
              transform: translate3d(-64px, -82px, 0) scale(1.07);
              opacity: 1;
            }
          }

          .glass-header,
          #todaySidebar,
          #calendarView {
            position: relative;
            overflow: hidden;
            isolation: isolate;
          }

          #calendarView {
            overflow-x: hidden !important;
            overflow-y: auto !important;
          }

          .glass-header > *,
          #todaySidebar > *,
          #calendarView > * {
            position: relative;
            z-index: 1;
          }

          .glass-header {
            background: rgba(41, 37, 36, 0.22) !important;
            backdrop-filter: blur(32px) saturate(150%) !important;
            -webkit-backdrop-filter: blur(32px) saturate(150%) !important;
            border-bottom: 1px solid var(--ncpa-border) !important;
            box-shadow: 0 18px 55px rgba(0,0,0,0.20) !important;
          }

          .glass-header h1 {
            color: var(--ncpa-amber) !important;
            letter-spacing: -0.025em !important;
          }

          .glass-header p,
          #userEmailDisplay {
            color: var(--ncpa-text-secondary) !important;
          }

          #mainContent {
            position: relative;
          }

          header .container,
          #mainContent.container {
            max-width: none !important;
            width: 100% !important;
            padding-left: 24px !important;
            padding-right: 24px !important;
          }

          .glass-card,
          #calendarView,
          #tableView,
          #crewView {
            background: rgba(41, 37, 36, 0.22) !important;
            backdrop-filter: blur(32px) saturate(150%) !important;
            -webkit-backdrop-filter: blur(32px) saturate(150%) !important;
            border: 1px solid var(--ncpa-border) !important;
            outline: none !important;
            box-shadow: 0 22px 70px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.12) !important;
          }

          .btn-primary {
            background: var(--ncpa-amber) !important;
            color: var(--ncpa-text-dark) !important;
            border: 1px solid rgba(255,255,255,0.14) !important;
            box-shadow: 0 10px 25px rgba(224,164,88,0.20) !important;
            transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
          }

          .btn-primary:hover {
            background: #E8B269 !important;
            transform: translateY(-1px);
            box-shadow: 0 14px 30px rgba(224,164,88,0.25) !important;
          }

          .btn-glass {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-secondary) !important;
            border: 1px solid var(--ncpa-border-strong) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 20px rgba(0,0,0,0.12) !important;
            transition: transform 0.2s ease, color 0.2s ease, background 0.2s ease, border-color 0.2s ease !important;
          }

          .btn-glass:hover {
            background: rgba(255,255,255,0.12) !important;
            color: var(--ncpa-text-bright) !important;
            transform: translateY(-1px);
          }

          .nav-tabs-group {
            display: flex;
            align-items: center;
            gap: 10px;
            background: transparent !important;
            padding: 0;
          }

          .nav-tab,
          .nav-action {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            outline: none !important;
            padding: 0;
            margin: 0;
            cursor: pointer;
            line-height: 0;
            min-height: unset !important;
            transition: transform 0.18s ease;
          }

          .nav-tab:hover,
          .nav-action:hover {
            transform: translateY(-1px);
            background: transparent !important;
          }

          .nav-tab-img {
            height: 40px;
            width: auto;
            display: block;
            transition: filter 0.22s ease, opacity 0.22s ease, transform 0.18s ease;
          }

          .nav-tab.tab-active .nav-tab-img {
            filter: none;
            opacity: 1;
            transform: scale(1);
          }

          .nav-tab:not(.tab-active) .nav-tab-img {
            filter: grayscale(1) brightness(0.78);
            opacity: 0.5;
            transform: scale(0.97);
          }

          .nav-tab:not(.tab-active):hover .nav-tab-img {
            filter: grayscale(0.55) brightness(0.88);
            opacity: 0.72;
          }

          .nav-action-img {
            height: 40px;
            width: auto;
            display: block;
          }

          .nav-action-img--sm {
            height: 34px;
          }

          .nav-tab.tab-active {
            background: transparent !important;
            box-shadow: none !important;
            outline: none !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
          }

          /* Special: nav-action stays neutral (not active), but the
             primary action (Add Show) is highlighted with amber */
          .nav-action[aria-label="Add Show"] {
            color: var(--ncpa-text-dark);
            background: linear-gradient(135deg, #f0b978 0%, var(--ncpa-amber) 50%, #c98a3f 100%);
            box-shadow:
              0 6px 14px rgba(224,164,88,0.30),
              inset 0 1px 0 rgba(255,255,255,0.40);
            padding: 9px 18px;
            font-weight: 700;
          }
          .nav-action[aria-label="Add Show"]:hover {
            filter: brightness(1.05);
            color: var(--ncpa-text-dark);
            background: linear-gradient(135deg, #f0b978 0%, var(--ncpa-amber) 50%, #c98a3f 100%);
          }

          #desktopCalendarLayout {
            gap: 0;
            border-radius: 24px;
            overflow: hidden;
          }

          #todaySidebar {
            width: 280px;
            min-width: 260px;
            max-width: 32%;
            padding: 16px 14px;
            background: rgba(28,25,23,0.14) !important;
            backdrop-filter: blur(26px) saturate(140%) !important;
            -webkit-backdrop-filter: blur(26px) saturate(140%) !important;
            border-right: 1px solid var(--ncpa-border) !important;
            outline: none !important;
          }

          #todaySidebarClock {
            min-height: 132px;
            padding: 18px 18px 16px;
            margin-bottom: 12px;
            border-radius: 22px;
            background: linear-gradient(135deg, rgba(224,164,88,0.22), rgba(41,37,36,0.34)) !important;
            border: 1px solid rgba(224,164,88,0.34) !important;
            box-shadow: 0 16px 36px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.14) !important;
          }

          #todaySidebarClock::before {
            content: "TODAY";
            color: var(--ncpa-amber);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.1em;
            margin-bottom: 6px;
          }

          #todaySidebarDayNumber {
            font-size: 52px;
            color: var(--ncpa-text-bright);
            letter-spacing: -0.05em;
          }

          #todaySidebarDateLabel {
            color: var(--ncpa-text-secondary);
            font-size: 13px;
          }

          #todaySidebarTime {
            color: var(--ncpa-text-bright);
            font-size: 22px;
            letter-spacing: 0.08em;
          }

          #todaySidebarEventsPanel {
            padding: 12px;
            border-radius: 20px;
            background: rgba(41,37,36,0.18) !important;
            border: 1px solid var(--ncpa-border) !important;
            border-bottom: 1px solid var(--ncpa-border-strong) !important;
            box-shadow: 0 14px 34px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.08) !important;
          }

          #todaySidebarEventsPanel::before {
            content: "Today's Agenda";
            display: block;
            color: var(--ncpa-text);
            font-size: 14px;
            font-weight: 700;
            margin: 0 2px 10px;
          }

          #todaySidebarEmpty {
            color: var(--ncpa-text-muted);
          }

          #desktopCalendarMain {
            background: rgba(41,37,36,0.10);
          }

          #desktopCalendarChrome {
            background: rgba(41,37,36,0.24) !important;
            backdrop-filter: blur(26px) saturate(140%) !important;
            -webkit-backdrop-filter: blur(26px) saturate(140%) !important;
            border-bottom: 1px solid var(--ncpa-border);
          }

          #currentMonthYear {
            color: var(--ncpa-amber) !important;
            letter-spacing: -0.025em !important;
          }

          #monthEventCount {
            color: var(--ncpa-text-secondary) !important;
          }

          #desktopCalendarChrome button {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-secondary) !important;
            border: 1px solid var(--ncpa-border) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
            transition: transform 0.2s ease, background 0.2s ease, color 0.2s ease;
          }

          #desktopCalendarChrome button:hover {
            background: rgba(255,255,255,0.12) !important;
            color: var(--ncpa-text-bright) !important;
            transform: translateY(-1px);
          }

          #desktopCalendarChrome .grid > div {
            background: transparent !important;
            color: var(--ncpa-text-muted) !important;
            font-size: 11px !important;
            letter-spacing: 0.08em;
          }

          #desktopCalendarChrome .grid > div:nth-child(6) {
            color: var(--ncpa-amber) !important;
          }

          #desktopCalendarGridWrap {
            background: transparent;
          }

          .calendar-day {
            min-height: 132px;
            padding: 8px;
            border-radius: 16px;
            overflow: hidden;
            outline: none !important;
            border: 1px solid var(--ncpa-border);
            background: rgba(28,25,23,0.18);
            backdrop-filter: blur(22px) saturate(140%);
            -webkit-backdrop-filter: blur(22px) saturate(140%);
            transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
          }

          .calendar-day-active:hover {
            transform: translateY(-2px);
            border-color: rgba(255,255,255,0.20);
            background: rgba(41,37,36,0.26);
            box-shadow: 0 12px 26px rgba(0,0,0,0.14);
          }

          .calendar-day-empty {
            background: rgba(255,255,255,0.02);
            border-color: rgba(255,255,255,0.05);
          }

          .calendar-day-today {
            border-color: rgba(224,164,88,0.60);
            background: linear-gradient(135deg, rgba(224,164,88,0.22), rgba(41,37,36,0.30));
            box-shadow: 0 8px 16px rgba(224,164,88,0.10);
          }

          .calendar-day-number {
            color: var(--ncpa-text-secondary);
            font-size: 12px;
            line-height: 24px;
            font-weight: 700;
            margin-bottom: 5px;
          }

          .calendar-day-number-today {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            border-radius: 999px;
            background: var(--ncpa-amber);
            color: var(--ncpa-text-dark);
            line-height: 1;
          }

          .event-card {
            position: relative;
            padding: 7px 8px;
            margin-bottom: 5px;
            border-radius: 10px;
            border: 1px solid var(--ncpa-border);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            box-shadow: 0 8px 16px rgba(0,0,0,0.10);
            color: var(--ncpa-text);
            font-size: 10px;
            line-height: 1.35;
            transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, filter 0.2s ease;
          }

          .event-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 12px 24px rgba(0,0,0,0.18);
            border-color: rgba(255,255,255,0.16);
            filter: brightness(1.08);
          }

          .event-card-green {
            background: linear-gradient(120deg, rgba(224,164,88,0.16), rgba(41,37,36,0.30)) !important;
            border-left: 4px solid var(--ncpa-amber) !important;
          }

          .event-card-peach {
            background: linear-gradient(120deg, rgba(199,91,57,0.18), rgba(41,37,36,0.30)) !important;
            border-left: 4px solid var(--ncpa-terracotta) !important;
          }

          .event-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
          }

          .event-card-time {
            color: var(--ncpa-amber);
            font-size: 12px;
            font-weight: 700;
          }

          .event-card-peach .event-card-time {
            color: var(--ncpa-terracotta-light);
          }

          .event-card-status {
            flex-shrink: 0;
            padding: 2px 8px;
            border-radius: 999px;
            border: 1px solid rgba(224,164,88,0.20);
            background: rgba(224,164,88,0.16);
            color: var(--ncpa-amber-light);
            font-size: 10px;
            font-weight: 700;
          }

          .event-card-peach .event-card-status {
            border-color: rgba(199,91,57,0.24);
            background: rgba(199,91,57,0.20);
            color: var(--ncpa-terracotta-light);
          }

          .event-card-title {
            color: var(--ncpa-text-bright);
            font-weight: 800;
          }

          .event-card-meta {
            color: var(--ncpa-text-secondary);
            margin-top: 3px;
          }

          .event-card-meta i {
            color: var(--ncpa-text-muted);
            width: 12px;
            text-align: center;
          }

          .event-card-foh,
          .event-card-stage {
            color: var(--ncpa-text-secondary) !important;
          }

          #todaySidebarEvents .event-card {
            padding: 12px 12px;
            margin-bottom: 10px;
            border-radius: 14px;
            font-size: 12px;
          }

          #todaySidebarEvents .event-card-title {
            font-size: 14px;
            line-height: 1.3;
          }

          #todaySidebarEvents .event-card-meta {
            font-size: 12px;
          }

          .modal {
            background: rgba(28,25,23,0.68) !important;
            backdrop-filter: blur(10px) saturate(120%) !important;
            -webkit-backdrop-filter: blur(10px) saturate(120%) !important;
            opacity: 0;
            transition: opacity 0.28s ease;
          }

          .modal.active {
            opacity: 1;
          }

          .modal-content {
            background: var(--ncpa-panel-modal) !important;
            color: var(--ncpa-text);
            border: 1px solid var(--ncpa-border) !important;
            outline: none !important;
            box-shadow: 0 30px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.10) !important;
            backdrop-filter: blur(48px) saturate(150%) !important;
            -webkit-backdrop-filter: blur(48px) saturate(150%) !important;
            transform: scale(0.96) translateY(18px);
            transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
          }

          .modal.active .modal-content {
            transform: scale(1) translateY(0);
          }

          #eventModal .event-detail-modal {
            transform: perspective(1000px) rotateX(10deg) translate3d(0, 36px, 0) scale(0.95);
            opacity: 0;
            transform-origin: 50% 100%;
            transition: none !important;
            backface-visibility: hidden;
            -webkit-backface-visibility: hidden;
          }

          #eventModal.active .event-detail-modal {
            animation: ncpaEventDetailRollUp 0.4s cubic-bezier(0.25, 0.9, 0.35, 1) both;
          }

          @keyframes ncpaEventDetailRollUp {
            0% {
              opacity: 0;
              transform: perspective(1000px) rotateX(10deg) translate3d(0, 36px, 0) scale(0.95);
            }
            100% {
              opacity: 1;
              transform: perspective(1000px) rotateX(0deg) translate3d(0, 0, 0) scale(1);
            }
          }

          @keyframes ncpaEventDetailReveal {
            from {
              opacity: 0;
              transform: translate3d(0, 8px, 0);
            }
            to {
              opacity: 1;
              transform: translate3d(0, 0, 0);
            }
          }

          /* ════════════════════════════════════════════════════════════════
             EVENT DETAILS MODAL — Claymorphism panel
             PNG button styling (.event-detail-btn / .modal-img-btn) is
             preserved from origin/main — we only restyle panel/tray/blocks.
             ════════════════════════════════════════════════════════════════ */
          .event-detail-modal {
            position: relative;
            display: flex;
            flex-direction: column;
            width: 720px;
            height: auto !important;
            min-height: 0;
            max-width: min(720px, 92vw);
            max-height: min(820px, 92vh);
            padding: 0;
            border-radius: 28px !important;
            background:
              radial-gradient(120% 80% at 0% 0%, rgba(255,225,190,0.06), transparent 55%),
              #3a2a22 !important;
            border: 1px solid #1f1410 !important;
            box-shadow:
              0 40px 90px rgba(0,0,0,0.65),
              0 16px 36px rgba(0,0,0,0.35),
              inset 0 1px 0 rgba(255,225,190,0.10),
              inset 0 -1px 0 rgba(0,0,0,0.40) !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            outline: none !important;
            overflow: hidden;
          }

          .event-detail-header {
            padding: 30px 36px 6px;
            border-bottom: none;
          }

          .event-detail-header h2 {
            color: var(--ncpa-text-bright);
            font-size: 30px;
            line-height: 1.15;
            letter-spacing: -0.01em;
            margin-top: 42px;
            font-weight: 800;
          }

          .event-detail-close {
            width: 36px;
            height: 36px;
            background: #2a1d17 !important;
            color: var(--ncpa-text-secondary);
            border: 1px solid #1a120e !important;
            box-shadow:
              0 4px 10px rgba(0,0,0,0.35),
              inset 0 1px 0 rgba(255,225,190,0.06) !important;
            transition: color .18s, transform .18s;
            font-size: 14px;
          }

          .event-detail-close:hover {
            color: var(--ncpa-text-bright);
            transform: scale(1.05);
          }

          .event-detail-body {
            flex: 1;
            min-height: 0;
            padding: 0 36px 24px;
            overflow-y: auto;
          }

          .event-detail-status {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            position: absolute;
            top: 30px;
            left: 36px;
            margin: 0;
            padding: 7px 14px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: var(--ncpa-green-light);
            background: linear-gradient(135deg, #2d4a32 0%, #1f3324 100%);
            border: 1px solid #1a120e;
            box-shadow:
              0 4px 10px rgba(0,0,0,0.30),
              inset 0 1px 0 rgba(255,225,190,0.08);
          }

          .event-detail-status span {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: var(--ncpa-green-light);
            box-shadow: 0 0 8px var(--ncpa-green-light);
          }

          .event-detail-status.is-attention {
            color: #e8896a;
            background: linear-gradient(135deg, #4a261c 0%, #2e160f 100%);
          }

          .event-detail-status.is-attention span {
            background: #e8896a;
            box-shadow: 0 0 8px #e8896a;
          }

          .event-detail-stack {
            gap: 20px;
            height: auto;
          }

          .event-detail-hero {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .event-detail-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 16px 24px;
          }

          /* Sound Requirements, Call Time → recessed clay tray */
          .event-detail-sound {
            grid-column: 1 / -1;
            padding: 16px 18px;
            border-radius: 18px;
            background:
              linear-gradient(135deg, rgba(0,0,0,0.18), transparent 50%),
              #2a1d17 !important;
            border: 1px solid #160e0a !important;
            box-shadow:
              inset 0 3px 8px rgba(0,0,0,0.50),
              inset 0 -1px 0 rgba(255,225,190,0.04) !important;
          }

          .event-detail-col {
            gap: 22px;
          }

          .event-detail-label {
            color: var(--ncpa-text-muted);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            margin-bottom: 8px;
          }

          .event-detail-value {
            color: var(--ncpa-text-bright);
            font-size: 15px;
            line-height: 1.45;
            font-weight: 500;
          }

          .event-detail-program .event-detail-value {
            font-size: 24px;
            line-height: 1.25;
            font-weight: 700;
            letter-spacing: -0.01em;
          }

          .event-detail-clamp {
            -webkit-line-clamp: 3;
          }

          .event-detail-sound-value {
            display: block;
            max-height: 260px;
            overflow-y: auto;
            padding-right: 6px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            word-break: break-word;
          }

          .event-detail-sound-value::-webkit-scrollbar {
            width: 6px;
          }

          .event-detail-sound-value::-webkit-scrollbar-thumb {
            background: rgba(224,164,88,0.42);
            border-radius: 999px;
          }

          /* Rider chips — clay pill style */
          .event-detail-rider {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
          }

          .event-detail-rider a {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 11px;
            border-radius: 999px;
            background: rgba(224,164,88,0.08);
            border: 1px solid rgba(224,164,88,0.18);
            color: var(--ncpa-amber-light);
            font-size: 12px;
            text-decoration: none;
            transition: background .18s;
          }

          .event-detail-rider a:hover {
            background: rgba(224,164,88,0.16);
          }

          /* Crew block — clay recessed panel with glowing amber left stripe */
          .event-detail-crew {
            position: relative;
            padding: 16px 18px 16px 22px;
            border-radius: 18px;
            background:
              linear-gradient(135deg, rgba(0,0,0,0.15), transparent 50%),
              #2a1d17 !important;
            border: 1px solid #160e0a !important;
            border-left: 0 !important;
            box-shadow:
              inset 0 3px 8px rgba(0,0,0,0.50),
              inset 0 -1px 0 rgba(255,225,190,0.04) !important;
          }

          .event-detail-crew::before {
            content: "";
            position: absolute;
            left: 0; top: 12px; bottom: 12px;
            width: 4px;
            border-radius: 0 4px 4px 0;
            background: linear-gradient(180deg, var(--ncpa-amber-light), var(--ncpa-amber));
            box-shadow: 0 0 8px rgba(224,164,88,0.40);
          }

          .event-detail-crew .event-detail-label,
          .event-detail-crew-role {
            color: var(--ncpa-amber-light);
          }

          .event-detail-crew .event-detail-value {
            display: block;
            font-size: 14px;
            font-weight: 600;
            color: var(--ncpa-text-bright);
            margin: 0;
            line-height: 1.5;
          }

          .event-detail-crew .event-detail-value + .event-detail-value {
            margin-top: 4px;
          }

          .event-detail-crew .event-detail-crew-role {
            color: var(--ncpa-amber-light);
            font-weight: 700;
            font-size: 12px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            margin-right: 8px;
          }

          .event-detail-crew .event-detail-crew-role i {
            color: var(--ncpa-amber);
            font-size: 11px;
            margin-right: 4px;
          }

          /* Notes block — recessed clay tray */
          .event-detail-notes {
            padding: 14px 18px;
            border-radius: 18px;
            background:
              linear-gradient(135deg, rgba(0,0,0,0.15), transparent 50%),
              #2a1d17 !important;
            border: 1px solid #160e0a !important;
            box-shadow:
              inset 0 3px 8px rgba(0,0,0,0.50),
              inset 0 -1px 0 rgba(255,225,190,0.04) !important;
          }

          .event-detail-notes .event-detail-label {
            margin-bottom: 6px;
          }

          .event-detail-created {
            margin-top: 8px;
            padding-top: 14px;
            color: var(--ncpa-text-muted);
            font-size: 12px;
            border-top: 1px solid rgba(255,225,190,0.06);
            flex-shrink: 0;
          }

          .event-detail-footer {
            flex: 0 0 auto;
            display: flex;
            justify-content: flex-end;
            align-items: center;
            padding: 18px 36px 28px;
            border-top: 1px solid rgba(255,225,190,0.06);
            gap: 14px;
            min-height: 80px;
            overflow: visible;
          }

          #eventModal:not(.active) .event-detail-header,
          #eventModal:not(.active) .event-detail-status,
          #eventModal:not(.active) .event-detail-hero,
          #eventModal:not(.active) .event-detail-grid,
          #eventModal:not(.active) .event-detail-crew,
          #eventModal:not(.active) .event-detail-notes,
          #eventModal:not(.active) .event-detail-created,
          #eventModal:not(.active) .event-detail-footer {
            opacity: 0;
          }

          #eventModal.active .event-detail-header {
            animation: ncpaEventDetailReveal 0.34s ease-out 0.1s both;
          }

          #eventModal.active .event-detail-status {
            animation: ncpaEventDetailReveal 0.34s ease-out 0.14s both;
          }

          #eventModal.active .event-detail-hero {
            animation: ncpaEventDetailReveal 0.34s ease-out 0.18s both;
          }

          #eventModal.active .event-detail-grid {
            animation: ncpaEventDetailReveal 0.34s ease-out 0.22s both;
          }

          #eventModal.active .event-detail-crew {
            animation: ncpaEventDetailReveal 0.34s ease-out 0.26s both;
          }

          #eventModal.active .event-detail-notes {
            animation: ncpaEventDetailReveal 0.34s ease-out 0.3s both;
          }

          #eventModal.active .event-detail-created {
            animation: ncpaEventDetailReveal 0.34s ease-out 0.32s both;
          }

          #eventModal.active .event-detail-footer {
            animation: ncpaEventDetailReveal 0.34s ease-out 0.36s both;
          }

          .event-detail-btn {
            flex: 0 0 auto;
            padding: 0 !important;
            border: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            line-height: 0;
            overflow: visible;
            transition: filter 0.2s ease;
          }

          .event-detail-btn:hover {
            filter: brightness(1.03);
          }

          .event-detail-btn .modal-img {
            height: 44px;
            width: auto;
            display: block;
          }

          /* ════════════════════════════════════════════════════════════════
             EDIT EVENT MODAL — Claymorphism panel
             ════════════════════════════════════════════════════════════════ */
          #editEventModal .modal-content {
            width: 880px;
            max-width: min(880px, 94vw);
            max-height: min(900px, 92vh);
            border-radius: 28px !important;
            padding: 36px 40px 0 !important;
            background:
              radial-gradient(120% 80% at 0% 0%, rgba(255,225,190,0.06), transparent 55%),
              #3a2a22 !important;
            border: 1px solid #1f1410 !important;
            box-shadow:
              0 40px 90px rgba(0,0,0,0.65),
              0 16px 36px rgba(0,0,0,0.35),
              inset 0 1px 0 rgba(255,225,190,0.10),
              inset 0 -1px 0 rgba(0,0,0,0.40) !important;
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
            outline: none !important;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            overflow-x: hidden;
          }

          #editEventModal h2 {
            color: var(--ncpa-text-bright) !important;
            font-size: 32px !important;
            line-height: 1.15;
            letter-spacing: -0.01em;
            font-weight: 800 !important;
          }

          #editEventModal.active h2 {
            animation: ncpaEditReveal 0.34s ease-out both;
          }

          #editEventModal.active #editEventForm .space-y-4 > div,
          #editEventModal.active #editEventForm > div:last-child {
            animation: ncpaEditReveal 0.36s ease-out both;
          }

          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(1) { animation-delay: 0.03s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(2) { animation-delay: 0.055s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(3) { animation-delay: 0.08s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(4) { animation-delay: 0.105s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(5) { animation-delay: 0.13s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(6) { animation-delay: 0.155s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(7) { animation-delay: 0.18s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(8) { animation-delay: 0.205s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(9) { animation-delay: 0.23s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(10) { animation-delay: 0.255s; }
          #editEventModal.active #editEventForm .space-y-4 > div:nth-child(11) { animation-delay: 0.28s; }
          #editEventModal.active #editEventForm > div:last-child { animation-delay: 0.31s; }

          @keyframes ncpaEditReveal {
            from {
              opacity: 0;
              transform: translateY(8px);
              filter: blur(3px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
              filter: blur(0);
            }
          }

          #editEventModal button[onclick="closeEditEventModal()"] {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: #2a1d17 !important;
            border: 1px solid #1a120e !important;
            color: var(--ncpa-text-secondary) !important;
            line-height: 1;
            box-shadow:
              0 4px 10px rgba(0,0,0,0.35),
              inset 0 1px 0 rgba(255,225,190,0.06) !important;
            transition: color .18s, transform .18s;
            font-size: 14px !important;
          }
          #editEventModal button[onclick="closeEditEventModal()"]:hover {
            color: var(--ncpa-text-bright) !important;
            transform: scale(1.05);
          }

          #editEventForm .space-y-4 {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px 12px;
          }

          #editEventForm .space-y-4 > div {
            margin: 0 !important;
          }

          #editEventForm .space-y-4 > div:nth-child(1),
          #editEventForm .space-y-4 > div:nth-child(2),
          #editEventForm .space-y-4 > div:nth-child(3),
          #editEventForm .space-y-4 > div:nth-child(4),
          #editEventForm .space-y-4 > div:nth-child(11) {
            grid-column: 1 / -1;
          }

          #editEventForm .space-y-4 > div:nth-child(5),
          #editEventForm .space-y-4 > div:nth-child(6),
          #editEventForm .space-y-4 > div:nth-child(7),
          #editEventForm .space-y-4 > div:nth-child(8),
          #editEventForm .space-y-4 > div:nth-child(9),
          #editEventForm .space-y-4 > div:nth-child(10) {
            min-width: 0;
          }

          #editEventForm label,
          #editEventForm .block.text-sm,
          #editEventForm .text-sm.font-medium {
            color: var(--ncpa-text-muted) !important;
            font-weight: 700 !important;
            letter-spacing: 0.14em !important;
            text-transform: uppercase !important;
            font-size: 11px !important;
            margin-bottom: 8px !important;
          }

          /* Recessed clay inputs */
          #editEventForm input[type="text"],
          #editEventForm input[type="date"],
          #editEventForm textarea,
          #editEventForm select {
            background: linear-gradient(135deg, rgba(255,225,190,0.04), transparent 40%), #2a1d17 !important;
            border: 1px solid #160e0a !important;
            color: var(--ncpa-text-bright) !important;
            border-radius: 16px !important;
            padding: 14px 18px !important;
            font-size: 14px !important;
            font-weight: 500 !important;
            box-shadow:
              inset 0 2px 6px rgba(0,0,0,0.45),
              inset 0 -1px 0 rgba(255,225,190,0.04) !important;
            transition: border-color .18s, box-shadow .18s;
          }

          #editEventForm input::placeholder,
          #editEventForm textarea::placeholder {
            color: var(--ncpa-text-dim) !important;
            font-weight: 400 !important;
          }

          #editEventForm input:focus,
          #editEventForm textarea:focus,
          #editEventForm select:focus {
            border-color: rgba(224,164,88,0.45) !important;
            box-shadow:
              inset 0 2px 6px rgba(0,0,0,0.45),
              0 0 0 3px rgba(224,164,88,0.15) !important;
            outline: none !important;
          }

          #editEventForm input[type="radio"],
          #editEventForm input[type="checkbox"] {
            accent-color: var(--ncpa-amber);
          }

          /* Event Duration segmented control — clay pill */
          #editEventForm .flex.space-x-4 {
            display: inline-flex !important;
            gap: 4px !important;
            padding: 5px;
            border-radius: 999px;
            border: 1px solid #160e0a;
            background: #2a1d17 !important;
            box-shadow:
              inset 0 2px 5px rgba(0,0,0,0.40),
              inset 0 -1px 0 rgba(255,225,190,0.04) !important;
          }

          #editEventForm .flex.space-x-4 label {
            padding: 8px 16px !important;
            border-radius: 999px;
            color: var(--ncpa-text-secondary) !important;
            font-size: 13px !important;
            font-weight: 600 !important;
            letter-spacing: 0 !important;
            text-transform: none !important;
            margin: 0 !important;
            cursor: pointer;
            transition: color .18s, background .18s, box-shadow .18s;
          }

          #editEventForm .flex.space-x-4 input {
            position: absolute;
            opacity: 0;
            pointer-events: none;
          }

          #editEventForm .flex.space-x-4 label:has(input:checked) {
            background: linear-gradient(135deg, #f0b978 0%, var(--ncpa-amber) 50%, #c98a3f 100%) !important;
            color: var(--ncpa-text-dark) !important;
            box-shadow:
              0 4px 10px rgba(224,164,88,0.30),
              inset 0 1px 0 rgba(255,255,255,0.35) !important;
          }

          /* FOH / Stage assign cards — recessed clay trays */
          #editEventForm .border-blue-200,
          #editEventForm .border-green-200 {
            position: relative;
            background:
              linear-gradient(135deg, rgba(0,0,0,0.12), transparent 50%),
              #2a1d17 !important;
            border: 1px solid #160e0a !important;
            border-radius: 18px !important;
            padding: 14px 18px !important;
            box-shadow:
              inset 0 3px 8px rgba(0,0,0,0.45),
              inset 0 -1px 0 rgba(255,225,190,0.04) !important;
            margin-bottom: 14px !important;
          }

          #editEventForm .border-blue-200 i,
          #editEventForm .border-green-200 i {
            color: var(--ncpa-amber-light) !important;
          }

          #editEventForm .border-blue-200 > div.flex,
          #editEventForm .border-green-200 > div.flex {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
          }

          #editEventForm .border-blue-200 .text-blue-600,
          #editEventForm .border-green-200 .text-green-600 {
            color: var(--ncpa-amber-light) !important;
          }

          #editEventForm .border-blue-200 .text-sm.font-semibold,
          #editEventForm .border-green-200 .text-sm.font-semibold {
            color: var(--ncpa-text-bright) !important;
            font-size: 13px !important;
            font-weight: 700 !important;
            letter-spacing: 0.04em !important;
            text-transform: none !important;
            margin: 0 0 0 10px !important;
          }

          #editEventForm .border-blue-200 .text-xs,
          #editEventForm .border-green-200 .text-xs {
            color: var(--ncpa-text-dim) !important;
            font-size: 11px !important;
            font-weight: 500 !important;
            letter-spacing: 0.04em !important;
            text-transform: none !important;
            margin: 0 !important;
          }

          #editEventForm .border-blue-200 span,
          #editEventForm .border-green-200 span {
            color: var(--ncpa-text-secondary) !important;
          }

          /* FOH select — chevron */
          #editEventForm .border-blue-200 select,
          #editEventForm .border-green-200 select {
            padding-right: 44px !important;
            background-image:
              linear-gradient(135deg, rgba(255,225,190,0.04), transparent 40%),
              url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%23A8A29E' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>") !important;
            background-repeat: no-repeat !important;
            background-position: right 16px center !important;
            background-size: 10px 6px !important;
            appearance: none;
            -webkit-appearance: none;
          }

          #editEventForm .stage-checkbox + span {
            color: var(--ncpa-text-secondary) !important;
          }

          #editEventForm .stage-checkbox:checked + span {
            color: var(--ncpa-amber-light) !important;
            font-weight: 700;
          }

          /* Stage crew — 5-col grid, all names visible, no horizontal scroll */
          #editEventForm .stage-crew-grid {
            display: grid !important;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 6px 10px;
            margin-bottom: 0 !important;
            overflow: visible !important;
          }

          #editEventForm .stage-crew-grid label {
            display: flex !important;
            align-items: center;
            gap: 8px;
            margin: 0 !important;
            padding: 6px 8px;
            border-radius: 10px;
            cursor: pointer;
            letter-spacing: 0 !important;
            text-transform: none !important;
            font-weight: 500 !important;
            font-size: 13px !important;
            min-width: 0;
          }

          #editEventForm .stage-crew-grid label:hover {
            background: rgba(255,255,255,0.06);
          }

          #editEventForm .stage-crew-grid label span {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          @media (max-width: 720px) {
            #editEventForm .stage-crew-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
          }

          @media (max-width: 420px) {
            #editEventForm .stage-crew-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          /* Crew propagation row (PR #30) — amber clay tray with glowing left stripe */
          #editCrewPropagateRow {
            position: relative !important;
            background:
              radial-gradient(120% 80% at 100% 0%, rgba(224,164,88,0.10), transparent 60%),
              linear-gradient(135deg, rgba(224,164,88,0.10), rgba(224,164,88,0.04)),
              #2a1d17 !important;
            border: 1px solid rgba(224,164,88,0.30) !important;
            border-radius: 18px !important;
            padding: 16px 18px 16px 20px !important;
            margin: 6px 0 18px !important;
            color: var(--ncpa-amber-light) !important;
            box-shadow:
              inset 0 3px 8px rgba(0,0,0,0.40),
              inset 0 -1px 0 rgba(255,225,190,0.06),
              0 4px 12px rgba(224,164,88,0.10) !important;
            overflow: hidden;
          }

          #editCrewPropagateRow::before {
            content: "";
            position: absolute;
            left: 0; top: 10px; bottom: 10px;
            width: 4px;
            border-radius: 0 4px 4px 0;
            background: linear-gradient(180deg, var(--ncpa-amber-light), var(--ncpa-amber), #c98a3f);
            box-shadow: 0 0 10px rgba(224,164,88,0.50);
          }

          #editCrewPropagateRow label {
            display: flex !important;
            align-items: flex-start !important;
            gap: 12px !important;
            cursor: pointer;
            color: var(--ncpa-amber-light) !important;
            font-size: 14px !important;
            font-weight: 700 !important;
            letter-spacing: 0 !important;
            text-transform: none !important;
            margin: 0 !important;
          }

          #editCrewPropagateRow label .rounded {
            width: 20px !important;
            height: 20px !important;
            flex-shrink: 0;
            margin-top: 1px;
            background: #2a1d17 !important;
            border: 1.5px solid rgba(224,164,88,0.40) !important;
            box-shadow: inset 0 1px 3px rgba(0,0,0,0.5) !important;
            accent-color: var(--ncpa-amber) !important;
            border-radius: 6px !important;
            transition: background .15s, border-color .15s, box-shadow .15s;
          }

          #editCrewPropagateRow label .rounded:checked {
            background: var(--ncpa-amber) !important;
            border-color: var(--ncpa-amber) !important;
            box-shadow:
              0 2px 4px rgba(224,164,88,0.30),
              inset 0 1px 0 rgba(255,255,255,0.4) !important;
          }

          #editCrewPropagateRow p {
            margin-top: 8px !important;
            padding-left: 32px;
            color: var(--ncpa-text-muted) !important;
            font-size: 12px !important;
            font-weight: 400 !important;
            line-height: 1.5;
          }

          #editCrewPropagateRow p::before {
            content: "\f05a";
            font-family: "Font Awesome 6 Free";
            font-weight: 900;
            color: var(--ncpa-amber);
            margin-right: 6px;
          }

          #editEventForm > .flex.justify-end {
            position: sticky;
            bottom: 0;
            z-index: 3;
            display: flex !important;
            justify-content: flex-end !important;
            align-items: center !important;
            gap: 12px !important;
            width: calc(100% + 80px);
            margin: 26px -40px 0 !important;
            padding: 18px 40px 28px;
            border-radius: 0 0 28px 28px;
            border-top: 1px solid rgba(255,225,190,0.06);
            background: linear-gradient(180deg, rgba(58,42,34,0.0) 0%, #3a2a22 35%, #3a2a22 100%);
            box-shadow: 0 -14px 30px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,225,190,0.06);
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
          }

          #editEventForm > .flex.justify-end button:not(.modal-img-btn) {
            flex: 0 0 auto;
            min-width: 104px;
            min-height: 40px;
            margin: 0 !important;
            border-radius: 13px !important;
            font-size: 14px;
            font-weight: 800;
            transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
          }

          #editEventForm > .flex.justify-end button:not(.modal-img-btn):hover {
            transform: translateY(-1px);
          }

          #editEventForm > .flex.justify-end .modal-img-btn {
            flex: 0 0 auto !important;
            width: auto !important;
            min-width: auto !important;
            min-height: 0 !important;
            border-radius: 0 !important;
            overflow: visible;
            background: transparent !important;
            border: 0 !important;
            box-shadow: none !important;
            padding: 0 !important;
          }

          #editEventForm > .flex.justify-end .modal-img {
            height: 44px;
            width: auto;
            max-width: none;
            flex-shrink: 0;
            object-fit: contain;
          }

          #editEventForm > .flex.justify-end button[type="button"]:not(.modal-img-btn) {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-secondary) !important;
            border: 1px solid var(--ncpa-border-strong);
          }

          #editEventForm > .flex.justify-end button[type="button"]:not(.modal-img-btn):hover {
            background: rgba(255,255,255,0.13) !important;
            color: var(--ncpa-text-bright) !important;
          }

          #editEventForm > .flex.justify-end button[type="submit"]:not(.modal-img-btn) {
            background: var(--ncpa-amber) !important;
            color: var(--ncpa-text-dark) !important;
            border: 1px solid rgba(255,255,255,0.14) !important;
            box-shadow: 0 10px 25px rgba(224,164,88,0.20) !important;
          }

          #editEventForm > .flex.justify-end button[type="submit"]:not(.modal-img-btn):hover {
            background: #E8B269 !important;
            box-shadow: 0 14px 30px rgba(224,164,88,0.25) !important;
          }

          #filterPanel,
          #filterPanel.filter-panel {
            background: rgba(41,37,36,0.30) !important;
            color: var(--ncpa-text);
            border: 1px solid rgba(255,255,255,0.12);
            outline: none !important;
            box-shadow: 0 20px 60px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.14);
            backdrop-filter: blur(32px) saturate(150%);
            -webkit-backdrop-filter: blur(32px) saturate(150%);
          }

          #filterPanel h3,
          #filterPanel .filter-panel-title {
            color: var(--ncpa-text-bright);
            letter-spacing: -0.01em;
          }

          #filterPanel h3 i,
          #filterPanel .filter-panel-title i {
            color: var(--ncpa-amber);
          }

          #filterPanel > div:first-child button,
          #filterPanel .filter-panel-close {
            width: 32px;
            height: 32px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            color: var(--ncpa-text-secondary);
            background: rgba(255,255,255,0.07);
            border: 1px solid rgba(255,255,255,0.10);
            transition: transform 0.2s ease, color 0.2s ease, background 0.2s ease;
          }

          #filterPanel > div:first-child button:hover,
          #filterPanel .filter-panel-close:hover {
            transform: translateY(-1px);
            color: var(--ncpa-text-bright);
            background: rgba(255,255,255,0.12);
          }

          #filterPanel label,
          #filterPanel .filter-panel-label {
            color: var(--ncpa-text-secondary);
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          #filterVenue,
          #filterCrew,
          #filterTeam,
          #filterDateFrom,
          #filterDateTo,
          #filterRequirements,
          #filterPanel .filter-panel-control {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-bright) !important;
            border: 1px solid rgba(255,255,255,0.14) !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
            outline: none;
            scrollbar-color: rgba(224,164,88,0.55) rgba(255,255,255,0.06);
          }

          #filterVenue:focus,
          #filterCrew:focus,
          #filterTeam:focus,
          #filterDateFrom:focus,
          #filterDateTo:focus,
          #filterRequirements:focus,
          #filterPanel .filter-panel-control:focus {
            border-color: rgba(224,164,88,0.60) !important;
            box-shadow: 0 0 0 3px rgba(224,164,88,0.14), inset 0 1px 0 rgba(255,255,255,0.08);
          }

          #filterVenue option,
          #filterCrew option,
          #filterTeam option,
          #filterRequirements option,
          #filterPanel .filter-panel-control option {
            background: #241F1B;
            color: var(--ncpa-text-bright);
          }

          #filterVenue option:checked,
          #filterCrew option:checked,
          #filterTeam option:checked,
          #filterRequirements option:checked,
          #filterPanel .filter-panel-control option:checked {
            background: linear-gradient(120deg, rgba(224,164,88,0.88), rgba(224,164,88,0.72));
            color: var(--ncpa-text-dark);
          }

          #filterPanel > div:nth-last-child(2),
          #filterPanel .filter-panel-actions {
            border-top: 1px solid rgba(255,255,255,0.10);
          }

          #filterPanel > div:nth-last-child(2) button,
          #filterPanel .filter-panel-btn {
            min-height: 38px;
            font-weight: 800;
            transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, color 0.2s ease;
          }

          #filterPanel > div:nth-last-child(2) button:hover,
          #filterPanel .filter-panel-btn:hover {
            transform: translateY(-1px);
          }

          #filterPanel > div:nth-last-child(2) > button,
          #filterPanel .filter-panel-btn-secondary {
            background: rgba(255,255,255,0.08);
            background-image: none !important;
            color: var(--ncpa-text-secondary);
            border: 1px solid rgba(255,255,255,0.14);
          }

          #filterPanel > div:nth-last-child(2) > button:hover,
          #filterPanel .filter-panel-btn-secondary:hover {
            background: rgba(255,255,255,0.13);
            color: var(--ncpa-text-bright);
          }

          #filterPanel > div:nth-last-child(2) button[onclick="applyFilters()"],
          #filterPanel button[onclick="applyFilters()"],
          #filterPanel .filter-panel-btn-primary {
            background: var(--ncpa-amber) !important;
            background-image: none !important;
            color: var(--ncpa-text-dark);
            border: 1px solid rgba(255,255,255,0.14);
            box-shadow: 0 10px 25px rgba(224,164,88,0.20);
          }

          #filterPanel > div:nth-last-child(2) button[onclick="applyFilters()"]:hover,
          #filterPanel button[onclick="applyFilters()"]:hover,
          #filterPanel .filter-panel-btn-primary:hover {
            background: #E8B269 !important;
            background-image: none !important;
            box-shadow: 0 14px 30px rgba(224,164,88,0.25);
          }

          #filterResults,
          #filterPanel .filter-panel-results {
            color: var(--ncpa-text-secondary);
          }

          #actionsDropdown,
          #userDropdown {
            background: rgba(36,31,27,0.92) !important;
            border: 1px solid rgba(255,255,255,0.12) !important;
            outline: none !important;
            box-shadow: 0 18px 45px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.12) !important;
            backdrop-filter: blur(28px) saturate(145%) !important;
            -webkit-backdrop-filter: blur(28px) saturate(145%) !important;
          }

          #actionsDropdown button,
          #userDropdown button {
            color: var(--ncpa-text-secondary) !important;
            transition: background 0.2s ease, color 0.2s ease;
          }

          #actionsDropdown button:hover,
          #userDropdown button:hover {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-bright) !important;
          }

          #actionsDropdown .text-gray-500,
          #actionsDropdown .text-gray-700,
          #actionsDropdown span,
          #userDropdown .text-sm {
            color: var(--ncpa-text-secondary) !important;
          }

          #actionsDropdown hr,
          #actionsDropdown .border-gray-200,
          #userDropdown hr {
            border-color: rgba(255,255,255,0.10) !important;
          }

          #tableView,
          #crewView {
            color: var(--ncpa-text);
          }

          #tableView select,
          #crewView select,
          #tableView input,
          #crewView input,
          #tableView textarea,
          #crewView textarea {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-bright) !important;
            border: 1px solid rgba(255,255,255,0.14) !important;
            border-radius: 12px !important;
          }

          #tableView option,
          #crewView option {
            background: #241F1B;
            color: var(--ncpa-text-bright);
          }

          #tableView table {
            color: var(--ncpa-text-secondary);
            border-color: rgba(255,255,255,0.10) !important;
          }

          #tableView table th {
            background: rgba(224,164,88,0.18) !important;
            color: var(--ncpa-amber-light) !important;
            border-color: rgba(255,255,255,0.10) !important;
          }

          #tableView table td {
            color: var(--ncpa-text-secondary) !important;
            border-color: rgba(255,255,255,0.08) !important;
            background: rgba(28,25,23,0.16);
          }

          #tableView tbody tr:nth-child(even) td {
            background: rgba(255,255,255,0.03);
          }

          #tableView tbody tr:hover td,
          #tableView .editable-cell:hover {
            background: rgba(224,164,88,0.10) !important;
            color: var(--ncpa-text-bright) !important;
          }

          #tableView .text-gray-500,
          #tableView .text-gray-600,
          #tableView .text-gray-700,
          #crewView .text-gray-500,
          #crewView .text-gray-600,
          #crewView .text-gray-700,
          #crewView label {
            color: var(--ncpa-text-secondary) !important;
          }

          #tableView button {
            color: var(--ncpa-text-muted) !important;
            border-color: rgba(255,255,255,0.12) !important;
            transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease !important;
          }

          #tableView button:hover {
            color: var(--ncpa-amber-light) !important;
            background: rgba(255,255,255,0.08) !important;
            box-shadow: 0 10px 22px rgba(0,0,0,0.18) !important;
            transform: translateY(-1px);
          }

          #crewContent .rounded-2xl,
          #crewContent [style*="background:rgba(255,255,255"],
          #crewContent [style*="background: rgba(255,255,255"],
          #crewContent [style*="background:rgba(248"],
          #crewContent [style*="background: rgba(248"] {
            background: rgba(41,37,36,0.22) !important;
            color: var(--ncpa-text) !important;
            border: 1px solid rgba(255,255,255,0.10) !important;
            outline: none !important;
            box-shadow: 0 14px 34px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.10) !important;
            backdrop-filter: blur(24px) saturate(140%) !important;
            -webkit-backdrop-filter: blur(24px) saturate(140%) !important;
          }

          #crewContent h1,
          #crewContent h2,
          #crewContent h3,
          #crewContent h4,
          #crewContent strong {
            color: var(--ncpa-text-bright) !important;
          }

          #crewContent p,
          #crewContent span,
          #crewContent div {
            color: inherit;
          }

          #crewContent .text-xl.font-bold {
            color: var(--ncpa-amber-light) !important;
          }

          #crewContent .bg-gray-200 {
            background: rgba(255,255,255,0.08) !important;
          }

          #crewContent .bg-red-400,
          #crewContent .text-red-600 {
            background-color: var(--ncpa-terracotta) !important;
            color: #F3C9B8 !important;
          }

          #crewContent .bg-\\[\\#A8C3A0\\],
          #crewContent [class*="bg-[#A8C3A0]"] {
            background-color: rgba(224,164,88,0.72) !important;
            color: var(--ncpa-text-dark) !important;
          }

          #crewContent .text-blue-600 {
            color: var(--ncpa-amber-light) !important;
          }

          .modal-content h2,
          .modal-content h3 {
            color: var(--ncpa-text-bright) !important;
          }

          .modal-content p,
          .modal-content label,
          .modal-content .text-gray-500,
          .modal-content .text-gray-600,
          .modal-content .text-gray-700,
          .modal-content .text-gray-800 {
            color: var(--ncpa-text-secondary) !important;
          }

          .modal-content input[type="text"],
          .modal-content input[type="email"],
          .modal-content input[type="password"],
          .modal-content input[type="date"],
          .modal-content input[type="number"],
          .modal-content textarea,
          .modal-content select {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-bright) !important;
            border: 1px solid rgba(255,255,255,0.14) !important;
            border-radius: 12px !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
          }

          .modal-content input::placeholder,
          .modal-content textarea::placeholder {
            color: rgba(201,192,180,0.58) !important;
          }

          .modal-content input:focus,
          .modal-content textarea:focus,
          .modal-content select:focus {
            border-color: rgba(224,164,88,0.60) !important;
            box-shadow: 0 0 0 3px rgba(224,164,88,0.14), inset 0 1px 0 rgba(255,255,255,0.08) !important;
          }

          .modal-content option {
            background: #241F1B;
            color: var(--ncpa-text-bright);
          }

          .modal-content .bg-gray-300,
          .modal-content button.bg-gray-300 {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-secondary) !important;
            border: 1px solid rgba(255,255,255,0.14);
          }

          .modal-content .bg-gray-300:hover,
          .modal-content button.bg-gray-300:hover {
            background: rgba(255,255,255,0.13) !important;
            color: var(--ncpa-text-bright) !important;
          }

          .modal-content .bg-red-600,
          .modal-content button.bg-red-600 {
            background: rgba(199,91,57,0.20) !important;
            color: #F3C9B8 !important;
            border: 1px solid rgba(199,91,57,0.45);
          }

          .modal-content .bg-red-600:hover,
          .modal-content button.bg-red-600:hover {
            background: rgba(199,91,57,0.30) !important;
          }

          #addShowCrewCard,
          .avail-cbox {
            background: rgba(255,255,255,0.06) !important;
            color: var(--ncpa-text-secondary) !important;
            border: 1px solid rgba(255,255,255,0.12) !important;
            border-radius: 16px;
          }

          .avail-role-label,
          .avail-excl-hdr,
          .avail-cbox strong {
            color: var(--ncpa-text-bright) !important;
          }

          .avail-role-hint,
          .avail-loading,
          .avail-citem {
            color: var(--ncpa-text-secondary) !important;
          }

          .avail-cpill label {
            background: rgba(255,255,255,0.08) !important;
            color: var(--ncpa-text-secondary) !important;
            border-color: rgba(255,255,255,0.14) !important;
          }

          .avail-foh-pill input:checked + label,
          .avail-stage-pill input:checked + label {
            background: var(--ncpa-amber) !important;
            color: var(--ncpa-text-dark) !important;
            border-color: rgba(255,255,255,0.18) !important;
            box-shadow: 0 8px 18px rgba(224,164,88,0.22) !important;
          }

          #mobileWeekNav,
          .mobile-day-header {
            background: rgba(41,37,36,0.80) !important;
            color: var(--ncpa-text-secondary) !important;
            border-color: var(--ncpa-border) !important;
          }

          .mobile-day-header.today {
            color: var(--ncpa-amber) !important;
            background: rgba(224,164,88,0.12) !important;
            border-left-color: var(--ncpa-amber) !important;
          }

          .mobile-event-card .program {
            color: var(--ncpa-text-bright) !important;
          }

          .mobile-event-card .meta,
          .mobile-event-card .crew-foh,
          .mobile-event-card .crew-stage {
            color: var(--ncpa-text-secondary) !important;
          }

          @media (min-width: 768px) {
            body {
              background:
                radial-gradient(960px 640px at 6% -8%, rgba(224,164,88,0.30), transparent 66%),
                radial-gradient(980px 720px at 96% 4%, rgba(199,91,57,0.30), transparent 62%),
                radial-gradient(840px 640px at 64% 106%, rgba(240,185,120,0.18), transparent 70%),
                linear-gradient(135deg, #171412 0%, #211C19 48%, #2B211C 100%) !important;
            }

            body::before {
              width: min(56vw, 760px);
              height: min(46vw, 620px);
            }

            body::after {
              width: min(58vw, 880px);
              height: min(48vw, 660px);
            }

            html::before {
              width: min(58vw, 840px);
              height: min(42vw, 620px);
            }

            header.glass-header {
              background: rgba(31,27,24,0.86) !important;
              border-bottom-color: rgba(224,164,88,0.18) !important;
              box-shadow: 0 20px 54px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.12) !important;
            }

            #calendarView {
              background: rgba(26,23,21,0.78) !important;
              border-color: rgba(224,164,88,0.18) !important;
              box-shadow: 0 26px 70px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.14) !important;
            }

            #desktopCalendarChrome {
              background: rgba(32,28,25,0.76) !important;
              border-bottom-color: rgba(224,164,88,0.16) !important;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.10);
            }

            #desktopCalendarMain {
              background:
                radial-gradient(620px 440px at 78% 10%, rgba(224,164,88,0.08), transparent 70%),
                rgba(22,19,17,0.30) !important;
            }

            #todaySidebar {
              background: rgba(24,21,19,0.72) !important;
              border-right-color: rgba(224,164,88,0.16) !important;
              box-shadow: 18px 0 42px rgba(0,0,0,0.18), inset 1px 0 0 rgba(255,255,255,0.08) !important;
            }

            #todaySidebarClock {
              background: linear-gradient(135deg, rgba(224,164,88,0.30), rgba(42,35,31,0.72)) !important;
              box-shadow: 0 18px 40px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.16) !important;
            }

            #todaySidebarEventsPanel {
              background: rgba(41,37,36,0.34) !important;
              box-shadow: 0 16px 38px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.10) !important;
            }

            .calendar-day-active,
            .calendar-day-empty {
              background: rgba(255,255,255,0.035) !important;
              border-color: rgba(255,255,255,0.08) !important;
            }

            .event-card {
              box-shadow: 0 12px 24px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.08) !important;
            }
          }

          @media (max-width: 767px) {
            body {
              background:
                radial-gradient(640px 420px at 8% -8%, rgba(224,164,88,0.30), transparent 66%),
                radial-gradient(620px 480px at 96% 8%, rgba(199,91,57,0.28), transparent 60%),
                linear-gradient(145deg, #171412 0%, #211C19 48%, #2B211C 100%) !important;
              color: var(--ncpa-text-bright) !important;
            }

            body::before {
              width: 340px;
              height: 300px;
              left: -92px;
              top: -72px;
            }

            body::after {
              width: 390px;
              height: 330px;
              right: -132px;
              top: -62px;
            }

            html::before {
              width: 380px;
              height: 320px;
              left: 78px;
              bottom: -118px;
            }

            header.glass-header {
              background: rgba(31,27,24,0.86) !important;
              border-bottom-color: rgba(224,164,88,0.18) !important;
              box-shadow: 0 18px 45px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.12) !important;
            }

            #mainContent.container {
              padding-left: 16px !important;
              padding-right: 16px !important;
            }

            #mobileActionBar {
              gap: 12px;
            }

            #mobileActionBar .btn-glass {
              background: rgba(255,255,255,0.12) !important;
              color: var(--ncpa-text-bright) !important;
              border-color: rgba(255,255,255,0.16) !important;
              box-shadow: 0 12px 28px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.12) !important;
            }

            #calendarView {
              background: rgba(26,23,21,0.82) !important;
              border: 1px solid rgba(224,164,88,0.18) !important;
              border-radius: 24px !important;
              box-shadow: 0 24px 55px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.14) !important;
              backdrop-filter: blur(30px) saturate(155%) !important;
              -webkit-backdrop-filter: blur(30px) saturate(155%) !important;
            }

            #mobileWeekNav {
              margin: 4px 4px 14px !important;
              padding: 12px 10px !important;
              border-radius: 20px !important;
              background: rgba(32,28,25,0.92) !important;
              border: 1px solid rgba(255,255,255,0.14) !important;
              box-shadow: 0 14px 30px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12) !important;
              color: var(--ncpa-text-bright) !important;
            }

            #mobileWeekLabel {
              color: var(--ncpa-amber-light) !important;
              font-size: 0.95rem !important;
              letter-spacing: 0.01em;
            }

            #mobileTodayBtn {
              background: rgba(224,164,88,0.18) !important;
              color: var(--ncpa-amber-light) !important;
              border: 1px solid rgba(224,164,88,0.32) !important;
            }

            #mobileWeekEvents {
              padding-left: 6px !important;
              padding-right: 6px !important;
              padding-bottom: 28px !important;
            }

            .mobile-day-header {
              position: sticky;
              top: 78px;
              margin: 18px 0 10px !important;
              padding: 12px 12px 11px !important;
              border-radius: 16px !important;
              background: rgba(39,34,31,0.94) !important;
              color: var(--ncpa-text-secondary) !important;
              border: 1px solid rgba(255,255,255,0.10) !important;
              border-left: 4px solid rgba(255,255,255,0.14) !important;
              box-shadow: 0 12px 24px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.10) !important;
              backdrop-filter: blur(22px) saturate(140%) !important;
              -webkit-backdrop-filter: blur(22px) saturate(140%) !important;
            }

            .mobile-day-header.today {
              background: linear-gradient(120deg, rgba(224,164,88,0.24), rgba(39,34,31,0.94)) !important;
              color: var(--ncpa-amber-light) !important;
              border-left-color: var(--ncpa-amber) !important;
            }

            .mobile-day-header.today::before {
              background: var(--ncpa-amber) !important;
              box-shadow: 0 0 16px rgba(224,164,88,0.55);
            }

            .mobile-event-card {
              padding: 16px 16px !important;
              border-radius: 18px !important;
              margin-bottom: 14px !important;
              background: linear-gradient(120deg, rgba(74,64,57,0.78), rgba(33,29,26,0.86)) !important;
              color: var(--ncpa-text-bright) !important;
              box-shadow: 0 18px 38px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.12) !important;
            }

            .mobile-event-card.event-card-green {
              background: linear-gradient(120deg, rgba(224,164,88,0.30), rgba(47,41,36,0.88)) !important;
              border-left-color: var(--ncpa-amber) !important;
            }

            .mobile-event-card.event-card-peach {
              background: linear-gradient(120deg, rgba(199,91,57,0.30), rgba(47,41,36,0.88)) !important;
              border-left-color: var(--ncpa-terracotta) !important;
            }

            .mobile-event-program,
            .mobile-event-card .program {
              color: #FFF9F0 !important;
              font-size: 1rem !important;
              font-weight: 800 !important;
            }

            .mobile-event-venue,
            .mobile-event-crew,
            .mobile-event-card .meta,
            .mobile-event-card .crew-foh,
            .mobile-event-card .crew-stage {
              color: rgba(245,241,234,0.76) !important;
              font-size: 0.88rem !important;
            }

            .mobile-event-foh {
              color: var(--ncpa-amber-light) !important;
            }

            .mobile-no-shows {
              color: rgba(201,192,180,0.68) !important;
              background: rgba(255,255,255,0.04);
              border: 1px dashed rgba(255,255,255,0.10);
              border-radius: 16px;
            }
          }

          @supports not (backdrop-filter: blur(32px)) {
            .glass-header,
            .glass-card,
            #calendarView,
            #todaySidebar,
            #desktopCalendarChrome,
            .modal-content {
              background: rgba(41,37,36,0.92) !important;
            }
          }

          /* System toast notifications (Phase 1) */
          .ncpa-toast {
            position: fixed;
            top: 16px;
            right: 16px;
            min-width: 280px;
            max-width: 420px;
            padding: 14px 18px;
            border-radius: 14px;
            z-index: 9999;
            font-size: 14px;
            font-weight: 500;
            line-height: 1.4;
            color: var(--ncpa-text-bright);
            background: linear-gradient(120deg, rgba(224,164,88,0.18), rgba(41,37,36,0.42));
            border: 1px solid var(--ncpa-border);
            border-left: 4px solid var(--ncpa-amber);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            box-shadow: 0 8px 32px rgba(0,0,0,0.28);
          }

          .ncpa-toast--success {
            border-left-color: var(--ncpa-green);
            background: linear-gradient(120deg, rgba(92,157,111,0.22), rgba(41,37,36,0.42));
          }

          .ncpa-toast--error {
            border-left-color: var(--ncpa-terracotta);
            background: linear-gradient(120deg, rgba(199,91,57,0.22), rgba(41,37,36,0.42));
          }

          .ncpa-toast--info {
            border-left-color: var(--ncpa-amber);
            background: linear-gradient(120deg, rgba(224,164,88,0.18), rgba(41,37,36,0.42));
          }

          .ncpa-toast--warning {
            border-left-color: var(--ncpa-amber-light);
            background: linear-gradient(120deg, rgba(240,185,120,0.20), rgba(41,37,36,0.42));
          }

          .ncpa-toast--progress .ncpa-toast-step {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 10px;
          }

          .ncpa-toast--progress .ncpa-toast-progress-track {
            background: rgba(255,255,255,0.15);
            border-radius: 6px;
            height: 10px;
            overflow: hidden;
          }

          .ncpa-toast--progress .ncpa-toast-progress-bar {
            background: var(--ncpa-amber-light);
            height: 100%;
            width: 0%;
            transition: width 0.5s ease;
            border-radius: 6px;
          }

          .ncpa-toast--progress.ncpa-toast--success .ncpa-toast-progress-bar {
            background: var(--ncpa-green-light);
          }

          .ncpa-toast--progress.ncpa-toast--error .ncpa-toast-progress-bar {
            background: var(--ncpa-terracotta-light);
          }

          .ncpa-toast--progress .ncpa-toast-progress-pct {
            font-size: 11px;
            margin-top: 6px;
            opacity: 0.85;
            color: var(--ncpa-text-secondary);
          }

          /* Centered upload overlay — freezes app while Word doc uploads */
          .ncpa-upload-overlay {
            position: fixed;
            inset: 0;
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(28, 25, 23, 0.78);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
          }

          .ncpa-upload-overlay .ncpa-toast--progress {
            position: static;
            top: auto;
            right: auto;
            width: min(420px, 100%);
            min-width: 0;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
          }

          body.ncpa-upload-frozen {
            overflow: hidden;
          }

          /* Inline status messages (Phase 2) */
          .ncpa-status {
            font-size: 0.875rem;
            line-height: 1.25rem;
            color: var(--ncpa-text-muted);
          }

          .ncpa-status--info {
            color: var(--ncpa-amber-light);
          }

          .ncpa-status--success {
            color: var(--ncpa-green-light);
          }

          .ncpa-status--error {
            color: var(--ncpa-terracotta-light);
          }

          #loginError,
          #signupError,
          #changePasswordError {
            color: var(--ncpa-terracotta-light) !important;
          }

          #signupSuccess,
          #changePasswordSuccess {
            color: var(--ncpa-green-light) !important;
          }

          @media (prefers-reduced-motion: reduce) {
            *,
            *::before,
            *::after {
              animation-duration: 0.01ms !important;
              animation-iteration-count: 1 !important;
              scroll-behavior: auto !important;
              transition-duration: 0.01ms !important;
            }

            html::before,
            body::before,
            body::after,
            #editEventModal.active h2,
            #editEventModal.active #editEventForm .space-y-4 > div,
            #editEventModal.active #editEventForm > div:last-child,
            #eventModal.active .event-detail-modal,
            #eventModal.active .event-detail-header,
            #eventModal.active .event-detail-status,
            #eventModal.active .event-detail-hero,
            #eventModal.active .event-detail-grid,
            #eventModal.active .event-detail-crew,
            #eventModal.active .event-detail-notes,
            #eventModal.active .event-detail-created,
            #eventModal.active .event-detail-footer {
              animation: none !important;
              transform: none !important;
              filter: none !important;
              opacity: 1 !important;
            }
          }
        </style>
    </head>
    <body style="background-color: #f8f9fc; padding-bottom: env(safe-area-inset-bottom);">
        <div class="min-h-screen">
            <!-- Header -->
            <header class="glass-header sticky top-0 z-30" style="background:rgba(248,249,252,0.78);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.45);box-shadow:0 1px 24px rgba(45,51,56,0.07);padding-top:env(safe-area-inset-top);">
                <div class="container mx-auto px-4 md:px-6 py-2 md:py-4">
                    <div class="flex justify-between items-center">
                        <div class="hidden md:block flex-1"></div>
                        <div class="flex-1 text-center">
                            <h1 class="text-xl md:text-3xl font-bold whitespace-nowrap" style="color: #98A2D7; letter-spacing: -0.01em;">
                                <i class="fas fa-music mr-1 md:mr-2"></i>NCPA Sound Crew
                            </h1>
                            <p class="hidden md:block text-gray-600 mt-1">Event Schedule & Technical Dashboard</p>
                        </div>
                        <div class="flex-1 flex justify-end items-center gap-3">
                            <!-- User Menu (shown when logged in) -->
                            <div id="userMenu" style="display: none;">
                                <div class="relative">
                                    <button onclick="toggleUserDropdown()" class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#ebeef3] transition-all">
                                        <i class="fas fa-user-circle text-2xl" style="color: #98A2D7;"></i>
                                        <span id="userEmailDisplay" class="text-sm font-medium text-gray-700"></span>
                                        <!-- Admin badge -->
                                        <span id="adminBadge" style="display: none;" class="relative">
                                            <i class="fas fa-user-shield text-lg" style="color: #98A2D7;"></i>
                                            <span id="pendingCount" class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center" style="display: none;"></span>
                                        </span>
                                    </button>
                                    <!-- Dropdown -->
                                    <div id="userDropdown" class="hidden absolute right-0 mt-2 w-48 rounded-2xl z-50" style="background:rgba(248,249,252,0.90);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);outline:1px solid rgba(173,179,184,0.18);box-shadow:inset 1px 1px 0 rgba(255,255,255,0.55),0 16px 40px rgba(45,51,56,0.08);">
                                        <button onclick="openChangePasswordModal()" class="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm">
                                            <i class="fas fa-key mr-2"></i>Change Password
                                        </button>
                                        <button id="adminPanelBtn" onclick="openAdminPanel()" class="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm" style="display: none;">
                                            <i class="fas fa-users-cog mr-2"></i>Admin Panel
                                        </button>
                                        <hr class="my-1">
                                        <button onclick="logout()" class="w-full text-left px-4 py-2 hover:bg-red-50 text-sm text-red-600">
                                            <i class="fas fa-sign-out-alt mr-2"></i>Logout
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <!-- Login Button (shown when not logged in) -->
                            <button id="loginBtn" onclick="openLoginModal()" class="btn-primary px-4 py-2">
                                <i class="fas fa-sign-in-alt mr-2"></i>Login
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <!-- Tab Navigation -->
            <div id="mainContent" class="container mx-auto px-4 md:px-6 py-2 md:py-4">
                <!-- MOBILE: Compact action bar — AI centred, Add Show right -->
                <div id="mobileActionBar" class="md:hidden grid grid-cols-3 items-center mb-2">
                    <div></div>
                    <div class="flex justify-center">
                        <button type="button" onclick="toggleAIAssistant()" class="nav-action" aria-label="Ask AI">
                            <img src="/static/images/nav/ask-ai.png" alt="Ask AI" class="nav-action-img nav-action-img--sm">
                        </button>
                    </div>
                    <div class="flex justify-end">
                        <button type="button" onclick="openAddShowModal()" class="nav-action" aria-label="Add Show">
                            <img src="/static/images/nav/add-show.png" alt="Add Show" class="nav-action-img nav-action-img--sm">
                        </button>
                    </div>
                </div>
                
                
                
                <!-- DESKTOP: Full toolbar with all features -->
                <div class="hidden md:block">
                    <div class="flex flex-wrap justify-between items-center gap-y-2 mb-4 md:mb-6">
                        <!-- Left: Tab navigation -->
                        <div class="nav-tabs-group shrink-0">
                            <button type="button" id="calendarTab" class="nav-tab tab-active" onclick="showTab('calendar')" aria-label="Calendar">
                                <img src="/static/images/nav/calendar-tab.png" alt="Calendar" class="nav-tab-img">
                            </button>
                            <button type="button" id="tableTab" class="nav-tab" onclick="showTab('table')" aria-label="Table">
                                <img src="/static/images/nav/table-tab.png" alt="Table" class="nav-tab-img">
                            </button>
                            <button type="button" id="crewTab" class="nav-tab" onclick="showTab('crew')" aria-label="Crew">
                                <img src="/static/images/nav/crew-tab.png" alt="Crew" class="nav-tab-img">
                            </button>
                        </div>

                        <!-- Center: Ask AI button -->
                        <div class="flex items-center shrink-0">
                            <button type="button" onclick="toggleAIAssistant()" class="nav-action" aria-label="Ask AI">
                                <img src="/static/images/nav/ask-ai.png" alt="Ask AI" class="nav-action-img">
                            </button>
                        </div>

                        <!-- Right: Toolbar actions -->
                        <div class="flex items-center gap-2 shrink-0">
                            <!-- Divider -->
                            <div class="h-8 w-px bg-gray-300"></div>

                            <!-- Analysis Tools Group -->
                            <div class="flex gap-2">
                                <button onclick="toggleFilterPanel()"
                                        class="btn-glass px-3 py-2 text-sm">
                                    <i class="fas fa-filter mr-1.5"></i>Filters
                                </button>
                            </div>

                            <!-- Divider -->
                            <div class="h-8 w-px bg-gray-300"></div>

                            <!-- Import/Export Dropdown -->
                            <div class="relative">
                                <button onclick="toggleActionsDropdown()"
                                        class="btn-glass px-4 py-2 text-sm flex items-center gap-2">
                                    <i class="fas fa-ellipsis-v"></i>
                                    <span>More Actions</span>
                                    <i class="fas fa-chevron-down text-xs"></i>
                                </button>

                                <!-- Dropdown Menu -->
                                <div id="actionsDropdown" class="hidden absolute right-0 mt-2 w-56 rounded-2xl z-50" style="background:rgba(248,249,252,0.90);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);outline:1px solid rgba(173,179,184,0.18);box-shadow:inset 1px 1px 0 rgba(255,255,255,0.55),0 16px 40px rgba(45,51,56,0.08);">
                                    <div class="py-2">
                                        <!-- Export Section -->
                                        <div class="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">Export</div>
                                        <button onclick="openCSVExportModal(); toggleActionsDropdown();"
                                                class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3">
                                            <i class="fas fa-file-csv w-5" style="color: #98A2D7;"></i>
                                            <span class="text-sm text-gray-700">Export CSV</span>
                                        </button>
                                        <button onclick="openWhatsAppExportModal(); toggleActionsDropdown();"
                                                class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3">
                                            <i class="fab fa-whatsapp text-green-600 w-5"></i>
                                            <span class="text-sm text-gray-700">WhatsApp Export</span>
                                        </button>
                                        <button onclick="openShortNoticeModal(); toggleActionsDropdown();"
                                                class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3">
                                            <i class="fas fa-clock text-red-500 w-5"></i>
                                            <span class="text-sm text-gray-700">Short Notice Report</span>
                                        </button>

                                        <!-- Divider -->
                                        <div class="my-2 border-t border-gray-200"></div>

                                        <!-- Import Section -->
                                        <div class="px-3 py-1 text-xs font-semibold text-gray-500 uppercase">Import</div>
                                        <button onclick="document.getElementById('wordInput').click(); toggleActionsDropdown();"
                                                class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3">
                                            <i class="fas fa-file-word text-blue-600 w-5"></i>
                                            <span class="text-sm text-gray-700">Upload Word</span>
                                        </button>
                                        <button onclick="document.getElementById('csvInput').click(); toggleActionsDropdown();"
                                                class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-3">
                                            <i class="fas fa-file-upload text-teal-600 w-5"></i>
                                            <span class="text-sm text-gray-700">Upload CSV</span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Hidden file inputs -->
                            <input type="file" id="wordInput" accept=".doc,.docx" style="display: none;" onchange="handleWordUpload(event)">
                            <input type="file" id="csvInput" accept=".csv" style="display: none;" onchange="handleCSVUpload(event)">

                            <!-- Add Show Button -->
                            <button type="button" onclick="openAddShowModal()" class="nav-action" aria-label="Add Show">
                                <img src="/static/images/nav/add-show.png" alt="Add Show" class="nav-action-img">
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Calendar View -->
                <div id="calendarView" class="rounded-2xl glass-card overflow-y-auto max-h-[calc(100vh-240px)] md:max-h-[calc(100vh-180px)]">
                    <!-- Desktop two-column layout: today sidebar + month calendar -->
                    <div id="desktopCalendarLayout" class="hidden md:flex min-h-0">
                        <aside id="todaySidebar">
                            <div id="todaySidebarClock">
                                <div id="todaySidebarDayNumber"></div>
                                <div id="todaySidebarDateLabel"></div>
                                <div id="todaySidebarTime">00:00:00</div>
                            </div>
                            <div id="todaySidebarEventsPanel">
                                <div id="todaySidebarEvents"></div>
                            </div>
                        </aside>
                        <div id="desktopCalendarMain" class="flex-1 min-w-0 flex flex-col">
                            <!-- Sticky header: month controls + days-of-week (desktop only) -->
                            <div id="desktopCalendarChrome" class="sticky top-0 z-10 p-3 md:p-6 pb-0 md:pb-0" style="background:rgba(255,255,255,0.70);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);">
                                <!-- Calendar controls with event count -->
                                <div class="flex justify-between items-center mb-4 md:mb-6">
                                    <button onclick="changeMonth(-1)" class="px-3 py-2 text-sm md:text-base rounded-xl touch-manipulation" style="background-color: rgba(168,195,160,0.22); color: #2d3338;">
                                        <i class="fas fa-chevron-left"></i><span class="hidden md:inline"> Previous</span>
                                    </button>
                                    <div class="text-center">
                                        <h2 id="currentMonthYear" class="text-lg md:text-2xl font-bold" style="color: #98A2D7; letter-spacing: -0.01em;"></h2>
                                        <p id="monthEventCount" class="text-sm text-gray-600 mt-1"></p>
                                    </div>
                                    <button onclick="changeMonth(1)" class="px-3 py-2 text-sm md:text-base rounded-xl touch-manipulation" style="background-color: rgba(168,195,160,0.22); color: #2d3338;">
                                        <span class="hidden md:inline">Next </span><i class="fas fa-chevron-right"></i>
                                    </button>
                                </div>
                                
                                <!-- Calendar grid - Mobile optimized -->
                                <div class="grid grid-cols-7 gap-1 md:gap-2">
                                    <div class="font-bold text-center py-1.5 md:py-2 text-xs md:text-sm" style="background-color: rgba(248,249,252,0.55); color: #5a6065;">SUN</div>
                                    <div class="font-bold text-center py-1.5 md:py-2 text-xs md:text-sm" style="background-color: rgba(248,249,252,0.55); color: #5a6065;">MON</div>
                                    <div class="font-bold text-center py-1.5 md:py-2 text-xs md:text-sm" style="background-color: rgba(248,249,252,0.55); color: #5a6065;">TUE</div>
                                    <div class="font-bold text-center py-1.5 md:py-2 text-xs md:text-sm" style="background-color: rgba(248,249,252,0.55); color: #5a6065;">WED</div>
                                    <div class="font-bold text-center py-1.5 md:py-2 text-xs md:text-sm" style="background-color: rgba(248,249,252,0.55); color: #5a6065;">THU</div>
                                    <div class="font-bold text-center py-1.5 md:py-2 text-xs md:text-sm" style="background-color: rgba(248,249,252,0.55); color: #5a6065;">FRI</div>
                                    <div class="font-bold text-center py-1.5 md:py-2 text-xs md:text-sm" style="background-color: rgba(248,249,252,0.55); color: #5a6065;">SAT</div>
                                </div>
                            </div>
                            <!-- Scrollable calendar grid (desktop only) -->
                            <div id="desktopCalendarGridWrap" class="p-3 md:p-6 pt-2 md:pt-2">
                                <div id="calendarGrid" class="grid grid-cols-7 gap-1 md:gap-2"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Mobile week-agenda view (hidden on desktop) -->
                    <div id="mobileCalendarView" class="md:hidden">
                        <!-- Sticky week nav -->
                        <div id="mobileWeekNav" class="sticky top-0 z-10 mb-3 px-1 py-2 flex justify-between items-center" style="background:rgba(255,255,255,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);">
                            <button id="mobilePrevWeek" class="btn-glass px-3 py-1.5 text-sm">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <div class="flex items-center gap-2">
                                <span id="mobileWeekLabel" class="text-sm font-semibold text-gray-700"></span>
                                <button id="mobileTodayBtn" class="hidden text-xs px-2 py-1 rounded-full" style="background:rgba(152,162,215,0.15);color:#465080;">Today</button>
                            </div>
                            <button id="mobileNextWeek" class="btn-glass px-3 py-1.5 text-sm">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                        <!-- Week events list -->
                        <div id="mobileWeekEvents" class="space-y-6 pb-6 px-1"></div>
                    </div>
                </div>

                <!-- Table View -->
                <div id="tableView" class="glass-card rounded-2xl p-3 md:p-6" style="display: none;">
                    <!-- Bulk Actions Bar -->
                    <div class="mb-4 flex items-center justify-between">
                        <div class="flex items-center space-x-3">
                            <select id="bulkDeleteMonth" class="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">
                                <option value="">Select Month</option>
                                <option value="1">January</option>
                                <option value="2">February</option>
                                <option value="3">March</option>
                                <option value="4">April</option>
                                <option value="5">May</option>
                                <option value="6">June</option>
                                <option value="7">July</option>
                                <option value="8">August</option>
                                <option value="9">September</option>
                                <option value="10">October</option>
                                <option value="11">November</option>
                                <option value="12">December</option>
                            </select>
                            <select id="bulkDeleteYear" class="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">
                                <option value="">Select Year</option>
                                <option value="2024">2024</option>
                                <option value="2025">2025</option>
                                <option value="2026">2026</option>
                                <option value="2027">2027</option>
                                <option value="2028">2028</option>
                            </select>
                            <button onclick="bulkDeleteEvents()" class="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all flex items-center">
                                <i class="fas fa-trash mr-1.5"></i>Delete Month
                            </button>
                        </div>
                        <div id="bulkDeleteStatus" class="ncpa-status"></div>
                    </div>
                    
                    <div class="overflow-auto" style="max-height: 70vh;">
                        <table class="w-full border-collapse table-fixed">
                            <colgroup>
                                <col style="width: 5%;">   <!-- Select -->
                                <col style="width: 10%;">  <!-- Date -->
                                <col style="width: 23%;">  <!-- Program -->
                                <col style="width: 10%;">  <!-- Venue -->
                                <col style="width: 10%;">  <!-- Team -->
                                <col style="width: 18%;">  <!-- Sound Requirements -->
                                <col style="width: 8%;">   <!-- Call Time -->
                                <col style="width: 10%;">  <!-- Crew -->
                                <col style="width: 6%;">   <!-- Actions -->
                            </colgroup>
                            <thead>
                                <tr>
                                    <th class="px-2 py-3 text-center text-white font-semibold text-sm">
                                        <input type="checkbox" id="selectAllCheckbox" onchange="toggleSelectAll(this.checked)" 
                                               class="cursor-pointer">
                                    </th>
                                    <th class="px-2 py-3 text-left text-white font-semibold text-sm">Date</th>
                                    <th class="px-2 py-3 text-left text-white font-semibold text-sm">Program/Event</th>
                                    <th class="px-2 py-3 text-left text-white font-semibold text-sm">Venue</th>
                                    <th class="px-2 py-3 text-left text-white font-semibold text-sm">Team</th>
                                    <th class="px-2 py-3 text-left text-white font-semibold text-sm">Sound Req</th>
                                    <th class="px-2 py-3 text-left text-white font-semibold text-sm">Call</th>
                                    <th class="px-2 py-3 text-left text-white font-semibold text-sm">Crew</th>
                                    <th class="px-2 py-3 text-left text-white font-semibold text-sm">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="tableBody">
                                <!-- Table rows will be dynamically generated -->
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <!-- Dashboard View -->
                <!-- Dashboard removed - using simple event count in calendar header instead -->
                
                <!-- Crew Tab -->
                <div id="crewView" class="glass-card rounded-2xl p-6" style="display: none;">
                    <div class="flex items-center gap-3 mb-5">
                        <label for="crewMonthSelect" class="text-sm font-semibold text-gray-600">Showing load for:</label>
                        <select id="crewMonthSelect"
                                class="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                                onchange="loadCrewStats()">
                        </select>
                    </div>
                    <div id="crewContent">
                        <div class="text-center py-12">
                            <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
                            <p class="mt-4 text-gray-600">Loading crew statistics...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Event Detail Modal -->
        <div id="eventModal" class="modal">
            <div class="modal-content event-detail-modal">
                <div class="event-detail-header">
                    <h2>Event Details</h2>
                    <button type="button" onclick="closeEventModal()" class="event-detail-close" aria-label="Close">&times;</button>
                </div>
                <div id="eventModalContent" class="event-detail-body"></div>
                <div id="eventModalFooter" class="event-detail-footer"></div>
            </div>
        </div>

        <!-- Add Show Modal -->
        <div id="addShowModal" class="modal">
            <div class="modal-content">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">Add New Show</h2>
                    <button onclick="closeAddShowModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <form id="addShowForm" onsubmit="handleAddShow(event)">
                    <div class="space-y-4">
                        <!-- Date Type Selection -->
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Event Duration *</label>
                            <div class="flex space-x-4">
                                <label class="flex items-center cursor-pointer">
                                    <input type="radio" name="dateType" value="single" checked onchange="toggleDateFields()" 
                                           class="mr-2">
                                    <span class="text-sm">Single Date</span>
                                </label>
                                <label class="flex items-center cursor-pointer">
                                    <input type="radio" name="dateType" value="multiple" onchange="toggleDateFields()" 
                                           class="mr-2">
                                    <span class="text-sm">Multiple Dates (Same show across dates)</span>
                                </label>
                            </div>
                        </div>
                        
                        <!-- Single Date Field -->
                        <div id="singleDateField">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                            <input type="date" name="event_date" id="singleDate"
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                        </div>
                        
                        <!-- Multiple Date Fields -->
                        <div id="multipleDateFields" style="display: none;">
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                                    <input type="date" name="start_date" id="startDate"
                                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                                    <input type="date" name="end_date" id="endDate"
                                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                                </div>
                            </div>
                            <p class="text-xs text-gray-500 mt-1">
                                <i class="fas fa-info-circle mr-1"></i>
                                Same show will be created for all dates in this range with identical venue, crew, and requirements.
                            </p>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Program/Event *</label>
                            <input type="text" name="program" required 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Venue *</label>
                            <input type="text" name="venue" required list="venueList"
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]"
                                   placeholder="Select or type venue">
                            <datalist id="venueList">
                                <option value="JBT Museum">JBT Museum</option>
                                <option value="JBT">Jamshed Bhabha Theatre</option>
                                <option value="TET">Tata Theatre</option>
                                <option value="GDT">Godrej Dance Theatre</option>
                                <option value="LT">Little Theatre</option>
                                <option value="SVR">Sea View Room</option>
                                <option value="TT">Tata Theatre</option>
                                <option value="Experimental Theatre">Experimental Theatre</option>
                            </datalist>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Team (curator)</label>
                            <select name="team" id="addShowTeam"
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                                <option value="">Select Team...</option>
                                <option value="Bruce/Team">Bruce/Team</option>
                                <option value="Dr.Rao/Team">Dr.Rao/Team</option>
                                <option value="Dr.Swapno/Team">Dr.Swapno/Team</option>
                                <option value="Farrahnaz/Team">Farrahnaz/Team</option>
                                <option value="Bianca/Team">Bianca/Team</option>
                                <option value="Dr.Sujata/Team">Dr.Sujata/Team</option>
                                <option value="Nooshin/Team">Nooshin/Team</option>
                                <option value="DPAG">DPAG</option>
                                <option value="DP">DP</option>
                                <option value="Others">Others</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Sound Requirements</label>
                            <textarea name="sound_requirements" rows="3"
                                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]"></textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Call Time</label>
                            <input type="text" name="call_time"
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                        </div>
                        <!-- Crew Availability Card (shown after date is selected) -->
                        <div id="addShowCrewCard" style="display:none; margin-top:12px;">
                          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#7280a8;margin-bottom:8px;">Crew Assignment</div>
                          <div id="addShowCrewBody">
                            <div class="avail-loading"><div class="avail-spinner"></div>Checking availability…</div>
                          </div>
                        </div>
                    </div>
                    <div class="flex justify-end space-x-3 mt-6">
                        <button type="button" onclick="closeAddShowModal()" 
                                class="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400">
                            Cancel
                        </button>
                        <button type="submit" class="btn-primary px-6 py-2">
                            Add Show
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Edit Event Modal -->
        <div id="editEventModal" class="modal">
            <div class="modal-content">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">Edit Event</h2>
                    <button onclick="closeEditEventModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <form id="editEventForm" onsubmit="handleEditEvent(event)">
                    <input type="hidden" name="event_id" id="editEventId">
                    <div class="space-y-4">
                        <!-- Date Type Selection -->
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Event Duration *</label>
                            <div class="flex space-x-4">
                                <label class="flex items-center cursor-pointer">
                                    <input type="radio" name="editDateType" value="single" checked onchange="toggleEditDateFields()" 
                                           class="mr-2">
                                    <span class="text-sm">Single Date</span>
                                </label>
                                <label class="flex items-center cursor-pointer">
                                    <input type="radio" name="editDateType" value="multiple" onchange="toggleEditDateFields()" 
                                           class="mr-2">
                                    <span class="text-sm">Extend to Multiple Dates</span>
                                </label>
                            </div>
                        </div>
                        
                        <!-- Single Date Field -->
                        <div id="editSingleDateField">
                            <label class="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                            <input type="date" name="event_date" id="editSingleDate"
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                        </div>
                        
                        <!-- Multiple Date Fields -->
                        <div id="editMultipleDateFields" style="display: none;">
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                                    <input type="date" name="start_date" id="editStartDate"
                                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                                </div>
                                <div>
                                    <label class="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                                    <input type="date" name="end_date" id="editEndDate"
                                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                                </div>
                            </div>
                            <p class="text-xs text-gray-500 mt-1">
                                <i class="fas fa-info-circle mr-1"></i>
                                Creates copies of this event for additional dates. Original event will be updated to start date.
                            </p>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Program/Event *</label>
                            <input type="text" name="program" id="editProgram" required 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Venue *</label>
                            <input type="text" name="venue" id="editVenue" required list="venueList"
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]"
                                   placeholder="Select or type venue">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Team (curator)</label>
                            <select name="team" id="editTeam"
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                                <option value="">Select Team...</option>
                                <option value="Bruce/Team">Bruce/Team</option>
                                <option value="Dr.Rao/Team">Dr.Rao/Team</option>
                                <option value="Dr.Swapno/Team">Dr.Swapno/Team</option>
                                <option value="Farrahnaz/Team">Farrahnaz/Team</option>
                                <option value="Bianca/Team">Bianca/Team</option>
                                <option value="Dr.Sujata/Team">Dr.Sujata/Team</option>
                                <option value="Nooshin/Team">Nooshin/Team</option>
                                <option value="DPAG">DPAG</option>
                                <option value="DP">DP</option>
                                <option value="Others">Others</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Sound Requirements</label>
                            <textarea name="sound_requirements" id="editSoundReq" rows="3" 
                                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]"></textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Call Time</label>
                            <input type="text" name="call_time" id="editCallTime"
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Rider (document URLs, comma-separated)</label>
                            <input type="text" name="rider" id="editRider" placeholder="https://... , https://..."
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                            <textarea name="notes" id="editNotes" rows="2" placeholder="Internal notes (not shared to sheet)"
                                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600"></textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Crew Assignment</label>

                            <!-- FOH — single assign -->
                            <div class="mb-3 p-3 border border-blue-200 rounded-lg" style="background:rgba(239,246,255,0.7)">
                                <div class="flex items-center mb-2">
                                    <i class="fas fa-headphones text-blue-600 mr-2 text-xs"></i>
                                    <span class="text-sm font-semibold text-blue-800">FOH</span>
                                    <span class="text-xs text-blue-400 ml-2">single assign</span>
                                </div>
                                <select id="editFohCrew" name="foh_crew"
                                        class="w-full px-3 py-2 border border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm bg-white">
                                    <option value="">— none —</option>
                                    <option value="Ashwin">Ashwin</option>
                                    <option value="Naren">Naren</option>
                                    <option value="Sandeep">Sandeep</option>
                                    <option value="Coni">Coni</option>
                                    <option value="Nikhil">Nikhil</option>
                                    <option value="NS">NS</option>
                                    <option value="Aditya">Aditya</option>
                                    <option value="Viraj">Viraj</option>
                                    <option value="Shridhar">Shridhar</option>
                                    <option value="Nazar">Nazar</option>
                                    <option value="Omkar">Omkar</option>
                                    <option value="Akshay">Akshay</option>
                                    <option value="OC1">OC1</option>
                                    <option value="OC2">OC2</option>
                                    <option value="OC3">OC3</option>
                                </select>
                            </div>

                            <!-- Stage — multi assign -->
                            <div class="p-3 border border-green-200 rounded-lg" style="background:rgba(240,253,244,0.7)">
                                <div class="flex items-center mb-2">
                                    <i class="fas fa-volume-up text-green-600 mr-2 text-xs"></i>
                                    <span class="text-sm font-semibold text-green-800">Stage</span>
                                    <span class="text-xs text-green-400 ml-2">multi assign</span>
                                </div>
                                <div class="stage-crew-grid">
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Ashwin" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Ashwin</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Naren" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Naren</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Sandeep" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Sandeep</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Coni" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Coni</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Nikhil" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Nikhil</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="NS" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">NS</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Aditya" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Aditya</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Viraj" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Viraj</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Shridhar" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Shridhar</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Nazar" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Nazar</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Omkar" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Omkar</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="Akshay" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">Akshay</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="OC1" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">OC1</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="OC2" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">OC2</span>
                                    </label>
                                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">
                                        <input type="checkbox" value="OC3" class="crew-checkbox stage-checkbox">
                                        <span class="text-sm">OC3</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                    <!-- Crew propagation row — shown only when sibling events exist -->
                    <div id="editCrewPropagateRow"
                         class="p-3 rounded-lg border border-amber-200 mt-2"
                         style="display:none; background:rgba(255,251,235,0.85)">
                        <label class="flex items-center gap-2 cursor-pointer text-sm font-medium" style="color:#92400e">
                            <input type="checkbox" id="editPropagateCrew" class="rounded">
                            <span id="editPropagateLabel">Apply crew to all other dates of this show</span>
                        </label>
                        <p class="text-xs mt-1 ml-5" style="color:#b45309">Only crew fields are updated — call times, notes, and other details stay independent per date.</p>
                    </div>
                    <div class="flex justify-end space-x-3 mt-6">
                        <button type="button" onclick="closeEditEventModal()" class="modal-img-btn" aria-label="Cancel">
                            <img src="/static/images/buttons/cancel.png" alt="Cancel" class="modal-img">
                        </button>
                        <button type="submit" class="modal-img-btn" aria-label="Save Changes">
                            <img src="/static/images/buttons/save-changes.png" alt="Save Changes" class="modal-img">
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Delete Confirmation Modal -->
        <div id="deleteConfirmModal" class="modal">
            <div class="modal-content" style="max-width: 400px;">
                <h2 class="text-xl font-bold mb-4" style="color: #2d3338;">Delete Event</h2>
                <p class="text-gray-700 mb-6" id="deleteConfirmMessage">Are you sure you want to delete this event?</p>
                <div class="flex justify-end space-x-3">
                    <button type="button" onclick="closeDeleteConfirm()" class="modal-img-btn" aria-label="Cancel">
                        <img src="/static/images/buttons/cancel.png" alt="Cancel" class="modal-img">
                    </button>
                    <button type="button" id="deleteConfirmBtn" class="modal-img-btn" aria-label="Delete">
                        <img src="/static/images/buttons/delete.png" alt="Delete" class="modal-img">
                    </button>
                </div>
            </div>
        </div>

        <!-- WhatsApp Export Modal -->
        <div id="whatsappExportModal" class="modal">
            <div class="modal-content" style="max-width: 600px;">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">
                        <i class="fab fa-whatsapp mr-2"></i>Export for WhatsApp
                    </h2>
                    <button onclick="closeWhatsAppExportModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                
                <div class="space-y-4 mb-6">
                    <p class="text-gray-600">Select a time range to export events:</p>
                    <div class="grid grid-cols-2 gap-3">
                        <button onclick="exportTomorrow()" class="btn-primary px-4 py-3 transition-all">
                            <i class="fas fa-calendar-day mr-2"></i>Tomorrow
                        </button>
                        <button onclick="exportThisWeek()" class="btn-primary px-4 py-3 transition-all">
                            <i class="fas fa-calendar-week mr-2"></i>This Week
                        </button>
                        <button onclick="exportNextWeek()" class="btn-primary px-4 py-3 transition-all">
                            <i class="fas fa-calendar-plus mr-2"></i>Next Week
                        </button>
                        <button onclick="exportCustomDate()" class="px-4 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all">
                            <i class="fas fa-calendar-alt mr-2"></i>Custom Date
                        </button>
                    </div>
                </div>
                
                <div id="customDatePicker" style="display: none;" class="mb-6">
                    <label class="block text-sm font-medium text-gray-700 mb-2">Select Date:</label>
                    <input type="date" id="customDateInput" class="w-full px-4 py-2 border border-gray-300 rounded-lg">
                    <button onclick="exportSelectedDate()" class="btn-primary mt-3 w-full px-4 py-2">
                        Generate Export
                    </button>
                </div>
                
                <div id="exportPreview" style="display: none;">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="font-semibold text-gray-700">Preview:</h3>
                        <button onclick="copyToClipboard()" class="btn-primary px-4 py-2">
                            <i class="fas fa-copy mr-2"></i>Copy to Clipboard
                        </button>
                    </div>
                    <textarea id="exportText" readonly class="w-full h-64 p-4 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"></textarea>
                </div>
            </div>
        </div>

        <!-- CSV Export Modal -->
        <div id="csvExportModal" class="modal">
            <div class="modal-content" style="max-width: 500px;">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">
                        <i class="fas fa-file-download mr-2"></i>Export Events
                    </h2>
                    <button onclick="closeCSVExportModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                
                <div class="space-y-4">
                    <p class="text-gray-600">Select month to export:</p>
                    
                    <div class="grid grid-cols-1 gap-3">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Month:</label>
                            <select id="csvExportMonth" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                                <option value="1">January</option>
                                <option value="2">February</option>
                                <option value="3">March</option>
                                <option value="4">April</option>
                                <option value="5">May</option>
                                <option value="6">June</option>
                                <option value="7">July</option>
                                <option value="8">August</option>
                                <option value="9">September</option>
                                <option value="10">October</option>
                                <option value="11">November</option>
                                <option value="12">December</option>
                            </select>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">Year:</label>
                            <select id="csvExportYear" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                                <option value="2024">2024</option>
                                <option value="2025" selected>2025</option>
                                <option value="2026">2026</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="space-y-2">
                        <p class="text-sm font-medium text-gray-700 mb-2">Export Format:</p>
                        <div class="grid grid-cols-3 gap-2">
                            <button onclick="generateCSVExport()" 
                                    class="px-3 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-all text-sm">
                                <i class="fas fa-file-csv mr-1"></i>CSV
                            </button>
                            <button onclick="generateExcelExport()" 
                                    class="px-3 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all text-sm">
                                <i class="fas fa-file-excel mr-1"></i>Excel
                            </button>
                            <button onclick="generateICalendarExport()" 
                                    class="px-3 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all text-sm">
                                <i class="fas fa-calendar mr-1"></i>Calendar
                            </button>
                        </div>
                        <p class="text-xs text-gray-500 mt-2">
                            <i class="fas fa-info-circle mr-1"></i>
                            Use <strong>Calendar</strong> (.ics) for Google Calendar, Apple Calendar, Outlook
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Short Notice Report Modal -->
        <div id="shortNoticeModal" class="modal">
            <div class="modal-content" style="max-width: 520px;">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #FF6B35;">
                        <i class="fas fa-clock mr-2"></i>Short Notice Report
                    </h2>
                    <button onclick="closeShortNoticeModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <p class="text-sm text-gray-500 mb-4">
                    Exports manually-entered shows in the selected range.
                    Only shows entered via <em>Add Show</em> with <strong class="text-red-600">fewer than 14 days</strong> notice are included. Bulk imports are excluded.
                </p>
                <div class="flex gap-2 mb-5">
                    <button id="snr-tab-month" onclick="snrSetMode('month')"
                            class="flex-1 px-3 py-2 text-sm rounded-lg border border-orange-400 bg-orange-500 text-white transition-all">
                        Single Month
                    </button>
                    <button id="snr-tab-range" onclick="snrSetMode('range')"
                            class="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-all">
                        Month Range
                    </button>
                </div>
                <div id="snr-panel-month" class="space-y-3">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Month:</label>
                    <input type="month" id="snrMonth"
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                </div>
                <div id="snr-panel-range" class="space-y-3" style="display:none;">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">From Month:</label>
                        <input type="month" id="snrStart"
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                    </div>
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">To Month:</label>
                        <input type="month" id="snrEnd"
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500">
                    </div>
                </div>
                <div class="mt-5 flex gap-3">
                    <button onclick="downloadShortNoticeReport()"
                            class="flex-1 px-4 py-2.5 text-sm text-white rounded-lg"
                            style="background-color: #FF6B35;">
                        <i class="fas fa-download mr-2"></i>Download CSV
                    </button>
                    <button onclick="closeShortNoticeModal()"
                            class="px-4 py-2.5 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                        Cancel
                    </button>
                </div>
            </div>
        </div>

        <!-- AI Assistant Floating Button -->
        <!-- (Removed) Floating Ask AI button — Ask AI is in top toolbar -->

        <!-- AI Assistant Modal -->
<div id="aiAssistantModal" class="modal">
             <div class="modal-content" style="max-width: 700px;">
                 <div class="flex justify-between items-center mb-4">
                     <h2 class="text-2xl font-bold" style="color: #2d3338;">
                         <i class="fas fa-robot mr-2"></i>Ask AI
                     </h2>
                     <button onclick="closeAIAssistant()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                 </div>
                 
                  <div class="mb-6">
                      <p class="text-gray-400 italic mb-4">Search your events using natural language. Ask anything about dates, venues, crew, or availability.</p>
                      
                      <div class="flex space-x-2">
                          <input type="text" id="aiQueryInput" placeholder="Ask a question about your events..." 
                                 class="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]"
                                 onkeypress="if(event.key==='Enter') askAI()">
                          <button onclick="askAI()" class="btn-primary px-6 py-3">
                              <i class="fas fa-paper-plane"></i>
                          </button>
                      </div>
                  </div>
                 
                  <div id="aiResponse" style="display: none;">
                      <div class="bg-gray-50 rounded-lg p-4 mb-4">
                          <div class="flex items-center justify-between mb-2">
                              <div class="flex items-center">
                                  <div class="loading mr-2" id="aiLoading" style="display: none;"></div>
                                  <h3 class="font-semibold text-gray-700">Response:</h3>
                              </div>
                              <button onclick="clearAIResults()" class="text-sm px-3 py-1.5 rounded-lg transition-colors" style="background:rgba(152,162,215,0.12);color:#465080;" onmouseover="this.style.background='rgba(152,162,215,0.22)'" onmouseout="this.style.background='rgba(152,162,215,0.12)'">
                                  Clear Results
                              </button>
                          </div>
                          <p id="aiExplanation" class="text-gray-600 mb-3"></p>
                          <div id="aiResultsContainer" class="overflow-x-auto"></div>
                      </div>
                  </div>
             </div>
         </div>

        <script>
          // Early Safari test - runs before any libraries load
          console.log('🔍 Early test: JavaScript is running!');
          console.log('🔍 Browser:', navigator.userAgent.includes('Safari') ? 'Safari' : 'Other');
          
          // Test if we can access basic DOM
          document.addEventListener('DOMContentLoaded', function() {
            console.log('✅ DOMContentLoaded fired successfully');
            console.log('✅ Body element:', document.body ? 'Found' : 'Not found');
          });
        </script>
        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js" crossorigin="anonymous"></script>
        <!-- Login Modal -->
        <div id="loginModal" class="modal">
            <div class="modal-content max-w-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">Login</h2>
                    <button onclick="closeLoginModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <form id="loginForm" onsubmit="handleLogin(event)">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input type="email" id="loginEmail" required 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Password</label>
                        <input type="password" id="loginPassword" required 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                    </div>
                    <div id="loginError" class="mb-4 ncpa-status ncpa-status--error" style="display: none;"></div>
                    <div class="flex gap-3">
                        <button type="submit" class="btn-primary flex-1 px-4 py-2 transition-all">
                            Login
                        </button>
                        <button type="button" onclick="openSignupModal()" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all">
                            Sign Up
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Signup Modal -->
        <div id="signupModal" class="modal">
            <div class="modal-content max-w-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">Sign Up</h2>
                    <button onclick="closeSignupModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <p class="text-sm text-gray-600 mb-4">Your account will require admin approval before you can login.</p>
                <form id="signupForm" onsubmit="handleSignup(event)">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input type="email" id="signupEmail" required 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Password</label>
                        <input type="password" id="signupPassword" required minlength="6"
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                        <p class="text-xs text-gray-500 mt-1">Minimum 6 characters</p>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
                        <input type="password" id="signupPasswordConfirm" required 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                    </div>
                    <div id="signupError" class="mb-4 ncpa-status ncpa-status--error" style="display: none;"></div>
                    <div id="signupSuccess" class="mb-4 ncpa-status ncpa-status--success" style="display: none;"></div>
                    <div class="flex gap-3">
                        <button type="submit" class="btn-primary flex-1 px-4 py-2 transition-all">
                            Sign Up
                        </button>
                        <button type="button" onclick="openLoginModal()" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all">
                            Back to Login
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Change Password Modal -->
        <div id="changePasswordModal" class="modal">
            <div class="modal-content max-w-md">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">Change Password</h2>
                    <button onclick="closeChangePasswordModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <form id="changePasswordForm" onsubmit="handleChangePassword(event)">
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Current Password</label>
                        <input type="password" id="currentPassword" required 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">New Password</label>
                        <input type="password" id="newPassword" required minlength="6"
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Confirm New Password</label>
                        <input type="password" id="newPasswordConfirm" required 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#98A2D7]">
                    </div>
                    <div id="changePasswordError" class="mb-4 ncpa-status ncpa-status--error" style="display: none;"></div>
                    <div id="changePasswordSuccess" class="mb-4 ncpa-status ncpa-status--success" style="display: none;"></div>
                    <div class="flex gap-3">
                        <button type="submit" class="btn-primary flex-1 px-4 py-2 transition-all">
                            Change Password
                        </button>
                        <button type="button" onclick="closeChangePasswordModal()" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-all">
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Admin Panel Modal -->
        <div id="adminPanelModal" class="modal">
            <div class="modal-content max-w-2xl">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">
                        <i class="fas fa-users-cog mr-2"></i>Admin Panel
                    </h2>
                    <button onclick="closeAdminPanel()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <div id="adminPanelContent">
                    <div class="text-center py-8">
                        <i class="fas fa-spinner fa-spin text-3xl text-gray-400"></i>
                        <p class="mt-3 text-gray-600">Loading pending approvals...</p>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js" crossorigin="anonymous"></script>
        <script src="https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js" crossorigin="anonymous"></script>
        <script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js" crossorigin="anonymous"></script>
        <script src="/static/app.js?v=4.2.7"></script>
        <script src="/static/v41-features.js?v=4.2.1"></script>
        <script src="/static/auth.js?v=1.0.0"></script>
    </body>
    </html>
  `)
})

export default app
