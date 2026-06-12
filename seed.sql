-- Sample data for testing
INSERT OR IGNORE INTO events (event_date, program, venue, team, sound_requirements, call_time, crew, requirements_updated) VALUES 
  ('2025-11-01', 'Nakashtara Dance Festival Day 3 Ishangu – The Black Swan Manipuri by Priti Patel & Troupe Sancescaratum Kala Marga Nrittya by Priyal Bhattacharya''s Cre8aDance', 'JBT 8pm', 'Dr.Swapno/Team', 'ACT 1: 4 DPA 4099 clipping Mic, ?? Microphones (6 small stand & 4 long stand), 4 Head Gear Cordless Mic (skin color), 1 EB Jack-in. Stage Monitor: 2m x 2.5m x 88 10, 5m 4r 4, C4?? touch plug_5, Collar Microphone 1 1 DPA 4099 clipping Mic, ?? Microphones (6 small stand & 4 long stand), 4 Head Gear Cordless Mic (skin color), 1 EB Jack-in', 'Setup 7am, Tech learn 7am, Green rooms ready 9am', '', 1),
  ('2025-11-01', 'Keys to Joy – PianoForte An NCPA Presentation', 'TT 6.30pm', 'Farahnaz & Team', 'NCPA Audio Recording: NCPA Sound; Mikes required', 'Piano 12.45pm, Tuning 1pm: AC 12:30pm, Light adjustment 2pm, Sound check 3pm', '', 1),
  ('2025-11-02', 'Rise and Fall of Humpty Dumpty English Play', 'GDT 12noon', 'Nonon/Team', 'NCPA basic sound, 2 cordless mics, Aux wire connections', 'Unloading 9am-9:30am, Setup 9:30am, Sound ready 9am', '', 1);

-- June 2026 sample data (includes today for local dev sidebar testing)
INSERT OR IGNORE INTO events (event_date, program, venue, team, sound_requirements, call_time, crew, requirements_updated, stage_crew) VALUES
  ('2026-06-12', 'Shri Shivaji Vidya', 'Tata Theatre', 'Nooshin/Team', 'Podx2, HHx6, EP + Band rider to follow', '8:30 am', 'Coni, Omkar, Akshay', 1, 'Coni, Omkar, Akshay'),
  ('2026-06-12', 'Connections Year 4 Workshops', 'Experimental Theatre', 'Bruce/Team', 'NCPA basic sound system to play music, 2 cordless mikes, laptop', '09:00 am', 'Nazar, OC1', 1, 'Nazar, OC1'),
  ('2026-06-12', 'Absence of Presence Setup and Rehearsal', 'Jamshed Bhabha Theatre', 'Dr.Swapno/Team', 'SM 81 - 1, SM57 - 1, SM58 - 4, HS - 1, EP - 1', '01:00 pm', 'Naren, Shridhar, OC2', 1, 'Naren, Shridhar, OC2'),
  ('2026-06-12', 'Workshop by Aditi Mangaldas', 'JBT Foyer', 'Dr.Swapno/Team', 'Not specified', '09:00 am', 'NS, OC2', 0, 'NS, OC2'),
  ('2026-06-12', 'Page to Stage: Guilt Trip Book Launch', 'Little Theatre', 'Bruce/Team', 'NCPA basic sound, 2 cordless mics', '06:30 pm', 'OC1', 1, 'OC1'),
  ('2026-06-12', 'Summer Fiesta Workshops', 'Little Theatre', 'Bruce/Team', 'NCPA basic sound', '10:00 am', 'OC2', 1, 'OC2'),
  ('2026-06-12', 'Summer Fiesta Workshops', 'JBT Museum', 'Bruce/Team', 'NCPA basic sound', '10:00 am', 'OC1', 1, 'OC1');
