-- P0: only two subject tables. Repository JSON is the canonical row source.
-- String-valued identifiers; probabilistic semantics of weight is NOT yet accepted.
CREATE TABLE links (
  link TEXT NOT NULL PRIMARY KEY CHECK (length(link) > 0),
  "begin" TEXT NOT NULL CHECK (length("begin") > 0),
  "end" TEXT NOT NULL CHECK (length("end") > 0),
  weight REAL NOT NULL CHECK (typeof(weight) IN ('real','integer') AND weight >= 0 AND weight <= 1)
) WITHOUT ROWID;

CREATE TABLE strings (
  link TEXT NOT NULL PRIMARY KEY CHECK (length(link) > 0),
  string TEXT NOT NULL
) WITHOUT ROWID;
