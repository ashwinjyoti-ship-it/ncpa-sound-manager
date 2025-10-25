// NCPA Sound Crew - Frontend Application
// State management
let currentView = 'calendar';
let currentDate = new Date();
let allEvents = [];
let currentEditingCell = null;

// API Base URL
const API_BASE = '/api';

// Initialize app on page load
document.addEventListener('DOMContentLoaded', () => {
  loadEvents();
  renderCalendar();
  
  // Search functionality with debounce
  let searchTimeout;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      handleSearch(e.target.value);
    }, 500);
  });
});

// ============================================
// DATA LOADING
// ============================================

async function loadEvents() {
  try {
    const response = await axios.get(`${API_BASE}/events`);
    if (response.data.success) {
      allEvents = response.data.data;
      renderCurrentView();
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
  
  if (tab === 'calendar') {
    document.getElementById('calendarTab').classList.add('tab-active');
    document.getElementById('calendarView').style.display = 'block';
    document.getElementById('tableView').style.display = 'none';
    renderCalendar();
  } else {
    document.getElementById('tableTab').classList.add('tab-active');
    document.getElementById('calendarView').style.display = 'none';
    document.getElementById('tableView').style.display = 'block';
    renderTable();
  }
}

function renderCurrentView() {
  if (currentView === 'calendar') {
    renderCalendar();
  } else {
    renderTable();
  }
}

// ============================================
// CALENDAR VIEW
// ============================================

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  // Update header
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('currentMonthYear').textContent = `${monthNames[month]} ${year}`;
  
  // Get first day of month and number of days
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Get events for this month
  const startDate = new Date(year, month, 1).toISOString().split('T')[0];
  const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
  const monthEvents = allEvents.filter(event => 
    event.event_date >= startDate && event.event_date <= endDate
  );
  
  // Group events by date
  const eventsByDate = {};
  monthEvents.forEach(event => {
    const date = event.event_date;
    if (!eventsByDate[date]) {
      eventsByDate[date] = [];
    }
    eventsByDate[date].push(event);
  });
  
  // Render calendar grid
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';
  
  // Add empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day bg-gray-50';
    grid.appendChild(emptyCell);
  }
  
  // Add cells for each day
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day bg-white p-2';
    
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayEvents = eventsByDate[dateStr] || [];
    
    // Day number
    const dayNumber = document.createElement('div');
    dayNumber.className = 'font-bold text-gray-700 mb-2';
    dayNumber.textContent = day;
    cell.appendChild(dayNumber);
    
    // Event cards
    dayEvents.forEach(event => {
      const card = document.createElement('div');
      card.className = `text-xs p-2 mb-1 rounded cursor-pointer ${
        event.requirements_updated ? 'event-card-green' : 'event-card-peach'
      }`;
      card.onclick = () => openEventModal(event);
      
      card.innerHTML = `
        <div class="font-semibold truncate">${truncateText(event.program, 30)}</div>
        <div class="text-gray-600 truncate"><i class="fas fa-map-marker-alt mr-1"></i>${event.venue}</div>
        ${event.crew ? `<div class="text-gray-600 truncate"><i class="fas fa-users mr-1"></i>${event.crew}</div>` : ''}
      `;
      
      cell.appendChild(card);
    });
    
    grid.appendChild(cell);
  }
}

function changeMonth(delta) {
  currentDate.setMonth(currentDate.getMonth() + delta);
  renderCalendar();
}

// ============================================
// TABLE VIEW
// ============================================

function renderTable() {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  
  if (allEvents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">No events found</td></tr>';
    return;
  }
  
  allEvents.forEach(event => {
    const row = document.createElement('tr');
    row.className = 'border-b hover:bg-gray-50';
    
    row.innerHTML = `
      <td class="px-4 py-3">${formatDate(event.event_date)}</td>
      <td class="px-4 py-3 editable-cell" data-field="program" data-id="${event.id}">${event.program || ''}</td>
      <td class="px-4 py-3 editable-cell" data-field="venue" data-id="${event.id}">${event.venue || ''}</td>
      <td class="px-4 py-3 editable-cell" data-field="team" data-id="${event.id}">${event.team || ''}</td>
      <td class="px-4 py-3 editable-cell" data-field="sound_requirements" data-id="${event.id}">${event.sound_requirements || ''}</td>
      <td class="px-4 py-3 editable-cell" data-field="call_time" data-id="${event.id}">${event.call_time || ''}</td>
      <td class="px-4 py-3 editable-cell" data-field="crew" data-id="${event.id}">${event.crew || ''}</td>
      <td class="px-4 py-3">
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
  
  content.innerHTML = `
    <div class="space-y-4">
      <div>
        <label class="font-semibold text-gray-700">Date:</label>
        <p class="text-gray-900">${formatDate(event.event_date)}</p>
      </div>
      <div>
        <label class="font-semibold text-gray-700">Program/Event:</label>
        <p class="text-gray-900">${event.program}</p>
      </div>
      <div>
        <label class="font-semibold text-gray-700">Venue:</label>
        <p class="text-gray-900">${event.venue}</p>
      </div>
      <div>
        <label class="font-semibold text-gray-700">Team (curator):</label>
        <p class="text-gray-900">${event.team || 'Not specified'}</p>
      </div>
      <div>
        <label class="font-semibold text-gray-700">Sound Requirements:</label>
        <p class="text-gray-900 whitespace-pre-wrap">${event.sound_requirements || 'Not specified'}</p>
      </div>
      <div>
        <label class="font-semibold text-gray-700">Call Time:</label>
        <p class="text-gray-900">${event.call_time || 'Not specified'}</p>
      </div>
      <div>
        <label class="font-semibold text-gray-700">Crew (sound team):</label>
        <p class="text-gray-900">${event.crew || 'Not assigned'}</p>
      </div>
      <div>
        <label class="font-semibold text-gray-700">Created:</label>
        <p class="text-gray-600 text-sm">${formatDateTime(event.created_at)}</p>
      </div>
    </div>
  `;
  
  modal.classList.add('active');
}

function closeEventModal() {
  document.getElementById('eventModal').classList.remove('active');
}

// ============================================
// ADD SHOW MODAL
// ============================================

function openAddShowModal() {
  document.getElementById('addShowModal').classList.add('active');
  document.getElementById('addShowForm').reset();
}

function closeAddShowModal() {
  document.getElementById('addShowModal').classList.remove('active');
}

async function handleAddShow(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  
  try {
    const response = await axios.post(`${API_BASE}/events`, data);
    
    if (response.data.success) {
      showNotification('Show added successfully', 'success');
      closeAddShowModal();
      await loadEvents();
    }
  } catch (error) {
    console.error('Error adding show:', error);
    showNotification('Failed to add show', 'error');
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
          showNotification(`✓ Successfully uploaded ${eventsToUpload.length} events! ${invalidEvents.length > 0 ? `(Skipped ${invalidEvents.length} invalid rows)` : ''}`, 'success');
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
  
  showNotification('📄 Extracting text from Word document...', 'info');
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    
    // Extract raw text from Word document
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value;
    
    console.log('Word document extracted:', text.length, 'characters');
    
    // Estimate processing time based on document size
    const estimatedChunks = Math.ceil(text.length / 12000);
    const estimatedTime = estimatedChunks * 15; // ~15 seconds per chunk
    
    if (estimatedChunks > 1) {
      showNotification(`🤖 AI is analyzing document in ${estimatedChunks} chunks... (this may take ~${estimatedTime}s)`, 'info');
    } else {
      showNotification('🤖 AI is analyzing the document...', 'info');
    }
    
    // Use AI to parse the document intelligently with chunked processing
    const response = await axios.post(`${API_BASE}/ai/parse-word`, {
      text: text,
      filename: file.name
    }, {
      timeout: 180000 // 3 minutes timeout for large documents
    });
    
    if (!response.data.success) {
      throw new Error(response.data.error || 'AI parsing failed');
    }
    
    const events = response.data.events;
    const chunks = response.data.chunks || 1;
    const totalEvents = response.data.totalEvents || events.length;
    const uniqueEvents = response.data.uniqueEvents || events.length;
    
    if (events.length === 0) {
      showNotification('❌ No events found in document. AI could not identify any event entries.', 'error');
      return;
    }
    
    console.log(`✅ AI parsed ${uniqueEvents} unique events from ${chunks} chunks (${totalEvents} total found)`);
    console.log('Sample events:', events.slice(0, 3));
    
    // Show success message with chunk info
    if (chunks > 1) {
      showNotification(`✅ AI analyzed ${chunks} chunks and found ${uniqueEvents} events! Now uploading...`, 'success');
    } else {
      showNotification(`✅ AI found ${uniqueEvents} events! Now uploading...`, 'success');
    }
    
    // Upload events
    const uploadResponse = await axios.post(`${API_BASE}/events/bulk`, { events });
    
    if (uploadResponse.data.success) {
      const uploaded = uploadResponse.data.data.length;
      const duplicates = uploadResponse.data.skipped ? uploadResponse.data.skipped.length : 0;
      
      let message = `✅ Successfully uploaded ${uploaded} events from Word document!`;
      if (duplicates > 0) {
        message += ` (${duplicates} duplicates skipped)`;
      }
      
      showNotification(message, 'success');
      await loadEvents();
    } else {
      showNotification(`❌ Upload failed: ${uploadResponse.data.error || 'Unknown error'}`, 'error');
    }
    
  } catch (error) {
    console.error('Error parsing Word document:', error);
    
    // Better error messages
    let errorMessage = 'Failed to parse Word document';
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      errorMessage = 'Document is very large and processing timed out. Please try CSV upload instead.';
    } else if (error.response?.data?.error) {
      errorMessage = error.response.data.error;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    showNotification(`❌ ${errorMessage}`, 'error');
  } finally {
    // Always reset file input so user can try again
    e.target.value = '';
  }
}

// ============================================
// SEARCH
// ============================================

async function handleSearch(query) {
  const events = [];
  
  // Extract month and year from filename or text
  let month = null;
  let year = null;
  
  // Try to extract from filename
  const filenameMatch = filename.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{4})/i);
  if (filenameMatch) {
    month = parseMonthName(filenameMatch[1]);
    year = parseInt(filenameMatch[2]);
  }
  
  // Try to extract from text if not found in filename
  if (!month || !year) {
    const textMatch = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s*(\d{4})/i);
    if (textMatch) {
      month = parseMonthName(textMatch[1]);
      year = parseInt(textMatch[2]);
    }
  }
  
  if (!month || !year) {
    console.error('Could not extract month/year from document');
    showNotification('❌ Could not detect month/year in document. Filename should contain month and year (e.g., "Feb 2025.docx")', 'error');
    return [];
  }
  
  console.log(`✓ Detected month: ${month}, year: ${year}`);
  
  // Split text into lines
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  
  // Find the header row - be flexible with matching
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    // Look for key header indicators
    if ((line.includes('day') || line.includes('date')) && 
        (line.includes('programme') || line.includes('program') || line.includes('event'))) {
      headerIndex = i;
      console.log(`✓ Found potential header at line ${i}: "${lines[i].substring(0, 100)}"`);
      break;
    }
  }
  
  if (headerIndex === -1) {
    console.error('Could not find table header row');
    console.log('First 10 lines of document:', lines.slice(0, 10));
    showNotification('❌ Could not find table header. Document should have columns with "Day/Date" and "Programme/Event"', 'error');
    return [];
  }
  
  console.log(`✓ Using header at line ${headerIndex}`);
  
  // Parse rows after header
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if line starts with a day pattern
    const dayMatch = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})(st|nd|rd|th)/i);
    if (dayMatch) {
      const dayNumber = parseInt(dayMatch[2]);
      const event_date = `${year}-${String(month).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
      
      // Gather all text for this event
      let fullText = line.substring(dayMatch[0].length).trim();
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}(st|nd|rd|th)/i.test(nextLine) || 
            (nextLine.includes('Day') && nextLine.includes('Date'))) {
          break;
        }
        fullText += ' ' + nextLine;
        j++;
      }
      
      const parsed = parseEventLine(fullText);
      
      if (parsed.program && parsed.venue) {
        events.push({
          event_date,
          program: parsed.program,
          venue: parsed.venue,
          team: '',
          sound_requirements: parsed.sound_requirements || '',
          call_time: parsed.call_time || '',
          crew: parsed.crew || ''
        });
      }
      
      i = j - 1;
    }
  }
  
  if (events.length === 0) {
    console.warn('⚠️ No valid events parsed. Possible reasons:');
    console.warn('  - No lines matched day pattern (Mon/Tue/etc + number + st/nd/rd/th)');
    console.warn('  - Parsed events missing program or venue');
    console.log('Sample lines after header:', lines.slice(headerIndex + 1, Math.min(headerIndex + 6, lines.length)));
  } else {
    console.log(`✓ Parsed ${events.length} events successfully`);
  }
  return events;
}

function parseEventLine(text) {
  let program = '';
  let venue = '';
  let sound_requirements = '';
  let call_time = '';
  let crew = '';
  
  // Extract venue
  if (text.includes('TET')) venue = 'Tata Theatre';
  else if (text.includes('Experimental')) venue = 'Experimental Theatre';
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
// SEARCH
// ============================================

async function handleSearch(query) {
  if (!query || query.trim() === '') {
    loadEvents();
    return;
  }
  
  try {
    const response = await axios.get(`${API_BASE}/events/search?q=${encodeURIComponent(query)}`);
    
    if (response.data.success) {
      allEvents = response.data.data;
      
      // Show notification if no results found
      if (allEvents.length === 0) {
        showNotification(`No events found for "${query}". Clear search to see all events.`, 'info');
      }
      
      renderCurrentView();
    }
  } catch (error) {
    console.error('Error searching:', error);
    showNotification('Search failed', 'error');
  }
}

// ============================================
// DELETE EVENT
// ============================================

async function deleteEvent(id) {
  if (!confirm('Are you sure you want to delete this event?')) {
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

function showNotification(message, type = 'info') {
  // Simple notification using alert for now
  // Can be enhanced with a toast library later
  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  console.log(`${icon} ${message}`);
  
  // Create a simple toast
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 max-w-md ${
    type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Error messages stay longer (8 seconds) so users can read them
  const duration = type === 'error' ? 8000 : 3000;
  
  setTimeout(() => {
    toast.remove();
  }, duration);
}

// Close modals when clicking outside
window.onclick = function(event) {
  const eventModal = document.getElementById('eventModal');
  const addShowModal = document.getElementById('addShowModal');
  const deleteConfirmModal = document.getElementById('deleteConfirmModal');
  const whatsappModal = document.getElementById('whatsappExportModal');
  const aiModal = document.getElementById('aiAssistantModal');
  
  if (event.target === eventModal) {
    closeEventModal();
  }
  if (event.target === addShowModal) {
    closeAddShowModal();
  }
  if (event.target === deleteConfirmModal) {
    closeDeleteConfirm();
  }
  if (event.target === whatsappModal) {
    closeWhatsAppExportModal();
  }
  if (event.target === aiModal) {
    closeAIAssistant();
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
  document.getElementById('aiQueryInput').focus();
}

function closeAIAssistant() {
  document.getElementById('aiAssistantModal').classList.remove('active');
}

async function askAI(predefinedQuery) {
  const input = document.getElementById('aiQueryInput');
  const query = predefinedQuery || input.value.trim();
  
  if (!query) {
    showNotification('Please enter a question', 'error');
    return;
  }
  
  // Show loading
  document.getElementById('aiResponse').style.display = 'block';
  document.getElementById('aiLoading').style.display = 'inline-block';
  document.getElementById('aiExplanation').textContent = 'Thinking...';
  document.getElementById('aiResultsContainer').innerHTML = '';
  
  try {
    const response = await axios.post(`${API_BASE}/ai/query`, { query });
    
    if (response.data.success) {
      const { data, explanation, query: sqlQuery } = response.data;
      
      // Hide loading
      document.getElementById('aiLoading').style.display = 'none';
      
      // Show explanation
      document.getElementById('aiExplanation').textContent = explanation || `Found ${data.length} results`;
      
      // Display results
      if (data.length === 0) {
        document.getElementById('aiResultsContainer').innerHTML = '<p class="text-gray-500 text-center py-4">No events found matching your query.</p>';
      } else {
        // Render as table
        let tableHTML = '<table class="w-full text-sm border-collapse"><thead><tr style="background-color: #8B4513;">';
        
        // Get column names from first result
        const columns = Object.keys(data[0]);
        columns.forEach(col => {
          tableHTML += `<th class="px-3 py-2 text-left text-white font-semibold">${col}</th>`;
        });
        tableHTML += '</tr></thead><tbody>';
        
        // Add data rows
        data.forEach((row, index) => {
          tableHTML += `<tr class="border-b ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}">`;
          columns.forEach(col => {
            let value = row[col];
            
            // Format dates
            if (col === 'event_date' && value) {
              value = formatDate(value).replace(/,\s*\d{4}/, '');
            }
            
            // Format sound requirements with links
            if (col === 'sound_requirements' && value) {
              value = formatLinksInText(value);
            }
            
            // Truncate long text
            if (typeof value === 'string' && value.length > 100) {
              value = value.substring(0, 97) + '...';
            }
            
            tableHTML += `<td class="px-3 py-2">${value || ''}</td>`;
          });
          tableHTML += '</tr>';
        });
        tableHTML += '</tbody></table>';
        
        document.getElementById('aiResultsContainer').innerHTML = tableHTML;
        
        // Show SQL query in console for debugging
        console.log('Generated SQL:', sqlQuery);
      }
      
      // Clear input if it was a predefined query
      if (predefinedQuery) {
        input.value = '';
      }
      
    } else {
      throw new Error(response.data.error || 'AI query failed');
    }
    
  } catch (error) {
    console.error('AI query error:', error);
    document.getElementById('aiLoading').style.display = 'none';
    document.getElementById('aiExplanation').textContent = 'Sorry, I encountered an error processing your question.';
    document.getElementById('aiResultsContainer').innerHTML = `<p class="text-red-600 text-sm">${error.response?.data?.error || error.message}</p>`;
    showNotification('AI query failed', 'error');
  }
}
