# Agent API — crew availability (read-only)

Gives an AI agent the same roster the calendar's day modal shows: who is **available**, **assigned** (on shows) and **unavailable** (blocked/on leave).

## One-time setup (Ash)
1. Make up a long random key (e.g. 40+ characters).
2. Cloudflare dashboard → Pages → ncpa-sound → Settings → Variables and Secrets → add **secret** `AGENT_API_KEY` (Production) → redeploy.
3. Give the same key to your agent. Never commit it. To rotate, change the secret and redeploy.

## Calls
Send header `Authorization: Bearer <key>`. GET only.

**One day**
`GET https://ncpa-sound.pages.dev/api/agent/crew-availability?date=2026-09-01`
```json
{ "success": true, "date": "2026-09-01",
  "available": ["Coni"], "assigned": ["Naren", "Sandeep"], "unavailable": ["Nazar"],
  "shows": [{ "program": "Show A", "venue": "JBT", "crew": "Naren, Sandeep", "foh_crew": "Naren", "stage_crew": "Sandeep" }] }
```

**Date range (max 31 days)**
`GET .../api/agent/crew-availability?start=2026-09-01&end=2026-09-07` → `{ "success": true, "start", "end", "days": [ {same as above per day} ] }`

Errors: 401 wrong/missing key, 400 bad dates, 503 key not set up yet.

Results come from the same logic as the calendar modal (`src/crew-availability.ts`).
