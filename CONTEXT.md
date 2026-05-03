# ncpa-sound-manager — Session Context

> Reference file for Claude Code sessions. Updated after each significant work block.
> Last updated: 2026-04-30

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
| `stable/v1.2` | `869bb96` | **Current stable** — FOH/Stage crew split, Edit modal UI, CSV export update |
| `stable/v1.1` | `bf1d377` | Previous stable — Apple glass UI, correct short notice |
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
| `stable/v1.1` | Rollback marker | Current stable — post glass UI session |
| `stable/v1.0` | Rollback marker | Previous stable |
| `claude/update-color-palette-0MUE8` | **Merged & live** | Glassmorphism/lavender palette — merged in PRs #1 & #2 |

**Important:** Local branch is named `master`, remote production is `main`.
Push with: `git push origin master:main`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server framework | [Hono.js](https://hono.dev) on Cloudflare Pages Functions |
| Frontend | Vanilla JS + Tailwind CSS (served as inline template string in `src/index.tsx`) |
| Database | Cloudflare D1 (SQLite) — `ncpa-sound-crew-db` |
| AI parsing | Anthropic Claude API (`claude-sonnet-4-6`) via `ANTHROPIC_API_KEY` env var |
| Vector search | Cloudflare Vectorize — `ncpa-events-index` (binding: `VECTORIZE`) |
| Deployment | GitHub Actions → `cloudflare/wrangler-action@v3` |
| Build | `npm run build` (Vite/TypeScript) → output in `./dist` |

**D1 database ID:** `8dd5bac9-26b7-45d7-94b3-7a013ec3e880`

**Cloudflare Pages env vars needed:**
- `ANTHROPIC_API_KEY` — Claude API key for Word doc parsing
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — in GitHub Actions secrets

---

## Key Files

| File | Purpose |
|---|---|
| `src/index.tsx` | Main Hono server — ALL routes, ALL HTML/CSS/JS served as template strings |
| `public/static/app.js` | Frontend calendar logic — event cards, modals, upload handling |
| `public/static/auth.js` | Admin panel — user management, crew stats, pending approvals |
| `public/static/v41-features.js` | V4.1 feature set — old short notice logic (dormant), analytics etc. |
| `wrangler.jsonc` | Cloudflare config — D1, AI, Vectorize bindings |
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
- `foh_crew` — single person; FOH position. Single-select dropdown in Edit modal.
- `stage_crew` — one or more; stage crew. Multi-select checkboxes in Edit modal.
- `crew` — kept as denormalized combined string (FOH + Stage joined) for backward compat.
- May 2026 existing data migrated: first name in `crew` → `foh_crew`, rest → `stage_crew`.
- Pre-May 2026 data: `foh_crew` and `stage_crew` are NULL; `crew` unchanged.

**`source` column values:**
- `'manual'` — entered via the Add Show form. Used by short notice report.
- `'import_word'` — uploaded via Word doc or CSV bulk import.
- Note: historical records before March 2026 code fix may have `source = 'manual'` even if bulk-imported (old code defaulted to 'manual'). All NEW uploads are correctly tagged.

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

**Note:** Old `checkShortNotice()` toolbar button (yellow card UI) has been removed — it used wrong logic with no source filter.

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

**Tab navigation:** iOS segmented control — grey pill container, active tab = floating white glass pill.

**Toolbar buttons:** All glass-style. Conflicts button removed. Old Short Notice toolbar button removed.

---

## Removed Features

| Feature | Reason |
|---|---|
| Conflicts button (toolbar) | Removed — not needed |
| Short Notice toolbar button | Removed — replaced by More Actions → Short Notice Report with correct logic |

---

## Recent Work (as of 2026-04-30)

| Commit | What |
|---|---|
| `bcc7b65` | FOH/Stage crew split: Edit modal UI, DB migration, CSV export update |
| `bf1d377` | Remove old Short Notice toolbar button (wrong logic, no source filter) |
| `71af5f8` | Short notice report: month range picker (not day range) |
| `8a34017` | Remove Conflicts feature completely |
| `4a3875b` | CSV bulk upload: update crew on duplicate match instead of skipping |
| `a67f76f` | Apple liquid glass UI: subtle card colours, segmented tabs, glass buttons |
| `e530f56` | Fix event card indicator colours (was lavender, now proper green/red) |

---

## Next Up

- [ ] Run DB migration 0007 on production D1: `wrangler d1 execute ncpa-sound-crew-db --file=migrations/0007_foh_stage_crew.sql`
- [ ] Bump Google Sheet IMPORTDATA formula `v=N` after migration so Sheets picks up new FOH/Stage columns
- [ ] Colour palette refinement — the glassmorphism is in production. Session decision needed:
  - Option A: Strip glassmorphism, go clean/flat, apply new palette
  - Option B: Keep glassmorphism, change lavender/purple tones to something better
  - Rollback to `stable/v1.1` if anything breaks
