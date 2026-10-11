// Physical SQLite v1 research vertical. NOT the canonical db/schema.sql cutover.
// SQLite allocates 64-bit Link identities; external source keys are ephemeral
// import aliases only, never IDs and never content hashes.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

export const MAX_LINK_ID=9223372036854775807n;
export const NUMERIC_LINK_SCHEMA_V1=String.raw`
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
`;

const fail=s=>{throw new Error('NUMERIC_LINK_V1: '+s);};
const keys=(r)=>Object.keys(r).sort().join(',');
const isKey=k=>typeof k==='string'&&k.length>0;
const validWeight=w=>w===null||(typeof w==='number'&&Number.isFinite(w)&&w>=0&&w<=1);
const cmp=(a,b)=>a<b?-1:a>b?1:0;

export function parseLinkId(s){
 if(typeof s!=='string'||!/^[1-9][0-9]*$/.test(s))fail('noncanonical decimal ID');
 const id=BigInt(s);
 if(id>MAX_LINK_ID)fail('ID exceeds signed 64 bits');
 return id;
}
export function formatLinkId(id){
 if(typeof id!=='bigint'||id<=0n||id>MAX_LINK_ID)fail('64-bit BigInt required');
 return id.toString(10);
}
export function initializeNumericLinks(db){
 if(!(db instanceof DatabaseSync))fail('SQLite DatabaseSync required');
 db.exec('PRAGMA foreign_keys=ON;');
 db.exec(NUMERIC_LINK_SCHEMA_V1);
}
export function newNumericLinkDb(){
 const db=new DatabaseSync(':memory:');
 initializeNumericLinks(db);
 return db;
}
export function readNumericLinks(db){
 const s=db.prepare('SELECT link_id,from_id,to_id,string,weight,from_uses,to_uses FROM links ORDER BY link_id');
 s.setReadBigInts(true);
 return s.all().map(r=>({...r}));
}
export function verifyNumericLinks(db){
 const broken=db.prepare('SELECT link_id FROM links WHERE (from_id IS NOT NULL AND from_id NOT IN (SELECT link_id FROM links)) OR (to_id IS NOT NULL AND to_id NOT IN (SELECT link_id FROM links)) LIMIT 1');
 broken.setReadBigInts(true);
 if(broken.get())fail('dangling endpoint');
 const mismatch=db.prepare(
  'SELECT link_id FROM links WHERE from_uses!=(SELECT COUNT(*) FROM links f WHERE f.from_id=links.link_id) '+
  'OR to_uses!=(SELECT COUNT(*) FROM links t WHERE t.to_id=links.link_id) LIMIT 1');
 mismatch.setReadBigInts(true);
 if(mismatch.get())fail('stale structural counters');
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')
  fail('SQLite integrity_check');
 return {links:BigInt(db.prepare('SELECT COUNT(*) n FROM links').get().n)};
}
export function rebuildNumericCounters(db){
 db.exec('UPDATE links SET '+
  'from_uses=(SELECT COUNT(*) FROM links a WHERE a.from_id=links.link_id), '+
  'to_uses=(SELECT COUNT(*) FROM links b WHERE b.to_id=links.link_id)');
}
export function numericIndexPlans(db){
 const from=db.prepare('EXPLAIN QUERY PLAN SELECT link_id FROM links WHERE from_id=?').all(1n);
 const to=db.prepare('EXPLAIN QUERY PLAN SELECT link_id FROM links WHERE to_id=?').all(1n);
 return {from:from.map(x=>x.detail),to:to.map(x=>x.detail)};
}
/** Every row is {key,string,weight} or {key,from,to,weight}.
 * Source keys are ephemeral import aliases, sorted by exact UTF-16 order.
 * Forward refs and cycles resolve through staged placeholder allocations.
 */
export function importNumericGraph(db,sourceRows){
 if(!Array.isArray(sourceRows))fail('rows must be array');
 const byKey=new Map();
 for(const row of sourceRows){
  if(row===null||typeof row!=='object'||Array.isArray(row)||!isKey(row.key))fail('invalid row/key');
  if(byKey.has(row.key))fail('duplicate external source key');
  const atom=keys(row)==='key,string,weight'&&typeof row.string==='string';
  const pair=(keys(row)==='from,key,to,weight'||keys(row)==='from,key,string,to,weight')&&
   isKey(row.from)&&isKey(row.to)&&
   (row.string===undefined||row.string===null||typeof row.string==='string');
  if((!atom&&!pair)||!validWeight(row.weight))fail('invalid row/poles/weight');
  byKey.set(row.key,{...row});
 }
 for(const row of byKey.values())if(Object.hasOwn(row,'from')&&
    (!byKey.has(row.from)||!byKey.has(row.to)))fail('unknown external pole');
 const ordered=[...byKey.values()].sort((a,b)=>cmp(a.key,b.key));
 // An existing transaction is not silently committed or rolled back by us.
 if(db.isTransaction)fail('nested transaction unsupported');
 const allocated=new Map();
 const stage=db.prepare("INSERT INTO links(string,weight) VALUES('',NULL)");
 stage.setReadBigInts(true);
 const atom=db.prepare('UPDATE links SET string=?,weight=? WHERE link_id=?');
 const pair=db.prepare('UPDATE links SET from_id=?,to_id=?,string=?,weight=? WHERE link_id=?');
 db.exec('PRAGMA foreign_keys=ON;');
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const row of ordered){
   const id=stage.run().lastInsertRowid;
   assert.equal(typeof id,'bigint');
   allocated.set(row.key,id);
  }
  for(const row of ordered){
   const id=allocated.get(row.key);
   if(Object.hasOwn(row,'from'))pair.run(allocated.get(row.from),allocated.get(row.to),row.string??null,row.weight,id);
   else atom.run(row.string,row.weight,id);
  }
  rebuildNumericCounters(db);
  verifyNumericLinks(db);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return allocated;
}
