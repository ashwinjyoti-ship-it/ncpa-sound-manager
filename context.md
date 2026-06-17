# ncpa-sound-manager — Session Context

> Reference file for AI coding sessions. Updated after each significant work block.
> Last updated: 2026-06-17

---

## Project Overview

**ncpa-sound-manager** is an internal web app for the NCPA (National Centre for the Performing Arts) sound department. It manages the monthly events calendar, tracks sound requirements, crew assignments, call times, and rider documents for each show.

- **Production URL:** `https://ncpa-sound.pages.dev`
- **Cloudflare Pages project name:** `ncpa-sound` (in `wrangler.jsonc`)
- **GitHub repo:** `ashwinjyoti-ship-it/ncpa-sound-manager`

---

## Stable Rollback Markers

| Branch | Commit | What's in it |
|---|---|---|
| `stable/v1.2` | `869bb96` | **Previous stable** — FOH/Stage crew split, Edit modal UI, CSV export update |
| `stable/v1.1` | `bf1d377` | Older stable — Apple glass UI, correct short notice |
| `stable/v1.0` | `7d43d76` | Pre-glass UI, pre-crew-CSV-update |

**To roll back production to stable/v1.2:**
```
git push origin stable/v1.2:main --force
```

> **Note:** Production `main` has moved ahead of `stable/v1.2` with the NCPA warm dark reskin, nav PNG buttons, Crew tab access changes, and notification theming (PR #61, pending merge).

---

## Branch Strategy

| Branch | State | Purpose |
|---|---|---|
| `main` | Production | Cloudflare Pages deploys from here via GitHub Actions |
| `cursor/ncpa-themed-notifications-cd9e` | In review | PR #61 — NCPA-themed system toasts + inline status messages |
| `stable/v1.2` | Rollback marker | Post FOH/Stage crew split |
| `stable/v1.1` | Rollback marker | Post glass UI |
| `stable/v1.0` | Rollback marker | Pre-glass UI |

Push to production: `git push origin <branch>:main` (or merge via PR).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server framework | [Hono.js](https://hono.dev) on Cloudflare Pages Functions |
| Frontend | Vanilla JS + Tailwind CSS (CDN) — HTML/CSS shell in `src/index.tsx` |
| Database (events) | Cloudflare D1 (SQLite) — `ncpa-sound-crew-db` (binding: `DB`) |
| Database (crew) | Cloudflare D1 (SQLite) — `ncpa-crew-db` (binding: `DB_CREW`) — read-only from this app |
| AI parsing | Anthropic Claude API via `ANTHROPIC_API_KEY` env var |
| Vector search | Cloudflare Vectorize — `ncpa-events-index` (binding: `VECTORIZE`) |
| Deployment | GitHub Actions → `cloudflare/wrangler-action@v3` |
| Build | `npm run build` (Vite) → output in `./dist` |

**D1 database IDs:**
- `ncpa-sound-crew-db` (events): `8dd5bac9-26b7-45d7-94b3-7a013ec3e880`
- `ncpa-crew-db` (crew unavailability): `3bc26aff-d41b-4d7b-bb68-7b768d02dabf`

**Cloudflare Pages env vars needed:**
- `ANTHROPIC_API_KEY` — Claude API key for Word doc parsing
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — in GitHub Actions secrets

**Important — `DB_CREW` in production:** Ensure the `DB_CREW` binding is added in the Cloudflare Pages dashboard (Settings → Functions → D1 database bindings) pointing to `ncpa-crew-db`. Without it the `/api/crew-availability` endpoint will error.

---

## Local Development

```bash
npm install
npm run dev:sandbox   # build + migrate local D1 + wrangler pages dev on :3000
```

- **URL:** `http://127.0.0.1:3000`
- **Default admin:** `ashwinjyoti@gmail.com` / `admin123` (created on first auth init)
- Migrations prompt once on first run — answer `Y`

---

## Key Files

| File | Purpose |
|---|---|
| `src/index.tsx` | Main Hono server — routes, HTML shell, **all theme CSS** (`:root` tokens + overrides) |
| `public/static/app.js` | Calendar logic, modals, uploads, **notification toasts**, Add Show UI |
| `public/static/auth.js` | Login/signup, admin panel, user management, crew stats |
| `public/static/v41-features.js` | V4.1 features — filters, conflicts, bulk ops, analytics, short notice |
| `wrangler.jsonc` | Cloudflare config — D1 (`DB` + `DB_CREW`), AI, Vectorize bindings |
| `.github/workflows/deploy.yml` | CI/CD — deploys on push to `main` |

There is **no separate theme file** or `tailwind.config.js`. Styling lives in the inline `<style>` block inside `src/index.tsx`, layered over legacy CSS from the earlier light glass theme.

---

## UI / Visual Style — NCPA Warm Dark Theme (Current)

The app was re-skinned from the earlier **light glassmorphism / periwinkle** palette (`#98A2D7`, `#f8f9fc`) to a **warm dark stone theme** using CSS custom properties on `:root` in `src/index.tsx`.

### Design tokens

| Token | Value | Role |
|---|---|---|
| `--ncpa-bg` / `--ncpa-bg-2` / `--ncpa-bg-3` | `#1C1917` → `#2A211C` | Page backgrounds |
| `--ncpa-amber` / `--ncpa-amber-light` | `#E0A458` / `#F0B978` | Primary accent, info, active states |
| `--ncpa-terracotta` / `--ncpa-terracotta-light` | `#C75B39` / `#E8825F` | Error, urgency, incomplete events |
| `--ncpa-green` / `--ncpa-green-light` | `#5C9D6F` / `#7DC491` | Success |
| `--ncpa-text*` | Cream tones | Typography on dark surfaces |
| `--ncpa-panel*` / `--ncpa-border*` | Semi-transparent stone | Glass panels, cards, modals |

### Key CSS classes

| Class | Purpose |
|---|---|
| `.btn-primary` | Amber pill button with dark text |
| `.glass-card` / `.glass-header` | Dark frosted panels (overridden to NCPA tokens) |
| `.modal-content` | Dark modal surfaces with cream text |
| `.event-card-green` | Complete event — **amber** left border (name kept for compat) |
| `.event-card-peach` | Incomplete event — **terracotta** left border |
| `.ncpa-toast` / `.ncpa-toast--{success,error,info,warning}` | Floating system toasts (Phase 1) |
| `.ncpa-status` / `.ncpa-status--{info,success,error}` | Inline status text (Phase 2) |

### Navigation

- Calendar / Table / Crew tabs use PNG clay-style button images (`/static/images/nav/`)
- Active tab has no rectangular background overlay (fixed PR #58)
- **Crew tab visible to all users** — no login required (PR #59 era)

### Still on old palette (known gaps)

| Item | Location | Notes |
|---|---|---|
| PWA `theme_color` / `background_color` | `public/manifest.json`, `<meta theme-color>` | Still `#465080` / `#f8f9fc` |
| Some inline `style=""` hex values | Scattered in `index.tsx` HTML | Partially overridden by later CSS |
| v4.1 report modals | `v41-features.js` dynamic HTML | Old `#98A2D7`, `bg-red-50`, etc. |
| Admin panel inline errors | `auth.js` | `text-red-600` in crew stats / pending users |
| Native `confirm()` / `alert()` | `app.js`, `auth.js`, `v41-features.js` | Browser chrome — not themed |
| `deleteConfirmModal` | `index.tsx` HTML | Exists but **unused** — deletes use native `confirm()` |

---

## Notification & Status Message System

**No toast library** (no react-hot-toast, sonner, etc.). All feedback is custom vanilla JS in `public/static/app.js`.

### Phase 1 — Floating toasts (PR #61)

| Function | Purpose |
|---|---|
| `getNotificationToastClass(type)` | Returns `.ncpa-toast` + type modifier |
| `showNotification(message, type)` | Top-right toast — auto-dismiss (3s info/success/warning, 8s error) |
| `showPersistentNotification()` | Persistent toast (defined, rarely used) |
| `createUploadProgressToast()` | Word doc upload progress bar |
| `updateUploadProgress(toast, pct, msg, type)` | Updates Word upload toast |

**Toast type → colour:**

| Type | Token / class |
|---|---|
| `info` | `--ncpa-amber` → `.ncpa-toast--info` |
| `success` | `--ncpa-green` → `.ncpa-toast--success` |
| `error` | `--ncpa-terracotta` → `.ncpa-toast--error` |
| `warning` | `--ncpa-amber-light` → `.ncpa-toast--warning` |

**Used for:** CSV upload, Word doc bulk upload, single/bulk delete toasts, add/edit events, exports, AI queries, login-required warnings, and general errors.

### Phase 2 — Inline status messages (PR #61)

| Element | Classes | Used when |
|---|---|---|
| `#bulkDeleteStatus` | `.ncpa-status--info/success/error` | Bulk month delete progress/result |
| `#loginError`, `#signupError`, `#changePasswordError` | `.ncpa-status--error` | Auth form errors |
| `#signupSuccess`, `#changePasswordSuccess` | `.ncpa-status--success` | Auth form success |
| Add Show crew error | `.ncpa-status--error` | Crew availability API failure |
| `#aiResultsContainer` error | `.ncpa-status--error` | AI query failure inline text |

### Delete confirmations

All delete flows still use native `confirm()` dialogs (browser chrome). The styled `#deleteConfirmModal` in HTML is dead code — `closeDeleteConfirm()` is referenced in click-outside handler but never defined as a working flow.

---

## Database Schema — `events` Table

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date TEXT,         -- "YYYY-MM-DD"
  program TEXT,            -- Short show name (max ~7 words)
  venue TEXT,              -- Full venue name (see mapping below)
  team TEXT,               -- Department/team name
  sound_requirements TEXT, -- Audio equipment only (mics, monitors, laptops, aux)
  call_time TEXT,          -- Sound team call time only
  crew TEXT,               -- Comma-separated crew names (backward-compat, kept as combined FOH+Stage)
  foh_crew TEXT,           -- Single FOH engineer name (May 2026 onwards)
  stage_crew TEXT,         -- Comma-separated stage crew (May 2026 onwards)
  requirements_updated INTEGER, -- 1 if sound_requirements is filled, else 0
  status TEXT,             -- "confirmed" | "tentative" | "cancelled"
  tags TEXT,
  source TEXT,             -- "manual" (Add Show form) | "import_word" (Word/CSV upload)
  rider TEXT,              -- Comma-separated document URLs (OneDrive etc.)
  notes TEXT               -- Internal notes — NOT exported to Google Sheet
);
```

**FOH / Stage crew split (migration 0007):**
- `foh_crew` — single person; FOH position. Single-select in Add Show and Edit modal.
- `stage_crew` — one or more; stage crew. Multi-select in Add Show and Edit modal.
- `crew` — kept as denormalized combined string (FOH + Stage joined) for backward compat.

**`source` column values:**
- `'manual'` — entered via the Add Show form. Used by short notice report.
- `'import_word'` — uploaded via Word doc or CSV bulk import.

---

## Add Show — Crew Availability Flow

1. User picks a date (or date range) in the Add Show modal
2. Frontend calls `GET /api/crew-availability?dates=YYYY-MM-DD,...` (debounced 280ms)
3. Endpoint queries **two databases**:
   - `DB` — existing shows on those dates, extracts crew from `crew`, `foh_crew`, `stage_crew`
   - `DB_CREW` — `crew_unavailability` records from the crew-assignment automation app
4. Returns: `available`, `assigned` (on another show), `unavailable` (blocked)
5. UI renders FOH (radio), Stage (checkbox), and excluded crew sections
6. On submit, `POST /api/events` receives `foh_crew` + `stage_crew`

**Valid crew roster** (hardcoded in `/api/crew-availability`):
`Naren, Sandeep, Coni, Nikhil, NS, Aditya, Viraj, Shridhar, Nazar, Omkar, Akshay, OC1, OC2, OC3`

---

## API Endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/crew-availability?dates=...` | Available/assigned/unavailable crew for given dates |
| `POST` | `/api/events` | Create event — accepts `foh_crew` + `stage_crew` |
| `PUT` | `/api/events/:id` | Update event |
| `PUT` | `/api/events/bulk-crew` | Update crew across multiple event IDs (propagation) |
| `DELETE` | `/api/events/:id` | Delete event |
| `GET` | `/api/events` | List events (month filter) |
| `POST` | `/api/events/bulk` | CSV bulk upload |
| `POST` | `/api/events/bulk-delete` | Delete all events in a month/year |
| `GET` | `/api/export/csv` | Google Sheets export |
| `GET` | `/api/export/short-notice-report` | Short notice report (manual entries only) |

Auth routes in `src/auth-endpoints.ts`: signup, login, `/api/auth/me`, admin approve/reject, change password.

---

## Venue Code Mapping (for Word doc parsing)

| Code | Full Name |
|---|---|
| `TT` | Tata Theatre |
| `TET` | Experimental Theatre (**not** Tata Theatre) |
| `JBT` | Jamshed Bhabha Theatre |
| `GDT` | Godrej Dance Theatre |
| `LT` / `Little` | Little Theatre |
| `OAP` | Open Air Plaza |
| `DPAG` | Dilip Piramal Art Gallery |
| `Stuart Liff Lib` | Stuart Liff Library |

---

## Word Document Parsing

The app parses NCPA monthly schedule Word docs (`.docx`) into events using Claude (`parseChunkWithClaude` in `src/index.tsx`).

**Key parsing rules:**
- `program`: Short name only — max 5–7 words
- `sound_requirements`: Audio/AV equipment ONLY
- `call_time`: Sound-team-specific readiness time ONLY
- `crew`: Always return `""` — crew assigned manually or via CSV
- **Multi-day events**: separate event per date, identical fields except `event_date`

Upload shows a **progress toast** (`createUploadProgressToast`) through extract → AI parse → DB upload stages.

---

## CSV Bulk Upload Logic (`POST /api/events/bulk`)

**Duplicate check:** compares `event_date + program + venue` as triplet.

| CSV row vs existing record | CSV has crew? | Result |
|---|---|---|
| Match found | Yes | **Updates `crew` field** on existing record |
| Match found | No | Skip |
| No match | Either | Insert as new event with `source = 'import_word'` |

Invalid rows missing `event_date`, `program`, or `venue` are dropped.

---

## Google Sheet Integration

```
=IMPORTDATA("https://ncpa-sound.pages.dev/api/export/csv?month=YYYY-MM&v=N")
```

Bump `v=N` by 1 to force cache refresh in Sheets.

**CSV columns:** `Date, FOH, Stage, Program, Venue, Team, Sound Requirements, Call Time, Rider 1, Rider 2, Rider 3`

Notes are internal only — not exported.

---

## Short Notice Report

**Route:** `GET /api/export/short-notice-report`  
**Access:** More Actions → clock icon → "Short Notice Report"

- Only `source = 'manual'` events (Add Show — not Word/CSV imports)
- Protocol break = notice period ≤ 12 days
- Modal: single month or month range export

---

## Event Card Colour Logic

Logic in `public/static/app.js` — `isEventGreen(event)`:

- **Complete (`.event-card-green`):** `requirements_updated = 1` AND `call_time` is set and not "not specified"
- **Incomplete (`.event-card-peach`):** either field missing

**Visual (NCPA theme):**
- Complete → amber left border + warm gradient background
- Incomplete → terracotta left border + warm gradient background

(Class names `green`/`peach` are legacy — colours are now amber/terracotta.)

---

## Removed Features

| Feature | Reason |
|---|---|
| Conflicts button (toolbar) | Removed — not needed |
| Short Notice toolbar button | Replaced by More Actions → Short Notice Report |
| Standalone `add-show` app | Merged into ncpa-sound-manager (PR #21) |
| Rectangular active nav tab background | Removed (PR #58) |

---

## Recent Work (as of 2026-06-17)

| PR / Commit | What |
|---|---|
| PR #61 (open) | **NCPA notification theming** — Phase 1 floating toasts + Phase 2 inline status messages |
| PR #59 (merged) | Fix Stage crew assign grid in edit modal |
| PR #58 (merged) | Remove rectangular background from active nav tab buttons |
| `e479c44` | Show Crew tab for all users (no login required) |
| PR #57 (merged) | Revert nav buttons to clay PNG images |
| PR #30 (merged) | Multi-date Add Show fix + crew propagation via `PUT /api/events/bulk-crew` |
| PR #21 (merged) | add-show integration — crew availability, FOH/Stage pill UI, `DB_CREW` binding |

---

## Next Up

- [ ] **Merge PR #61** — NCPA-themed system notifications
- [ ] **Update PWA manifest + meta theme-color** to NCPA dark palette (`#1C1917` / `#E0A458`)
- [ ] **Theme delete confirmations** — wire up `deleteConfirmModal` instead of native `confirm()`
- [ ] **v4.1 report modals** — update remaining old-palette dynamic HTML in `v41-features.js`
- [ ] **Admin panel inline messages** in `auth.js` — align with `.ncpa-status` classes
- [ ] Bump Google Sheet IMPORTDATA formula `v=N` after deploy
