-- Configurable crew roster, owned locally by this app (ncpa-sound-crew-db)
-- rather than the external ncpa-crew-db used by the separate
-- Crew-Assignment-Automation app. Sound Manager's crew list is intentionally
-- independent from that app's roster from this point on — see Settings > Crew.

CREATE TABLE IF NOT EXISTS crew (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Whether this person is eligible for AI auto-suggestions / crew stats.
  -- Preserves the pre-existing rule that the team head (Ashwin) is a valid
  -- checkbox/FOH pick but is excluded from the learning engine and stats
  -- dashboards. Configurable per person via Settings > Crew.
  include_in_ai INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Best-effort seed of the roster this app was already effectively using
-- (the fallback list baked into index.tsx / ai-chat-endpoint.ts, plus
-- Ashwin as team head). Adjust freely via Settings > Crew after this lands —
-- this table is now the single source of truth for crew names in this app.
INSERT OR IGNORE INTO crew (name, active, sort_order, include_in_ai) VALUES
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
