-- NCPA Sound Crew - Add entry_type to events
-- Distinguishes manually entered events from bulk-uploaded events
-- Default 'bulk' is safe: all existing records were loaded via bulk upload

ALTER TABLE events ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'bulk';

-- Index to speed up short-notice report queries
CREATE INDEX IF NOT EXISTS idx_entry_type ON events(entry_type);
