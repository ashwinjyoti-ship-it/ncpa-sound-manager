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

// Delete event
app.delete('/api/events/:id', async (c) => {
  try {
    const id = c.req.param('id')
    
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
    const { month, year } = body
    
    if (!month || !year) {
      return c.json({ success: false, error: 'Month and year are required' }, 400)
    }
    
    // Calculate date range for the month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate() // Last day of month
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    
    // Count events first
    const countResult = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM events 
      WHERE event_date >= ? AND event_date <= ?
    `).bind(startDate, endDate).first()
    
    const count = countResult?.count || 0
    
    if (count === 0) {
      return c.json({ success: true, deleted: 0, message: 'No events found for this month' })
    }
    
    // Delete events
    await c.env.DB.prepare(`
      DELETE FROM events 
      WHERE event_date >= ? AND event_date <= ?
    `).bind(startDate, endDate).run()
    
    return c.json({ 
      success: true, 
      deleted: count,
      message: `Deleted ${count} events from ${startDate} to ${endDate}` 
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
            button {
              min-height: 44px;
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
                        <button onclick="toggleAIAssistant()" class="btn-glass px-3 py-1.5 text-xs">
                            <i class="fas fa-robot mr-1"></i>Ask AI
                        </button>
                    </div>
                    <div class="flex justify-end">
                        <button onclick="openAddShowModal()" class="btn-primary px-3 py-1.5 text-xs font-semibold">
                            <i class="fas fa-plus mr-1"></i>Add Show
                        </button>
                    </div>
                </div>
                
                
                
                <!-- DESKTOP: Full toolbar with all features -->
                <div class="hidden md:block">
                    <div class="flex flex-wrap justify-between items-center gap-y-2 mb-4 md:mb-6">
                        <!-- Left: Tab navigation -->
                        <div class="flex shrink-0 p-1 rounded-xl" style="background:rgba(120,120,128,0.10);gap:2px;">
                            <button id="calendarTab" class="px-3 py-1.5 text-sm font-semibold tab-active rounded-lg transition-all" onclick="showTab('calendar')">
                                <i class="fas fa-calendar-alt mr-1.5"></i>Calendar
                            </button>
                            <button id="tableTab" class="px-3 py-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 rounded-lg transition-all" onclick="showTab('table')">
                                <i class="fas fa-table mr-1.5"></i>Table
                            </button>
                            <button id="crewTab" class="px-3 py-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 rounded-lg transition-all" onclick="showTab('crew')">
                                <i class="fas fa-users mr-1.5"></i>Crew
                            </button>
                        </div>

                        <!-- Center: Ask AI button -->
                        <div class="flex items-center shrink-0">
                            <button onclick="toggleAIAssistant()"
                                    class="btn-primary px-4 py-2 text-sm transition-all shadow-md hover:shadow-lg">
                                <i class="fas fa-robot mr-1.5"></i>Ask AI
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
                            <button onclick="openAddShowModal()"
                                    class="btn-primary px-3 py-2 text-sm transition-all">
                                <i class="fas fa-plus mr-1.5"></i>Add Show
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Calendar View -->
                <div id="calendarView" class="rounded-2xl glass-card overflow-y-auto max-h-[calc(100vh-240px)] md:max-h-[calc(100vh-180px)]">
                    <!-- Sticky header: month controls + days-of-week (desktop only) -->
                    <div class="sticky top-0 z-10 p-3 md:p-6 pb-0 md:pb-0 hidden md:block" style="background:rgba(255,255,255,0.70);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);">
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
                    <div class="p-3 md:p-6 pt-2 md:pt-2 hidden md:block">
                        <div id="calendarGrid" class="grid grid-cols-7 gap-1 md:gap-2"></div>
                    </div>

                    <!-- Mobile week-agenda view (hidden on desktop) -->
                    <div id="mobileCalendarView" class="md:hidden">
                        <!-- Sticky week nav -->
                        <div class="sticky top-0 z-10 mb-3 px-1 py-2 flex justify-between items-center" style="background:rgba(255,255,255,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);">
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
                            <button onclick="changeMonth(1)" class="px-3 py-2 text-sm md:text-base rounded-xl touch-manipulation" style="background-color: rgba(168,195,160,0.22); color: #2d3338;">
                                <span class="hidden md:inline">Next </span><i class="fas fa-chevron-right"></i>
                            </button>
                        </div>

                        <!-- Calendar grid header -->
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
                    <!-- Scrollable desktop calendar grid -->
                    <div class="hidden md:block p-3 md:p-6 pt-2 md:pt-2">
                        <div id="calendarGrid" class="grid grid-cols-7 gap-1 md:gap-2"></div>
                    </div>

                    <!-- MOBILE: Week Agenda View -->
                    <div id="mobileCalendarView" class="md:hidden">
                        <!-- Sticky week nav -->
                        <div class="sticky top-0 z-10 mb-3 px-3 py-2 flex justify-between items-center" style="background:rgba(255,255,255,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid rgba(173,179,184,0.12);">
                            <button id="mobilePrevWeek" class="btn-glass px-3 py-1.5 text-sm">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <div class="flex items-center gap-2">
                                <span id="mobileWeekLabel" class="text-sm font-semibold text-gray-700">1 – 7 Jun 2026</span>
                                <button id="mobileTodayBtn" class="hidden text-xs px-2 py-1 rounded-full font-medium" style="background:rgba(152,162,215,0.18);color:#465080;">Today</button>
                            </div>
                            <button id="mobileNextWeek" class="btn-glass px-3 py-1.5 text-sm">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                        <!-- Week events list -->
                        <div id="mobileWeekEvents" class="space-y-5 pb-6 px-3"></div>
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
                            </select>
                            <button onclick="bulkDeleteEvents()" class="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all flex items-center">
                                <i class="fas fa-trash mr-1.5"></i>Delete Month
                            </button>
                        </div>
                        <div id="bulkDeleteStatus" class="text-sm text-gray-600"></div>
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
            <div class="modal-content">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #2d3338;">Event Details</h2>
                    <button onclick="closeEventModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <div id="eventModalContent"></div>
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
                                <div class="grid grid-cols-3 gap-1 max-h-40 overflow-y-auto">
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
                        <button type="button" onclick="closeEditEventModal()"
                                class="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400">
                            Cancel
                        </button>
                        <button type="submit" class="btn-primary px-6 py-2">
                            Save Changes
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
                    <button onclick="closeDeleteConfirm()" 
                            class="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400">
                        Cancel
                    </button>
                    <button id="deleteConfirmBtn" 
                            class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                        Delete
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
        <button id="aiAssistantBtn" onclick="toggleAIAssistant()"
                class="btn-primary fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-40">
            <i class="fas fa-robot text-xl"></i>
        </button>

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
                    <div id="loginError" class="mb-4 text-red-600 text-sm" style="display: none;"></div>
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
                    <div id="signupError" class="mb-4 text-red-600 text-sm" style="display: none;"></div>
                    <div id="signupSuccess" class="mb-4 text-green-600 text-sm" style="display: none;"></div>
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
                    <div id="changePasswordError" class="mb-4 text-red-600 text-sm" style="display: none;"></div>
                    <div id="changePasswordSuccess" class="mb-4 text-green-600 text-sm" style="display: none;"></div>
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
        <script src="/static/app.js?v=4.2.0"></script>
        <script src="/static/v41-features.js?v=4.2.0"></script>
        <script src="/static/auth.js?v=1.0.0"></script>
    </body>
    </html>
  `)
})

export default app
