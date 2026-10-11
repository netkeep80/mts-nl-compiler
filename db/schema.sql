-- Research schema: ONE canonical subject relation.
CREATE TABLE links (
 link_id TEXT NOT NULL PRIMARY KEY CHECK(length(link_id)>0),
 from_id TEXT CHECK(from_id IS NULL OR length(from_id)>0),
 to_id TEXT CHECK(to_id IS NULL OR length(to_id)>0),
 string TEXT,
 weight REAL CHECK(weight IS NULL OR (typeof(weight) IN ('integer','real') AND weight>=0 AND weight<=1)),
 from_uses INTEGER NOT NULL DEFAULT 0 CHECK(from_uses>=0),
 to_uses INTEGER NOT NULL DEFAULT 0 CHECK(to_uses>=0),
 CHECK((from_id IS NULL AND to_id IS NULL) OR (from_id IS NOT NULL AND to_id IS NOT NULL)),
 CHECK(from_id IS NOT NULL OR string IS NOT NULL)
) WITHOUT ROWID;
