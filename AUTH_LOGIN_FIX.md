# Authentication Login Issue - Troubleshooting Guide

**Issue**: User logs in successfully but gets logged out immediately after page refresh  
**Status**: **FIX DEPLOYED** ✅  
**Test URL**: https://59c8ca6b.ncpa-sound.pages.dev

---

## 🔧 **What Was Fixed**

### **Problem**
- User logs in → sees logged-in state for 1 second → gets logged out
- Happens in new browsers or incognito mode
- Cookies not persisting across page loads

### **Root Cause**
Cloudflare Pages uses:
- `sameSite: 'None'` (for iframe embedding)
- `secure: true` (HTTPS only)

These settings require **explicit `withCredentials: true`** in axios requests, otherwise browsers block the cookies.

### **Solution**
Added three fixes:
1. **Global axios config**: `axios.defaults.withCredentials = true`
2. **Auth check request**: Added `withCredentials: true` to `/auth/me`
3. **Login request**: Added `withCredentials: true` to `/auth/login`
4. **Comprehensive logging**: Added console logs to debug auth flow

---

## 🧪 **How to Test the Fix**

### **Step 1: Open Browser DevTools**
1. Open https://59c8ca6b.ncpa-sound.pages.dev
2. Press **F12** to open DevTools
3. Click the **Console** tab
4. Hard refresh: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)

### **Step 2: Check Initial Load**
You should see these logs:
```
🍪 Axios configured to send credentials with all requests
🚀 Page loaded, checking authentication...
🍪 Initial cookies: (none)
🔐 Checking authentication...
❌ Auth check error: 401 {success: false, error: 'Not authenticated'}
```

This is **normal** if you're not logged in yet.

### **Step 3: Try Logging In**
1. Click **Login** button
2. Enter your email and password
3. Click **Login**

You should see:
```
🔐 Attempting login for: your-email@example.com
✅ Login response: {success: true, user: {...}}
✅ Login successful, user: your-email@example.com
🍪 Cookies after login: session_token=...
```

**Page will reload automatically.**

### **Step 4: Check After Reload**
After the page reloads, you should see:
```
🍪 Axios configured to send credentials with all requests
🚀 Page loaded, checking authentication...
🍪 Initial cookies: session_token=...
🔐 Checking authentication...
✅ Auth response: {success: true, user: {...}}
✅ User authenticated: your-email@example.com
```

**You should stay logged in!** ✅

---

## 🚨 **If You Still Get Logged Out**

If you see `❌` errors after login, check these common issues:

### **Issue 1: Third-Party Cookies Blocked**

**Symptoms**:
```
❌ Auth check error: 401 {success: false, error: 'Not authenticated'}
🍪 Initial cookies: (none)
```

**Solution**:
1. **Chrome/Edge**:
   - Settings → Privacy and security → Cookies and other site data
   - Select "Allow all cookies" or add exception for `ncpa-sound.pages.dev`

2. **Firefox**:
   - Settings → Privacy & Security → Cookies and Site Data
   - Uncheck "Delete cookies and site data when Firefox is closed"
   - Add exception for `ncpa-sound.pages.dev`

3. **Safari**:
   - Preferences → Privacy
   - Uncheck "Prevent cross-site tracking"
   - Uncheck "Block all cookies"

---

### **Issue 2: Incognito/Private Mode**

**Symptoms**:
- Works in normal mode but not in incognito/private mode

**Explanation**:
Incognito/Private mode **blocks third-party cookies** by default.

**Solution**:
- Use normal browser window
- OR manually allow cookies in incognito (not recommended for security)

---

### **Issue 3: Browser Extensions Blocking Cookies**

**Symptoms**:
```
❌ Auth check error: 401
```
But cookies look like they're being set.

**Common culprits**:
- **Privacy Badger**
- **uBlock Origin** (strict mode)
- **Ghostery**
- **AdBlock Plus**

**Solution**:
1. Disable extensions temporarily
2. Try logging in
3. If it works, add `ncpa-sound.pages.dev` to extension whitelist

---

### **Issue 4: Clear Site Data**

**Symptoms**:
- Worked before, suddenly stopped working
- Console shows old/corrupted cookies

**Solution**:
1. Open DevTools (F12)
2. Go to **Application** tab
3. Left sidebar → **Storage** → **Clear site data**
4. Click **Clear site data** button
5. Hard refresh page
6. Try logging in again

---

### **Issue 5: CORS/Cookie Domain Issues**

**Symptoms**:
```
❌ Auth check error: Network Error
```
OR
```
🍪 Cookies after login: (none)
```

**Explanation**:
Cookie might not be set due to domain mismatch.

**Check**:
1. Open DevTools → **Network** tab
2. Look for `/auth/login` request
3. Check **Response Headers** for `Set-Cookie`
4. Check if cookie has correct domain

**Expected**:
```
Set-Cookie: session_token=...; Domain=.pages.dev; Secure; HttpOnly; SameSite=None
```

---

## 📊 **Understanding the Console Logs**

### **Successful Flow**:
```
🍪 Axios configured                   ← Global config loaded
🚀 Page loaded                        ← Page initialized
🍪 Initial cookies: session_token=... ← Cookie found
🔐 Checking authentication            ← Auth check started
✅ Auth response: {success: true}     ← Server confirmed auth
✅ User authenticated: email@...      ← User logged in
```

### **Failed Auth (Not Logged In)**:
```
🍪 Axios configured
🚀 Page loaded
🍪 Initial cookies: (none)            ← No cookie found
🔐 Checking authentication
❌ Auth check error: 401              ← Server rejected (normal)
```

### **Login Flow**:
```
🔐 Attempting login for: email@...    ← Login started
✅ Login response: {success: true}    ← Server approved
✅ Login successful                   ← Cookie set
🍪 Cookies after login: session_token=... ← Cookie visible
(page reloads)
✅ User authenticated                 ← Still logged in after reload ✅
```

---

## 🔍 **Advanced Debugging**

### **Check Cookies Manually**

**In DevTools**:
1. **Application** tab
2. Left sidebar → **Cookies** → `https://ncpa-sound.pages.dev`
3. Look for `session_token`

**Expected**:
| Name | Value | Domain | Path | Expires | HttpOnly | Secure | SameSite |
|------|-------|--------|------|---------|----------|--------|----------|
| session_token | (long string) | .pages.dev | / | (7 days from now) | ✓ | ✓ | None |

**If missing**: Cookies are being blocked by browser

**If present but auth fails**: Backend issue (contact admin)

---

### **Check Network Requests**

**In DevTools → Network tab**:

1. **Login request** (`/api/auth/login`):
   - Method: POST
   - Status: 200 OK
   - Response: `{success: true, user: {...}}`
   - Response Headers: `Set-Cookie: session_token=...`

2. **Auth check request** (`/api/auth/me`):
   - Method: GET
   - Status: 200 OK (if logged in) or 401 (if not)
   - Request Headers: `Cookie: session_token=...`
   - Response: `{success: true, user: {...}}`

**If Cookie header is missing in /auth/me**: `withCredentials` not working

---

## ✅ **Production URLs**

| Environment | URL | Status |
|------------|-----|--------|
| **Latest (with fix)** | https://59c8ca6b.ncpa-sound.pages.dev | ✅ Live |
| **Production** | https://ncpa-sound.pages.dev | ✅ Live |
| **Sandbox** | http://localhost:3000 | ✅ Running |
| **GitHub** | https://github.com/ashwinjyoti-ship-it/ncpa-sound-manager | ✅ Pushed |

---

## 🎯 **Quick Checklist**

Before reporting an issue, verify:

- [ ] Using latest URL: https://59c8ca6b.ncpa-sound.pages.dev
- [ ] Hard refreshed page (`Ctrl + Shift + R`)
- [ ] DevTools Console open (F12)
- [ ] Third-party cookies **allowed** in browser settings
- [ ] **NOT** using incognito/private mode
- [ ] Browser extensions **disabled** (or site whitelisted)
- [ ] Cleared site data (DevTools → Application → Clear site data)
- [ ] Console shows `🍪 Axios configured` on page load
- [ ] Console shows `🍪 Cookies after login: session_token=...` after login
- [ ] Network tab shows `Cookie: session_token=...` in /auth/me request

---

## 📧 **Still Having Issues?**

If you've tried everything above and still get logged out, provide:

1. **Browser & Version**: (e.g., Chrome 120, Firefox 121)
2. **Operating System**: (e.g., Windows 11, macOS 14)
3. **Console logs**: (copy all logs from Console tab)
4. **Network logs**: (screenshot of /auth/login and /auth/me requests)
5. **Cookie screenshot**: (DevTools → Application → Cookies)
6. **Browser settings**: (are third-party cookies allowed?)
7. **Extensions**: (list of active extensions)

---

## 💡 **Why This Happened**

Cloudflare Pages deploys to a `*.pages.dev` subdomain, which browsers treat as a "third-party" context when cookies use `SameSite=None`. 

Modern browsers (Chrome 80+, Firefox 69+, Safari 13+) require:
- **`Secure` flag**: Cookie only sent over HTTPS ✅
- **`SameSite=None`**: Allow cross-site cookie ✅
- **`withCredentials: true`**: Explicitly tell browser to include cookie ✅

The third requirement was missing, so browsers were **silently blocking** the cookies.

---

## 🔧 **Files Changed**

- **`public/static/auth.js`**: Added `axios.defaults.withCredentials = true` and comprehensive logging

**Commit**: `682b298` - "fix: Add auth debugging and ensure cookies are sent with all requests"

---

**Status**: ✅ **FIX DEPLOYED - TEST NOW**

**Action**: Open https://59c8ca6b.ncpa-sound.pages.dev in a new incognito window and try logging in. Check console for the emoji logs. It should work!
