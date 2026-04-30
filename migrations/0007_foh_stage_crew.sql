-- NCPA Sound Crew — FOH / Stage crew split
-- Adds foh_crew (single) and stage_crew (multi) columns to events.
-- One-time migration for May 2026 data only: first name → foh_crew, rest → stage_crew.
-- All other months are left untouched.

ALTER TABLE events ADD COLUMN foh_crew TEXT DEFAULT NULL;
ALTER TABLE events ADD COLUMN stage_crew TEXT DEFAULT NULL;

-- Split existing May 2026 crew assignments into FOH + Stage
UPDATE events
SET
  foh_crew = CASE
    WHEN crew IS NOT NULL AND TRIM(crew) != '' THEN
      TRIM(CASE
        WHEN INSTR(crew, ',') > 0 THEN SUBSTR(crew, 1, INSTR(crew, ',') - 1)
        ELSE crew
      END)
    ELSE NULL
  END,
  stage_crew = CASE
    WHEN crew IS NOT NULL AND INSTR(crew, ',') > 0 THEN
      TRIM(SUBSTR(crew, INSTR(crew, ',') + 1))
    ELSE NULL
  END
WHERE strftime('%Y-%m', event_date) = '2026-05';
