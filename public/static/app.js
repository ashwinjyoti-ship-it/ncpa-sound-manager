// NCPA Sound Crew - Frontend Application

// Browser compatibility check
(function() {
  try {
    // Test optional chaining
    const test = {}?.test;
    // Test nullish coalescing  
    const test2 = null ?? 'default';
  } catch (error) {
    alert('⚠️ Browser Not Supported\n\nThis app requires a modern browser.\n\nPlease update Safari to version 14+ or use:\n• Chrome\n• Firefox\n• Edge\n• GenSpark Browser');
    throw new Error('Browser not supported');
  }
})();

// State management
let currentView = 'calendar';
let currentDate = new Date();
let allEvents = [];
let currentEditingCell = null;

// API Base URL
const API_BASE = '/api';

// ============================================
// DISPLAY NORMALIZATION HELPERS
// ============================================

// Normalize venue display (Tata Theatre → TT)
function displayVenue(venue) {
  if (!venue) return '';
  
  const venueStr = venue.toString().trim();
  
  // Normalize all Tata Theatre variations to TT
  if (venueStr.includes('Tata Theatre') || venueStr === 'Tata Theatre') {
    return 'TT';
  }
  
  return venue;
}

// ============================================
// MULTI-DATE SHOW HELPERS (consecutive dates only)
// ============================================

function eventHasCrew(e) {
  var sc = e.stage_crew;
  if (Array.isArray(sc)) return sc.some(Boolean) || !!(e.foh_crew && String(e.foh_crew).trim()) || !!(e.crew && String(e.crew).trim());
  return !!(e.foh_crew && String(e.foh_crew).trim()) || !!(sc && String(sc).trim()) || !!(e.crew && String(e.crew).trim());
}

function addDaysUtc(dateStr, days) {
  var d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isConsecutiveDate(prev, next) {
  return addDaysUtc(prev, 1) === next;
}

function venueGroupKey(venue) {
  var v = (venue || '').trim();
  var upper = v.toUpperCase();
  if (upper === 'JBT MUSEUM' || upper.indexOf('JBT MUSEUM ') === 0) return 'JBT Museum';
  if (v === 'TT' || v === 'Tata Theatre') return 'TT';
  if (v === 'TET' || v === 'Experimental Theatre') return 'TET';
  return v;
}

function programVenueKey(program, venue) {
  return (program || '').trim() + '|' + venueGroupKey(venue);
}

// Union of same show_group_id and inferred consecutive cluster (2+), not
// "ID if present else dates" — a show_group_id that's drifted out of sync
// with the actual consecutive run (e.g. a partial re-upload minted a new id
// for part of an existing run) must not orphan the rows left on the old id.
function findMultiDateSiblings(event, events) {
  var key = programVenueKey(event.program, event.venue);
  var byGroupId = event.show_group_id
    ? events.filter(function(e) {
        return e.id !== event.id &&
          e.show_group_id === event.show_group_id &&
          programVenueKey(e.program, e.venue) === key;
      })
    : [];

  var peers = events.filter(function(e) {
    return e.id !== event.id && programVenueKey(e.program, e.venue) === key;
  });
  var cluster = [event].concat(peers).sort(function(a, b) {
    return a.event_date.localeCompare(b.event_date);
  });
  var clusters = [];
  for (var i = 0; i < cluster.length; i++) {
    if (i === 0 || !isConsecutiveDate(cluster[i - 1].event_date, cluster[i].event_date)) {
      clusters.push([cluster[i]]);
    } else {
      clusters[clusters.length - 1].push(cluster[i]);
    }
  }
  var mine = clusters.find(function(c) {
    return c.some(function(e) { return e.id === event.id; });
  });
  var byDate = (!mine || mine.length < 2) ? [] : mine.filter(function(e) { return e.id !== event.id; });

  var merged = new Map();
  byGroupId.concat(byDate).forEach(function(e) { merged.set(e.id, e); });
  return Array.from(merged.values());
}

document.addEventListener('DOMContentLoaded', async () => {
   renderCurrentView();
   await loadEvents();
   renderCurrentView();

   // Scroll to today's date on initial mobile load
   if (isMobileView() && currentView === 'calendar') {
     setTimeout(function() {
       scrollMobileAgendaToDate(formatDateKeyLocal(new Date()));
     }, 150);
   }

   // Wire mobile week navigation
   var prevWeekBtn = document.getElementById('mobilePrevWeek');
   var nextWeekBtn = document.getElementById('mobileNextWeek');
   var todayBtn = document.getElementById('mobileTodayBtn');

   if (prevWeekBtn) {
     prevWeekBtn.addEventListener('click', function() {
       currentDate.setDate(currentDate.getDate() - 7);
       renderMobileCalendar();
     });
   }
   if (nextWeekBtn) {
     nextWeekBtn.addEventListener('click', function() {
       currentDate.setDate(currentDate.getDate() + 7);
       renderMobileCalendar();
     });
   }
   if (todayBtn) {
     todayBtn.addEventListener('click', function() {
       const today = new Date();
       currentDate = today;
       renderMobileCalendar({ scrollToDate: formatDateKeyLocal(today) });
     });
   }

   // Resize listener to switch between desktop and mobile renderers
   var lastMobile = isMobileView();
   var resizeTimer = null;
   window.addEventListener('resize', function() {
     clearTimeout(resizeTimer);
     resizeTimer = setTimeout(function() {
       var nowMobile = isMobileView();
       if (nowMobile !== lastMobile && currentView === 'calendar') {
         lastMobile = nowMobile;
         renderCurrentView();
       }
     }, 200);
  });
});

// ============================================
// DATA LOADING
// ============================================

async function loadEvents() {
  try {
    const response = await axios.get(`${API_BASE}/events`, { timeout: 60000 });
    if (response.data.success) {
      allEvents = response.data.data;
      renderCurrentView();
    } else {
    }
  } catch (error) {
    console.error('Error loading events:', error);
    showNotification('Failed to load events', 'error');
  }
}

// ============================================
// VIEW SWITCHING
// ============================================

function showTab(tab) {
  currentView = tab;
  
  // Update tab buttons
  document.getElementById('calendarTab').classList.remove('tab-active');
  document.getElementById('tableTab').classList.remove('tab-active');
  const crewTab = document.getElementById('crewTab');
  if (crewTab) crewTab.classList.remove('tab-active');
  const settingsTab = document.getElementById('settingsTab');
  if (settingsTab) settingsTab.classList.remove('tab-active');
  const dashboardTab = document.getElementById('dashboardTab');
  if (dashboardTab) dashboardTab.classList.remove('tab-active');
  
  // Hide all views
  document.getElementById('calendarView').style.display = 'none';
  document.getElementById('tableView').style.display = 'none';
  const crewView = document.getElementById('crewView');
  if (crewView) crewView.style.display = 'none';
  const settingsView = document.getElementById('settingsView');
  if (settingsView) settingsView.style.display = 'none';
  const dashboardView = document.getElementById('dashboardView');
  if (dashboardView) dashboardView.style.display = 'none';
  
  if (tab === 'calendar') {
    document.getElementById('calendarTab').classList.add('tab-active');
    document.getElementById('calendarView').style.display = 'block';
    renderCurrentView();
  } else if (tab === 'table') {
    stopTodaySidebarClock();
    document.getElementById('tableTab').classList.add('tab-active');
    document.getElementById('tableView').style.display = 'block';
    renderTable();
  } else if (tab === 'crew') {
    stopTodaySidebarClock();
    if (crewTab) crewTab.classList.add('tab-active');
    if (crewView) {
      crewView.style.display = 'block';
      if (typeof loadCrewStats === 'function') {
        loadCrewStats();
      }
    }
  } else if (tab === 'settings') {
    stopTodaySidebarClock();
    if (settingsTab) settingsTab.classList.add('tab-active');
    if (settingsView) {
      settingsView.style.display = 'block';
      if (typeof loadSettingsPage === 'function') {
        loadSettingsPage();
      }
    }
  }
}

function renderCurrentView() {
  if (currentView === 'calendar') {
    const mobile = isMobileView();
    setCalendarShellForViewport(mobile);
    if (mobile) {
      renderMobileCalendar();
    } else {
      renderCalendar();
    }
  } else {
    renderTable();
  }
}

function setCalendarShellForViewport(mobile) {
  const desktopLayout = document.getElementById('desktopCalendarLayout');
  const mobileView = document.getElementById('mobileCalendarView');

  if (mobile) {
    stopTodaySidebarClock();
  }

  if (desktopLayout) {
    desktopLayout.style.display = mobile ? 'none' : 'flex';
  }
  if (mobileView) {
    mobileView.style.display = mobile ? 'block' : 'none';
  }
}

// ============================================
// CALENDAR VIEW
// ============================================

function isEventGreen(event) {
  return event.requirements_updated && event.call_time && event.call_time.trim() && event.call_time.toLowerCase() !== 'not specified';
}

function appendDesktopEventCrew(card, event) {
  if (event.foh_crew || event.stage_crew) {
    if (event.foh_crew) {
      const row = document.createElement('div');
      row.className = 'event-card-meta event-card-crew event-card-foh truncate';
      const icon = document.createElement('i');
      icon.className = 'fas fa-headphones mr-1 text-xs';
      row.appendChild(icon);
      row.appendChild(document.createTextNode(event.foh_crew));
      card.appendChild(row);
    }
    if (event.stage_crew) {
      const row = document.createElement('div');
      row.className = 'event-card-meta event-card-crew event-card-stage truncate';
      const icon = document.createElement('i');
      icon.className = 'fas fa-volume-up mr-1 text-xs';
      row.appendChild(icon);
      row.appendChild(document.createTextNode(event.stage_crew));
      card.appendChild(row);
    }
  } else if (event.crew) {
    const row = document.createElement('div');
    row.className = 'event-card-meta event-card-crew truncate';
    const icon = document.createElement('i');
    icon.className = 'fas fa-users mr-1';
    row.appendChild(icon);
    row.appendChild(document.createTextNode(event.crew));
    card.appendChild(row);
  }
}

function createDesktopEventCard(event, options) {
  const truncateProgram = (options && options.truncateProgram) || 30;
  const statusComplete = isEventGreen(event);
  const card = document.createElement('div');
  card.className = 'event-card cursor-pointer ' + (statusComplete ? 'event-card-green' : 'event-card-peach');
  card.onclick = function() { openEventModal(event); };

  if (options && options.showStatus) {
    const header = document.createElement('div');
    header.className = 'event-card-header';

    const time = document.createElement('span');
    time.className = 'event-card-time';
    time.textContent = event.call_time && event.call_time.trim() ? event.call_time : 'Not set';
    header.appendChild(time);

    const status = document.createElement('span');
    status.className = 'event-card-status';
    status.textContent = statusComplete ? 'Complete' : 'Attention';
    header.appendChild(status);

    card.appendChild(header);
  }

  const title = document.createElement('div');
  title.className = 'event-card-title truncate';
  title.textContent = truncateText(event.program, truncateProgram);
  card.appendChild(title);

  const venue = document.createElement('div');
  venue.className = 'event-card-meta truncate';
  const venueIcon = document.createElement('i');
  venueIcon.className = 'fas fa-map-marker-alt mr-1';
  venue.appendChild(venueIcon);
  venue.appendChild(document.createTextNode(displayVenue(event.venue)));
  card.appendChild(venue);

  appendDesktopEventCrew(card, event);
  return card;
}

let todaySidebarClockIntervalId = null;
let todaySidebarRenderedDateKey = null;

function formatTodaySidebarTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

function stopTodaySidebarClock() {
  if (todaySidebarClockIntervalId !== null) {
    clearInterval(todaySidebarClockIntervalId);
    todaySidebarClockIntervalId = null;
  }
}

function updateTodaySidebarTime() {
  const timeEl = document.getElementById('todaySidebarTime');
  if (!timeEl) return;

  const now = new Date();
  timeEl.textContent = formatTodaySidebarTime(now);

  const dateKey = formatDateKeyLocal(now);
  if (todaySidebarRenderedDateKey !== null && dateKey !== todaySidebarRenderedDateKey) {
    renderTodaySidebar();
  }
}

function startTodaySidebarClock() {
  stopTodaySidebarClock();
  updateTodaySidebarTime();
  todaySidebarClockIntervalId = setInterval(updateTodaySidebarTime, 1000);
}

function renderTodaySidebar() {
  const dayNumberEl = document.getElementById('todaySidebarDayNumber');
  const dateLabelEl = document.getElementById('todaySidebarDateLabel');
  const eventsEl = document.getElementById('todaySidebarEvents');
  if (!dayNumberEl || !dateLabelEl || !eventsEl) return;

  const today = new Date();
  const todayStr = formatDateKeyLocal(today);
  const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];

  dayNumberEl.textContent = today.getDate();
  dateLabelEl.textContent = weekdayNames[today.getDay()] + ' · ' + monthNames[today.getMonth()] + ' ' + today.getFullYear();
  todaySidebarRenderedDateKey = todayStr;
  startTodaySidebarClock();

  const todayEvents = allEvents.filter(function(e) {
    return normalizeEventDateKey(e.event_date) === todayStr;
  });

  if (typeof eventsEl.replaceChildren === 'function') {
    eventsEl.replaceChildren();
  } else {
    eventsEl.innerHTML = '';
  }
  if (todayEvents.length === 0) {
    const empty = document.createElement('p');
    empty.id = 'todaySidebarEmpty';
    empty.textContent = 'No events today';
    eventsEl.appendChild(empty);
  } else {
    todayEvents.forEach(function(event) {
      eventsEl.appendChild(createDesktopEventCard(event, { truncateProgram: 40, showStatus: true }));
    });
  }
}

function renderCalendar() {
  try {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  console.log(`🔧 renderCalendar called:`, {
    currentDateFull: currentDate.toISOString(),
    year: year,
    month: month,
    monthName: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month]
  });
  
  // Update header
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('currentMonthYear').textContent = `${monthNames[month]} ${year}`;
  
  // Get first day of month and number of days
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  console.log(`🔧 Date calculations:`, {
    firstDay: firstDay,
    daysInMonth: daysInMonth,
    startDateCalc: `new Date(${year}, ${month}, 1)`,
    endDateCalc: `new Date(${year}, ${month}, ${daysInMonth})`
  });
  
  // Get events for this month
  // CRITICAL FIX: Format dates in YYYY-MM-DD WITHOUT timezone conversion
  // Using toISOString() converts to UTC which breaks for non-UTC timezones!
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  
  console.log(`🔧 Actual formatted dates:`, {startDate, endDate});
  
  // Filter events and count unique ones only (by ID)
  const monthEvents = allEvents.filter(event => {
    // Make sure event_date exists and is valid
    if (!event.event_date) return false;
    
    // Ensure we're comparing strings properly
    const eventDate = event.event_date.toString();
    return eventDate >= startDate && eventDate <= endDate;
  });
  
  // Remove any duplicates by ID (shouldn't happen, but just in case)
  const uniqueEventIds = new Set();
  const uniqueMonthEvents = monthEvents.filter(event => {
    if (uniqueEventIds.has(event.id)) {
      console.log(`⚠️ DUPLICATE REMOVED: ID ${event.id} - ${event.program}`);
      return false; // Skip duplicate
    }
    uniqueEventIds.add(event.id);
    return true;
  });
  
  // Update event count display with unique count
  const eventCountEl = document.getElementById('monthEventCount');
  if (eventCountEl) {
    eventCountEl.textContent = `${uniqueMonthEvents.length} events`;
  }
  
  // Check if next month has events when current month is empty
  if (uniqueMonthEvents.length === 0) {
    const nextMonth = month + 1;
    const nextYear = nextMonth > 11 ? year + 1 : year;
    const nextMonthIndex = nextMonth > 11 ? 0 : nextMonth;
    const nextStartDate = new Date(nextYear, nextMonthIndex, 1).toISOString().split('T')[0];
    const nextDaysInMonth = new Date(nextYear, nextMonthIndex + 1, 0).getDate();
    const nextEndDate = new Date(nextYear, nextMonthIndex, nextDaysInMonth).toISOString().split('T')[0];
    
    const nextMonthEvents = allEvents.filter(event => {
      if (!event.event_date) return false;
      const eventDate = event.event_date.toString();
      return eventDate >= nextStartDate && eventDate <= nextEndDate;
    });
    
    if (nextMonthEvents.length > 0 && eventCountEl) {
      eventCountEl.innerHTML = `0 events <span class="text-blue-600 cursor-pointer hover:underline" onclick="changeMonth(1)" title="Click to view ${monthNames[nextMonthIndex]} ${nextYear}">→ ${nextMonthEvents.length} events in ${monthNames[nextMonthIndex]}</span>`;
    }
  }
  
  console.log(`📊 Event Count Debug - Month: ${monthNames[month]} ${year}`);
  console.log(`  - Total allEvents: ${allEvents.length}`);
  console.log(`  - Filtered monthEvents: ${monthEvents.length}`);
  console.log(`  - Unique monthEvents: ${uniqueMonthEvents.length}`);
  console.log(`  - Date range: ${startDate} to ${endDate}`);
  
  // Debug: Check if Jan 31 events are in monthEvents
  if (month === 0 && year === 2026) {
    console.log(`  - Jan 31 in monthEvents:`, monthEvents.filter(e => e.event_date === '2026-01-31').length);
    console.log(`  - Jan 31 in uniqueMonthEvents:`, uniqueMonthEvents.filter(e => e.event_date === '2026-01-31').length);
  }
  
  // SUPER DEBUG: If January 2026, log ALL event dates
  if (month === 0 && year === 2026) {
    console.log(`🚨 JANUARY 2026 SPECIAL DEBUG:`);
    const jan31Events = allEvents.filter(e => {
      if (!e.event_date) return false;
      const date = e.event_date.toString().trim();
      return date.includes('31') && date.includes('01') && date.includes('2026');
    });
    console.log(`  - Events with '31' and '01' and '2026' in date:`, jan31Events.map(e => ({
      id: e.id, 
      date: e.event_date, 
      dateType: typeof e.event_date,
      dateLength: e.event_date ? e.event_date.length : 0,
      program: e.program
    })));
    console.log(`  - Exact match for '2026-01-31':`, 
      allEvents.filter(e => e.event_date === '2026-01-31').map(e => ({id: e.id, program: e.program}))
    );
    console.log(`  - Using includes():`, 
      allEvents.filter(e => e.event_date && e.event_date.includes('2026-01-31')).map(e => ({id: e.id, program: e.program}))
    );
  }
  
  // Group events by date
  const eventsByDate = {};
  
  // CRITICAL DEBUG for January 2026
  if (month === 0 && year === 2026) {
    console.log(`🚨 GROUPING DEBUG - uniqueMonthEvents count: ${uniqueMonthEvents.length}`);
    console.log(`🚨 Events with date containing '31':`, 
      uniqueMonthEvents.filter(e => e.event_date && e.event_date.includes('31')).map(e => ({
        id: e.id,
        date: e.event_date,
        program: e.program
      }))
    );
  }
  
  uniqueMonthEvents.forEach(event => {
    const date = normalizeEventDateKey(event.event_date);
    if (!date) return;
    if (!eventsByDate[date]) {
      eventsByDate[date] = [];
    }
    eventsByDate[date].push(event);
    
    // Debug: Log day 31 events specifically
    if (date && date.endsWith('-31')) {
      console.log('🔍 Found day 31 event in grouping:', {
        date: date,
        program: event.program,
        venue: event.venue,
        id: event.id,
        crew: event.crew
      });
    }
  });
  
  // Log events by date after grouping
  console.log(`  - Events by date:`, Object.keys(eventsByDate).length > 0 ? Object.keys(eventsByDate) : 'No events');
  
  // CRITICAL DEBUG: Check day 31 specifically for current month
  const day31DateStr = `${year}-${String(month + 1).padStart(2, '0')}-31`;
  if (daysInMonth === 31) {
    console.log(`🎯 DEBUGGING DAY 31 for ${monthNames[month]} ${year}:`);
    console.log(`  - Expected date string: ${day31DateStr}`);
    console.log(`  - Events in eventsByDate[${day31DateStr}]:`, eventsByDate[day31DateStr] || 'NONE');
    console.log(`  - Keys in eventsByDate:`, Object.keys(eventsByDate));
    console.log(`  - allEvents with date ${day31DateStr}:`, 
      allEvents.filter(e => e.event_date === day31DateStr).map(e => ({id: e.id, program: e.program}))
    );
  }
  
  // Render calendar grid
  const grid = document.getElementById('calendarGrid');
  if (!grid) {
    return;
  }
  grid.innerHTML = '';
  
  // Add empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day calendar-day-empty';
    grid.appendChild(emptyCell);
  }
  
  // Add cells for each day
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    
    // Highlight today's date with a special background
    cell.className = 'calendar-day calendar-day-active' + (isToday ? ' calendar-day-today' : '');
    
    const dayEvents = eventsByDate[dateStr] || [];
    
    // Debug: Log day 31 specifically
    if (day === 31) {
      console.log(`🔍 Rendering day 31:`, {
        dateStr: dateStr,
        eventsFound: dayEvents.length,
        eventsByDateKeys: Object.keys(eventsByDate),
        hasKey: eventsByDate.hasOwnProperty(dateStr),
        events: dayEvents
      });
    }
    
    // Day number — clickable link that opens the crew availability modal
    const dayNumber = document.createElement('button');
    dayNumber.type = 'button';
    dayNumber.className = (isToday ? 'calendar-day-number calendar-day-number-today' : 'calendar-day-number') + ' calendar-day-number-link';
    dayNumber.textContent = day;
    dayNumber.title = 'View crew availability';
    dayNumber.setAttribute('aria-label', 'View crew availability for ' + dateStr);
    dayNumber.onclick = function(e) {
      e.stopPropagation();
      openDayAvailModal(dateStr);
    };
    cell.appendChild(dayNumber);
    
    // Event cards
    dayEvents.forEach(event => {
      cell.appendChild(createDesktopEventCard(event));
    });
    
    grid.appendChild(cell);
  }

  renderTodaySidebar();
  } catch (err) {
    console.error('renderCalendar failed:', err);
  }
}

function changeMonth(delta) {
  currentDate.setMonth(currentDate.getMonth() + delta);
  if (isMobileView()) {
    renderMobileCalendar();
  } else {
    renderCalendar();
  }
}

// ============================================
// MOBILE WEEK AGENDA VIEW
// ============================================

function isMobileView() {
  return window.innerWidth < 768;
}

function formatDateKeyLocal(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function normalizeEventDateKey(dateValue) {
  if (!dateValue) return '';
  return String(dateValue).trim().slice(0, 10);
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sun, 1 = Mon
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function formatMobileDate(date) {
  const opts = { day: 'numeric', month: 'short' };
  return date.toLocaleDateString('en-GB', opts);
}

function formatMobileDayHeader(date) {
  const dayName = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const dateStr = formatMobileDate(date);
  return dayName + ' ' + dateStr;
}

function renderMobileCalendar(options) {
  options = options || {};
  const weekStart = getWeekStart(currentDate);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  // Update week label
  const weekLabel = document.getElementById('mobileWeekLabel');
  const startStr = formatMobileDate(weekStart);
  const endStr = formatMobileDate(weekEnd);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const yearStr = weekStart.getFullYear();
  if (weekLabel) {
    if (sameMonth) {
      weekLabel.textContent = startStr + ' – ' + weekEnd.getDate() + ' ' + formatMobileDate(weekEnd).split(' ')[1] + ' ' + yearStr;
    } else {
      weekLabel.textContent = startStr + ' – ' + endStr + ' ' + yearStr;
    }
  }

  // Show/hide Today button
  const todayBtn = document.getElementById('mobileTodayBtn');
  const today = new Date();
  const todayWeekStart = getWeekStart(today);
  const isCurrentWeek = weekStart.getTime() === todayWeekStart.getTime();
  if (todayBtn) {
    if (isCurrentWeek) {
      todayBtn.classList.add('hidden');
    } else {
      todayBtn.classList.remove('hidden');
    }
  }

  renderMobileWeekEvents(weekStart, weekEnd);

  if (options.scrollToDate) {
    scrollMobileAgendaToDate(options.scrollToDate);
  }
}

function renderMobileWeekEvents(weekStart, weekEnd) {
  const container = document.getElementById('mobileWeekEvents');
  if (!container) return;
  container.innerHTML = '';

  // Pre-compute eventsByDate from allEvents
  const eventsByDate = {};
  allEvents.forEach(function(event) {
    const date = event.event_date;
    if (!eventsByDate[date]) {
      eventsByDate[date] = [];
    }
    eventsByDate[date].push(event);
  });

  const today = new Date();
  const todayStr = formatDateKeyLocal(today);

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + i);
    const dateStr = formatDateKeyLocal(dayDate);

    // Day section
    const daySection = document.createElement('div');
    daySection.id = 'mobile-day-' + dateStr;
    daySection.dataset.mobileDate = dateStr;

    // Day header — tappable, opens the crew availability modal
    const dayHeader = document.createElement('div');
    dayHeader.className = 'mobile-day-header' + (dateStr === todayStr ? ' today' : '');
    dayHeader.textContent = formatMobileDayHeader(dayDate);
    const availIco = document.createElement('i');
    availIco.className = 'fas fa-users davail-mobile-ico';
    availIco.setAttribute('aria-hidden', 'true');
    dayHeader.appendChild(availIco);
    dayHeader.title = 'View crew availability';
    dayHeader.setAttribute('role', 'button');
    dayHeader.tabIndex = 0;
    dayHeader.style.cursor = 'pointer';
    dayHeader.onclick = function() { openDayAvailModal(dateStr); };
    dayHeader.onkeydown = function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDayAvailModal(dateStr); }
    };
    daySection.appendChild(dayHeader);

    // Events
    const dayEvents = eventsByDate[dateStr] || [];
    if (dayEvents.length === 0) {
      const noShows = document.createElement('div');
      noShows.className = 'mobile-no-shows';
      noShows.textContent = 'No shows';
      daySection.appendChild(noShows);
    } else {
      dayEvents.forEach(function(event) {
        daySection.appendChild(renderMobileEventCard(event));
      });
    }

    container.appendChild(daySection);
  }
}

function scrollMobileAgendaToDate(dateStr) {
  setTimeout(function() {
    var target = document.querySelector('[data-mobile-date="' + dateStr + '"]');
    var scroller = document.getElementById('calendarView');
    var weekNav = document.getElementById('mobileWeekNav');
    if (!target || !scroller) return;

    var scrollerRect = scroller.getBoundingClientRect();
    var targetRect = target.getBoundingClientRect();
    var stickyOffset = weekNav ? weekNav.offsetHeight + 8 : 0;
    var targetTop = Math.max(0, scroller.scrollTop + (targetRect.top - scrollerRect.top) - stickyOffset);

    // Use smooth scroll when supported, otherwise instant fallback
    try {
      scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
    } catch (e) {
      scroller.scrollTop = targetTop;
    }
  }, 100);
}

function renderMobileEventCard(event) {
  const card = document.createElement('div');
  card.className = 'mobile-event-card ' + (isEventGreen(event) ? 'event-card-green' : 'event-card-peach');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.onclick = function() { openEventModal(event); };
  card.onkeypress = function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openEventModal(event);
    }
  };

  // Crew display
  let crewHtml = '';
  if (event.foh_crew || event.stage_crew) {
    if (event.foh_crew) {
      crewHtml += '<div class="mobile-event-crew mobile-event-foh mt-1"><i class="fas fa-headphones mr-1 text-xs"></i>' + escHtml(event.foh_crew) + '</div>';
    }
    if (event.stage_crew) {
      crewHtml += '<div class="mobile-event-crew mobile-event-stage mt-1"><i class="fas fa-volume-up mr-1 text-xs"></i>' + escHtml(event.stage_crew) + '</div>';
    }
  } else if (event.crew) {
    crewHtml = '<div class="mobile-event-crew mt-1"><i class="fas fa-users mr-1"></i>' + escHtml(event.crew) + '</div>';
  }

  card.innerHTML =
    '<div class="mobile-event-program font-semibold text-sm">' + escHtml(event.program) + '</div>' +
    '<div class="mobile-event-venue text-xs mt-1"><i class="fas fa-map-marker-alt mr-1"></i>' + escHtml(displayVenue(event.venue)) + '</div>' +
    crewHtml;

  return card;
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================
// TABLE VIEW
// ============================================

function toggleSelectAll(checked) {
  document.querySelectorAll('.bulk-select-checkbox').forEach(cb => {
    cb.checked = checked;
    const eventId = parseInt(cb.dataset.eventId);
    if (checked) {
      bulkSelection.add(eventId);
    } else {
      bulkSelection.delete(eventId);
    }
  });
  
  if (typeof updateBulkActionBar === 'function') {
    updateBulkActionBar();
  }
}

function renderTable() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  
  if (allEvents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">No events found</td></tr>';
    return;
  }
  
  allEvents.forEach(event => {
    const row = document.createElement('tr');
    row.id = `event-row-${event.id}`; // Add ID for scrolling
    row.className = 'border-b hover:bg-gray-50 transition-colors duration-200';
    
    row.innerHTML = `
      <td class="px-2 py-2 text-center">
        <input type="checkbox" class="bulk-select-checkbox" data-event-id="${event.id}" 
               onchange="toggleBulkSelect(${event.id}, this.checked)">
      </td>
      <td class="px-2 py-2 text-sm">${formatDate(event.event_date)}</td>
      <td class="px-2 py-2 text-sm editable-cell" data-field="program" data-id="${event.id}">${event.program || ''}</td>
      <td class="px-2 py-2 text-sm editable-cell" data-field="venue" data-id="${event.id}">${displayVenue(event.venue) || ''}</td>
      <td class="px-2 py-2 text-sm editable-cell" data-field="team" data-id="${event.id}">${event.team || ''}</td>
      <td class="px-2 py-2 text-sm editable-cell" data-field="sound_requirements" data-id="${event.id}">${event.sound_requirements || ''}</td>
      <td class="px-2 py-2 text-sm editable-cell" data-field="call_time" data-id="${event.id}">${event.call_time || ''}</td>
      <td class="px-2 py-2 text-sm editable-cell" data-field="crew" data-id="${event.id}">${event.crew || ''}</td>
      <td class="px-2 py-2 text-center">
        <button onclick="deleteEvent(${event.id})" class="text-red-600 hover:text-red-800">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
    
    tbody.appendChild(row);
  });
  
  // Add click handlers for editable cells
  document.querySelectorAll('.editable-cell').forEach(cell => {
    cell.addEventListener('click', handleCellEdit);
  });
}

function handleCellEdit(e) {
  const cell = e.currentTarget;
  
  // If already editing this cell, return
  if (currentEditingCell === cell) return;
  
  // Save any previous edit
  if (currentEditingCell) {
    saveCell(currentEditingCell);
  }
  
  currentEditingCell = cell;
  const currentValue = cell.textContent;
  const field = cell.dataset.field;
  
  // Create input based on field type
  let input;
  if (field === 'sound_requirements') {
    input = document.createElement('textarea');
    input.rows = 3;
  } else {
    input = document.createElement('input');
    input.type = 'text';
  }
  
  input.value = currentValue;
  input.className = cell.querySelector('input, textarea')?.className || '';
  
  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();
  
  // Save on blur
  input.addEventListener('blur', () => {
    saveCell(cell);
  });
  
  // Save on Enter (for input, not textarea)
  if (field !== 'sound_requirements') {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      }
    });
  }
}

async function saveCell(cell) {
  const input = cell.querySelector('input, textarea');
  if (!input) return;
  
  const newValue = input.value;
  const field = cell.dataset.field;
  const id = cell.dataset.id;
  
  // Get the full event data
  const event = allEvents.find(e => e.id == id);
  if (!event) return;
  
  // Update the event object
  event[field] = newValue;
  
  try {
    const response = await axios.put(`${API_BASE}/events/${id}`, event);
    
    if (response.data.success) {
      cell.textContent = newValue;
      currentEditingCell = null;
      
      // Reload to get updated requirements_updated flag
      await loadEvents();
      showNotification('Updated successfully', 'success');
    }
  } catch (error) {
    console.error('Error updating event:', error);
    cell.textContent = event[field]; // Revert to original value
    showNotification('Failed to update', 'error');
  }
}

// ============================================
// EVENT MODAL
// ============================================

function openEventModal(event) {
  const modal = document.getElementById('eventModal');
  const content = document.getElementById('eventModalContent');
  const footer = document.getElementById('eventModalFooter');
  if (!modal || !content || !footer) return;
  
  modal.classList.remove('active');

  const isAuthenticated = typeof currentUser !== 'undefined' && currentUser !== null;
  const statusComplete = isEventGreen(event);
  const statusLabel = statusComplete ? 'Ready' : 'Needs Attention';
  
  const soundReqsFormatted = event.sound_requirements 
    ? formatLinksInText(event.sound_requirements) 
    : 'Not specified';
  const soundReqsTitle = event.sound_requirements
    ? escHtml(event.sound_requirements.replace(/\s+/g, ' ').trim())
    : 'Not specified';

  const crewHtml = (event.foh_crew || event.stage_crew) ? `
    ${event.stage_crew ? `<p class="event-detail-value"><span class="event-detail-crew-role"><i class="fas fa-volume-up mr-1 text-xs"></i>Stage:</span> ${event.stage_crew}</p>` : ''}
    ${event.foh_crew ? `<p class="event-detail-value" style="margin-top:2px"><span class="event-detail-crew-role"><i class="fas fa-headphones mr-1 text-xs"></i>FOH:</span> ${event.foh_crew}</p>` : ''}
  ` : `<p class="event-detail-value">${event.crew || 'Not assigned'}</p>`;

  const riderHtml = event.rider ? `
    <div class="event-detail-rider">
      ${event.rider.split(',').map((url, i) => `<a href="${url.trim()}" target="_blank" rel="noopener"><i class="fas fa-external-link-alt mr-1 text-xs"></i>Rider ${i + 1}</a>`).join(' ')}
    </div>
  ` : '';

  const notesHtml = event.notes ? `
    <div class="event-detail-notes">
      <span class="event-detail-label">Notes</span>
      <p class="event-detail-value event-detail-clamp">${event.notes}</p>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="event-detail-status ${statusComplete ? 'is-complete' : 'is-attention'}">
      <span></span>${statusLabel}
    </div>
    <div class="event-detail-stack">
      <div class="event-detail-hero">
        <div class="event-detail-field">
          <span class="event-detail-label">Date</span>
          <p class="event-detail-value">${formatDate(event.event_date)}</p>
        </div>
        <div class="event-detail-field event-detail-program">
          <span class="event-detail-label">Program / Event</span>
          <p class="event-detail-value event-detail-clamp">${event.program}</p>
        </div>
      </div>

      <div class="event-detail-grid">
        <div class="event-detail-field">
          <span class="event-detail-label">Venue</span>
          <p class="event-detail-value">${displayVenue(event.venue)}</p>
        </div>
        <div class="event-detail-field">
          <span class="event-detail-label">Team (curator)</span>
          <p class="event-detail-value">${event.team || 'Not specified'}</p>
        </div>
        <div class="event-detail-field event-detail-sound">
          <span class="event-detail-label">Sound Requirements</span>
          <p class="event-detail-value event-detail-sound-value" title="${soundReqsTitle}">${soundReqsFormatted}</p>
          ${riderHtml}
        </div>
        <div class="event-detail-field">
          <span class="event-detail-label">Call Time</span>
          <p class="event-detail-value">${event.call_time || 'Not specified'}</p>
        </div>
      </div>

      <div class="event-detail-crew">
        <span class="event-detail-label">Crew — Sound Team</span>
        ${crewHtml}
      </div>

      ${notesHtml}

      <div class="event-detail-created">Created ${formatDateTime(event.created_at)}</div>
    </div>
  `;

  if (isAuthenticated) {
    footer.innerHTML = `
      <button type="button" onclick="deleteEventFromModal(${event.id})" class="event-detail-btn modal-img-btn" aria-label="Delete">
        <img src="/static/images/buttons/delete.png" alt="Delete" class="modal-img">
      </button>
      <button type="button" onclick="editEventFromModal(${event.id})" class="event-detail-btn modal-img-btn" aria-label="Edit">
        <img src="/static/images/buttons/edit.png" alt="Edit" class="modal-img">
      </button>
    `;
  } else {
    footer.innerHTML = `
      <p class="event-detail-login">
        <i class="fas fa-lock mr-1"></i>
        Please <a href="#" onclick="closeEventModal(); openLoginModal(); return false;" style="color:#98A2D7;font-weight:600;">login</a> to edit events
      </p>
    `;
  }
  
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      modal.classList.add('active');
    });
  });
}

function closeEventModal() {
  document.getElementById('eventModal').classList.remove('active');
  const footer = document.getElementById('eventModalFooter');
  if (footer) footer.innerHTML = '';
}

// Delete event from modal with confirmation
async function deleteEventFromModal(eventId) {
  // Close modal first
  closeEventModal();
  
  // Show confirmation
  if (!confirm('Are you sure you want to delete?')) {
    return;
  }
  
  try {
    const response = await axios.delete(`${API_BASE}/events/${eventId}`);
    
    if (response.data.success) {
      showNotification('✅ Event deleted successfully', 'success');
      await loadEvents();
      renderCurrentView();
    }
  } catch (error) {
    console.error('Error deleting event:', error);
    showNotification('❌ Failed to delete event', 'error');
  }
}

// ============================================
// ADD SHOW MODAL
// ============================================

function openAddShowModal() {
  // Check authentication
  const isAuthenticated = typeof currentUser !== 'undefined' && currentUser !== null;
  
  if (!isAuthenticated) {
    // Show login modal instead
    openLoginModal();
    showNotification('⚠️ Please login to add events', 'warning');
    return;
  }
  
  document.getElementById('addShowModal').classList.add('active');
  document.getElementById('addShowForm').reset();
  // Hide crew card on open (will show when date is picked)
  var crewCard = document.getElementById('addShowCrewCard');
  if (crewCard) crewCard.style.display = 'none';
}

function closeAddShowModal() {
  document.getElementById('addShowModal').classList.remove('active');
  document.getElementById('addShowForm').reset();
  // Reset crew availability card
  var crewCard = document.getElementById('addShowCrewCard');
  if (crewCard) crewCard.style.display = 'none';
  var crewBody = document.getElementById('addShowCrewBody');
  if (crewBody) crewBody.innerHTML = '<div class="avail-loading"><div class="avail-spinner"></div>Checking availability…</div>';
  _addShowAvail = null;
}

function toggleDateFields() {
  const dateType = document.querySelector('input[name="dateType"]:checked').value;
  const singleDateField = document.getElementById('singleDateField');
  const multipleDateFields = document.getElementById('multipleDateFields');
  const singleDate = document.getElementById('singleDate');
  const startDate = document.getElementById('startDate');
  const endDate = document.getElementById('endDate');
  
  if (dateType === 'single') {
    singleDateField.style.display = 'block';
    multipleDateFields.style.display = 'none';
    singleDate.required = true;
    startDate.required = false;
    endDate.required = false;
  } else {
    singleDateField.style.display = 'none';
    multipleDateFields.style.display = 'block';
    singleDate.required = false;
    startDate.required = true;
    endDate.required = true;
  }
}

async function handleAddShow(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  const dateType = data.dateType;
  
  // FOH and Stage crew will be read at submit time from pill selectors
  const fohCrewSelected = (document.querySelector('input[name="addshow_foh_crew"]:checked') || {}).value || '';
  const stageCrewSelected = Array.from(document.querySelectorAll('input[name="addshow_stage_crew"]:checked')).map(function(i){return i.value;});
  const crewString = [fohCrewSelected, ...stageCrewSelected].filter(Boolean).join(', ') || null;
  
  try {
    if (dateType === 'single') {
      // Single date event
      // Read FOH and Stage crew from the availability pill UI
      const fohCrew = (document.querySelector('input[name="addshow_foh_crew"]:checked') || {}).value || '';
      const stageCrew = Array.from(document.querySelectorAll('input[name="addshow_stage_crew"]:checked')).map(function(i){return i.value;});
      const response = await axios.post(`${API_BASE}/events`, {
        event_date: data.event_date,
        program: data.program,
        venue: data.venue,
        team: data.team || null,
        sound_requirements: data.sound_requirements || null,
        call_time: data.call_time || null,
        foh_crew: fohCrew,
        stage_crew: stageCrew,
        rider: data.rider || null,
        notes: data.notes || null
      });
      
      if (response.data.success) {
        showNotification('Show added successfully', 'success');
        closeAddShowModal();
        await loadEvents();
        
        // Navigate to the month of the added show
        const eventDate = new Date(data.event_date);
        currentDate = new Date(eventDate.getFullYear(), eventDate.getMonth(), 1);
        if (isMobileView()) {
          currentDate = getWeekStart(new Date(data.event_date + 'T00:00:00'));
        }
        renderCurrentView();
      }
    } else {
      // Multiple dates — one API call, shared show_group_id, crew on every day
      const startUTC = new Date(data.start_date + 'T00:00:00Z');
      const endUTC   = new Date(data.end_date   + 'T00:00:00Z');

      if (startUTC > endUTC) {
        showNotification('Start date must be before or equal to end date', 'error');
        return;
      }

      const dates = [];
      const iter = new Date(startUTC);
      while (iter <= endUTC) {
        dates.push(iter.toISOString().slice(0, 10));
        iter.setUTCDate(iter.getUTCDate() + 1);
      }

      showNotification('Creating ' + dates.length + ' event' + (dates.length > 1 ? 's' : '') + '...', 'info');

      const response = await axios.post(`${API_BASE}/events/multi-date`, {
        dates: dates,
        program: data.program,
        venue: data.venue,
        team: data.team || null,
        sound_requirements: data.sound_requirements || null,
        call_time: data.call_time || null,
        foh_crew: fohCrewSelected,
        stage_crew: stageCrewSelected,
        rider: data.rider || null,
        notes: data.notes || null,
      });

      if (!response.data.success) {
        showNotification('Failed to add show: ' + (response.data.error || 'Unknown error'), 'error');
        return;
      }

      showNotification(dates.length + ' event' + (dates.length > 1 ? 's' : '') + ' created', 'success');
      closeAddShowModal();
      await loadEvents();

      currentDate = new Date(startUTC.getUTCFullYear(), startUTC.getUTCMonth(), 1);
      if (isMobileView()) {
        currentDate = getWeekStart(new Date(startUTC));
      }
      renderCurrentView();
    }
  } catch (error) {
    console.error('Error adding show:', error);
    showNotification('Failed to add show: ' + (error.response?.data?.error || error.message), 'error');
  }
}


// ============================================
// CREW AVAILABILITY FOR ADD SHOW MODAL
// ============================================

var _addShowAvailTimer = null;
var _addShowAvail = null;
var _addShowAvailRequestId = 0;

function schedAddShowAvailCheck() {
  clearTimeout(_addShowAvailTimer);
  var requestId = ++_addShowAvailRequestId;
  _addShowAvail = null;
  var card = document.getElementById('addShowCrewCard');
  if (card) card.style.display = 'none';
  var body = document.getElementById('addShowCrewBody');
  if (body) body.innerHTML = '<div class="avail-loading"><div class="avail-spinner"></div>Checking availability…</div>';
  _addShowAvailTimer = setTimeout(function() {
    return doAddShowAvailCheck(requestId);
  }, 280);
}

function getAddShowDates() {
  var dateType = (document.querySelector('input[name="dateType"]:checked') || {}).value || 'single';
  if (dateType === 'single') {
    var singleDate = document.getElementById('singleDate');
    if (singleDate && singleDate.value) return [singleDate.value];
  } else {
    var startDate = document.getElementById('startDate');
    var endDate = document.getElementById('endDate');
    if (startDate && endDate && startDate.value && endDate.value) {
      var out = [], cur = new Date(startDate.value + 'T00:00:00Z'), end = new Date(endDate.value + 'T00:00:00Z');
      while (cur <= end) { out.push(cur.toISOString().slice(0,10)); cur.setUTCDate(cur.getUTCDate()+1); }
      return out;
    }
  }
  return [];
}

async function doAddShowAvailCheck(requestId) {
  if (requestId == null) requestId = ++_addShowAvailRequestId;
  if (requestId !== _addShowAvailRequestId) return;
  var dates = getAddShowDates();
  var card = document.getElementById('addShowCrewCard');
  if (!dates.length) { if (card) card.style.display = 'none'; return; }
  if (card) card.style.display = 'block';
  var body = document.getElementById('addShowCrewBody');
  if (body) body.innerHTML = '<div class="avail-loading"><div class="avail-spinner"></div>Checking ' + dates.length + ' date' + (dates.length > 1 ? 's' : '') + '\u2026</div>';
  try {
    var r = await fetch('/api/crew-availability?dates=' + dates.join(','));
    var d = await r.json();
    if (requestId !== _addShowAvailRequestId) return;
    if (!d.success) throw new Error(d.error);
    _addShowAvail = d;
    renderAddShowAvail(d);
  } catch(e) {
    if (requestId !== _addShowAvailRequestId) return;
    if (body) body.innerHTML = '<div class="ncpa-status ncpa-status--error" style="font-size:13px;padding:4px 0">&#9888; ' + addShowEscHtml(e.message) + '</div>';
  }
}

function renderAddShowAvail(d) {
  var h = '';
  if (d.conflicts && d.conflicts.length) {
    h += '<div class="avail-cbox"><strong>&#9888; Existing shows on ' + (d.dates.length > 1 ? 'these dates' : 'this date') + ':</strong>';
    d.conflicts.forEach(function(c) {
      var crew = [c.foh_crew, c.stage_crew, c.crew].filter(Boolean).join(', ') || 'no crew yet';
      h += '<div class="avail-citem">&bull; ' + addShowEscHtml(c.event_date) + ': <strong>' + addShowEscHtml(c.program) + '</strong> @ ' + addShowEscHtml(c.venue) + ' (' + addShowEscHtml(crew) + ')</div>';
    });
    h += '</div>';
  }
  if (!d.available.length) {
    h += '<div class="avail-no-crew">No crew available for the selected date(s).</div>';
  } else {
    h += '<div class="avail-role-hdr"><span class="avail-role-label">FOH Engineer</span><span class="avail-role-badge avail-badge-foh">Single select</span></div>';
    h += '<p class="avail-role-hint">Select one crew member as Front-of-House engineer.</p>';
    h += '<div class="avail-pill-grid">';
    d.available.forEach(function(name) {
      var id = 'addshow_foh_' + addShowSid(name);
      h += '<div class="avail-cpill avail-foh-pill"><input type="radio" name="addshow_foh_crew" id="' + id + '" value="' + addShowEscHtml(name) + '" onchange="onAddShowFoh(this)"><label for="' + id + '">' + addShowEscHtml(name) + '</label></div>';
    });
    h += '<div class="avail-cpill avail-foh-pill avail-none-pill"><input type="radio" name="addshow_foh_crew" id="addshow_foh_none" value="" checked><label for="addshow_foh_none">None / TBD</label></div>';
    h += '</div>';
    h += '<div class="avail-divider"></div>';
    h += '<div class="avail-role-hdr"><span class="avail-role-label">Stage Crew</span><span class="avail-role-badge avail-badge-stage">Multi select</span></div>';
    h += '<p class="avail-role-hint">Select one or more stage crew members.</p>';
    h += '<div class="avail-pill-grid">';
    d.available.forEach(function(name) {
      var id = 'addshow_stage_' + addShowSid(name);
      h += '<div class="avail-cpill avail-stage-pill"><input type="checkbox" name="addshow_stage_crew" id="' + id + '" value="' + addShowEscHtml(name) + '" onchange="onAddShowStage(this)"><label for="' + id + '">' + addShowEscHtml(name) + '</label></div>';
    });
    h += '</div>';
  }
  if (d.assigned.length || d.unavailable.length) {
    h += '<div class="avail-divider"></div>';
    h += '<div class="avail-excl-hdr">Excluded from selection</div>';
    h += '<div class="avail-excl-grid">';
    d.assigned.forEach(function(n) { h += '<span class="avail-etag avail-etag-a">&#128274; ' + addShowEscHtml(n) + ' (assigned)</span>'; });
    d.unavailable.forEach(function(n) { h += '<span class="avail-etag avail-etag-b">&#9940; ' + addShowEscHtml(n) + ' (blocked)</span>'; });
    h += '</div>';
  }
  var body = document.getElementById('addShowCrewBody');
  if (body) body.innerHTML = h;
}

function onAddShowFoh(radio) {
  if (!radio.value) return;
  var cb = document.getElementById('addshow_stage_' + addShowSid(radio.value));
  if (cb) cb.checked = false;
}

function onAddShowStage(cb) {
  if (!cb.checked) return;
  var radio = document.querySelector('input[name="addshow_foh_crew"]:checked');
  if (radio && radio.value === cb.value) {
    var none = document.getElementById('addshow_foh_none');
    if (none) none.checked = true;
  }
}

function addShowSid(s) { return String(s).replace(/[^a-zA-Z0-9]/g, '_'); }

function addShowEscHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Wire date change listeners for crew availability check
// Called after DOMContentLoaded to ensure elements exist
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    var singleDate = document.getElementById('singleDate');
    var startDate = document.getElementById('startDate');
    var endDate = document.getElementById('endDate');
    if (singleDate) singleDate.addEventListener('change', schedAddShowAvailCheck);
    if (startDate) startDate.addEventListener('change', schedAddShowAvailCheck);
    if (endDate) endDate.addEventListener('change', schedAddShowAvailCheck);
    // Also wire the dateType radio buttons so switching modes re-checks
    document.querySelectorAll('input[name="dateType"]').forEach(function(r) {
      r.addEventListener('change', schedAddShowAvailCheck);
    });
  });
})();

// ============================================
// DAY CREW AVAILABILITY MODAL (calendar date link)
// ============================================

var _dayAvailRequestedDate = null;

function openDayAvailModal(dateStr) {
  var modal = document.getElementById('dayAvailModal');
  if (!modal) return;
  var title = document.getElementById('dayAvailTitle');
  if (title) {
    var d = new Date(dateStr + 'T00:00:00');
    title.textContent = isNaN(d.getTime()) ? dateStr
      : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  var body = document.getElementById('dayAvailBody');
  if (body) body.innerHTML = '<div class="avail-loading"><div class="avail-spinner"></div>Checking crew availability…</div>';
  modal.classList.add('active');
  _dayAvailRequestedDate = dateStr;
  fetch('/api/crew-availability?dates=' + encodeURIComponent(dateStr))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (dateStr !== _dayAvailRequestedDate) return; // superseded by a later request
      if (!d.success) throw new Error(d.error || 'Failed to load availability');
      renderDayAvail(d);
    })
    .catch(function(e) {
      if (dateStr !== _dayAvailRequestedDate) return; // superseded by a later request
      if (body) body.innerHTML = '<div class="ncpa-status ncpa-status--error" style="font-size:13px;padding:8px 0">&#9888; ' + addShowEscHtml(e.message) + '</div>';
    });
}

function closeDayAvailModal() {
  var modal = document.getElementById('dayAvailModal');
  if (modal) modal.classList.remove('active');
  _dayAvailRequestedDate = null;
}

function renderDayAvail(d) {
  var esc = addShowEscHtml;
  var onShows = d.assigned || [];
  var onLeave = d.unavailable || [];
  var avail = d.available || [];
  var h = '';

  // Summary strip
  h += '<div class="davail-summary">';
  h += '<span class="davail-count davail-count-show"><i class="fas fa-music" aria-hidden="true"></i> ' + onShows.length + ' on shows</span>';
  h += '<span class="davail-count davail-count-leave"><i class="fas fa-ban" aria-hidden="true"></i> ' + onLeave.length + ' on leave</span>';
  h += '<span class="davail-count davail-count-avail"><i class="fas fa-check" aria-hidden="true"></i> ' + avail.length + ' available</span>';
  h += '</div>';

  // On shows — just the names of crew occupied on shows (the calendar
  // already shows which shows those are)
  h += '<div class="davail-sec-hdr">On shows (' + onShows.length + ')</div>';
  if (!onShows.length) {
    h += '<div class="davail-empty">Nobody on shows.</div>';
  } else {
    h += '<div class="davail-tags">';
    onShows.forEach(function(n) { h += '<span class="davail-tag davail-tag-show">' + esc(n) + '</span>'; });
    h += '</div>';
  }

  // On leave / blocked
  h += '<div class="davail-sec-hdr">On leave / blocked (' + onLeave.length + ')</div>';
  if (!onLeave.length) {
    h += '<div class="davail-empty">Nobody on leave.</div>';
  } else {
    h += '<div class="davail-tags">';
    onLeave.forEach(function(n) { h += '<span class="davail-tag davail-tag-leave">&#9940; ' + esc(n) + '</span>'; });
    h += '</div>';
  }

  // Available
  h += '<div class="davail-sec-hdr">Available (' + avail.length + ')</div>';
  if (!avail.length) {
    h += '<div class="davail-empty">No crew available.</div>';
  } else {
    h += '<div class="davail-tags">';
    avail.forEach(function(n) { h += '<span class="davail-tag davail-tag-avail">' + esc(n) + '</span>'; });
    h += '</div>';
  }

  var body = document.getElementById('dayAvailBody');
  if (body) body.innerHTML = h;
}

// ============================================
// EDIT EVENT
// ============================================

function toggleEditDateFields() {
  const dateType = document.querySelector('input[name="editDateType"]:checked').value;
  const singleDateField = document.getElementById('editSingleDateField');
  const multipleDateFields = document.getElementById('editMultipleDateFields');
  const singleDate = document.getElementById('editSingleDate');
  const startDate = document.getElementById('editStartDate');
  const endDate = document.getElementById('editEndDate');
  
  if (dateType === 'single') {
    singleDateField.style.display = 'block';
    multipleDateFields.style.display = 'none';
    singleDate.required = true;
    startDate.required = false;
    endDate.required = false;
  } else {
    singleDateField.style.display = 'none';
    multipleDateFields.style.display = 'block';
    singleDate.required = false;
    startDate.required = true;
    endDate.required = true;
    // Pre-fill start date with current event date
    if (singleDate.value) {
      startDate.value = singleDate.value;
    }
  }
}

// Live crew roster (from the shared crew DB) — cached for the session so we
// don't refetch on every edit. The roster is the single source of truth, so
// crew removed in the automation app (e.g. Nikhil) no longer appear here.
var _crewRosterCache = null;
async function fetchCrewRoster() {
  if (_crewRosterCache) return _crewRosterCache;
  try {
    var r = await fetch('/api/crew-roster');
    var d = await r.json();
    if (d && d.success && Array.isArray(d.roster)) {
      _crewRosterCache = d.roster;
      return _crewRosterCache;
    }
  } catch (e) { /* fall through to empty */ }
  return [];
}

// Rebuild the Edit modal's FOH dropdown and Stage checkbox grid from the live
// roster. Any crew already assigned to this event but no longer in the roster
// are still shown (tagged "removed") so editing an older show never silently
// drops them.
function renderEditCrewControls(roster, fohValue, stageList) {
  roster = Array.isArray(roster) ? roster.slice() : [];
  var extra = [];
  [fohValue].concat(stageList || []).forEach(function(n) {
    n = (n || '').trim();
    if (n && roster.indexOf(n) === -1 && extra.indexOf(n) === -1) extra.push(n);
  });
  var all = roster.concat(extra);
  var isRemoved = function(n) { return roster.indexOf(n) === -1; };

  var fohSelect = document.getElementById('editFohCrew');
  if (fohSelect) {
    var opts = '<option value="">— none —</option>';
    all.forEach(function(n) {
      opts += '<option value="' + addShowEscHtml(n) + '">' + addShowEscHtml(n) +
              (isRemoved(n) ? ' (removed)' : '') + '</option>';
    });
    fohSelect.innerHTML = opts;
  }

  var grid = document.querySelector('#editEventForm .stage-crew-grid');
  if (grid) {
    var html = '';
    all.forEach(function(n) {
      html += '<label class="flex items-center space-x-2 cursor-pointer hover:bg-white/70 p-1 rounded">' +
              '<input type="checkbox" value="' + addShowEscHtml(n) + '" class="crew-checkbox stage-checkbox">' +
              '<span class="text-sm">' + addShowEscHtml(n) + (isRemoved(n) ? ' (removed)' : '') + '</span></label>';
    });
    grid.innerHTML = html;
  }
}

async function editEventFromModal(eventId) {
  // Close event detail modal
  closeEventModal();

  // Fetch event details
  try {
    const response = await axios.get(`${API_BASE}/events/${eventId}`);
    if (response.data.success) {
      const event = response.data.data;

      // Populate form
      document.getElementById('editEventId').value = event.id;
      document.getElementById('editSingleDate').value = event.event_date;
      document.getElementById('editProgram').value = event.program;
      document.getElementById('editVenue').value = event.venue;
      document.getElementById('editTeam').value = event.team || '';
      document.getElementById('editSoundReq').value = event.sound_requirements || '';
      document.getElementById('editCallTime').value = event.call_time || '';
      document.getElementById('editRider').value = event.rider || '';
      document.getElementById('editNotes').value = event.notes || '';

      // Stage list — prefer stage_crew; fall back to the combined crew list
      // for pre-FOH/Stage events. Guard against stage_crew being a non-string
      // (e.g. empty BLOB returned as [] by D1).
      const _sc = event.stage_crew;
      const stageList = (typeof _sc === 'string' && _sc)
        ? _sc.split(',').map(c => c.trim())
        : (!event.foh_crew && event.crew && typeof event.crew === 'string')
          ? event.crew.split(',').map(c => c.trim())
          : [];

      // Build FOH + Stage controls from the live crew roster (removed crew such
      // as Nikhil drop off), then apply this event's current selections.
      const roster = await fetchCrewRoster();
      renderEditCrewControls(roster, event.foh_crew || '', stageList);

      // FOH — single select dropdown
      const fohSelect = document.getElementById('editFohCrew');
      if (fohSelect) {
        fohSelect.value = event.foh_crew || '';
      }

      // Stage — check the boxes for this event's stage crew
      document.querySelectorAll('.stage-checkbox').forEach(cb => {
        cb.checked = stageList.includes(cb.value);
      });

      // Reset to single date mode
      document.querySelector('input[name="editDateType"][value="single"]').checked = true;
      toggleEditDateFields();

      // Multi-date siblings (consecutive run or shared show_group_id)
      const siblings = (response.data.multi_date_siblings && response.data.multi_date_siblings.length > 0)
        ? response.data.multi_date_siblings
        : findMultiDateSiblings(event, allEvents);
      var propagateRow = document.getElementById('editCrewPropagateRow');
      var propagateCb  = document.getElementById('editPropagateCrew');
      if (propagateRow && propagateCb) {
        if (siblings.length > 0) {
          var siblingsHaveNoCrew = siblings.every(function(e) { return !eventHasCrew(e); });
          var sibDates = siblings.map(function(e) { return e.event_date; }).sort().join(', ');
          document.getElementById('editPropagateLabel').textContent =
            'Apply crew to ' + siblings.length + ' other date' + (siblings.length > 1 ? 's' : '') +
            ' in this run (' + sibDates + ')';
          propagateCb.checked = siblingsHaveNoCrew;
          propagateRow.style.display = 'block';
          propagateRow.dataset.siblingIds = JSON.stringify(siblings.map(function(e) { return e.id; }));
          propagateRow.dataset.showGroupId = event.show_group_id || '';
        } else {
          propagateRow.style.display = 'none';
          propagateCb.checked = false;
          propagateRow.dataset.siblingIds = '[]';
          propagateRow.dataset.showGroupId = '';
        }
      }

      // Open edit modal
      document.getElementById('editEventModal').classList.add('active');
    }
  } catch (error) {
    console.error('Error fetching event:', error);
    showNotification('Failed to load event details', 'error');
  }
}

function closeEditEventModal() {
  document.getElementById('editEventModal').classList.remove('active');
  const fohSelect = document.getElementById('editFohCrew');
  if (fohSelect) fohSelect.value = '';
  document.querySelectorAll('.stage-checkbox').forEach(cb => { cb.checked = false; });
  var propagateRow = document.getElementById('editCrewPropagateRow');
  if (propagateRow) {
    propagateRow.style.display = 'none';
    propagateRow.dataset.siblingIds = '[]';
    propagateRow.dataset.showGroupId = '';
  }
  var propagateCb = document.getElementById('editPropagateCrew');
  if (propagateCb) propagateCb.checked = false;
}

async function handleEditEvent(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  const dateType = data.editDateType;
  const eventId = data.event_id;

  // FOH — single value from dropdown
  const fohCrew = document.getElementById('editFohCrew')?.value || null;

  // Stage — multi-select checkboxes
  const stageCrew = [];
  document.querySelectorAll('.stage-checkbox:checked').forEach(cb => {
    stageCrew.push(cb.value);
  });
  const stageCrewString = stageCrew.length > 0 ? stageCrew.join(', ') : null;

  // Combined crew for backward-compat (FOH first, then Stage)
  const crewParts = [fohCrew, stageCrewString].filter(Boolean);
  const crewString = crewParts.length > 0 ? crewParts.join(', ') : null;
  
  try {
    if (dateType === 'single') {
      // Simple update for single date
      const response = await axios.put(`${API_BASE}/events/${eventId}`, {
        event_date: data.event_date,
        program: data.program,
        venue: data.venue,
        team: data.team || null,
        sound_requirements: data.sound_requirements || null,
        call_time: data.call_time || null,
        crew: crewString,
        foh_crew: fohCrew || null,
        stage_crew: stageCrewString,
        rider: data.rider || null,
        notes: data.notes || null
      });

      if (response.data.success) {
        // Propagate crew to sibling events if requested — isolated so a
        // propagation failure doesn't leave the modal open / calendar stale
        var propagateCb = document.getElementById('editPropagateCrew');
        if (propagateCb && propagateCb.checked) {
          var propagateRow = document.getElementById('editCrewPropagateRow');
          var siblingIds = JSON.parse((propagateRow && propagateRow.dataset.siblingIds) || '[]');
          if (siblingIds.length > 0) {
            try {
              var groupId = (propagateRow && propagateRow.dataset.showGroupId) || '';
              if (!groupId && typeof crypto !== 'undefined' && crypto.randomUUID) {
                groupId = crypto.randomUUID();
              }
              var allIds = [parseInt(eventId, 10)].concat(siblingIds);
              await axios.put(`${API_BASE}/events/bulk-crew`, {
                ids: allIds,
                foh_crew: fohCrew || null,
                stage_crew: stageCrewString,
                show_group_id: groupId || undefined,
              });
            } catch (propErr) {
              console.error('Crew propagation failed:', propErr);
              showNotification('Event saved, but crew propagation to other dates failed', 'warning');
            }
          }
        }
        showNotification('Event updated successfully', 'success');
      closeEditEventModal();
      await loadEvents();
      renderCurrentView();
    }
    } else {
      // Multiple dates - update original and create copies for additional dates
      const startDate = new Date(data.start_date);
      const endDate = new Date(data.end_date);

      if (startDate > endDate) {
        showNotification('Start date must be before or equal to end date', 'error');
        return;
      }

      var propagateRowExtend = document.getElementById('editCrewPropagateRow');
      var groupIdExtend = (propagateRowExtend && propagateRowExtend.dataset.showGroupId) || '';
      if (!groupIdExtend && typeof crypto !== 'undefined' && crypto.randomUUID) {
        groupIdExtend = crypto.randomUUID();
      }

      // Update original event to start date
      await axios.put(`${API_BASE}/events/${eventId}`, {
        event_date: data.start_date,
        program: data.program,
        venue: data.venue,
        team: data.team || null,
        sound_requirements: data.sound_requirements || null,
        call_time: data.call_time || null,
        crew: crewString,
        foh_crew: fohCrew || null,
        stage_crew: stageCrewString,
        rider: data.rider || null,
        notes: data.notes || null,
        show_group_id: groupIdExtend || null,
      });

      // Create copies for remaining dates
      const events = [];
      const currentDateIter = new Date(startDate);
      currentDateIter.setDate(currentDateIter.getDate() + 1);

      while (currentDateIter <= endDate) {
        events.push({
          event_date: currentDateIter.toISOString().split('T')[0],
          program: data.program,
          venue: data.venue,
          team: data.team || null,
          sound_requirements: data.sound_requirements || null,
          call_time: data.call_time || null,
          crew: crewString,
          foh_crew: fohCrew || null,
          stage_crew: stageCrewString,
          rider: data.rider || null,
          notes: data.notes || null,
          show_group_id: groupIdExtend || null,
        });
        currentDateIter.setDate(currentDateIter.getDate() + 1);
      }
      
      if (events.length > 0) {
        await axios.post(`${API_BASE}/events/bulk`, { events, source: 'manual' });
      }
      
      const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
      showNotification(`Event extended to ${totalDays} dates`, 'success');
      closeEditEventModal();
      await loadEvents();
      renderCurrentView();
    }
  } catch (error) {
    console.error('Error updating event:', error);
    showNotification('Failed to update event: ' + (error.response?.data?.error || error.message), 'error');
  }
}

// ============================================
// CSV UPLOAD
// ============================================

function handleCSVUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  showNotification('Parsing CSV file...', 'info');
  
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      console.log('CSV parsed, total rows:', results.data.length);
      console.log('CSV headers:', Object.keys(results.data[0] || {}));
      console.log('First row sample:', results.data[0]);
      
      const allParsed = results.data.map((row, index) => {
        const parsed = {
          row: index + 1,
          event_date: parseDate(row['Date'] || row['date'] || row['EVENT DATE'] || row['Event Date']),
          original_date: row['Date'] || row['date'] || row['EVENT DATE'] || row['Event Date'],
          program: row['Program'] || row['program'] || row['Program/Event'] || row['Event'] || '',
          venue: row['Venue'] || row['venue'] || '',
          team: row['Team'] || row['team'] || row['Curator'] || '',
          sound_requirements: row['Sound Requirements'] || row['sound_requirements'] || row['Sound Requirement'] || row['sound_requirement'] || '',
          call_time: row['Call Time'] || row['call_time'] || row['CallTime'] || '',
          crew: row['Crew'] || row['crew'] || row['Sound Crew'] || ''
        };
        return parsed;
      });
      
      const validEvents = allParsed.filter(event => event.event_date && event.program && event.venue);
      const invalidEvents = allParsed.filter(event => !event.event_date || !event.program || !event.venue);
      
      console.log('Valid events:', validEvents.length);
      console.log('Invalid/skipped events:', invalidEvents.length);
      
      if (invalidEvents.length > 0) {
        console.log('Invalid events details:', invalidEvents);
      }
      
      if (validEvents.length === 0) {
        showNotification(`No valid events found. ${results.data.length} rows in CSV, but all missing required fields (Date, Program, or Venue)`, 'error');
        return;
      }
      
      // Remove the metadata fields before sending
      const eventsToUpload = validEvents.map(e => ({
        event_date: e.event_date,
        program: e.program,
        venue: e.venue,
        team: e.team,
        sound_requirements: e.sound_requirements,
        call_time: e.call_time,
        crew: e.crew
      }));
      
      try {
        showNotification(`Uploading ${eventsToUpload.length} events...`, 'info');
        const response = await axios.post(`${API_BASE}/events/bulk`, { events: eventsToUpload });
        
        if (response.data.success) {
          const stats = response.data.stats || {};
          const uploaded = stats.inserted || response.data.data.length;
          const duplicates = stats.skipped || 0;
          const invalid = stats.invalid || 0;
          
          let message = `✓ ${uploaded} new events added`;
          if (duplicates > 0) {
            message += `, ${duplicates} duplicates skipped`;
          }
          if (invalid > 0 || invalidEvents.length > 0) {
            message += `, ${invalid + invalidEvents.length} invalid entries ignored`;
          }
          
          showNotification(message, 'success');
          await loadEvents();
        } else {
          showNotification(`Upload failed: ${response.data.error || 'Unknown error'}`, 'error');
        }
      } catch (error) {
        console.error('Error uploading CSV:', error);
        showNotification(`Failed to upload CSV: ${error.response?.data?.error || error.message}`, 'error');
      }
    },
    error: (error) => {
      console.error('Error parsing CSV:', error);
      showNotification(`Failed to parse CSV file: ${error.message}`, 'error');
    }
  });
  
  // Reset file input
  e.target.value = '';
}

// ============================================
// WORD DOCUMENT UPLOAD
// ============================================

async function handleWordUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const progressToast = createUploadProgressToast();
  let animInterval = null;

  try {
    updateUploadProgress(progressToast, 5, '📄 Extracting text from Word document...');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value;

    // Extract month/year from filename for navigation
    const monthMatch = file.name.match(/(january|february|march|april|may|june|july|august|september|october|november|december)/i);
    const yearMatch = file.name.match(/20\d{2}/);
    let uploadedMonth = null;
    let uploadedYear = null;
    if (monthMatch && yearMatch) {
      const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
      uploadedMonth = monthNames.indexOf(monthMatch[0].toLowerCase());
      uploadedYear = parseInt(yearMatch[0]);
    }

    const estimatedChunks = Math.ceil(text.length / 12000);
    const estimatedMs = estimatedChunks * 15000;
    const chunkLabel = estimatedChunks > 1 ? `${estimatedChunks} chunks` : '1 chunk';
    updateUploadProgress(progressToast, 15, `🤖 AI parsing document (${chunkLabel})...`);

    // Animate progress bar during AI call (15% → 80% over estimated time)
    let elapsed = 0;
    animInterval = setInterval(() => {
      elapsed += 600;
      const pct = 15 + (65 * Math.min(elapsed / estimatedMs, 0.95));
      updateUploadProgress(progressToast, pct, `🤖 AI parsing document (${chunkLabel})...`);
    }, 600);

    const response = await axios.post(`${API_BASE}/ai/parse-word`, {
      text: text,
      filename: file.name
    }, { timeout: 180000 });

    clearInterval(animInterval);
    animInterval = null;

    if (!response.data.success) {
      throw new Error(response.data.error || 'AI parsing failed');
    }

    const events = response.data.events;
    const uniqueEvents = response.data.uniqueEvents || events.length;

    if (events.length === 0) {
      updateUploadProgress(progressToast, 100, '❌ No events found in document', 'error');
      setTimeout(() => removeUploadProgress(progressToast), 8000);
      return;
    }

    updateUploadProgress(progressToast, 85, `⬆️ Uploading ${uniqueEvents} events to database...`);

    const uploadResponse = await axios.post(`${API_BASE}/events/bulk`, { events });

    if (uploadResponse.data.success) {
      const stats = uploadResponse.data.stats || {};
      const uploaded = stats.inserted || uploadResponse.data.data.length;
      const duplicates = stats.skipped || 0;
      const invalid = stats.invalid || 0;

      await loadEvents();
      if (uploadedMonth !== null && uploadedYear !== null) {
        currentDate = new Date(uploadedYear, uploadedMonth, 1);
        if (isMobileView()) {
          currentDate = getWeekStart(new Date(uploadedYear, uploadedMonth, 1));
        }
        renderCurrentView();
      }

      let message = `✅ ${uploaded} events added`;
      if (duplicates > 0) message += `, ${duplicates} duplicates skipped`;
      if (invalid > 0) message += `, ${invalid} invalid`;

      const notificationType = uploaded > 0 ? 'success' : 'info';
      updateUploadProgress(progressToast, 100, message, notificationType);
      setTimeout(() => removeUploadProgress(progressToast), 6000);
    } else {
      updateUploadProgress(progressToast, 100, `❌ Upload failed: ${uploadResponse.data.error || 'Unknown error'}`, 'error');
      setTimeout(() => removeUploadProgress(progressToast), 8000);
    }

  } catch (error) {
    if (animInterval) clearInterval(animInterval);
    let errorMessage = 'Failed to parse Word document';
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      errorMessage = 'Timed out — document may be too large. Try CSV upload instead.';
    } else if (error.response?.data?.error) {
      errorMessage = error.response.data.error;
    } else if (error.message) {
      errorMessage = error.message;
    }
    updateUploadProgress(progressToast, 100, `❌ ${errorMessage}`, 'error');
    setTimeout(() => removeUploadProgress(progressToast), 8000);
  } finally {
    e.target.value = '';
  }
}


function parseEventLine(text) {
  let program = '';
  let venue = '';
  let sound_requirements = '';
  let call_time = '';
  let crew = '';
  
  // Extract venue
  if (text.includes('TET') || text.includes('Experimental')) venue = 'Experimental Theatre';
  else if (text.includes('TT') || text.includes('Tata')) venue = 'Tata Theatre';
  else if (text.includes('Jamshed')) venue = 'Jamshed Bhabha Theatre';
  else if (text.includes('Little')) venue = 'Little Theatre';
  
  // Extract program (text before venue or before requirements keywords)
  const venueIndex = venue ? text.indexOf(venue) : -1;
  if (venueIndex > 0) {
    program = text.substring(0, venueIndex).trim();
  } else {
    const reqIndex = text.search(/(?:Stage|Sound|Light|AC|Projector|requirement|setup)/i);
    if (reqIndex > 0) {
      program = text.substring(0, reqIndex).trim();
    } else {
      program = text.substring(0, Math.min(150, text.length)).trim();
    }
  }
  
  // Remove curator team from program (in square brackets)
  program = program.replace(/\[.*?\]/g, '').trim();
  
  // Extract sound requirements
  const reqStartIndex = text.search(/(?:Stage|Sound|Light|AC|Projector|requirement|setup|technician)/i);
  if (reqStartIndex > 0) {
    sound_requirements = text.substring(reqStartIndex).trim();
  } else if (venueIndex > 0) {
    const afterVenue = text.substring(venueIndex + venue.length).trim();
    sound_requirements = afterVenue;
  }
  
  // Extract call time
  call_time = extractCallTime(sound_requirements);
  
  // Extract crew names
  const crewMatch = sound_requirements.match(/(?:Ashwin|Raj|Amit|Gawde|crew)/gi);
  if (crewMatch) {
    crew = [...new Set(crewMatch)].join(', ');
  }
  
  return { program, venue, sound_requirements, call_time, crew };
}

function extractCallTime(requirementsText) {
  if (!requirementsText) return '';
  
  // Priority 1: Sound-specific times
  const soundPatterns = [
    /sound\s+(?:at|by|from|setup|check|ready)\s+(?:by\s+)?(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/gi,
    /sound\s+requirements?.*?(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/gi,
    /(?:ashwin|crew|sound team).*?(?:at|by|from)\s+(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/gi
  ];
  
  for (const pattern of soundPatterns) {
    const match = requirementsText.match(pattern);
    if (match) {
      const timeMatch = match[0].match(/(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/i);
      if (timeMatch) {
        return normalizeTime(timeMatch[1]) + ' (Sound)';
      }
    }
  }
  
  // Priority 2: General technical times
  const techPatterns = [
    /(?:ready|setup|technicians?)\s+(?:at|by|from)\s+(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/gi,
    /(?:technical|tech).*?(?:at|by|from)\s+(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/gi
  ];
  
  for (const pattern of techPatterns) {
    const match = requirementsText.match(pattern);
    if (match) {
      const timeMatch = match[0].match(/(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/i);
      if (timeMatch) {
        return normalizeTime(timeMatch[1]) + ' (Tech)';
      }
    }
  }
  
  // Priority 3: Utility times
  const utilityPatterns = [
    /AC\s+(?:at|by|from)\s+(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/gi,
    /light(?:s|ing)?\s+(?:at|by|from)\s+(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/gi
  ];
  
  for (const pattern of utilityPatterns) {
    const match = requirementsText.match(pattern);
    if (match) {
      const timeMatch = match[0].match(/(\d{1,2}(?::\d{2})?\.?\d{0,2}\s*(?:am|pm))/i);
      if (timeMatch) {
        const timeValue = normalizeTime(timeMatch[1]);
        if (/AC/i.test(match[0])) return timeValue + ' (AC)';
        else if (/light/i.test(match[0])) return timeValue + ' (Lights)';
      }
    }
  }
  
  return '';
}

function normalizeTime(timeStr) {
  timeStr = timeStr.trim();
  timeStr = timeStr.replace(/\./g, ':');
  timeStr = timeStr.replace(/(\d)([ap]m)/i, '$1 $2');
  timeStr = timeStr.replace(/am/i, 'AM').replace(/pm/i, 'PM');
  return timeStr;
}

function parseMonthName(monthStr) {
  const months = {
    'jan': 1, 'january': 1,
    'feb': 2, 'february': 2,
    'mar': 3, 'march': 3,
    'apr': 4, 'april': 4,
    'may': 5,
    'jun': 6, 'june': 6,
    'jul': 7, 'july': 7,
    'aug': 8, 'august': 8,
    'sep': 9, 'september': 9,
    'oct': 10, 'october': 10,
    'nov': 11, 'november': 11,
    'dec': 12, 'december': 12
  };
  
  return months[monthStr.toLowerCase()] || null;
}

// ============================================
// DELETE EVENT
// ============================================

async function deleteEvent(id) {
  if (!confirm('Are you sure you want to delete?')) {
    return;
  }
  
  try {
    const response = await axios.delete(`${API_BASE}/events/${id}`);
    
    if (response.data.success) {
      showNotification('Event deleted successfully', 'success');
      await loadEvents();
    }
  } catch (error) {
    console.error('Error deleting event:', error);
    showNotification('Failed to delete event', 'error');
  }
}

// Bulk delete events by month
async function bulkDeleteEvents() {
  const month = document.getElementById('bulkDeleteMonth').value;
  const year = document.getElementById('bulkDeleteYear').value;
  
  if (!month || !year) {
    showNotification('Please select both month and year', 'error');
    return;
  }
  
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[parseInt(month)];
  
  if (!confirm(`Are you sure you want to delete ALL events from ${monthName} ${year}?\n\nThis action cannot be undone.`)) {
    return;
  }
  
  const statusDiv = document.getElementById('bulkDeleteStatus');
  statusDiv.textContent = 'Deleting...';
  statusDiv.className = 'ncpa-status ncpa-status--info';
  
  try {
    const response = await axios.post(`${API_BASE}/events/bulk-delete`, {
      month: parseInt(month),
      year: parseInt(year)
    });
    
    if (response.data.success) {
      const deleted = response.data.deleted;
      showNotification(`✅ Deleted ${deleted} events from ${monthName} ${year}`, deleted > 0 ? 'success' : 'info');
      statusDiv.textContent = deleted > 0
        ? `Last action: Deleted ${deleted} events`
        : 'No events found for that month';
      statusDiv.className = deleted > 0 ? 'ncpa-status ncpa-status--success' : 'ncpa-status ncpa-status--info';
      
      // Reload events
      await loadEvents();
      
      // Reset dropdowns
      document.getElementById('bulkDeleteMonth').value = '';
      document.getElementById('bulkDeleteYear').value = '';
    } else {
      const errorMessage = response.data.error || 'Delete failed';
      showNotification(`Failed to delete events: ${errorMessage}`, 'error');
      statusDiv.textContent = errorMessage;
      statusDiv.className = 'ncpa-status ncpa-status--error';
    }
  } catch (error) {
    console.error('Error bulk deleting events:', error);
    const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
    showNotification(`Failed to delete events: ${errorMessage}`, 'error');
    statusDiv.textContent = 'Error deleting events';
    statusDiv.className = 'ncpa-status ncpa-status--error';
  }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { 
    weekday: 'short', 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Remove any whitespace
  dateStr = dateStr.trim();
  
  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Try DD/MM/YYYY format with SLASH (international standard - most common from Google Sheets)
  // This MUST come before any JavaScript Date parsing to avoid MM/DD confusion
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    const year = slashMatch[3];
    
    // Always treat slash format as DD/MM/YYYY (international standard)
    return `${year}-${month}-${day}`;
  }
  
  // Try DD-MM-YYYY format (with dashes)
  const dashMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dashMatch) {
    let day = dashMatch[1].padStart(2, '0');
    let month = dashMatch[2].padStart(2, '0');
    let year = dashMatch[3];
    
    // Handle 2-digit year (25 -> 2025)
    if (year.length === 2) {
      year = '20' + year;
    }
    
    return `${year}-${month}-${day}`;
  }
  
  // Try YYYY/MM/DD format (already in correct order)
  const isoSlashMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (isoSlashMatch) {
    const year = isoSlashMatch[1];
    const month = isoSlashMatch[2].padStart(2, '0');
    const day = isoSlashMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // Last resort: Try parsing as Date (but this often gets DD/MM wrong)
  // We only reach here if none of the explicit patterns matched
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  
  return null;
}

function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

function formatLinksInText(text) {
  if (!text) return '';
  
  // Pattern to match URLs (http, https, www, drive.google.com, etc.)
  const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+|drive\.google\.com[^\s]+)/gi;
  
  // Replace URLs with clickable links
  return text.replace(urlPattern, (url) => {
    // Ensure the URL has a protocol
    let href = url;
    if (!url.match(/^https?:\/\//i)) {
      href = 'https://' + url;
    }
    
    // Create a shortened display text for long URLs
    const displayText = url.length > 50 ? url.substring(0, 47) + '...' : url;
    
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline hover:text-blue-800" title="${url}"><i class="fas fa-link"></i> ${displayText}</a>`;
  });
}

function getNotificationToastClass(type = 'info') {
  const typeClass = {
    success: 'ncpa-toast--success',
    error: 'ncpa-toast--error',
    warning: 'ncpa-toast--warning',
    info: 'ncpa-toast--info'
  }[type] || 'ncpa-toast--info';
  return `ncpa-toast ${typeClass}`;
}

function showNotification(message, type = 'info') {
  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : type === 'warning' ? '⚠' : 'ℹ';
  console.log(`${icon} ${message}`);

  const toast = document.createElement('div');
  toast.className = getNotificationToastClass(type);
  toast.textContent = message;
  document.body.appendChild(toast);

  const duration = type === 'error' ? 8000 : 3000;
  setTimeout(() => {
    toast.remove();
  }, duration);
}

// Persistent notification for long-running operations
function showPersistentNotification(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = getNotificationToastClass(type);
  toast.textContent = message;
  toast.setAttribute('data-persistent', 'true');
  document.body.appendChild(toast);
  return toast;
}

function updatePersistentNotification(toast, message, type = 'info') {
  if (!toast) return;
  toast.className = getNotificationToastClass(type);
  toast.textContent = message;
}

function removePersistentNotification(toast) {
  if (toast && toast.parentNode) {
    toast.remove();
  }
}

// Progress bar overlay for Word upload (centered, freezes the app)
function createUploadProgressToast() {
  const overlay = document.createElement('div');
  overlay.className = 'ncpa-upload-overlay';
  overlay.setAttribute('data-upload-overlay', 'true');

  const toast = document.createElement('div');
  toast.setAttribute('data-persistent', 'true');
  toast.className = 'ncpa-toast ncpa-toast--info ncpa-toast--progress';
  toast.innerHTML = `
    <div id="uploadStepLabel" class="ncpa-toast-step">📄 Preparing...</div>
    <div class="ncpa-toast-progress-track">
      <div id="uploadProgressBar" class="ncpa-toast-progress-bar"></div>
    </div>
    <div id="uploadProgressPct" class="ncpa-toast-progress-pct">0%</div>
  `;

  overlay.appendChild(toast);
  document.body.appendChild(overlay);
  document.body.classList.add('ncpa-upload-frozen');
  return toast;
}

function removeUploadProgress(toast) {
  if (toast && toast.parentNode) {
    const overlay = toast.closest('[data-upload-overlay]');
    if (overlay) {
      overlay.remove();
    } else {
      toast.remove();
    }
  }
  document.body.classList.remove('ncpa-upload-frozen');
}

function updateUploadProgress(toast, percent, message, type = 'info') {
  if (!toast) return;
  const progressType = type === 'success' ? 'success' : type === 'error' ? 'error' : 'info';
  toast.className = `ncpa-toast ncpa-toast--${progressType} ncpa-toast--progress`;
  const label = toast.querySelector('#uploadStepLabel');
  const bar = toast.querySelector('#uploadProgressBar');
  const pct = toast.querySelector('#uploadProgressPct');
  if (label) label.textContent = message;
  if (bar) bar.style.width = `${Math.min(Math.round(percent), 100)}%`;
  if (pct) pct.textContent = type === 'success' ? '✓ Complete' : type === 'error' ? '✗ Failed' : `${Math.round(percent)}%`;
}

// Close modals when clicking outside
window.onclick = function(event) {
  const eventModal = document.getElementById('eventModal');
  const addShowModal = document.getElementById('addShowModal');
  const editEventModal = document.getElementById('editEventModal');
  const deleteConfirmModal = document.getElementById('deleteConfirmModal');
  const whatsappModal = document.getElementById('whatsappExportModal');
  const csvModal = document.getElementById('csvExportModal');
  const aiModal = document.getElementById('aiAssistantModal');
  const dayAvailModal = document.getElementById('dayAvailModal');

  if (event.target === eventModal) {
    closeEventModal();
  }
  if (event.target === addShowModal) {
    closeAddShowModal();
  }
  if (event.target === editEventModal) {
    closeEditEventModal();
  }
  if (event.target === deleteConfirmModal) {
    closeDeleteConfirm();
  }
  if (event.target === whatsappModal) {
    closeWhatsAppExportModal();
  }
  if (event.target === csvModal) {
    closeCSVExportModal();
  }
  if (event.target === aiModal) {
    closeAIAssistant();
  }
  if (event.target === dayAvailModal) {
    closeDayAvailModal();
  }
}

// ============================================
// WHATSAPP EXPORT
// ============================================

function openWhatsAppExportModal() {
  document.getElementById('whatsappExportModal').classList.add('active');
  document.getElementById('exportPreview').style.display = 'none';
  document.getElementById('customDatePicker').style.display = 'none';
}

function closeWhatsAppExportModal() {
  document.getElementById('whatsappExportModal').classList.remove('active');
}

function exportTomorrow() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];
  
  generateWhatsAppExport(dateStr, dateStr, `Tomorrow (${formatDate(dateStr)})`);
}

function exportThisWeek() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
  
  // Calculate start of week (Sunday)
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek);
  
  // Calculate end of week (Saturday)
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + (6 - dayOfWeek));
  
  const startStr = startOfWeek.toISOString().split('T')[0];
  const endStr = endOfWeek.toISOString().split('T')[0];
  
  generateWhatsAppExport(startStr, endStr, `This Week (${formatDate(startStr)} - ${formatDate(endStr)})`);
}

function exportNextWeek() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  
  // Calculate start of next week (next Sunday)
  const startOfNextWeek = new Date(today);
  startOfNextWeek.setDate(today.getDate() + (7 - dayOfWeek));
  
  // Calculate end of next week (next Saturday)
  const endOfNextWeek = new Date(startOfNextWeek);
  endOfNextWeek.setDate(startOfNextWeek.getDate() + 6);
  
  const startStr = startOfNextWeek.toISOString().split('T')[0];
  const endStr = endOfNextWeek.toISOString().split('T')[0];
  
  generateWhatsAppExport(startStr, endStr, `Next Week (${formatDate(startStr)} - ${formatDate(endStr)})`);
}

function exportCustomDate() {
  document.getElementById('customDatePicker').style.display = 'block';
  document.getElementById('exportPreview').style.display = 'none';
  
  // Set default to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('customDateInput').value = tomorrow.toISOString().split('T')[0];
}

function exportSelectedDate() {
  const dateInput = document.getElementById('customDateInput').value;
  if (!dateInput) {
    showNotification('Please select a date', 'error');
    return;
  }
  
  generateWhatsAppExport(dateInput, dateInput, formatDate(dateInput));
}

function generateWhatsAppExport(startDate, endDate, title) {
  // Filter events for the date range
  const filteredEvents = allEvents.filter(event => 
    event.event_date >= startDate && event.event_date <= endDate
  ).sort((a, b) => a.event_date.localeCompare(b.event_date));
  
  if (filteredEvents.length === 0) {
    showNotification('No events found for the selected date range', 'error');
    return;
  }
  
  // Generate WhatsApp message format - crisp and bold headers
  let message = `📅 *Events for ${title}*\n\n`;
  
  filteredEvents.forEach((event, index) => {
    message += `🎭 *Event ${index + 1}*\n`;
    
    // Program name - extract main name only (before NCPA, before organizer, first 60 chars)
    let programName = event.program;
    // Remove organizer info in brackets/square brackets
    programName = programName.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '');
    // Remove "NCPA &" or "NCPA and" prefix
    programName = programName.replace(/NCPA\s+(&|and)\s+/gi, '');
    // Trim and limit to 60 characters for WhatsApp
    programName = programName.trim().substring(0, 60);
    if (event.program.length > 60) programName += '...';
    
    message += `*Program:* ${programName}\n`;
    message += `*Venue:* ${event.venue}\n`;
    
    if (event.call_time) {
      message += `*Call Time:* ${event.call_time}\n`;
    }
    
    if (event.crew && event.crew.trim() !== '') {
      message += `*Crew:* ${event.crew}\n`;
    }
    
    if (event.sound_requirements && event.sound_requirements.trim() !== '') {
      // Extract sound-specific requirements only
      let soundReqs = event.sound_requirements;
      
      // Remove HTML tags
      soundReqs = soundReqs.replace(/<[^>]*>/g, '');
      
      // Try to extract sound-related info only
      const soundKeywords = /sound|audio|mic|speaker|amp|mixer|stage|setup|rider|crew/gi;
      const sentences = soundReqs.split(/[.!]\s+/);
      const soundSentences = sentences.filter(s => soundKeywords.test(s));
      
      if (soundSentences.length > 0) {
        soundReqs = soundSentences.join('. ').trim();
        // Limit to 150 chars for WhatsApp
        if (soundReqs.length > 150) {
          soundReqs = soundReqs.substring(0, 147) + '...';
        }
      } else {
        // No sound-specific info, use first 150 chars of full requirements
        soundReqs = soundReqs.substring(0, 150);
        if (event.sound_requirements.length > 150) soundReqs += '...';
      }
      
      message += `*Sound:* ${soundReqs}\n`;
    }
    
    message += `\n`;
  });
  
  message += `---\n`;
  message += `Total: ${filteredEvents.length} event${filteredEvents.length !== 1 ? 's' : ''}`;
  
  // Show preview
  document.getElementById('exportText').value = message;
  document.getElementById('exportPreview').style.display = 'block';
  document.getElementById('customDatePicker').style.display = 'none';
}

function copyToClipboard() {
  const textarea = document.getElementById('exportText');
  textarea.select();
  textarea.setSelectionRange(0, 99999); // For mobile devices
  
  try {
    document.execCommand('copy');
    showNotification('Copied to clipboard! Paste in WhatsApp.', 'success');
    
    // Close modal after short delay
    setTimeout(() => {
      closeWhatsAppExportModal();
    }, 1500);
  } catch (err) {
    console.error('Failed to copy:', err);
    showNotification('Failed to copy. Please copy manually.', 'error');
  }
}

// ============================================
// CSV EXPORT
// ============================================

function openCSVExportModal() {
  const modal = document.getElementById('csvExportModal');
  modal.classList.add('active');
  
  // Set current month and year as defaults
  const now = new Date();
  document.getElementById('csvExportMonth').value = now.getMonth() + 1;
  document.getElementById('csvExportYear').value = now.getFullYear();
}

function closeCSVExportModal() {
  document.getElementById('csvExportModal').classList.remove('active');
}

async function generateCSVExport() {
  const month = document.getElementById('csvExportMonth').value;
  const year = document.getElementById('csvExportYear').value;
  
  if (!month || !year) {
    showNotification('Please select month and year', 'error');
    return;
  }
  
  try {
    // Calculate date range for the month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    // Fetch events for this month
    showNotification('Fetching events...', 'info');
    const response = await axios.get(`${API_BASE}/events/range?start=${startDate}&end=${endDate}`);
    
    if (!response.data.success || !response.data.data || response.data.data.length === 0) {
      showNotification('No events found for this month', 'warning');
      return;
    }
    
    const events = response.data.data;
    
    // Convert to CSV format
    const csvContent = convertEventsToCSV(events);
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(month) - 1];
    
    link.setAttribute('href', url);
    link.setAttribute('download', `NCPA_Events_${monthName}_${year}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`✅ Downloaded ${events.length} events for ${monthName} ${year}`, 'success');
    closeCSVExportModal();
    
  } catch (error) {
    console.error('CSV export error:', error);
    showNotification(`Failed to export CSV: ${error.message}`, 'error');
  }
}

function convertEventsToCSV(events) {
  // CSV headers
  const headers = ['Date', 'Program', 'Venue', 'Team', 'Sound Requirements', 'Call Time', 'Crew'];
  
  // Convert events to CSV rows
  const rows = events.map(event => {
    return [
      escapeCSVExportField(event.event_date),
      escapeCSVExportField(event.program),
      escapeCSVExportField(event.venue),
      escapeCSVExportField(event.team),
      escapeCSVExportField(event.sound_requirements),
      escapeCSVExportField(event.call_time),
      escapeCSVExportField(event.crew)
    ].join(',');
  });
  
  // Combine headers and rows
  return [headers.join(','), ...rows].join('\n');
}

function normalizeCSVExportField(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeCSVExportField(value) {
  const normalized = normalizeCSVExportField(value);
  if (normalized.includes(',') || normalized.includes('"')) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

// ============================================
// iCALENDAR EXPORT FOR CALENDAR APPS
// ============================================

// Parse a call_time value into a validated [hours, minutes] pair.
// Accepts "HH:MM" (with optional seconds/AM-PM). Returns null when the value
// is missing or not a real time (e.g. "not specified", "TBD"), so callers can
// fall back to a sensible default instead of crashing on undefined parts.
function parseCallTime(callTime) {
  if (!callTime || typeof callTime !== 'string') return null;
  const trimmed = callTime.trim();
  if (!trimmed) return null;

  // Reject placeholders that are not real times
  const lower = trimmed.toLowerCase();
  if (lower === 'not specified' || lower === 'tbd' || lower === 'n/a' || lower === 'na') {
    return null;
  }

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const meridiem = match[3];

  if (meridiem) {
    const isPM = meridiem.toLowerCase() === 'pm';
    if (hours === 12) hours = isPM ? 12 : 0;
    else if (isPM) hours += 12;
  }

  if (hours < 0 || hours > 23) return null;
  return [String(hours).padStart(2, '0'), minutes];
}

function formatICalendarDateTime(date) {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}00`;
}

function convertEventsToICalendar(events) {
  // iCalendar header
  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NCPA Sound Crew//Event Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:NCPA Sound Crew Events',
    'X-WR-TIMEZONE:Asia/Kolkata'
  ];
  
  // Convert each event to VEVENT
  events.forEach(event => {
    const eventDate = event.event_date; // Format: YYYY-MM-DD

    // Parse date defensively — skip malformed/missing dates instead of crashing
    const dateParts = eventDate ? String(eventDate).split('-') : [];
    let year, month, day;
    if (dateParts.length === 3 && dateParts.every(p => /^\d+$/.test(p))) {
      [year, month, day] = dateParts.map(p => p.padStart(2, '0'));
    } else {
      console.warn('Skipping event with invalid date for iCalendar export:', event.id, eventDate);
      return;
    }

    // Parse call time defensively — fall back to 09:00 when missing/invalid
    const parsed = parseCallTime(event.call_time);
    const hours = parsed ? parsed[0] : '09';
    const minutes = parsed ? parsed[1] : '00';
    
    // Create datetime stamps (iCalendar format: YYYYMMDDTHHmmss)
    const startDateTime = new Date(Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hours, 10),
      parseInt(minutes, 10)
    ));
    const endDateTime = new Date(startDateTime.getTime() + (2 * 60 * 60 * 1000));
    const dtStart = formatICalendarDateTime(startDateTime);
    const dtEnd = formatICalendarDateTime(endDateTime);
    
    // Create unique ID
    const uid = `${event.id}-${eventDate}@ncpa-sound.pages.dev`;
    
    // Create timestamp (now)
    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    // Build description
    let description = [];
    if (event.venue) description.push(`Venue: ${event.venue}`);
    if (event.team) description.push(`Team: ${event.team}`);
    if (event.crew) description.push(`Crew: ${event.crew}`);
    if (event.sound_requirements) description.push(`Sound Requirements: ${event.sound_requirements}`);
    if (event.call_time) description.push(`Call Time: ${event.call_time}`);
    
    const descText = description.join('\\n').replace(/,/g, '\\,');
    
    // Build VEVENT
    icsLines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${timestamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${event.program.replace(/,/g, '\\,')}`,
      `DESCRIPTION:${descText}`,
      `LOCATION:${(event.venue || '').replace(/,/g, '\\,')}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  });
  
  // iCalendar footer
  icsLines.push('END:VCALENDAR');
  
  return icsLines.join('\r\n');
}

async function generateICalendarExport() {
  const month = document.getElementById('csvExportMonth').value;
  const year = document.getElementById('csvExportYear').value;
  
  if (!month || !year) {
    showNotification('Please select month and year', 'error');
    return;
  }
  
  try {
    // Calculate date range for the month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    // Fetch events for this month
    showNotification('Fetching events for calendar...', 'info');
    const response = await axios.get(`${API_BASE}/events/range?start=${startDate}&end=${endDate}`);
    
    if (!response.data.success || !response.data.data || response.data.data.length === 0) {
      showNotification('No events found for this month', 'warning');
      return;
    }
    
    const events = response.data.data;
    
    // Convert to iCalendar format
    const icsContent = convertEventsToICalendar(events);
    
    // Create download link
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(month) - 1];
    
    link.setAttribute('href', url);
    link.setAttribute('download', `NCPA_Events_${monthName}_${year}.ics`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`✅ Downloaded ${events.length} events as calendar file (.ics)`, 'success');
    closeCSVExportModal();
    
  } catch (error) {
    console.error('iCalendar export error:', error);
    showNotification(`Failed to export calendar: ${error.message}`, 'error');
  }
}

// Expose iCalendar export globally
window.generateICalendarExport = generateICalendarExport;

// ============================================
// EXCEL EXPORT
// ============================================

async function generateExcelExport() {
  const month = document.getElementById('csvExportMonth').value;
  const year = document.getElementById('csvExportYear').value;
  
  if (!month || !year) {
    showNotification('Please select month and year', 'error');
    return;
  }
  
  // Check if XLSX library is loaded
  if (typeof XLSX === 'undefined') {
    showNotification('Excel library not loaded. Please refresh the page and try again.', 'error');
    console.error('XLSX library is not loaded');
    return;
  }
  
  try {
    // Calculate date range for the month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    // Fetch events for this month
    showNotification('Fetching events...', 'info');
    const response = await axios.get(`${API_BASE}/events/range?start=${startDate}&end=${endDate}`);
    
    if (!response.data.success || !response.data.data || response.data.data.length === 0) {
      showNotification('No events found for this month', 'warning');
      return;
    }
    
    const events = response.data.data;
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Prepare data for Excel
    const worksheetData = [
      ['Date', 'Program', 'Venue', 'Team', 'Sound Requirements', 'Call Time', 'Crew']
    ];
    
    events.forEach(event => {
      worksheetData.push([
        event.event_date || '',
        event.program || '',
        event.venue || '',
        event.team || '',
        event.sound_requirements || '',
        event.call_time || '',
        event.crew || ''
      ]);
    });
    
    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 12 },  // Date
      { wch: 50 },  // Program
      { wch: 10 },  // Venue
      { wch: 20 },  // Team
      { wch: 30 },  // Sound Requirements
      { wch: 10 },  // Call Time
      { wch: 20 }   // Crew
    ];
    
    // Add worksheet to workbook
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[parseInt(month) - 1];
    
    XLSX.utils.book_append_sheet(wb, ws, `${monthName} ${year}`);
    
    // Generate Excel file and download
    XLSX.writeFile(wb, `NCPA_Events_${monthName}_${year}.xlsx`);
    
    showNotification(`✅ Downloaded ${events.length} events for ${monthName} ${year}`, 'success');
    closeCSVExportModal();
    
  } catch (error) {
    console.error('Excel export error:', error);
    showNotification(`Failed to export Excel: ${error.message}`, 'error');
  }
}

// ============================================
// AI ASSISTANT
// ============================================

function toggleAIAssistant() {
  const modal = document.getElementById('aiAssistantModal');
  if (modal.classList.contains('active')) {
    closeAIAssistant();
  } else {
    openAIAssistant();
  }
}

function openAIAssistant() {
  document.getElementById('aiAssistantModal').classList.add('active');
  renderAIChat();
  document.getElementById('aiChatInput').focus();
}

function closeAIAssistant() {
  document.getElementById('aiAssistantModal').classList.remove('active');
}

// Chat history lives in memory only — it resets on page reload or "New Chat".
let aiChatHistory = [];
let aiChatPending = false;

const AI_SUGGESTED_QUESTIONS = [
  'How many events this month?',
  'What dates is Tata Theatre free next month?',
  "Show Ashwin's upcoming events",
  'Which venue was busiest last month?'
];

function clearAIChat() {
  aiChatHistory = [];
  aiChatPending = false;
  renderAIChat();
}

function renderAIChat() {
  const container = document.getElementById('aiChatMessages');
  if (!container) return;

  if (aiChatHistory.length === 0 && !aiChatPending) {
    const chips = AI_SUGGESTED_QUESTIONS.map(q =>
      `<button onclick="askAI('${q.replace(/'/g, "\\'")}')" class="text-xs rounded-full px-3 py-1 transition-colors" style="background:rgba(255,255,255,0.70);outline:1px solid rgba(173,179,184,0.25);color:#5a6065;">${escapeHtml(q)}</button>`
    ).join('');
    container.innerHTML = `
      <div class="text-sm text-gray-500">
        <p class="mb-3">Hi! Ask me anything about your events — crew, dates, venues, equipment, availability. I'll ask a follow-up question if something is unclear.</p>
        <div class="flex flex-wrap gap-2">${chips}</div>
      </div>`;
    return;
  }

  let html = aiChatHistory.map(msg => aiChatBubbleHTML(msg)).join('');
  if (aiChatPending) {
    html += `
      <div class="flex justify-start">
        <div class="rounded-lg px-4 py-3 text-sm bg-white text-gray-500" style="outline:1px solid rgba(173,179,184,0.25);">
          <div class="loading" style="display:inline-block;"></div>
          <span class="ml-2">Checking the database...</span>
        </div>
      </div>`;
  }
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
}

function aiChatBubbleHTML(msg) {
  if (msg.role === 'user') {
    return `
      <div class="flex justify-end">
        <div class="rounded-lg px-4 py-2.5 text-sm text-white" style="background:#98A2D7; max-width: 85%;">${escapeHtml(msg.content)}</div>
      </div>`;
  }
  const cls = msg.error ? 'ncpa-status ncpa-status--error' : 'bg-white text-gray-700';
  return `
    <div class="flex justify-start">
      <div class="rounded-lg px-4 py-2.5 text-sm ${cls}" style="outline:1px solid rgba(173,179,184,0.25); max-width: 85%;">${formatAIMessage(msg.content)}</div>
    </div>`;
}

// Minimal markdown rendering: **bold**, `code`, bullet lists, paragraphs
function formatAIMessage(text) {
  const escaped = escapeHtml(String(text || ''));
  const lines = escaped.split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += '<ul class="list-disc list-inside space-y-1 my-1">'; inList = true; }
      html += `<li>${bullet[1]}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim()) html += `<p class="my-1">${line}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="px-1 rounded" style="background:rgba(152,162,215,0.12);">$1</code>');
}

function escapeHtml(input) {
  return String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Kept for suggestion chips and legacy callers: submits a canned question.
function askAI(predefinedQuery) {
  if (predefinedQuery) {
    document.getElementById('aiChatInput').value = predefinedQuery;
  }
  sendAIChat();
}

async function sendAIChat() {
  const input = document.getElementById('aiChatInput');
  const query = input.value.trim();

  if (!query) {
    showNotification('Please enter a question', 'error');
    return;
  }
  if (aiChatPending) return;

  aiChatHistory.push({ role: 'user', content: query });
  input.value = '';
  aiChatPending = true;
  renderAIChat();

  try {
    // Send the recent conversation (error bubbles excluded) so the AI has
    // in-session context; nothing is persisted between sessions.
    const payload = aiChatHistory
      .filter(m => !m.error)
      .slice(-20)
      .map(m => ({ role: m.role, content: m.content }));

    const response = await axios.post(`${API_BASE}/ai/chat`, { messages: payload }, { timeout: 180000 });

    if (response.data.success) {
      aiChatHistory.push({ role: 'assistant', content: response.data.answer || 'No answer returned.' });
    } else {
      throw new Error(response.data.error || 'AI chat failed');
    }
  } catch (error) {
    console.error('AI chat error:', error);
    const detail = error.response?.data?.details || error.response?.data?.error || error.message;
    aiChatHistory.push({ role: 'assistant', error: true, content: `Sorry, something went wrong: ${detail}` });
    showNotification('AI query failed', 'error');
  } finally {
    aiChatPending = false;
    renderAIChat();
    const inputEl = document.getElementById('aiChatInput');
    if (inputEl) inputEl.focus();
  }
}

// ============================================
// TOOLBAR DROPDOWN MENU
// ============================================

function toggleActionsDropdown() {
  const dropdown = document.getElementById('actionsDropdown');
  dropdown.classList.toggle('hidden');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('actionsDropdown');
  const button = e.target.closest('button[onclick*="toggleActionsDropdown"]');
  
  if (dropdown && !dropdown.contains(e.target) && !button) {
    dropdown.classList.add('hidden');
  }
});

// Expose globally
window.toggleActionsDropdown = toggleActionsDropdown;

// ============================================
// SHORT NOTICE REPORT
// ============================================

function openShortNoticeModal() {
  document.getElementById('shortNoticeModal').classList.add('active');
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('snrMonth').value = `${yyyy}-${mm}`;
  // Default range: current month to current month
  document.getElementById('snrStart').value = `${yyyy}-${mm}`;
  document.getElementById('snrEnd').value = `${yyyy}-${mm}`;
  snrSetMode('month');
}

function closeShortNoticeModal() {
  document.getElementById('shortNoticeModal').classList.remove('active');
}

function snrSetMode(mode) {
  const isMonth = mode === 'month';
  document.getElementById('snr-panel-month').style.display = isMonth ? '' : 'none';
  document.getElementById('snr-panel-range').style.display = isMonth ? 'none' : '';
  const monthTab = document.getElementById('snr-tab-month');
  const rangeTab = document.getElementById('snr-tab-range');
  const on = ['bg-orange-500', 'text-white', 'border-orange-400'];
  const off = ['bg-white', 'text-gray-700', 'border-gray-300'];
  if (isMonth) {
    on.forEach(c => monthTab.classList.add(c));
    off.forEach(c => monthTab.classList.remove(c));
    off.forEach(c => rangeTab.classList.add(c));
    on.forEach(c => rangeTab.classList.remove(c));
  } else {
    on.forEach(c => rangeTab.classList.add(c));
    off.forEach(c => rangeTab.classList.remove(c));
    off.forEach(c => monthTab.classList.add(c));
    on.forEach(c => monthTab.classList.remove(c));
  }
}

function downloadShortNoticeReport() {
  const isMonthMode = document.getElementById('snr-panel-month').style.display !== 'none';
  let url;
  if (isMonthMode) {
    const month = document.getElementById('snrMonth').value;
    if (!month) { showNotification('Please select a month', 'error'); return; }
    url = `${API_BASE}/export/short-notice-report?month=${encodeURIComponent(month)}`;
  } else {
    const startMonth = document.getElementById('snrStart').value; // YYYY-MM
    const endMonth   = document.getElementById('snrEnd').value;   // YYYY-MM
    if (!startMonth || !endMonth) { showNotification('Please select both months', 'error'); return; }
    if (startMonth > endMonth) { showNotification('From month must be before To month', 'error'); return; }
    // Convert to full date range: first day of start month → last day of end month
    const [ey, em] = endMonth.split('-').map(Number);
    const lastDay = new Date(ey, em, 0).getDate();
    const start = `${startMonth}-01`;
    const end   = `${endMonth}-${String(lastDay).padStart(2, '0')}`;
    url = `${API_BASE}/export/short-notice-report?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  }
  const link = document.createElement('a');
  link.href = url;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showNotification('Downloading Short Notice Report...', 'success');
  closeShortNoticeModal();
}
