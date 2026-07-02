-- Multi-date show grouping: consecutive dates share show_group_id (one row per date).
ALTER TABLE events ADD COLUMN show_group_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_show_group_id ON events(show_group_id);
