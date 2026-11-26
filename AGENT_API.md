# Agent API — crew availability (read-only, no key)

Same data as the calendar's day modal: who is **available**, **assigned** (on shows) and **unavailable** (blocked). Open like the other read endpoints.

**One day:** `GET https://ncpa-sound.pages.dev/api/agent/crew-availability?date=2026-09-01`
```json
{ "success": true, "date": "2026-09-01", "available": ["Coni"], "assigned": ["Naren","Sandeep"], "unavailable": ["Nazar"],
  "shows": [{ "program": "Show A", "venue": "JBT", "crew": "Naren, Sandeep", "foh_crew": "Naren", "stage_crew": "Sandeep" }] }
```
**Range (max 31 days):** `...?start=2026-09-01&end=2026-09-07` → `{ "days": [ ...one per day ] }`

The existing `GET /api/crew-availability?dates=YYYY-MM-DD[,...]` also works. Both share `src/crew-availability.ts`.
