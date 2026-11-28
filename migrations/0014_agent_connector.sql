-- Revocable links that let an agent write crew without a user login, and a
-- record of every change made through them. Only a hash of each key is stored.
CREATE TABLE IF NOT EXISTS agent_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  revoked_at DATETIME
);

CREATE TABLE IF NOT EXISTS agent_crew_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  event_date TEXT,
  program TEXT,
  before_json TEXT,
  after_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
