// Deterministic, lossless bootstrap projection of ordinary physical Link rows.
// Research gate for #45: not learned semantic KB, not a production release.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {loadRows,counterMismatches} from './store.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const order=(a,b)=>a<b?-1:a>b?1:0;
const columns=['from_id','link_id','string','to_id','weight'];
const nonemptyString=s=>typeof s==='string'&&s.length>0;
const fail=s=>{throw new Error('KNOWLEDGE_SNAPSHOT_INVALID: '+s);};
export function canonicalPhysicalLinks(rows){
 if(!Array.isArray(rows))fail('Link rows must be an array');
 const byId=new Map();
 for(const row of rows){
  if(row===null||typeof row!=='object'||Array.isArray(row)||
   JSON.stringify(Object.keys(row).sort())!==JSON.stringify(columns))
   fail('exact five-field Link row required');
  const {link_id,from_id,to_id,string,weight}=row;
  if(!nonemptyString(link_id))fail('invalid Link ID');
  if(byId.has(link_id))fail('duplicate Link ID '+link_id);
  const atom=from_id===null&&to_id===null;
  const pair=nonemptyString(from_id)&&nonemptyString(to_id);
  if(!atom&&!pair)fail('invalid Link poles '+link_id);
  if(string!==null&&typeof string!=='string')fail('invalid string '+link_id);
  if(atom&&string===null)fail('atom without string '+link_id);
  if(weight!==null&&(!Number.isFinite(weight)||weight<0||weight>1))
   fail('invalid weight '+link_id);
  byId.set(link_id,{link_id,from_id,to_id,string,weight});
 }
 for(const row of byId.values())if(row.from_id!==null&&
   (!byId.has(row.from_id)||!byId.has(row.to_id)))
  fail('dangling endpoint '+row.link_id);
 return [...byId.values()].sort((a,b)=>order(a.link_id,b.link_id));
}
export function logicalGraphDigest(rows){
 const canon=canonicalPhysicalLinks(rows);
 const encoded=JSON.stringify({schema:'mts-nl/physical-links/v0',
  links:canon.map(r=>[r.link_id,r.from_id,r.to_id,r.string,r.weight])});
 return {schema:'mts-nl/physical-links/v0',links:canon.length,
  sha256:sha256(Buffer.from(encoded,'utf8'))};
}
export function buildKnowledgeSnapshot({rows,schemaSql,productVersion='0.0.0'}={}){
 if(typeof schemaSql!=='string'||!schemaSql.includes('CREATE TABLE links'))
  fail('trusted physical schema SQL required');
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(productVersion))
  fail('invalid product version');
 const canonical=canonicalPhysicalLinks(rows);
 const dir=mkdtempSync(join(tmpdir(),'mnc-kb-candidate-'));
 const path=join(dir,'knowledge.sqlite');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(schemaSql);
  // One canonical subject relation; no semantic side tables or source-data mutation.
  loadRows(db,canonical);
  assert.deepEqual(counterMismatches(db),[]);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  db.exec("VACUUM INTO '"+path.replaceAll("'","''")+"'");
  const sqlite=readFileSync(path);
  const graph=logicalGraphDigest(canonical);
  const manifest={format:'mts-nl/knowledge-snapshot/v0',
   productVersion,graph,sqliteSha256:sha256(sqlite),
   sqliteBytes:sqlite.length,schemaSha256:sha256(Buffer.from(schemaSql,'utf8')),
   sourceStatus:'BOOTSTRAP_UNTRAINED__NOT_SEMANTICALLY_VERIFIED'};
  return {manifest,sqlite};
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
}
