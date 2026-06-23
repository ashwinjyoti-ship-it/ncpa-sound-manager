# AGENTS.md

## Cursor Cloud specific instructions

NCPA Sound Crew is a single-service app: a Hono (TypeScript) backend on Cloudflare
Pages/Workers with a vanilla-JS frontend (`public/static/*.js`), backed by two local
D1 (SQLite) databases. The update script already runs `npm install`. Standard
scripts live in `package.json`; deployment notes are in `README.md`. The notes below
are non-obvious caveats discovered while setting up the cloud environment.

### Running the app locally (use `wrangler pages dev`, not `npm run dev`)
- `npm run dev` (plain `vite`) does NOT work here. `@hono/vite-dev-server` calls
  wrangler `getPlatformProxy`, which eagerly opens a **remote** proxy session for the
  `AI` and `VECTORIZE` bindings and fails without Cloudflare credentials
  ("Failed to start the remote proxy session ... /memberships failed"), making every
  route return 500.
- Instead run the built worker under local emulation:
  ```bash
  npm run build
  npm run db:migrate:local   # first run only / after schema changes
  npm run db:seed            # first run only / after db:reset
  npx wrangler pages dev dist --d1=ncpa-sound-crew-db --local --ip 0.0.0.0 --port 3000
  ```
  (`npm run dev:sandbox` chains build+migrate+serve; `ecosystem.config.cjs` runs the
  same command under pm2.) The app then serves on `http://localhost:3000`. There is no
  hot reload — rebuild (`npm run build`) and restart after editing `src/`.
  Editing `public/static/*.js` only needs a browser refresh.
- Local D1 state lives in `.wrangler/state/v3/d1` (gitignored). `npm run db:reset`
  wipes and re-seeds it.

### Binding limitations in local dev
- `AI` binding always runs **remote** (needs Cloudflare creds) and `VECTORIZE` is
  **not supported** locally. So the AI Assistant / RAG endpoints, semantic search, and
  `.docx` AI parsing are non-functional in pure local dev and also require
  `ANTHROPIC_API_KEY`. Core event management (calendar, table, CRUD reads, crew
  assignment, CSV) works fully against local D1.

### Schema drift — some write paths fail locally (pre-existing, not an env bug)
- The code references `events` columns `source`, `rider`, `notes`, `entry_type` that
  **no migration creates** (production D1 was patched out-of-band; the migration that
  added them was dropped from git history). On a fresh migration-built local DB:
  - "Add Show" (`POST /api/events`) fails: `no column named source`.
  - Full event Edit save (`PUT /api/events/:id`) fails: missing `rider`/`notes`.
  - Working write paths: bulk crew assign (`POST /api/events/bulk-assign`, used by the
    Table view "Assign Crew" bulk action) and `PUT /api/events/bulk-crew` — these only
    touch existing columns. Use these to demonstrate writes locally.

### Auth
- Auth is optional: the dashboard renders without login; login only unlocks admin
  features and the crew tab. Initialize once with `POST /api/auth/init` (creates the
  `users`/`sessions` tables and admin `ashwinjyoti@gmail.com` / `admin123`). The
  session cookie is `Secure; SameSite=None`.

### Lint / typecheck / build
- There is no lint or typecheck script and TypeScript is not a dependency; `npm run
  build` (vite) is the de-facto compile check. The `test-*.sh` shell scripts exercise
  the RAG/analytics endpoints and require the AI bindings + `ANTHROPIC_API_KEY`.
