// NCPA Sound Crew - Authentication & User Management
// Version 1.0.0

// Configure axios to always send cookies with requests
if (typeof axios !== 'undefined') {
  axios.defaults.withCredentials = true;
  console.log('🍪 Axios configured to send credentials with all requests');
}

let currentUser = null;

// Check authentication on page load
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Page loaded, checking authentication...');
  console.log('🍪 Initial cookies:', document.cookie || '(none)');
  await checkAuth();
});

// Check if user is authenticated
async function checkAuth() {
  try {
    console.log('🔐 Checking authentication...');
    const response = await axios.get(`${API_BASE}/auth/me`, {
      withCredentials: true  // Ensure cookies are sent
    });
    console.log('✅ Auth response:', response.data);
    
    if (response.data.success) {
      currentUser = response.data.user;
      console.log('✅ User authenticated:', currentUser.email);
      showUserMenu();
      
      // Check for pending approvals if admin
      if (currentUser.role === 'admin') {
        checkPendingApprovals();
      }
    } else {
      console.log('⚠️ Auth failed:', response.data);
      showLoginButton();
    }
  } catch (error) {
    console.error('❌ Auth check error:', error.response?.status, error.response?.data || error.message);
    showLoginButton();
  }
}

// Show user menu
function showUserMenu() {
  document.getElementById('loginBtn').style.display = 'none';
  document.getElementById('userMenu').style.display = 'block';
  document.getElementById('userEmailDisplay').textContent = currentUser.email;
  
  if (currentUser.role === 'admin') {
    document.getElementById('adminBadge').style.display = 'inline';
    document.getElementById('adminPanelBtn').style.display = 'block';
  }
  
  // Show Crew tab for authenticated users
  const crewTab = document.getElementById('crewTab');
  if (crewTab) crewTab.style.display = 'block';
}

// Show login button
function showLoginButton() {
  document.getElementById('loginBtn').style.display = 'block';
  document.getElementById('userMenu').style.display = 'none';
  currentUser = null;
  
  // Hide Crew tab for non-authenticated users
  const crewTab = document.getElementById('crewTab');
  if (crewTab) crewTab.style.display = 'none';
}

// Toggle user dropdown
function toggleUserDropdown() {
  const dropdown = document.getElementById('userDropdown');
  dropdown.classList.toggle('hidden');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('userDropdown');
  const userMenu = document.getElementById('userMenu');
  if (userMenu && !userMenu.contains(e.target)) {
    dropdown?.classList.add('hidden');
  }
});

// Login Modal
function openLoginModal() {
  document.getElementById('loginModal').classList.add('active');
  document.getElementById('loginEmail').focus();
  document.getElementById('loginError').style.display = 'none';
}

function closeLoginModal() {
  document.getElementById('loginModal').classList.remove('active');
  document.getElementById('loginForm').reset();
  document.getElementById('loginError').style.display = 'none';
}

async function handleLogin(event) {
  event.preventDefault();
  
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const errorDiv = document.getElementById('loginError');
  
  try {
    console.log('🔐 Attempting login for:', email);
    const response = await axios.post(`${API_BASE}/auth/login`, {
      email,
      password
    }, {
      withCredentials: true  // Ensure cookies are received and stored
    });
    
    console.log('✅ Login response:', response.data);
    
    if (response.data.success) {
      currentUser = response.data.user;
      console.log('✅ Login successful, user:', currentUser.email);
      
      // Check if cookies are set
      console.log('🍪 Cookies after login:', document.cookie);
      
      closeLoginModal();
      showUserMenu();
      
      // Reload page to fetch events
      location.reload();
    } else {
      console.error('❌ Login failed:', response.data.error);
      errorDiv.textContent = response.data.error || 'Login failed';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    console.error('❌ Login error:', error.response?.status, error.response?.data || error.message);
    errorDiv.textContent = error.response?.data?.error || 'Login failed. Please try again.';
    errorDiv.style.display = 'block';
  }
}

// Signup Modal
function openSignupModal() {
  closeLoginModal();
  document.getElementById('signupModal').classList.add('active');
  document.getElementById('signupEmail').focus();
  document.getElementById('signupError').style.display = 'none';
  document.getElementById('signupSuccess').style.display = 'none';
}

function closeSignupModal() {
  document.getElementById('signupModal').classList.remove('active');
  document.getElementById('signupForm').reset();
  document.getElementById('signupError').style.display = 'none';
  document.getElementById('signupSuccess').style.display = 'none';
}

async function handleSignup(event) {
  event.preventDefault();
  
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const passwordConfirm = document.getElementById('signupPasswordConfirm').value;
  const errorDiv = document.getElementById('signupError');
  const successDiv = document.getElementById('signupSuccess');
  
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';
  
  if (password !== passwordConfirm) {
    errorDiv.textContent = 'Passwords do not match';
    errorDiv.style.display = 'block';
    return;
  }
  
  try {
    const response = await axios.post(`${API_BASE}/auth/signup`, {
      email,
      password
    });
    
    if (response.data.success) {
      successDiv.textContent = 'Signup successful! Awaiting admin approval. You will be able to login once approved.';
      successDiv.style.display = 'block';
      document.getElementById('signupForm').reset();
      
      // Auto-close and open login after 3 seconds
      setTimeout(() => {
        closeSignupModal();
        openLoginModal();
      }, 3000);
    } else {
      errorDiv.textContent = response.data.error || 'Signup failed';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    errorDiv.textContent = error.response?.data?.error || 'Signup failed. Please try again.';
    errorDiv.style.display = 'block';
  }
}

// Change Password Modal
function openChangePasswordModal() {
  document.getElementById('userDropdown').classList.add('hidden');
  document.getElementById('changePasswordModal').classList.add('active');
  document.getElementById('currentPassword').focus();
  document.getElementById('changePasswordError').style.display = 'none';
  document.getElementById('changePasswordSuccess').style.display = 'none';
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal').classList.remove('active');
  document.getElementById('changePasswordForm').reset();
  document.getElementById('changePasswordError').style.display = 'none';
  document.getElementById('changePasswordSuccess').style.display = 'none';
}

async function handleChangePassword(event) {
  event.preventDefault();
  
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const newPasswordConfirm = document.getElementById('newPasswordConfirm').value;
  const errorDiv = document.getElementById('changePasswordError');
  const successDiv = document.getElementById('changePasswordSuccess');
  
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';
  
  if (newPassword !== newPasswordConfirm) {
    errorDiv.textContent = 'New passwords do not match';
    errorDiv.style.display = 'block';
    return;
  }
  
  try {
    const response = await axios.post(`${API_BASE}/auth/change-password`, {
      currentPassword,
      newPassword
    });
    
    if (response.data.success) {
      successDiv.textContent = 'Password changed successfully!';
      successDiv.style.display = 'block';
      document.getElementById('changePasswordForm').reset();
      
      setTimeout(() => {
        closeChangePasswordModal();
      }, 2000);
    } else {
      errorDiv.textContent = response.data.error || 'Failed to change password';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    errorDiv.textContent = error.response?.data?.error || 'Failed to change password';
    errorDiv.style.display = 'block';
  }
}

// Logout
async function logout() {
  try {
    await axios.post(`${API_BASE}/auth/logout`);
  } catch (error) {
    console.error('Logout error:', error);
  }
  
  currentUser = null;
  showLoginButton();
  location.reload();
}

// Admin Panel
async function checkPendingApprovals() {
  try {
    const response = await axios.get(`${API_BASE}/admin/pending-users`);
    if (response.data.success && response.data.users.length > 0) {
      const count = response.data.users.length;
      const badge = document.getElementById('pendingCount');
      badge.textContent = count;
      badge.style.display = 'flex';
    }
  } catch (error) {
    console.error('Failed to check pending approvals:', error);
  }
}

function openAdminPanel() {
  document.getElementById('userDropdown').classList.add('hidden');
  document.getElementById('adminPanelModal').classList.add('active');
  loadPendingUsers();
}

function closeAdminPanel() {
  document.getElementById('adminPanelModal').classList.remove('active');
}

async function loadPendingUsers() {
  const content = document.getElementById('adminPanelContent');
  
  try {
    const response = await axios.get(`${API_BASE}/admin/pending-users`);
    
    if (response.data.success) {
      const users = response.data.users;
      
      if (users.length === 0) {
        content.innerHTML = `
          <div class="text-center py-8">
            <i class="fas fa-check-circle text-5xl text-green-500"></i>
            <p class="mt-4 text-gray-600 text-lg">No pending approvals</p>
            <p class="text-sm text-gray-500 mt-2">All users have been reviewed</p>
          </div>
        `;
      } else {
        content.innerHTML = `
          <div class="mb-4">
            <h3 class="text-lg font-semibold text-gray-800">Pending User Approvals (${users.length})</h3>
          </div>
          <div class="space-y-3">
            ${users.map(user => `
              <div class="flex items-center justify-between p-4 rounded-2xl" style="background:rgba(255,255,255,0.72);outline:1px solid rgba(173,179,184,0.15);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);"
                <div>
                  <p class="font-medium text-gray-800">${user.email}</p>
                  <p class="text-sm text-gray-500">Requested: ${new Date(user.created_at).toLocaleDateString()}</p>
                </div>
                <div class="flex gap-2">
                  <button onclick="approveUser(${user.id})" 
                          class="px-4 py-2 text-white rounded-xl transition-all text-sm" style="background-color:#A8C3A0;"
                    <i class="fas fa-check mr-1"></i>Approve
                  </button>
                  <button onclick="rejectUser(${user.id})" 
                          class="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all text-sm">
                    <i class="fas fa-times mr-1"></i>Reject
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      }
    }
  } catch (error) {
    content.innerHTML = `
      <div class="text-center py-8">
        <i class="fas fa-exclamation-triangle text-4xl text-red-500"></i>
        <p class="mt-4 text-red-600">Failed to load pending users</p>
      </div>
    `;
  }
}

async function approveUser(userId) {
  try {
    const response = await axios.post(`${API_BASE}/admin/approve-user/${userId}`);
    if (response.data.success) {
      loadPendingUsers();
      checkPendingApprovals();
    }
  } catch (error) {
    alert('Failed to approve user');
  }
}

async function rejectUser(userId) {
  if (confirm('Are you sure you want to reject this user? This will permanently delete their account.')) {
    try {
      const response = await axios.post(`${API_BASE}/admin/reject-user/${userId}`);
      if (response.data.success) {
        loadPendingUsers();
        checkPendingApprovals();
      }
    } catch (error) {
      alert('Failed to reject user');
    }
  }
}

// Crew Statistics Tab
async function loadCrewStats() {
  const content = document.getElementById('crewContent');
  const select = document.getElementById('crewMonthSelect');

  // Populate the month dropdown on first load
  if (select && select.options.length === 0) {
    const today = new Date();
    for (let offset = -6; offset <= 3; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const opt = document.createElement('option');
      opt.value = value;
      opt.text = label;
      if (offset === 0) opt.selected = true;
      select.appendChild(opt);
    }
  }

  const today = new Date();
  const month = select
    ? select.value
    : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  // Show spinner while loading
  content.innerHTML = `
    <div class="text-center py-12">
      <i class="fas fa-spinner fa-spin text-4xl text-gray-400"></i>
      <p class="mt-4 text-gray-600">Loading crew statistics...</p>
    </div>
  `;

  try {
    const response = await axios.get(`${API_BASE}/crew/stats?month=${month}`);

    if (response.data.success) {
      const data = response.data.data;
      const monthName = new Date(data.month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

      if (data.crewStats.length === 0) {
        content.innerHTML = `
          <div class="text-center py-12">
            <i class="fas fa-calendar-times text-4xl text-gray-300"></i>
            <p class="mt-4 text-gray-600 font-medium">No crew assignments found for ${monthName}.</p>
            <p class="mt-2 text-gray-400 text-sm">Assignments may not have been made yet for this month. Try selecting a different month above.</p>
          </div>
        `;
        return;
      }

      content.innerHTML = `
        <div class="mb-6">
          <h2 class="text-2xl font-bold text-gray-800 mb-2">
            <i class="fas fa-users mr-2" style="color: #98A2D7;"></i>
            Crew Workload - ${monthName}
          </h2>
          <div class="flex gap-6 text-sm text-gray-600">
            <div><span class="font-semibold">${data.summary.totalAssignments}</span> total days</div>
            <div><span class="font-semibold">${data.summary.avgAssignments}</span> average days per crew</div>
            <div><span class="text-red-600 font-semibold">${data.summary.overloaded}</span> overloaded</div>
            <div><span class="text-blue-600 font-semibold">${data.summary.underutilized}</span> underutilized</div>
          </div>
        </div>

        <div class="space-y-4">
          ${data.crewStats.map((crew, idx) => {
            const statusColor = crew.status === 'overloaded' ? 'bg-red-400' :
                               crew.status === 'underutilized' ? 'bg-[#A2C2D6]' :
                               'bg-[#A8C3A0]';
            const statusText = crew.status === 'overloaded' ? 'Overloaded' :
                              crew.status === 'underutilized' ? 'Underutilized' :
                              'Balanced';

            return `
              <div class="p-4 rounded-2xl hover:shadow-md transition-all" style="background:rgba(255,255,255,0.72);outline:1px solid rgba(173,179,184,0.15);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-3">
                    <span class="text-lg font-bold text-gray-400">${idx + 1}.</span>
                    <span class="text-lg font-semibold text-gray-800">${crew.crew}</span>
                    <span class="px-2 py-1 text-xs font-medium text-white ${statusColor} rounded-full">
                      ${statusText}
                    </span>
                  </div>
                  <span class="text-xl font-bold" style="color: #98A2D7;">${crew.count} days</span>
                </div>
                <div class="relative w-full bg-gray-200 rounded-full h-6">
                  <div class="${statusColor} h-6 rounded-full transition-all flex items-center justify-end pr-2"
                       style="width: ${crew.percentage}%">
                    <span class="text-white text-xs font-semibold">${crew.percentage}%</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  } catch (error) {
    content.innerHTML = `
      <div class="text-center py-12">
        <i class="fas fa-exclamation-triangle text-4xl text-red-500"></i>
        <p class="mt-4 text-red-600">Failed to load crew statistics</p>
      </div>
    `;
  }
}
