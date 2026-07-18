-- TET (Experimental Theatre) had no venue_aliases row at all, so RAG venue
-- search/expansion never matched raw "TET" event rows against "Experimental
-- Theatre" queries or vice versa. TT (Tata Theatre) was already correct.
INSERT OR IGNORE INTO venue_aliases (canonical_name, alias) VALUES
  ('Experimental Theatre', 'TET');
