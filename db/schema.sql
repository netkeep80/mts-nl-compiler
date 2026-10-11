-- Numeric physical Link storage v1. Author decision #51. Single subject table.
-- sqlite_sequence is internal SQLite AUTOINCREMENT metadata, not a Link table.
CREATE TABLE links (
 link_id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(link_id>0),
 from_id INTEGER REFERENCES links(link_id) DEFERRABLE INITIALLY DEFERRED
  CHECK(from_id IS NULL OR (typeof(from_id)='integer' AND from_id>0)),
 to_id INTEGER REFERENCES links(link_id) DEFERRABLE INITIALLY DEFERRED
  CHECK(to_id IS NULL OR (typeof(to_id)='integer' AND to_id>0)),
 string TEXT CHECK(string IS NULL OR typeof(string)='text'),
 weight REAL CHECK(weight IS NULL OR (typeof(weight) IN ('integer','real') AND weight>=0 AND weight<=1)),
 from_uses INTEGER NOT NULL DEFAULT 0 CHECK(from_uses>=0),
 to_uses INTEGER NOT NULL DEFAULT 0 CHECK(to_uses>=0),
 CHECK ((from_id IS NULL AND to_id IS NULL) OR (from_id IS NOT NULL AND to_id IS NOT NULL)),
 CHECK (from_id IS NOT NULL OR string IS NOT NULL)
);
CREATE INDEX idx_links_from ON links(from_id);
CREATE INDEX idx_links_to ON links(to_id);
