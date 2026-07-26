// NCPA Sound Crew - Settings (venues + Anthropic / Word-parse API key)

let settingsVenuesCache = [];

async function loadVenuesForDropdowns() {
  try {
    const response = await axios.get(`${API_BASE}/venues`);
    if (!response.data.success) return;

    const venues = response.data.venues || [];
    settingsVenuesCache = venues;
    populateVenueDatalist(venues);

    // Refresh filter panel options if present
    if (typeof loadFilterOptions === 'function') {
      // loadFilterOptions pulls venues from filter-options which now uses DB
    }
  } catch (error) {
    console.warn('Failed to load venues for dropdowns:', error.message || error);
  }
}

function populateVenueDatalist(venues) {
  const datalist = document.getElementById('venueList');
  if (!datalist) return;

  datalist.innerHTML = '';
  venues.forEach((venue) => {
    const option = document.createElement('option');
    option.value = venue.code;
    option.textContent = venue.display_name && venue.display_name !== venue.code
      ? venue.display_name
      : venue.code;
    datalist.appendChild(option);
  });
}

function showSettingsTabForAdmin() {
  const settingsTab = document.getElementById('settingsTab');
  if (settingsTab) settingsTab.style.display = '';
}

function hideSettingsTab() {
  const settingsTab = document.getElementById('settingsTab');
  if (settingsTab) settingsTab.style.display = 'none';

  if (typeof currentView !== 'undefined' && currentView === 'settings') {
    if (typeof showTab === 'function') showTab('calendar');
  }
}

async function loadSettingsPage() {
  const content = document.getElementById('settingsContent');
  if (!content) return;

  if (!currentUser || currentUser.role !== 'admin') {
    content.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-lock text-4xl text-gray-400"></i>
        <p class="mt-4 text-gray-600">Admin access required to manage settings.</p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
      <p class="mt-4 text-gray-600">Loading settings...</p>
    </div>
  `;

  try {
    const [venuesRes, settingsRes] = await Promise.all([
      axios.get(`${API_BASE}/admin/venues`, { withCredentials: true }),
      axios.get(`${API_BASE}/admin/settings`, { withCredentials: true }),
    ]);

    if (!venuesRes.data.success || !settingsRes.data.success) {
      throw new Error(venuesRes.data.error || settingsRes.data.error || 'Failed to load settings');
    }

    renderSettingsPage(venuesRes.data.venues || [], settingsRes.data.settings || {});
  } catch (error) {
    content.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-exclamation-triangle text-4xl text-red-500"></i>
        <p class="mt-4 text-red-600">${error.response?.data?.error || error.message || 'Failed to load settings'}</p>
      </div>
    `;
  }
}

function renderSettingsPage(venues, settings) {
  const content = document.getElementById('settingsContent');
  if (!content) return;

  const api = settings.anthropic_api_key || {};
  const statusLabel = api.configured
    ? (api.source === 'settings'
      ? `Configured in Settings (${api.masked})`
      : `Using environment secret (${api.masked})`)
    : 'Not configured';
  const statusColor = api.configured ? '#A8C3A0' : '#e57373';

  content.innerHTML = `
    <div class="space-y-8">
      <section>
        <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h3 class="text-lg font-semibold text-gray-800">Venues</h3>
            <p class="text-sm text-gray-500 mt-1">These appear in Add/Edit Show and Filters. Use <strong>Others</strong> for maintenance or non-venue crew assignments.</p>
          </div>
        </div>

        <div class="overflow-x-auto rounded-xl" style="outline:1px solid rgba(173,179,184,0.18);">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-gray-600" style="background:rgba(255,255,255,0.55);">
                <th class="px-3 py-2 font-semibold">Code</th>
                <th class="px-3 py-2 font-semibold">Display name</th>
                <th class="px-3 py-2 font-semibold w-24">Order</th>
                <th class="px-3 py-2 font-semibold w-24">Active</th>
                <th class="px-3 py-2 font-semibold w-40">Actions</th>
              </tr>
            </thead>
            <tbody id="settingsVenuesBody">
              ${venues.map((v) => renderVenueRow(v)).join('')}
            </tbody>
          </table>
        </div>

        <div class="mt-4 p-4 rounded-xl" style="background:rgba(255,255,255,0.55);outline:1px solid rgba(173,179,184,0.15);">
          <h4 class="text-sm font-semibold text-gray-700 mb-3">Add venue</h4>
          <form id="addVenueForm" class="grid grid-cols-1 md:grid-cols-4 gap-3 items-end" onsubmit="handleAddVenue(event)">
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Code *</label>
              <input id="newVenueCode" required placeholder="e.g. OAP"
                     class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Display name</label>
              <input id="newVenueName" placeholder="e.g. Open Air Plaza"
                     class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Sort order</label>
              <input id="newVenueOrder" type="number" value="100"
                     class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
            </div>
            <div>
              <button type="submit" class="btn-primary px-4 py-2 text-sm w-full md:w-auto">
                <i class="fas fa-plus mr-1"></i>Add venue
              </button>
            </div>
          </form>
          <p id="addVenueError" class="text-sm text-red-600 mt-2" style="display:none;"></p>
        </div>
      </section>

      <section>
        <h3 class="text-lg font-semibold text-gray-800 mb-1">Word document / AI API key</h3>
        <p class="text-sm text-gray-500 mb-3">Anthropic API key used for Word (.docx) schedule parsing and Ask AI. A key saved here overrides the Cloudflare environment secret.</p>

        <div class="p-4 rounded-xl space-y-3" style="background:rgba(255,255,255,0.55);outline:1px solid rgba(173,179,184,0.15);">
          <div class="flex items-center gap-2 text-sm">
            <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${statusColor};"></span>
            <span class="text-gray-700">${statusLabel}</span>
          </div>

          <form id="apiKeyForm" class="space-y-3" onsubmit="handleSaveApiKey(event)">
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Anthropic API key</label>
              <input id="anthropicApiKeyInput" type="password" autocomplete="off"
                     placeholder="${api.has_settings_value ? '•••••••• (enter new key to replace)' : 'sk-ant-…'}"
                     class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#A8C3A0]">
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="submit" class="btn-primary px-4 py-2 text-sm">
                <i class="fas fa-save mr-1"></i>Save API key
              </button>
              ${api.has_settings_value ? `
              <button type="button" onclick="handleClearApiKey()" class="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                Clear saved key
              </button>` : ''}
            </div>
            <p id="apiKeyMessage" class="text-sm mt-1" style="display:none;"></p>
          </form>
        </div>
      </section>
    </div>
  `;
}

function renderVenueRow(venue) {
  const inactive = !venue.active;
  return `
    <tr data-venue-id="${venue.id}" class="${inactive ? 'opacity-60' : ''}" style="border-top:1px solid rgba(173,179,184,0.12);">
      <td class="px-3 py-2">
        <input data-field="code" value="${escapeHtml(venue.code)}"
               class="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
      </td>
      <td class="px-3 py-2">
        <input data-field="display_name" value="${escapeHtml(venue.display_name || '')}"
               class="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
      </td>
      <td class="px-3 py-2">
        <input data-field="sort_order" type="number" value="${Number(venue.sort_order) || 0}"
               class="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
      </td>
      <td class="px-3 py-2">
        <label class="inline-flex items-center gap-2 text-sm text-gray-700">
          <input data-field="active" type="checkbox" ${venue.active ? 'checked' : ''}>
          On
        </label>
      </td>
      <td class="px-3 py-2">
        <div class="flex flex-wrap gap-2">
          <button type="button" onclick="handleSaveVenue(${venue.id})"
                  class="px-3 py-1.5 text-xs text-white rounded-lg" style="background:#A8C3A0;">
            Save
          </button>
          <button type="button" onclick="handleDeleteVenue(${venue.id}, '${escapeHtml(venue.code)}')"
                  class="px-3 py-1.5 text-xs text-red-600 rounded-lg border border-red-200 hover:bg-red-50">
            Remove
          </button>
        </div>
      </td>
    </tr>
  `;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getVenueRowValues(id) {
  const row = document.querySelector(`tr[data-venue-id="${id}"]`);
  if (!row) return null;
  return {
    code: row.querySelector('[data-field="code"]').value.trim(),
    display_name: row.querySelector('[data-field="display_name"]').value.trim(),
    sort_order: Number(row.querySelector('[data-field="sort_order"]').value) || 0,
    active: row.querySelector('[data-field="active"]').checked ? 1 : 0,
  };
}

async function handleSaveVenue(id) {
  const payload = getVenueRowValues(id);
  if (!payload || !payload.code) {
    alert('Venue code is required');
    return;
  }

  try {
    const response = await axios.put(`${API_BASE}/admin/venues/${id}`, payload, {
      withCredentials: true,
    });
    if (!response.data.success) throw new Error(response.data.error || 'Save failed');
    await loadVenuesForDropdowns();
    await loadSettingsPage();
  } catch (error) {
    alert(error.response?.data?.error || error.message || 'Failed to save venue');
  }
}

async function handleDeleteVenue(id, code) {
  if (!confirm(`Remove venue "${code}" from the list?\n\nIt will be deactivated (existing events are kept).`)) {
    return;
  }

  try {
    const response = await axios.delete(`${API_BASE}/admin/venues/${id}`, {
      withCredentials: true,
    });
    if (!response.data.success) throw new Error(response.data.error || 'Remove failed');
    await loadVenuesForDropdowns();
    await loadSettingsPage();
  } catch (error) {
    alert(error.response?.data?.error || error.message || 'Failed to remove venue');
  }
}

async function handleAddVenue(event) {
  event.preventDefault();
  const errorEl = document.getElementById('addVenueError');
  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }

  const code = document.getElementById('newVenueCode').value.trim();
  const display_name = document.getElementById('newVenueName').value.trim() || code;
  const sort_order = Number(document.getElementById('newVenueOrder').value) || 100;

  try {
    const response = await axios.post(`${API_BASE}/admin/venues`, {
      code,
      display_name,
      sort_order,
      active: 1,
    }, { withCredentials: true });

    if (!response.data.success) throw new Error(response.data.error || 'Add failed');
    await loadVenuesForDropdowns();
    await loadSettingsPage();
  } catch (error) {
    if (errorEl) {
      errorEl.textContent = error.response?.data?.error || error.message || 'Failed to add venue';
      errorEl.style.display = 'block';
    } else {
      alert(error.response?.data?.error || error.message || 'Failed to add venue');
    }
  }
}

async function handleSaveApiKey(event) {
  event.preventDefault();
  const input = document.getElementById('anthropicApiKeyInput');
  const message = document.getElementById('apiKeyMessage');
  const value = (input?.value || '').trim();

  if (!value) {
    if (message) {
      message.textContent = 'Enter an API key to save.';
      message.style.color = '#e57373';
      message.style.display = 'block';
    }
    return;
  }

  try {
    const response = await axios.put(`${API_BASE}/admin/settings`, {
      anthropic_api_key: value,
    }, { withCredentials: true });

    if (!response.data.success) throw new Error(response.data.error || 'Save failed');
    await loadSettingsPage();
  } catch (error) {
    if (message) {
      message.textContent = error.response?.data?.error || error.message || 'Failed to save API key';
      message.style.color = '#e57373';
      message.style.display = 'block';
    }
  }
}

async function handleClearApiKey() {
  if (!confirm('Clear the API key saved in Settings?\n\nWord parsing will fall back to the Cloudflare environment secret if one is set.')) {
    return;
  }

  try {
    const response = await axios.put(`${API_BASE}/admin/settings`, {
      clear_anthropic_api_key: true,
      anthropic_api_key: '',
    }, { withCredentials: true });

    if (!response.data.success) throw new Error(response.data.error || 'Clear failed');
    await loadSettingsPage();
  } catch (error) {
    alert(error.response?.data?.error || error.message || 'Failed to clear API key');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadVenuesForDropdowns();
});
