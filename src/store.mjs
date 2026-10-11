// Canonical numeric SQLite adapter (#51). Legacy source labels can be
// transient import aliases; all persisted link_id/from_id/to_id are BIGINT.
import {migrateLegacyLinks} from './numeric-legacy-bridge-v1.mjs';
import {rebuildNumericCounters} from './numeric-link-store-v1.mjs';
export const columns=['from_id','link_id','string','to_id','weight'];
export function loadRows(db,rows){
 return migrateLegacyLinks(db,rows);
}
export function validateClosure(db){
 const stmt=db.prepare('SELECT a.link_id FROM links a '+
   'LEFT JOIN links f ON a.from_id=f.link_id '+
   'LEFT JOIN links t ON a.to_id=t.link_id '+
   'WHERE (a.from_id IS NOT NULL AND f.link_id IS NULL) '+
   'OR (a.to_id IS NOT NULL AND t.link_id IS NULL) LIMIT 1');
 stmt.setReadBigInts(true);
 const broken=stmt.get();
 if(broken)throw Error('Dangling endpoint: '+broken.link_id);
}
export function rebuildCounters(db){rebuildNumericCounters(db);}
export function counterMismatches(db){
 const query=db.prepare(
  'SELECT link_id FROM links p WHERE '+
  'from_uses!=(SELECT COUNT(*) FROM links a WHERE a.from_id=p.link_id) OR '+
  'to_uses!=(SELECT COUNT(*) FROM links b WHERE b.to_id=p.link_id) '+
  'ORDER BY link_id');
 query.setReadBigInts(true);
 return query.all().map(row=>row.link_id);
}
