# ncpa-sound-manager — Session Context

> Reference file for Claude Code sessions. Updated after each significant work block.
> Last updated: 2026-03-28

---

## Project Overview

**ncpa-sound-manager** is an internal web app for the NCPA (National Centre for the Performing Arts) sound department. It manages the monthly events calendar, tracks sound requirements, crew assignments, call times, and rider documents for each show.

- **Production URL:** `https://ncpa-sound.pages.dev`
- **Cloudflare Pages project name:** `ncpa-sound` (in `wrangler.jsonc`)
- **GitHub repo:** `ashwinjyoti-ship-it/ncpa-sound-manager`

---

## Stable Rollback Marker

**Branch:** `stable/v1.0` (commit `7d43d76`)

This is the last known-good state before colour palette work. If something breaks, revert `origin/main` to this branch.

**What's in v1.0:**
- Monthly calendar with event cards (green/red border logic)
- Manual "Add Show" form + bulk Word doc/CSV upload
- Word doc AI parsing (`claude-sonnet-4-6`)
- Crew assignment, rider/notes, call time fields
- CSV export (monthly + latest) for Google Sheets IMPORTDATA
- Short Notice Report (More Actions → clock icon): exports manually-entered shows with notice period in days. Protocol break = ≤ 12 days notice.
- Dark mode toggle

---

## Branch Strategy

| Branch | State | Purpose |
|---|---|---|
| `master` (local) | Stable, production | Maps to `origin/main` — this is what deploys |
| `origin/main` | Production | Cloudflare Pages deploys from here via GitHub Actions |
| `stable/v1.0` | Rollback marker | Last stable before colour palette work |
| `claude/update-color-palette-0MUE8` | Archived / not deployed | Previous glassmorphism/lavender attempt — not merged |

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
| `wrangler.jsonc` | Cloudflare config — D1, AI, Vectorize bindings |
| `.github/workflows/deploy.yml` | CI/CD — deploys on push to `main` only |
| `package.json` | Build scripts; note: `deploy:prod` script has legacy `--project-name ncpa-sound-crew` (wrong — ignore it, use wrangler.jsonc) |

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
  crew TEXT,               -- Comma-separated crew initials (assigned manually in app)
  requirements_updated INTEGER, -- 1 if sound_requirements is filled, else 0
  status TEXT,             -- "confirmed" | "tentative" | "cancelled"
  tags TEXT,
  source TEXT,             -- "manual" (Add Show form) | "import_word" (Word/CSV upload)
  rider TEXT,              -- Comma-separated document URLs (OneDrive etc.)
  notes TEXT               -- Internal notes — NOT exported to Google Sheet
);
```

**`source` column values:**
- `'manual'` — event entered via the Add Show form (relevant for short notice report)
- `'import_word'` — event uploaded via Word doc or CSV

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
- `crew`: Always return `""` — crew is assigned manually in the app.
- **Multi-day events**: "Thu 2nd & Fri 3rd & Sat 4th" → create a SEPARATE event per date with identical fields, only `event_date` changes.

---

## Google Sheet Integration

Crew access the live data via `=IMPORTDATA()` in Google Sheets:

```
=IMPORTDATA("https://ncpa-sound.pages.dev/api/export/csv?month=YYYY-MM&v=N")
```

**Important:** Bump `v=N` by 1 each time you want to force a cache refresh in Sheets (Google caches IMPORTDATA aggressively).

**Monthly CSV columns:** `Date, Crew, Program, Venue, Team, Sound Requirements, Call Time, Rider 1, Rider 2, Rider 3`

**Latest CSV columns:** `Date, Program, Venue, Team, Crew, Sound Requirements, Call Time, Status, Rider 1, Rider 2, Rider 3`

- Rider URLs are split into 3 separate columns (Rider 1, Rider 2, Rider 3) so each URL auto-links as a clickable hyperlink in Sheets (a single cell with multiple URLs loses clickability).
- Notes are **internal only** — not exported to any CSV/Sheet.

---

## Short Notice Report

**Route:** `GET /api/export/short-notice-report`

**Access:** More Actions dropdown → clock icon → "Short Notice Report"

**Logic:**
- Only covers `source = 'manual'` events (hand-entered via Add Show form)
- Notice period = `event_date` minus `created_at` date (whole days)
- **Protocol break = notice period ≤ 12 days** (NCPA requires 12 days to organise a show)
- Report includes ALL manual entries in range (not just short-notice ones) so you can see the full picture

**CSV output columns:** `Program Name, Record Creation Date, Show Date, Curation Team, Notice Period (days)`

**Date range options:** `?month=YYYY-MM` or `?start=YYYY-MM-DD&end=YYYY-MM-DD`

---

## Event Card Color Logic

Calendar cards show a colored left border:
- **Green** border (`.event-card-green`): `requirements_updated && call_time` both truthy
- **Red** border (`.event-card-peach`): either field missing

Logic is in `public/static/app.js` (search for `event-card-green`).

The `requirements_updated` DB flag is set server-side when `sound_requirements` is non-empty.

---

## Dark Mode

The app supports light/dark mode via CSS variables and `html.dark` class:
- Toggle button in header (moon/sun icon)
- Persisted to `localStorage`
- CSS variables defined on `:root` (light) and `html.dark` (dark) in `src/index.tsx`

---

## Recent Work (as of 2026-03-28)

| Commit | What |
|---|---|
| `7d43d76` | Merge short notice report + fix deploy workflow |
| `1fd0eef` | Fix: use source column instead of new entry_type column |
| `e9386d4` | Add Short Notice Report feature (entry_type approach — superseded) |
| `9ca285d` | Revert app freeze fix during Word upload |
| `81575d6` | Add Rider and Notes: view modal, edit form, API PUT, CSV Rider 1/2/3 split |

---

## Next Up

- [ ] Colour palette change (retry of `claude/update-color-palette-0MUE8` — previous attempt not merged)
  - Previous attempt: glassmorphism/lavender — review what was done before starting fresh
  - Rollback available at `stable/v1.0` if anything breaks

## Pending / To Verify

- [ ] Test Short Notice Report on production — confirm 23 manual events appear, notice period calculates correctly
- [ ] Upload April 2026.docx and confirm:
  - "The Monk & The Warrior" appears as 4 separate events (2nd, 3rd, 4th, 5th April)
  - "The Doctor By Farokh Udwadia" appears as 2 events (12th & 13th April)
  - TET events (Saz-e-Bahar, Stalemate) show venue as "Experimental Theatre" not "Tata Theatre"
  - Crew field is empty on all parsed events
- [ ] Bump `v=` in IMPORTDATA formula to verify Rider 1/2/3 columns appear in Sheet
