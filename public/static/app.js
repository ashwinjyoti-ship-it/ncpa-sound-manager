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
  
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async (results) => {
      const events = results.data.map(row => ({
        event_date: parseDate(row['Date'] || row['date'] || row['EVENT DATE']),
        program: row['Program'] || row['program'] || row['Program/Event'] || '',
        venue: row['Venue'] || row['venue'] || '',
        team: row['Team'] || row['team'] || '',
        sound_requirements: row['Sound Requirements'] || row['sound_requirements'] || '',
        call_time: row['Call Time'] || row['call_time'] || '',
        crew: row['Crew'] || row['crew'] || ''
      })).filter(event => event.event_date && event.program && event.venue);
      
      if (events.length === 0) {
        showNotification('No valid events found in CSV', 'error');
        return;
      }
      
      try {
        const response = await axios.post(`${API_BASE}/events/bulk`, { events });
        
        if (response.data.success) {
          showNotification(`${events.length} events uploaded successfully`, 'success');
          await loadEvents();
        }
      } catch (error) {
        console.error('Error uploading CSV:', error);
        showNotification('Failed to upload CSV', 'error');
      }
    },
    error: (error) => {
      console.error('Error parsing CSV:', error);
      showNotification('Failed to parse CSV file', 'error');
    }
  });
  
  // Reset file input
  e.target.value = '';
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
  
  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Try parsing as Date and converting to ISO
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

function showNotification(message, type = 'info') {
  // Simple notification using alert for now
  // Can be enhanced with a toast library later
  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
  console.log(`${icon} ${message}`);
  
  // Create a simple toast
  const toast = document.createElement('div');
  toast.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 ${
    type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'
  }`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Close modals when clicking outside
window.onclick = function(event) {
  const eventModal = document.getElementById('eventModal');
  const addShowModal = document.getElementById('addShowModal');
  
  if (event.target === eventModal) {
    closeEventModal();
  }
  if (event.target === addShowModal) {
    closeAddShowModal();
  }
}
