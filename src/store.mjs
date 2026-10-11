import assert from "node:assert/strict";

// Counters represent structural indegrees by pole, NOT observation frequencies.
// Accepted Git rows contain only the first five fields.
export const columns = ["from_id","link_id","string","to_id","weight"];
export function loadRows(db, rows) {
  const put = db.prepare("INSERT INTO links(link_id,from_id,to_id,string,weight) VALUES(?,?,?,?,?)");
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), columns);
    put.run(row.link_id,row.from_id,row.to_id,row.string,row.weight);
  }
  validateClosure(db);
  rebuildCounters(db);
}
export function validateClosure(db) {
  const broken = db.prepare(
    "SELECT a.link_id FROM links a "+
    "LEFT JOIN links f ON a.from_id=f.link_id "+
    "LEFT JOIN links t ON a.to_id=t.link_id "+
    "WHERE (a.from_id IS NOT NULL AND f.link_id IS NULL) "+
    "OR (a.to_id IS NOT NULL AND t.link_id IS NULL) LIMIT 1"
  ).get();
  if (broken) throw new Error("Dangling endpoint: "+broken.link_id);
}
export function rebuildCounters(db) {
  db.exec("UPDATE links SET "+
    "from_uses=(SELECT COUNT(*) FROM links a WHERE a.from_id=links.link_id), "+
    "to_uses=(SELECT COUNT(*) FROM links b WHERE b.to_id=links.link_id)");
}
export function counterMismatches(db) {
  return db.prepare("SELECT link_id FROM links p WHERE "+
    "from_uses!=(SELECT COUNT(*) FROM links a WHERE a.from_id=p.link_id) OR "+
    "to_uses!=(SELECT COUNT(*) FROM links b WHERE b.to_id=p.link_id) "+
    "ORDER BY link_id").all().map(x=>x.link_id);
}
