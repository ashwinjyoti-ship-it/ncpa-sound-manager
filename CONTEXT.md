# ncpa-sound-manager — Session Context

> Reference file for Claude Code sessions. Updated after each significant work block.
> Last updated: 2026-05-25

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

---

## Branch Strategy

| Branch | State | Purpose |
|---|---|---|
| `master` (local) | Stable, production | Maps to `origin/main` — this is what deploys |
| `origin/main` | Production | Cloudflare Pages deploys from here via GitHub Actions |
| `stable/v1.2` | Rollback marker | Post FOH/Stage crew split |
| `stable/v1.1` | Rollback marker | Post glass UI |
| `stable/v1.0` | Rollback marker | Pre-glass UI |

**Important:** Local branch is named `master`, remote production is `main`.
Push with: `git push origin master:main`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server framework | [Hono.js](https://hono.dev) on Cloudflare Pages Functions |
| Frontend | Vanilla JS + Tailwind CSS (served as inline template string in `src/index.tsx`) |
| Database (events) | Cloudflare D1 (SQLite) — `ncpa-sound-crew-db` (binding: `DB`) |
| Database (crew) | Cloudflare D1 (SQLite) — `ncpa-crew-db` (binding: `DB_CREW`) — read-only from this app |
| AI parsing | Anthropic Claude API (`claude-sonnet-4-6`) via `ANTHROPIC_API_KEY` env var |
| Vector search | Cloudflare Vectorize — `ncpa-events-index` (binding: `VECTORIZE`) |
| Deployment | GitHub Actions → `cloudflare/wrangler-action@v3` |
| Build | `npm run build` (Vite/TypeScript) → output in `./dist` |

**D1 database IDs:**
- `ncpa-sound-crew-db` (events): `8dd5bac9-26b7-45d7-94b3-7a013ec3e880`
- `ncpa-crew-db` (crew unavailability): `3bc26aff-d41b-4d7b-bb68-7b768d02dabf`

**Cloudflare Pages env vars needed:**
- `ANTHROPIC_API_KEY` — Claude API key for Word doc parsing
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — in GitHub Actions secrets

**Important — `DB_CREW` in production:** After deploying PR #21, ensure the `DB_CREW` binding is added in the Cloudflare Pages dashboard (Settings → Functions → D1 database bindings) pointing to `ncpa-crew-db`. Without it the `/api/crew-availability` endpoint will error.

---

## Key Files

| File | Purpose |
|---|---|
| `src/index.tsx` | Main Hono server — ALL routes, ALL HTML/CSS/JS served as template strings |
| `public/static/app.js` | Frontend calendar logic — event cards, modals, upload handling, Add Show UI |
| `public/static/auth.js` | Admin panel — user management, crew stats, pending approvals |
| `public/static/v41-features.js` | V4.1 feature set — old short notice logic (dormant), analytics etc. |
| `public/manifest.json` | PWA install metadata for Add to Home Screen / standalone app mode |
| `public/sw.js` | Service worker — caches app shell/static assets, keeps `/api/*` network-first |
| `public/_headers` | Cloudflare Pages headers for CORS, manifest MIME type, and service-worker cache control |
| `public/icon.svg` | Shared PWA and Apple touch icon |
| `wrangler.jsonc` | Cloudflare config — D1 (`DB` + `DB_CREW`), AI, Vectorize bindings |
| `.github/workflows/deploy.yml` | CI/CD — deploys on push to `main` only |

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

**FOH / Stage crew split (migration 0007, applied 2026-04-30):**
- `foh_crew` — single person; FOH position. Single-select in Add Show and Edit modal.
- `stage_crew` — one or more; stage crew. Multi-select in Add Show and Edit modal.
- `crew` — kept as denormalized combined string (FOH + Stage joined) for backward compat.
- May 2026 existing data migrated: first name in `crew` → `foh_crew`, rest → `stage_crew`.
- Pre-May 2026 data: `foh_crew` and `stage_crew` are NULL; `crew` unchanged.

**`source` column values:**
- `'manual'` — entered via the Add Show form. Used by short notice report.
- `'import_word'` — uploaded via Word doc or CSV bulk import.

---

## Add Show — Crew Availability Flow (merged May 2026, PR #21)

The Add Show modal now has an integrated crew availability check — previously this lived in a separate standalone `add-show` app.

**How it works:**
1. User picks a date (or date range) in the Add Show modal
2. Frontend calls `GET /api/crew-availability?dates=YYYY-MM-DD,...` (debounced 280ms)
3. Endpoint queries **two databases**:
   - `DB` (`ncpa-sound-crew-db`) — finds existing shows on those dates, extracts all assigned crew from `crew`, `foh_crew`, `stage_crew` columns
   - `DB_CREW` (`ncpa-crew-db`) — finds crew members with `crew_unavailability` records on those dates (managed by the crew-assignment automation app)
4. Returns three lists: `available`, `assigned` (on another show that day), `unavailable` (blocked in crew-assignment app)
5. UI renders:
   - **Conflict warning box** if other shows exist on the selected date(s)
   - **FOH Engineer** section — radio pill select (single select, available crew only)
   - **Stage Crew** section — checkbox pill select (multi-select, available crew only)
   - **Excluded** section — 🔒 assigned crew, ⛔ blocked crew
6. On submit, `POST /api/events` receives `foh_crew` (string) + `stage_crew` (array) and stores them directly — no need to open Edit afterwards

**Valid crew roster** (hardcoded in `/api/crew-availability`):
`Naren, Sandeep, Coni, Nikhil, NS, Aditya, Viraj, Shridhar, Nazar, Omkar, Akshay, OC1, OC2, OC3`

**`ncpa-crew-db` is read-only from this app** — its schema (`crew`, `crew_unavailability` tables) is managed by the crew-assignment automation app.

---

## API Endpoints

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/crew-availability?dates=...` | Returns available/assigned/unavailable crew for given dates |
| `POST` | `/api/events` | Create event — accepts `foh_crew` + `stage_crew` (or legacy `crew`) |
| `PUT` | `/api/events/:id` | Update event — full FOH/Stage/crew fields |
| `DELETE` | `/api/events/:id` | Delete event |
| `GET` | `/api/events` | List events (month filter) |
| `GET` | `/api/export/csv` | Google Sheets export — FOH, Stage, program, venue, team, etc. |
| `GET` | `/api/export/short-notice-report` | Short notice report (manual entries only, ≤12 days notice) |
| `POST` | `/api/events/bulk` | CSV bulk upload — insert or update crew on existing events |

---

## Venue Code Mapping (for Word doc parsing)

| Code | Full Name |
|---|---|
| `TT` | Tata Theatre |
| `TET` | Experimental Theatre (**not** Tata Theatre — common confusion) |
| `JBT` | Jamshed Bhabha Theatre |
| `GDT` | Godrej Dance Theatre |
| `LT` / `Little` | Little Theatre |
| `OAP` | Open Air Plaza |
| `DPAG` | Dilip Piramal Art Gallery |
| `Stuart Liff Lib` | Stuart Liff Library |

---

## Word Document Parsing (`parseChunkWithClaude` in `src/index.tsx`)

The app parses NCPA monthly schedule Word docs (`.docx`) into events using Claude.

**Key parsing rules:**
- `program`: Short name only — max 5–7 words. Remove "An NCPA Presentation", duration, organizer brackets, subtitles after colons.
- `sound_requirements`: Audio/AV equipment ONLY — mics, monitors, laptops, aux, NCPA basic sound. Exclude stage, lighting, AC, catering, parking, ushers.
- `call_time`: Sound-team-specific readiness time ONLY — "sound to be ready by X", "Sound Check at X". Not general setup/technician times.
- `crew`: Always return `""` — crew is assigned manually or via CSV.
- **Multi-day events**: "Thu 2nd & Fri 3rd & Sat 4th" → create a SEPARATE event per date with identical fields, only `event_date` changes.

---

## CSV Bulk Upload Logic (`POST /api/events/bulk`)

**Duplicate check:** compares `event_date + program + venue` as triplet.

| CSV row vs existing record | CSV has crew? | Result |
|---|---|---|
| Match found | Yes | **Updates `crew` field** on existing record |
| Match found | No | Skip (nothing to update) |
| No match | Either | Insert as new event with `source = 'import_word'` |

**Use case:** Generate crew assignments externally → upload CSV → crew gets written into matching records without duplicating events.

**Invalid rows:** Missing `event_date`, `program`, or `venue` → dropped.

**Response message** distinguishes: "X events uploaded, Y crew assignments updated, Z skipped."

---

## Google Sheet Integration

```
=IMPORTDATA("https://ncpa-sound.pages.dev/api/export/csv?month=YYYY-MM&v=N")
```

Bump `v=N` by 1 to force cache refresh in Sheets.

**Current CSV columns (as of 2026-04-30):**
`Date, FOH, Stage, Program, Venue, Team, Sound Requirements, Call Time, Rider 1, Rider 2, Rider 3`

- **FOH** — single engineer name, or empty for pre-May events.
- **Stage** — comma-separated stage crew. For pre-May events, falls back to legacy `crew` value.
- Old "Crew" column removed and replaced by FOH + Stage.

Notes are internal only — not exported.

---

## Short Notice Report

**Route:** `GET /api/export/short-notice-report`

**Access:** More Actions → clock icon → "Short Notice Report"

**Logic:**
- Only `source = 'manual'` events (hand-entered via Add Show — not Word/CSV imports)
- Notice period = `event_date` minus `DATE(created_at)` in whole days
- **Protocol break = notice period ≤ 12 days**
- Report shows ALL manual entries in range so you can see the full picture

**Modal options:**
- **Single Month** — month picker → exports that full month
- **Month Range** — from-month + to-month pickers → exports full months (1st to last day)

**CSV columns:** `Program Name, Record Creation Date, Show Date, Curation Team, Notice Period (days)`

---

## Event Card Colour Logic

- **Green** left border + faint green background: `requirements_updated = 1` AND `call_time` is set
- **Red** left border + faint red background: either field missing

Green = `rgba(74,172,100,0.60)` border, `rgba(240,253,244,0.70)` background — watercolour, not harsh.
Red = `rgba(220,88,88,0.55)` border, `rgba(254,242,242,0.70)` background — same treatment.

Logic in `public/static/app.js` line ~337.

---

## UI / Visual Style (Current Production)

**Palette:** Glassmorphism + lavender/periwinkle ("Ethereal Chronos" system, merged in PRs #1 & #2)
- Primary: `#98A2D7` (muted periwinkle)
- Deep accent: `#465080`
- Background: `#f8f9fc`
- Font: Manrope

**Key CSS classes (in `src/index.tsx`):**
- `.glass-surface` — frosted glass panel (20px blur)
- `.glass-card` — frosted glass card (12px blur)
- `.btn-primary` — liquid glass lavender pill (gradient + backdrop-filter)
- `.btn-glass` — Apple-style frosted secondary button (white border, inset highlight)
- `.tab-active` — iOS segmented control active pill (white glass, shadow)
- `.event-card-green` / `.event-card-peach` — watercolour green/red indicator cards

**Crew availability pill styles** (added PR #21, prefixed `avail-*`):
- `.avail-foh-pill input:checked+label` — solid periwinkle `#6B77C0` background
- `.avail-stage-pill input:checked+label` — soft green `#A8C3A0` background
- `.avail-cbox` — orange-tinted conflict warning box
- `.avail-etag-a` — red "assigned" tag, `.avail-etag-b` — grey "blocked" tag

**Tab navigation:** iOS segmented control — grey pill container, active tab = floating white glass pill.

**Toolbar buttons:** All glass-style. Conflicts button removed. Old Short Notice toolbar button removed.

---

## PWA + Mobile Shell (added May 2026)

The app can be installed from mobile browsers as a standalone PWA. The PWA shell is intentionally lightweight: it improves launch/install behavior and caches static assets, but it does **not** make event data usable offline.

**Source of truth:**
- `src/index.tsx` links the manifest, sets mobile web-app meta tags, registers `/sw.js`, and enables safe-area rendering with `viewport-fit=cover`.
- `public/manifest.json` sets `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, `orientation: "portrait-primary"`, `background_color: "#f8f9fc"`, `theme_color: "#465080"`, and SVG icon entries.
- `public/sw.js` defines cache `ncpa-sound-v1`, pre-caches `/`, `/static/app.js`, `/static/auth.js`, `/static/style.css`, `/manifest.json`, and `/icon.svg`.
- `public/_headers` serves `/manifest.json` as `application/manifest+json`, keeps `/sw.js` on `Cache-Control: no-cache`, and gives long-lived cache headers to static files.

**Runtime behavior:**
- `/api/*` requests are **network-first**. If the network fails, the service worker returns JSON `{ "error": "offline" }`.
- Non-API GET requests are **cache-first**. Cached HTML/static assets may stay in use until the service worker changes and activates.
- `install` calls `skipWaiting()` and `activate` deletes old cache names before `clients.claim()`.

**iOS safe-area constraints:**
- Keep `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`.
- Body uses `padding-bottom: env(safe-area-inset-bottom)` so content avoids the home indicator.
- The sticky header uses `padding-top: env(safe-area-inset-top)` and `apple-mobile-web-app-status-bar-style=black-translucent` so the title area clears the iOS status bar in standalone mode.
- When editing header height, sticky positioning, or top-level body padding, smoke-test both Safari tab mode and Add-to-Home-Screen standalone mode.

**Operational pitfalls:**
- Bump the `CACHE` constant in `public/sw.js` when changing cached shell assets (`/`, `/static/app.js`, `/static/auth.js`, `/static/style.css`, manifest, icon). Otherwise installed PWAs can continue serving stale cached assets.
- Do not change `/api/*` to cache-first; calendar/event data must come from D1 and should fail visibly when offline.
- The current icon is SVG-only. Verify target browsers/devices if a platform requires PNG icons before publishing to a wider audience.

**Smoke test checklist:**
1. Run `npm run build`.
2. Serve the build with Pages dev or Cloudflare Pages and verify `/manifest.json`, `/sw.js`, and `/icon.svg` return 200.
3. In Safari/Chrome mobile, add the app to the home screen and launch it standalone.
4. Confirm the header is not hidden under the status bar and bottom content is not blocked by the home indicator.
5. Toggle network offline: static shell may load, but event/API actions should show the network/API failure path rather than stale event data.

---

## Removed Features

| Feature | Reason |
|---|---|
| Conflicts button (toolbar) | Removed — not needed |
| Short Notice toolbar button | Removed — replaced by More Actions → Short Notice Report with correct logic |
| Standalone `add-show` app | Merged into ncpa-sound-manager (PR #21, May 2026) |

---

## Recent Work (as of 2026-05-06)

| PR / Commit | What |
|---|---|
| `79b7df2` | iOS PWA safe-area fix — `viewport-fit=cover`, sticky header top inset, body bottom inset |
| `85277bb` | PWA install support — manifest, service worker, app icon, Cloudflare headers, registration in `src/index.tsx` |
| PR #28 | Responsive/mobile layout tuning — landscape phone compaction, mobile toolbar AI button centering |
| PR #21 | **add-show integration** — crew availability check, FOH/Stage pill UI in Add Show modal, `/api/crew-availability` endpoint, `DB_CREW` binding for `ncpa-crew-db` |
| `bcc7b65` | FOH/Stage crew split: Edit modal UI, DB migration, CSV export update |
| `bf1d377` | Remove old Short Notice toolbar button (wrong logic, no source filter) |
| `71af5f8` | Short notice report: month range picker (not day range) |
| `8a34017` | Remove Conflicts feature completely |
| `4a3875b` | CSV bulk upload: update crew on duplicate match instead of skipping |
| `a67f76f` | Apple liquid glass UI: subtle card colours, segmented tabs, glass buttons |

---

## Next Up

- [ ] **Add `DB_CREW` binding in Cloudflare Pages dashboard** (production) — Settings → Functions → D1 database bindings → add `DB_CREW` → `ncpa-crew-db` (`3bc26aff-d41b-4d7b-bb68-7b768d02dabf`). Without this the crew availability check will fail in production.
- [ ] **Deploy PR #21** — run `npm run deploy:prod` or merge triggers GitHub Actions deploy
- [ ] Bump Google Sheet IMPORTDATA formula `v=N` after deploy so Sheets picks up any changes
- [ ] Colour palette refinement — the glassmorphism is in production. Session decision needed:
  - Option A: Strip glassmorphism, go clean/flat, apply new palette
  - Option B: Keep glassmorphism, change lavender/purple tones to something better
  - Rollback to `stable/v1.2` if anything breaks
