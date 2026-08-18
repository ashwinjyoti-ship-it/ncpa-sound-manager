-- Follow-up to 0012_configurable_crew.sql. That migration's CREATE TABLE
-- IF NOT EXISTS crew silently no-opped on production, which already had an
-- unrelated, unused "crew" table (Crew-Assignment-Automation's schema —
-- level/venue_capabilities/etc. — seeded there by mistake at some point; no
-- code in this repo reads it). The seed INSERT then failed on missing
-- columns and broke the deploy.
--
-- D1 migrations are tracked by filename, so 0012 must not be edited in
-- place now that it has shipped: any database where it already applied
-- successfully (e.g. a local/dev DB without production's conflicting
-- "crew" table) would never re-run it, and would be silently stuck without
-- this table. This migration creates the real, app-owned table under its
-- own name instead.
--
-- If you ran 0012 locally before this migration existed, your local "crew"
-- table (0012's own, not the production one) is now orphaned — safe to
-- ignore, or run `npm run db:reset` for a clean slate.

CREATE TABLE IF NOT EXISTS sound_crew (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  include_in_ai INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO sound_crew (name, active, sort_order, include_in_ai) VALUES
  ('Ashwin', 1, 5, 0),
  ('Naren', 1, 10, 1),
  ('Sandeep', 1, 20, 1),
  ('Coni', 1, 30, 1),
  ('NS', 1, 40, 1),
  ('Aditya', 1, 50, 1),
  ('Viraj', 1, 60, 1),
  ('Shridhar', 1, 70, 1),
  ('Nazar', 1, 80, 1),
  ('Omkar', 1, 90, 1),
  ('Akshay', 1, 100, 1),
  ('OC1', 1, 110, 1),
  ('OC2', 1, 120, 1),
  ('OC3', 1, 130, 1);
