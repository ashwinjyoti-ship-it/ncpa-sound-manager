import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database;
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

// Search events
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
                        
                        <!-- CSV Upload -->
                        <button onclick="document.getElementById('csvInput').click()" 
                                class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-all">
                            <i class="fas fa-file-upload mr-2"></i>Upload CSV
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

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"></script>
        <script src="/static/app.js"></script>
    </body>
    </html>
  `)
})

export default app
