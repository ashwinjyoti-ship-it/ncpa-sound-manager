import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for all API routes
app.use('/api/*', cors())

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

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

// Search events (MUST be before /:id route)
app.get('/api/events/search', async (c) => {
  try {
    const query = c.req.query('q')
    
    if (!query) {
      return c.json({ success: false, error: 'Search query required' }, 400)
    }
    
    const searchTerm = `%${query}%`
    
    const { results } = await c.env.DB.prepare(`
      SELECT * FROM events 
      WHERE program LIKE ? 
         OR venue LIKE ? 
         OR team LIKE ?
         OR crew LIKE ?
         OR sound_requirements LIKE ?
      ORDER BY event_date DESC
      LIMIT 50
    `).bind(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm).all()
    
    return c.json({ success: true, data: results })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Get single event
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
    const { event_date, program, venue, team, sound_requirements, call_time, crew } = body
    
    if (!event_date || !program || !venue) {
      return c.json({ success: false, error: 'Date, program, and venue are required' }, 400)
    }
    
    // Check if sound_requirements is filled
    const requirements_updated = sound_requirements && sound_requirements.trim() !== '' ? 1 : 0
    
    const result = await c.env.DB.prepare(`
      INSERT INTO events (event_date, program, venue, team, sound_requirements, call_time, crew, requirements_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      event_date,
      program,
      venue,
      team || null,
      sound_requirements || null,
      call_time || null,
      crew || null,
      requirements_updated
    ).run()
    
    return c.json({ 
      success: true, 
      data: { 
        id: result.meta.last_row_id,
        event_date,
        program,
        venue,
        team,
        sound_requirements,
        call_time,
        crew,
        requirements_updated
      }
    }, 201)
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

// Update event
app.put('/api/events/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { event_date, program, venue, team, sound_requirements, call_time, crew } = body
    
    // Check if sound_requirements is filled
    const requirements_updated = sound_requirements && sound_requirements.trim() !== '' ? 1 : 0
    
    await c.env.DB.prepare(`
      UPDATE events 
      SET event_date = ?,
          program = ?,
          venue = ?,
          team = ?,
          sound_requirements = ?,
          call_time = ?,
          crew = ?,
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
      crew || null,
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

// Bulk upload events (for CSV import)
app.post('/api/events/bulk', async (c) => {
  try {
    const body = await c.req.json()
    const { events } = body
    
    if (!Array.isArray(events) || events.length === 0) {
      return c.json({ success: false, error: 'Events array is required' }, 400)
    }
    
    // Insert all events in a transaction-like batch
    const results = []
    for (const event of events) {
      const { event_date, program, venue, team, sound_requirements, call_time, crew } = event
      
      if (!event_date || !program || !venue) {
        continue // Skip invalid events
      }
      
      const requirements_updated = sound_requirements && sound_requirements.trim() !== '' ? 1 : 0
      
      const result = await c.env.DB.prepare(`
        INSERT INTO events (event_date, program, venue, team, sound_requirements, call_time, crew, requirements_updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        event_date,
        program,
        venue,
        team || null,
        sound_requirements || null,
        call_time || null,
        crew || null,
        requirements_updated
      ).run()
      
      results.push({ id: result.meta.last_row_id, ...event })
    }
    
    return c.json({ 
      success: true, 
      message: `${results.length} events uploaded successfully`,
      data: results
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

// AI Query endpoint - Natural language to SQL conversion
app.post('/api/ai/query', async (c) => {
  try {
    const body = await c.req.json()
    const { query } = body
    
    if (!query) {
      return c.json({ success: false, error: 'Query is required' }, 400)
    }
    
    // Get API key from environment
    const apiKey = c.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return c.json({ success: false, error: 'AI service not configured' }, 500)
    }
    
    // Get sample events to provide context
    const sampleEvents = await c.env.DB.prepare(`
      SELECT * FROM events ORDER BY event_date DESC LIMIT 5
    `).all()
    
    // Call Anthropic Claude API to convert natural language to SQL
    const prompt = `You are a SQL query generator for an events database. The database has the following schema:

Table: events
Columns:
- id (INTEGER PRIMARY KEY)
- event_date (DATE) - format: YYYY-MM-DD
- program (TEXT) - event/program name
- venue (TEXT) - venue name (e.g., "Tata Theatre", "Experimental Theatre")
- team (TEXT) - curator team name
- sound_requirements (TEXT) - technical requirements
- call_time (TEXT) - when crew should arrive
- crew (TEXT) - crew member names
- requirements_updated (BOOLEAN) - 1 if sound requirements filled, 0 if empty
- created_at (DATETIME)
- updated_at (DATETIME)

Sample data:
${JSON.stringify(sampleEvents.results, null, 2)}

User query: "${query}"

Generate a SQL SELECT query to answer this question. Return ONLY the SQL query, nothing else. The query should:
1. Use SQLite syntax
2. Always include ORDER BY clause for consistent results
3. Use appropriate WHERE clauses
4. Limit results to 50 rows maximum
5. Use date comparisons with DATE() function for date fields

SQL Query:`
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    })
    
    if (!response.ok) {
      const error = await response.text()
      console.error('Anthropic API error:', error)
      return c.json({ success: false, error: 'AI query failed' }, 500)
    }
    
    const aiResult = await response.json()
    const sqlQuery = aiResult.content[0].text.trim()
    
    console.log('Generated SQL:', sqlQuery)
    
    // Execute the generated SQL query
    const { results } = await c.env.DB.prepare(sqlQuery).all()
    
    return c.json({ 
      success: true,
      query: sqlQuery,
      data: results,
      explanation: `Found ${results.length} matching events`
    })
    
  } catch (error: any) {
    console.error('AI query error:', error)
    return c.json({ success: false, error: error.message }, 500)
  }
})

// AI-powered Word document parser
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
    
    const prompt = `You are parsing an NCPA Sound Crew event schedule document. Extract ALL events from this document and return them as a JSON array.

Document text:
${text}${contextHint}

Parse ALL events and extract the following fields for EACH event:
- event_date: Date in YYYY-MM-DD format (extract from "Day & Date" column or date information)
- program: Full program/event name (from "Programme" or "Event" column)
- venue: Venue name (e.g., "Tata Theatre", "Experimental Theatre", "Jamshed Bhabha Theatre", "Little Theatre")
- team: Curator/team name if mentioned
- sound_requirements: Technical sound requirements (look for microphones, speakers, playback, recording, etc.)
- call_time: Call time for sound crew (prioritize times labeled "Sound" > "Tech" > "AC/Lights" > any utility times)
- crew: Crew member names assigned to the event

IMPORTANT INSTRUCTIONS:
1. Extract ALL events from the document - don't skip any
2. For dates: Look for day names (Monday, Tuesday, etc.) and dates (1, 2, 3, etc.) - combine them with month/year context
3. For call_time: Prioritize in this order:
   - Times explicitly labeled "Sound" or "Sound Call"
   - Times labeled "Tech" or "Technical"
   - Times labeled as utility work like "AC", "Lights", "Setup"
   - General call times
4. For sound_requirements: Extract ANY technical information related to audio/sound
5. If a field is not found or unclear, use empty string ""
6. Handle various document formats - don't rely on specific headers
7. Parse tables, lists, or any structured format

Return ONLY a JSON array of events, nothing else. Format:
[
  {
    "event_date": "2025-01-15",
    "program": "Classical Music Concert",
    "venue": "Tata Theatre",
    "team": "Indian Music",
    "sound_requirements": "4 mics, playback system",
    "call_time": "16:00",
    "crew": "Ashwin, Rohan"
  }
]

If no events are found or parsing fails, return an empty array: []`
    
    console.log('Sending Word document to Claude for parsing...')
    
    // For large documents, we need to handle them carefully
    console.log(`Processing document: ${text.length} characters`)
    
    // If document is too large (>15k chars), truncate with warning
    // Anthropic has input limits, and we want fast responses
    let processedText = text
    let truncated = false
    if (text.length > 15000) {
      processedText = text.substring(0, 15000)
      truncated = true
      console.warn(`Document truncated from ${text.length} to 15000 characters`)
    }
    
    // Rebuild prompt with processed text
    const finalPrompt = `You are parsing an NCPA Sound Crew event schedule document. Extract ALL events from this document and return them as a JSON array.

Document text:
${processedText}${contextHint}

Parse ALL events and extract the following fields for EACH event:
- event_date: Date in YYYY-MM-DD format (extract from "Day & Date" column or date information)
- program: Full program/event name (from "Programme" or "Event" column)
- venue: Venue name (e.g., "Tata Theatre", "Experimental Theatre", "Jamshed Bhabha Theatre", "Little Theatre")
- team: Curator/team name if mentioned (often in brackets like [Dr.Swapno/Team])
- sound_requirements: Technical sound requirements (look for microphones, speakers, playback, recording, etc.)
- call_time: Call time for sound crew (prioritize times labeled "Sound" > "Tech" > "Technical setup" > "AC/Lights" > any utility times)
- crew: Crew member names assigned to the event

IMPORTANT INSTRUCTIONS:
1. Extract ALL events from the document - don't skip any
2. For dates: Look for day names (Monday, Tuesday, etc.) and dates (Thu 4th, Fri 5th, etc.) - combine them with month/year context
3. For call_time: Prioritize in this order:
   - Times explicitly labeled "Sound" or "Sound Call" or "Sound Requirements:"
   - Times labeled "Tech" or "Technical" or "Technical setup:"
   - Times labeled as utility work like "AC", "Lights", "Setup"
   - General call times
4. For sound_requirements: Extract ANY technical information related to audio/sound (mics, speakers, recording, playback, etc.)
5. If a field is not found or unclear, use empty string ""
6. Handle various document formats - don't rely on specific headers
7. Parse tables, lists, or any structured format

Return ONLY a JSON array of events, nothing else. Format:
[
  {
    "event_date": "2025-09-04",
    "program": "Classical Music Concert",
    "venue": "Tata Theatre",
    "team": "Indian Music",
    "sound_requirements": "4 mics, playback system",
    "call_time": "16:00",
    "crew": "Ashwin, Rohan"
  }
]

If no events are found or parsing fails, return an empty array: []`
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4096, // Maximum for Haiku model
        messages: [{
          role: 'user',
          content: finalPrompt
        }]
      })
    })
    
    if (!response.ok) {
      const error = await response.text()
      console.error('Anthropic API error:', error)
      return c.json({ success: false, error: 'AI parsing service failed' }, 500)
    }
    
    const aiResult = await response.json()
    const aiResponse = aiResult.content[0].text.trim()
    
    console.log('AI Response:', aiResponse)
    
    // Parse JSON response from Claude
    let events = []
    try {
      // Extract JSON array from response (in case there's extra text)
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        events = JSON.parse(jsonMatch[0])
      } else {
        // Try parsing the whole response
        events = JSON.parse(aiResponse)
      }
      
      // Validate and clean events
      events = events.filter(event => {
        return event.event_date && event.program && event.venue
      })
      
      console.log(`Successfully parsed ${events.length} events`)
      
    } catch (parseError: any) {
      console.error('Failed to parse AI response as JSON:', parseError)
      return c.json({ 
        success: false, 
        error: 'AI returned invalid format. Please try again or use CSV upload.' 
      }, 500)
    }
    
    let message = `Found ${events.length} events in document`
    if (truncated) {
      message += ` (document was truncated - some events may be missing, consider using CSV upload for large files)`
    }
    
    return c.json({ 
      success: true,
      events: events,
      message: message,
      truncated: truncated
    })
    
  } catch (error: any) {
    console.error('Word parsing error:', error)
    return c.json({ success: false, error: error.message || 'Failed to parse document' }, 500)
  }
})

// ============================================
// FRONTEND ROUTES
// ============================================

app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NCPA Sound Crew - Event Schedule & Technical Dashboard</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: #f9f7f4;
          }
          
          .tab-active {
            border-bottom: 3px solid #8B4513;
            color: #8B4513;
          }
          
          .event-card-green {
            background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            border-left: 4px solid #28a745;
          }
          
          .event-card-peach {
            background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
            border-left: 4px solid #ffc107;
          }
          
          .calendar-day {
            min-height: 120px;
            border: 1px solid #e0e0e0;
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
            background-color: rgba(0,0,0,0.5);
          }
          
          .modal.active {
            display: flex;
            align-items: center;
            justify-content: center;
          }
          
          .modal-content {
            background-color: #fefefe;
            padding: 30px;
            border-radius: 12px;
            max-width: 700px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          }
          
          table th {
            position: sticky;
            top: 0;
            background-color: #8B4513;
            color: white;
            z-index: 10;
          }
          
          .editable-cell {
            cursor: text;
            min-width: 100px;
          }
          
          .editable-cell:hover {
            background-color: #f0f0f0;
          }
          
          .editable-cell input,
          .editable-cell textarea {
            width: 100%;
            border: 1px solid #ddd;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 14px;
          }
          
          .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(139, 69, 19, 0.3);
            border-radius: 50%;
            border-top-color: #8B4513;
            animation: spin 1s ease-in-out infinite;
          }
          
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        </style>
    </head>
    <body class="bg-gray-50">
        <div class="min-h-screen">
            <!-- Header -->
            <header class="bg-white shadow-md">
                <div class="container mx-auto px-6 py-4">
                    <h1 class="text-3xl font-bold text-center" style="color: #8B4513;">
                        <i class="fas fa-music mr-2"></i>
                        NCPA Sound Crew
                    </h1>
                    <p class="text-center text-gray-600 mt-1">Event Schedule & Technical Dashboard</p>
                </div>
            </header>

            <!-- Tab Navigation -->
            <div class="container mx-auto px-6 py-4">
                <div class="flex justify-between items-center mb-6">
                    <div class="flex space-x-6 border-b border-gray-300">
                        <button id="calendarTab" class="px-4 py-2 font-semibold tab-active transition-all" onclick="showTab('calendar')">
                            <i class="fas fa-calendar-alt mr-2"></i>Calendar
                        </button>
                        <button id="tableTab" class="px-4 py-2 font-semibold text-gray-600 hover:text-gray-800 transition-all" onclick="showTab('table')">
                            <i class="fas fa-table mr-2"></i>Table
                        </button>
                    </div>
                    
                    <div class="flex space-x-3">
                        <!-- Search -->
                        <div class="relative">
                            <input type="text" id="searchInput" placeholder="Search events..." 
                                   class="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600 w-64">
                            <i class="fas fa-search absolute right-3 top-3 text-gray-400"></i>
                        </div>
                        
                        <!-- WhatsApp Export -->
                        <button onclick="openWhatsAppExportModal()" 
                                class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all">
                            <i class="fab fa-whatsapp mr-2"></i>Export
                        </button>
                        
                        <!-- Word Upload -->
                        <button onclick="document.getElementById('wordInput').click()" 
                                class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all">
                            <i class="fas fa-file-word mr-2"></i>Upload Word
                        </button>
                        <input type="file" id="wordInput" accept=".doc,.docx" style="display: none;" onchange="handleWordUpload(event)">
                        
                        <!-- CSV Upload -->
                        <button onclick="document.getElementById('csvInput').click()" 
                                class="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-all">
                            <i class="fas fa-file-csv mr-2"></i>Upload CSV
                        </button>
                        <input type="file" id="csvInput" accept=".csv" style="display: none;" onchange="handleCSVUpload(event)">
                        
                        <!-- Add Show -->
                        <button onclick="openAddShowModal()" 
                                class="px-4 py-2 text-white rounded-lg hover:opacity-90 transition-all" 
                                style="background-color: #8B4513;">
                            <i class="fas fa-plus mr-2"></i>Add Show
                        </button>
                    </div>
                </div>

                <!-- Calendar View -->
                <div id="calendarView" class="bg-white rounded-lg shadow-lg p-6">
                    <!-- Calendar controls -->
                    <div class="flex justify-between items-center mb-6">
                        <button onclick="changeMonth(-1)" class="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
                            <i class="fas fa-chevron-left"></i> Previous
                        </button>
                        <h2 id="currentMonthYear" class="text-2xl font-bold" style="color: #8B4513;"></h2>
                        <button onclick="changeMonth(1)" class="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">
                            Next <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                    
                    <!-- Calendar grid -->
                    <div class="grid grid-cols-7 gap-2">
                        <div class="font-bold text-center py-2 bg-gray-100">Sun</div>
                        <div class="font-bold text-center py-2 bg-gray-100">Mon</div>
                        <div class="font-bold text-center py-2 bg-gray-100">Tue</div>
                        <div class="font-bold text-center py-2 bg-gray-100">Wed</div>
                        <div class="font-bold text-center py-2 bg-gray-100">Thu</div>
                        <div class="font-bold text-center py-2 bg-gray-100">Fri</div>
                        <div class="font-bold text-center py-2 bg-gray-100">Sat</div>
                    </div>
                    <div id="calendarGrid" class="grid grid-cols-7 gap-2 mt-2"></div>
                </div>

                <!-- Table View -->
                <div id="tableView" class="bg-white rounded-lg shadow-lg p-6" style="display: none;">
                    <div class="overflow-auto" style="max-height: 70vh;">
                        <table class="w-full border-collapse">
                            <thead>
                                <tr style="background-color: #8B4513;">
                                    <th class="px-4 py-3 text-left text-white font-semibold">Date</th>
                                    <th class="px-4 py-3 text-left text-white font-semibold">Program/Event</th>
                                    <th class="px-4 py-3 text-left text-white font-semibold">Venue</th>
                                    <th class="px-4 py-3 text-left text-white font-semibold">Team</th>
                                    <th class="px-4 py-3 text-left text-white font-semibold">Sound Requirements</th>
                                    <th class="px-4 py-3 text-left text-white font-semibold">Call Time</th>
                                    <th class="px-4 py-3 text-left text-white font-semibold">Crew</th>
                                    <th class="px-4 py-3 text-left text-white font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody id="tableBody">
                                <!-- Table rows will be dynamically generated -->
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- Event Detail Modal -->
        <div id="eventModal" class="modal">
            <div class="modal-content">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #8B4513;">Event Details</h2>
                    <button onclick="closeEventModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <div id="eventModalContent"></div>
            </div>
        </div>

        <!-- Add Show Modal -->
        <div id="addShowModal" class="modal">
            <div class="modal-content">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #8B4513;">Add New Show</h2>
                    <button onclick="closeAddShowModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                <form id="addShowForm" onsubmit="handleAddShow(event)">
                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                            <input type="date" name="event_date" required 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Program/Event *</label>
                            <input type="text" name="program" required 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Venue *</label>
                            <input type="text" name="venue" required 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Team (curator)</label>
                            <input type="text" name="team" 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Sound Requirements</label>
                            <textarea name="sound_requirements" rows="3" 
                                      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600"></textarea>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Call Time</label>
                            <input type="text" name="call_time" 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">Crew (sound team)</label>
                            <input type="text" name="crew" 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-600">
                        </div>
                    </div>
                    <div class="flex justify-end space-x-3 mt-6">
                        <button type="button" onclick="closeAddShowModal()" 
                                class="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400">
                            Cancel
                        </button>
                        <button type="submit" 
                                class="px-6 py-2 text-white rounded-lg hover:opacity-90" 
                                style="background-color: #8B4513;">
                            Add Show
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Delete Confirmation Modal -->
        <div id="deleteConfirmModal" class="modal">
            <div class="modal-content" style="max-width: 400px;">
                <h2 class="text-xl font-bold mb-4" style="color: #8B4513;">Delete Event</h2>
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
                    <h2 class="text-2xl font-bold" style="color: #8B4513;">
                        <i class="fab fa-whatsapp mr-2"></i>Export for WhatsApp
                    </h2>
                    <button onclick="closeWhatsAppExportModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                
                <div class="space-y-4 mb-6">
                    <p class="text-gray-600">Select a time range to export events:</p>
                    <div class="grid grid-cols-2 gap-3">
                        <button onclick="exportTomorrow()" class="px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all">
                            <i class="fas fa-calendar-day mr-2"></i>Tomorrow
                        </button>
                        <button onclick="exportThisWeek()" class="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all">
                            <i class="fas fa-calendar-week mr-2"></i>This Week
                        </button>
                        <button onclick="exportNextWeek()" class="px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-all">
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
                    <button onclick="exportSelectedDate()" class="mt-3 w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                        Generate Export
                    </button>
                </div>
                
                <div id="exportPreview" style="display: none;">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="font-semibold text-gray-700">Preview:</h3>
                        <button onclick="copyToClipboard()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
                            <i class="fas fa-copy mr-2"></i>Copy to Clipboard
                        </button>
                    </div>
                    <textarea id="exportText" readonly class="w-full h-64 p-4 border border-gray-300 rounded-lg bg-gray-50 font-mono text-sm"></textarea>
                </div>
            </div>
        </div>

        <!-- AI Assistant Floating Button -->
        <button id="aiAssistantBtn" onclick="toggleAIAssistant()" 
                class="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center z-40">
            <i class="fas fa-robot text-xl"></i>
        </button>

        <!-- AI Assistant Modal -->
        <div id="aiAssistantModal" class="modal">
            <div class="modal-content" style="max-width: 700px;">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-2xl font-bold" style="color: #8B4513;">
                        <i class="fas fa-robot mr-2"></i>AI Assistant
                    </h2>
                    <button onclick="closeAIAssistant()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                </div>
                
                <div class="mb-6">
                    <p class="text-gray-600 mb-4">Ask me anything about your events! Try these examples:</p>
                    <div class="grid grid-cols-2 gap-2 mb-4">
                        <button onclick="askAI('Show all events tomorrow')" class="px-3 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-left">
                            📅 Events tomorrow
                        </button>
                        <button onclick="askAI('Events at Tata Theatre this month')" class="px-3 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100 text-left">
                            🏛️ Events at Tata Theatre
                        </button>
                        <button onclick="askAI('Events with missing sound requirements')" class="px-3 py-2 text-sm bg-yellow-50 text-yellow-700 rounded-lg hover:bg-yellow-100 text-left">
                            ⚠️ Missing requirements
                        </button>
                        <button onclick="askAI('Events assigned to Ashwin')" class="px-3 py-2 text-sm bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 text-left">
                            👤 Ashwin's events
                        </button>
                    </div>
                    
                    <div class="flex space-x-2">
                        <input type="text" id="aiQueryInput" placeholder="Ask about events..." 
                               class="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600"
                               onkeypress="if(event.key==='Enter') askAI()">
                        <button onclick="askAI()" class="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
                
                <div id="aiResponse" style="display: none;">
                    <div class="bg-gray-50 rounded-lg p-4 mb-4">
                        <div class="flex items-center mb-2">
                            <div class="loading mr-2" id="aiLoading" style="display: none;"></div>
                            <h3 class="font-semibold text-gray-700">Response:</h3>
                        </div>
                        <p id="aiExplanation" class="text-gray-600 mb-3"></p>
                        <div id="aiResultsContainer" class="overflow-x-auto"></div>
                    </div>
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js"></script>
        <script src="/static/app.js?v=1.6.2"></script>
    </body>
    </html>
  `)
})

export default app
