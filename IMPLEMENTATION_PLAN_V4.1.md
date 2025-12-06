# 🚀 Implementation Plan - NCPA Sound Crew v4.1

**Branch**: `feature/enhancements-v4.1`  
**Base Version**: 4.0 (RAG Analytics Complete)  
**Target Version**: 4.1 (Enhanced Features)  
**Date**: December 6, 2025

---

## 🎯 FEATURES TO IMPLEMENT

### Priority Order (Based on Dependencies)

1. ✅ **Advanced Filtering & Sorting** (Foundation for other features)
2. ✅ **Conflict Detection** (Backend logic)
3. ✅ **Customized Export** (CSV with change tracking)
4. ✅ **Dashboard View** (New tab)
5. ✅ **Mobile Optimization** (CSS enhancements)
6. ✅ **Advanced Calendar Features** (Week view, drag-drop)
7. ✅ **Google Calendar Integration** (iCal feed)

---

## 📋 DETAILED IMPLEMENTATION

### 1. ADVANCED FILTERING & SORTING

**Location**: Table View  
**Estimated Time**: 3-4 hours

**Features**:
- Filter dropdowns above table
- Multi-filter support (venue + crew + date range + status)
- "Clear All Filters" button
- Filter badge showing active filter count
- Sort by any column (click headers)

**Implementation**:

```typescript
// Add to types.ts
interface FilterState {
  venue: string | null;
  crew: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  status: string | null;
}

// Add to app.js
let activeFilters: FilterState = {
  venue: null,
  crew: null,
  dateStart: null,
  dateEnd: null,
  status: null
};

function applyFilters() {
  let filtered = allEvents;
  
  if (activeFilters.venue) {
    filtered = filtered.filter(e => e.venue === activeFilters.venue);
  }
  if (activeFilters.crew) {
    filtered = filtered.filter(e => e.crew?.includes(activeFilters.crew));
  }
  if (activeFilters.dateStart) {
    filtered = filtered.filter(e => e.event_date >= activeFilters.dateStart);
  }
  if (activeFilters.dateEnd) {
    filtered = filtered.filter(e => e.event_date <= activeFilters.dateEnd);
  }
  
  renderTable(filtered);
  updateFilterBadge();
}

function sortTable(column, direction) {
  // Sort logic
}
```

**UI Addition** (index.tsx):
```html
<div class="filters-toolbar p-4 bg-white rounded-lg shadow mb-4">
  <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
    <select id="venueFilter" onchange="filterByVenue()">
      <option value="">All Venues</option>
      <option value="JBT">JBT</option>
      <option value="TET">TET</option>
      <!-- etc -->
    </select>
    
    <select id="crewFilter" onchange="filterByCrew()">
      <option value="">All Crew</option>
      <!-- Dynamic crew list -->
    </select>
    
    <input type="date" id="dateStartFilter" onchange="filterByDateRange()">
    <input type="date" id="dateEndFilter" onchange="filterByDateRange()">
    
    <button onclick="clearAllFilters()">
      Clear Filters <span id="filterBadge">0</span>
    </button>
  </div>
</div>
```

---

### 2. CONFLICT DETECTION

**Location**: Backend + Frontend warnings  
**Estimated Time**: 2-3 hours

**Conflict Types**:
1. Same crew, overlapping times (same day)
2. Same venue, overlapping times (same day)
3. Crew assigned to multiple events on same day (warning only)

**Implementation**:

```typescript
// Add to backend (index.tsx API)
app.get('/api/events/conflicts', async (c) => {
  const { DB } = c.env as Env;
  
  // Find conflicts
  const conflicts = await DB.prepare(`
    SELECT e1.id as event1_id, e1.program as event1_program,
           e2.id as event2_id, e2.program as event2_program,
           e1.event_date, e1.crew, e1.venue,
           'crew_overlap' as conflict_type
    FROM events e1
    JOIN events e2 ON e1.event_date = e2.event_date
    WHERE e1.id < e2.id
      AND e1.crew IS NOT NULL
      AND e2.crew IS NOT NULL
      AND (
        -- Same crew member in both events
        e1.crew LIKE '%' || e2.crew || '%'
        OR e2.crew LIKE '%' || e1.crew || '%'
      )
    
    UNION ALL
    
    SELECT e1.id, e1.program, e2.id, e2.program,
           e1.event_date, e1.venue, e1.venue,
           'venue_overlap' as conflict_type
    FROM events e1
    JOIN events e2 ON e1.event_date = e2.event_date 
                   AND e1.venue = e2.venue
    WHERE e1.id < e2.id
  `).all();
  
  return c.json({ success: true, conflicts: conflicts.results });
});

// Frontend warning badge
function checkConflicts(eventId) {
  const conflicts = await fetch('/api/events/conflicts');
  const data = await conflicts.json();
  
  // Show red warning badge on conflicting events
  data.conflicts.forEach(conflict => {
    if (conflict.event1_id === eventId || conflict.event2_id === eventId) {
      showConflictWarning(conflict);
    }
  });
}
```

**UI**:
- Red warning badge on event cards: ⚠️
- Conflict explanation in event modal
- "View Conflicting Event" button

---

### 3. CUSTOMIZED EXPORT (Google Sheets Integration)

**Location**: Export functionality  
**Estimated Time**: 2-3 hours

**Features**:
- Export with unique event IDs
- Track `updated_at` timestamp
- CSV format compatible with Google Sheets
- Instructions for Google Sheets IMPORTDATA formula

**Implementation**:

```typescript
// Modified export function
function exportToCSV(month, year) {
  const events = filterEventsByMonth(month, year);
  
  const csvData = [
    // Header with ID and updated_at for tracking
    ['ID', 'Date', 'Program', 'Venue', 'Team', 'Sound Requirements', 
     'Call Time', 'Crew', 'Last Updated']
  ];
  
  events.forEach(event => {
    csvData.push([
      event.id,  // Unique ID for tracking
      formatDate(event.event_date),
      event.program,
      event.venue,
      event.team || '',
      event.sound_requirements || '',
      event.call_time || '',
      event.crew || '',
      event.updated_at  // Timestamp for change detection
    ]);
  });
  
  const csv = csvData.map(row => row.map(escapeCSV).join(',')).join('\n');
  downloadCSV(csv, `NCPA_Events_${month}_${year}.csv`);
}

// Add export endpoint that returns CSV URL
app.get('/api/events/export-url', async (c) => {
  // Generate CSV and return public URL
  // Google Sheets can use: =IMPORTDATA("url")
});
```

**Google Sheets Integration Instructions**:
```
1. Export CSV from NCPA app
2. Upload to Google Drive (or use export URL)
3. In Google Sheets:
   =IMPORTDATA("https://ncpa-sound.pages.dev/api/events/export-csv")
4. Sheet auto-updates when you refresh!

Or use Apps Script for scheduled updates:
function updateSheet() {
  var url = "https://ncpa-sound.pages.dev/api/events/export-csv";
  var csv = UrlFetchApp.fetch(url).getContentText();
  var data = Utilities.parseCsv(csv);
  var sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
}
```

---

### 4. DASHBOARD VIEW

**Location**: New tab (between Table and existing tabs)  
**Estimated Time**: 6-8 hours

**Widgets**:
1. This Month Overview (cards)
2. Events by Venue (bar chart)
3. Crew Workload (bar chart)
4. Upcoming Events (list)
5. Events Needing Attention (missing data)
6. Trends (line chart)

**Implementation**:

```typescript
// Add new tab
<button id="dashboardTab" onclick="showTab('dashboard')">
  <i class="fas fa-chart-line mr-2"></i>Dashboard
</button>

// Dashboard HTML structure
<div id="dashboardView" style="display: none;">
  <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
    <!-- Metric Cards -->
    <div class="metric-card">
      <h3>Total Events</h3>
      <p class="text-4xl" id="totalEvents">0</p>
      <small>This Month</small>
    </div>
    
    <div class="metric-card">
      <h3>Events Today</h3>
      <p class="text-4xl" id="eventsToday">0</p>
    </div>
    
    <div class="metric-card">
      <h3>Busiest Venue</h3>
      <p class="text-2xl" id="busiestVenue">-</p>
    </div>
    
    <div class="metric-card">
      <h3>Crew Utilization</h3>
      <p class="text-4xl" id="crewUtilization">0%</p>
    </div>
  </div>
  
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- Chart containers -->
    <div class="chart-container">
      <h3>Events by Venue</h3>
      <canvas id="venueChart"></canvas>
    </div>
    
    <div class="chart-container">
      <h3>Crew Workload</h3>
      <canvas id="crewChart"></canvas>
    </div>
    
    <div class="chart-container">
      <h3>Upcoming Events (Next 7 Days)</h3>
      <div id="upcomingEventsList"></div>
    </div>
    
    <div class="chart-container">
      <h3>Events Needing Attention</h3>
      <div id="attentionList"></div>
    </div>
  </div>
</div>
```

**Using Chart.js** (already in CDN):
```javascript
function renderDashboard() {
  const events = allEvents;
  const thisMonth = events.filter(e => isThisMonth(e.event_date));
  
  // Metric cards
  document.getElementById('totalEvents').textContent = thisMonth.length;
  document.getElementById('eventsToday').textContent = 
    thisMonth.filter(e => isToday(e.event_date)).length;
  
  // Venue chart
  const venueData = groupBy(thisMonth, 'venue');
  new Chart(document.getElementById('venueChart'), {
    type: 'bar',
    data: {
      labels: Object.keys(venueData),
      datasets: [{
        label: 'Events',
        data: Object.values(venueData).map(v => v.length),
        backgroundColor: '#FF6B35'
      }]
    }
  });
  
  // Crew workload chart
  const crewData = groupBy(thisMonth, 'crew');
  // Similar chart...
  
  // Upcoming events list
  const upcoming = events
    .filter(e => isNext7Days(e.event_date))
    .slice(0, 10);
  renderUpcomingList(upcoming);
  
  // Events needing attention (missing data)
  const needsAttention = events.filter(e => 
    !e.crew || !e.sound_requirements || e.sound_requirements === 'TBD'
  );
  renderAttentionList(needsAttention);
}
```

---

### 5. MOBILE OPTIMIZATION

**Location**: CSS and responsive design  
**Estimated Time**: 4-5 hours

**Improvements**:
- Card-based table view on mobile
- Bottom navigation for tabs
- Larger touch targets
- Swipe gestures
- Simplified forms

**Implementation**:

```css
/* Mobile-first responsive styles */
@media (max-width: 768px) {
  /* Table becomes cards */
  #tableView table {
    display: none;
  }
  
  #tableView .mobile-cards {
    display: block;
  }
  
  .event-card-mobile {
    background: white;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  
  .event-card-mobile h3 {
    font-size: 18px;
    color: #FF6B35;
    margin-bottom: 8px;
  }
  
  .event-card-mobile .info-row {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #eee;
  }
  
  /* Bottom navigation */
  .tab-navigation {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: white;
    border-top: 2px solid #FF6B35;
    display: flex;
    justify-content: space-around;
    padding: 12px 0;
  }
  
  .tab-navigation button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    font-size: 12px;
  }
  
  /* Larger touch targets */
  button, a, input[type="checkbox"] {
    min-height: 44px;
    min-width: 44px;
  }
  
  /* Simplified forms */
  .add-event-modal {
    width: 95vw;
    height: 95vh;
    overflow-y: auto;
  }
  
  /* Calendar adjustments */
  .calendar-day {
    min-height: 80px;
  }
  
  .event-card {
    font-size: 11px;
    padding: 4px;
  }
}
```

---

### 6. ADVANCED CALENDAR FEATURES

**Location**: Calendar view enhancements  
**Estimated Time**: 4-5 hours

**Features**:
1. Week View (7 days horizontal)
2. Agenda View (list of upcoming)
3. Drag & Drop rescheduling
4. Multi-month view option

**Implementation**:

```typescript
// Week View
function renderWeekView(startDate) {
  const week = get7Days(startDate);
  
  const html = `
    <div class="week-view">
      ${week.map(day => `
        <div class="week-day">
          <div class="week-day-header">
            <div class="day-name">${getDayName(day)}</div>
            <div class="day-date">${formatDate(day)}</div>
          </div>
          <div class="week-day-events" 
               ondrop="handleDrop(event, '${day}')"
               ondragover="allowDrop(event)">
            ${getEventsForDay(day).map(event => `
              <div class="week-event-card" 
                   draggable="true"
                   ondragstart="handleDragStart(event, ${event.id})">
                <div class="event-time">${event.call_time}</div>
                <div class="event-title">${event.program}</div>
                <div class="event-venue">${event.venue}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
  
  document.getElementById('weekViewContainer').innerHTML = html;
}

// Drag & Drop
function handleDragStart(event, eventId) {
  event.dataTransfer.setData('eventId', eventId);
}

function handleDrop(event, newDate) {
  event.preventDefault();
  const eventId = event.dataTransfer.getData('eventId');
  
  if (confirm(`Reschedule event to ${newDate}?`)) {
    updateEventDate(eventId, newDate);
  }
}

// Agenda View
function renderAgendaView() {
  const upcoming = allEvents
    .filter(e => new Date(e.event_date) >= new Date())
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
    .slice(0, 50);
  
  const grouped = groupByDate(upcoming);
  
  const html = Object.entries(grouped).map(([date, events]) => `
    <div class="agenda-group">
      <h3 class="agenda-date">${formatDateLong(date)}</h3>
      <div class="agenda-events">
        ${events.map(event => `
          <div class="agenda-event-card">
            <div class="event-time">${event.call_time || 'TBD'}</div>
            <div class="event-details">
              <div class="event-program">${event.program}</div>
              <div class="event-meta">
                <span>${event.venue}</span>
                ${event.crew ? `<span> • ${event.crew}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
  
  document.getElementById('agendaViewContainer').innerHTML = html;
}
```

**View Switcher**:
```html
<div class="view-switcher">
  <button onclick="setCalendarView('month')">Month</button>
  <button onclick="setCalendarView('week')">Week</button>
  <button onclick="setCalendarView('agenda')">Agenda</button>
</div>
```

---

### 7. GOOGLE CALENDAR INTEGRATION

**Location**: New export option + iCal feed  
**Estimated Time**: 3-4 hours

**Features**:
1. Generate iCal feed URL
2. Subscribe in Google Calendar / Outlook / Apple Calendar
3. Auto-update when events change

**Implementation**:

```typescript
// iCal generation endpoint
app.get('/api/events/ical', async (c) => {
  const { DB } = c.env as Env;
  const events = await DB.prepare('SELECT * FROM events ORDER BY event_date').all();
  
  const ical = generateICalendar(events.results);
  
  return new Response(ical, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ncpa-events.ics"'
    }
  });
});

function generateICalendar(events) {
  let ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//NCPA Sound Crew//Event Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:NCPA Sound Crew Events
X-WR-TIMEZONE:Asia/Kolkata
X-WR-CALDESC:NCPA Sound Crew Event Schedule
`;

  events.forEach(event => {
    const dtstart = formatICalDate(event.event_date, event.call_time);
    const dtend = formatICalDate(event.event_date, addHours(event.call_time, 4));
    const uid = `event-${event.id}@ncpa-sound.pages.dev`;
    
    ical += `
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatICalDateNow()}
DTSTART:${dtstart}
DTEND:${dtend}
SUMMARY:${escapeICalText(event.program)}
LOCATION:${escapeICalText(event.venue)}
DESCRIPTION:${escapeICalText(generateDescription(event))}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
`;
  });
  
  ical += 'END:VCALENDAR';
  return ical;
}

function generateDescription(event) {
  let desc = '';
  if (event.team) desc += `Team: ${event.team}\\n`;
  if (event.sound_requirements) desc += `Sound: ${event.sound_requirements}\\n`;
  if (event.crew) desc += `Crew: ${event.crew}\\n`;
  if (event.call_time) desc += `Call Time: ${event.call_time}`;
  return desc;
}
```

**UI - Subscription Instructions**:
```html
<div class="calendar-sync-card">
  <h3>📅 Subscribe to Calendar</h3>
  <p>Get automatic updates in your calendar app:</p>
  
  <div class="subscription-url">
    <input type="text" readonly 
           value="https://ncpa-sound.pages.dev/api/events/ical"
           id="icalUrl">
    <button onclick="copyICalUrl()">Copy URL</button>
  </div>
  
  <div class="instructions">
    <h4>Google Calendar:</h4>
    <ol>
      <li>Open Google Calendar</li>
      <li>Click "+" next to "Other calendars"</li>
      <li>Select "From URL"</li>
      <li>Paste the URL above</li>
      <li>Click "Add calendar"</li>
    </ol>
    
    <h4>Apple Calendar:</h4>
    <ol>
      <li>Open Calendar app</li>
      <li>File → New Calendar Subscription</li>
      <li>Paste the URL above</li>
      <li>Click "Subscribe"</li>
    </ol>
    
    <h4>Outlook:</h4>
    <ol>
      <li>Open Outlook Calendar</li>
      <li>Click "Add calendar" → "From internet"</li>
      <li>Paste the URL above</li>
      <li>Click "Import"</li>
    </ol>
  </div>
</div>
```

---

## 🧪 TESTING STRATEGY

### Unit Testing
- Filter logic with various combinations
- Conflict detection algorithm
- iCal generation format validation
- Dashboard metrics calculations

### Integration Testing
- CSV export → Google Sheets import
- iCal feed → Google Calendar subscription
- Drag & drop event rescheduling
- Mobile responsive behavior

### User Acceptance Testing
- Test on real devices (iPhone, Android, iPad)
- Verify all filters work together
- Confirm conflicts are detected accurately
- Validate Google Calendar sync updates

---

## 📦 DEPLOYMENT PLAN

### Phase 1: Development (This Session)
1. Implement all features on feature branch
2. Local testing in sandbox
3. Fix bugs and refine UX

### Phase 2: Staging (Next Session)
1. Deploy to staging URL (separate Cloudflare project)
2. Team testing and feedback
3. Iterate based on feedback

### Phase 3: Production (After Approval)
1. Merge feature branch to main
2. Deploy to production
3. Monitor for issues
4. Create rollback plan

---

## 🔄 ROLLBACK PLAN

If anything breaks:
```bash
# Revert to stable version
git checkout main
npm run build
npm run deploy:prod

# Or cherry-pick working features
git cherry-pick <commit-hash>
```

---

## 📊 SUCCESS METRICS

After deployment, measure:
- ✅ Filter usage (track which filters are most used)
- ✅ Conflicts detected and resolved
- ✅ Dashboard page views
- ✅ Mobile vs desktop usage ratio
- ✅ Google Calendar subscriptions
- ✅ CSV export frequency
- ✅ User feedback and satisfaction

---

## 🎯 BULK CREW ASSIGNMENT SOLUTION

**Smart Suggestions Based on Historical Data**:

```typescript
// Analyze patterns
app.get('/api/analytics/crew-suggestions', async (c) => {
  const { venue, program_type } = c.req.query();
  
  const suggestions = await DB.prepare(`
    SELECT crew, COUNT(*) as frequency
    FROM events
    WHERE venue = ? 
      AND crew IS NOT NULL
    GROUP BY crew
    ORDER BY frequency DESC
    LIMIT 5
  `).bind(venue).all();
  
  return c.json({ 
    suggestions: suggestions.results.map(s => ({
      crew: s.crew,
      confidence: (s.frequency / totalEvents) * 100,
      reason: `Assigned to ${s.frequency} ${venue} events`
    }))
  });
});

// Bulk assignment UI
function bulkAssignCrew(selectedEventIds) {
  // Get smart suggestions
  const suggestions = await fetchCrewSuggestions(selectedEventIds);
  
  showDialog(`
    <h3>Bulk Assign Crew</h3>
    <p>${selectedEventIds.length} events selected</p>
    
    <h4>Suggested Crew (based on past assignments):</h4>
    ${suggestions.map(s => `
      <label>
        <input type="checkbox" value="${s.crew}">
        ${s.crew} 
        <span class="confidence">${s.confidence}% confidence</span>
        <small>${s.reason}</small>
      </label>
    `).join('')}
    
    <h4>Or enter custom crew:</h4>
    <input type="text" id="customCrew" placeholder="Enter crew names">
    
    <button onclick="confirmBulkAssign()">Assign to Selected Events</button>
  `);
}
```

**Benefits**:
- ✅ Learns from historical patterns
- ✅ Shows confidence scores
- ✅ User always has final say
- ✅ Safe and intelligent

---

**Ready to start implementation!** 🚀
