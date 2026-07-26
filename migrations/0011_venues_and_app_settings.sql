-- Configurable venues + app settings (Anthropic / Word-parse API key)
-- Venues drive Add/Edit datalists, filter options, and AI venue mapping.

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT
);

-- Seed current venues (UI + filter list) plus Others for maintenance / non-venue work
INSERT OR IGNORE INTO venues (code, display_name, sort_order, active) VALUES
  ('JBT Museum', 'JBT Museum', 10, 1),
  ('JBT', 'Jamshed Bhabha Theatre', 20, 1),
  ('TET', 'Experimental Theatre', 30, 1),
  ('GDT', 'Godrej Dance Theatre', 40, 1),
  ('LT', 'Little Theatre', 50, 1),
  ('SVR', 'Sea View Room', 60, 1),
  ('TT', 'Tata Theatre', 70, 1),
  ('DP Art Gallery', 'Dilip Piramal Art Gallery', 80, 1),
  ('Others', 'Others', 90, 1);

-- Keep RAG alias table in sync for new / common codes
INSERT OR IGNORE INTO venue_aliases (canonical_name, alias) VALUES
  ('JBT Museum', 'JBT Museum'),
  ('Jamshed Bhabha Theatre', 'JBT'),
  ('Experimental Theatre', 'TET'),
  ('Godrej Dance Theatre', 'GDT'),
  ('Little Theatre', 'LT'),
  ('Sea View Room', 'SVR'),
  ('Tata Theatre', 'TT'),
  ('Dilip Piramal Art Gallery', 'DP Art Gallery'),
  ('Dilip Piramal Art Gallery', 'DPAG'),
  ('Others', 'Others'),
  ('Others', 'Other'),
  ('Others', 'Maintenance');
