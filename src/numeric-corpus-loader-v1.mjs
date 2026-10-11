// Direct E0 Unicode-to-physical-Link loader: NO hash-derived Link IDs.
// Reuse is an EXPLICIT compilation policy, not UNIQUE(from_id,to_id).
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {formatLinkId,readNumericLinks,rebuildNumericCounters,verifyNumericLinks,numericIndexPlans} from './numeric-link-store-v1.mjs';

const now=()=>process.hrtime.bigint();
const millis=(start)=>Number(now()-start)/1e6;
const ms=x=>+x.toFixed(3);
const fail=x=>{throw new Error('HASHLESS_CORPUS: '+x);};
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const pairKey=(from,to)=>from.toString(10)+':'+to.toString(10);
const sqlBytes=db=>{
 const p=db.prepare('PRAGMA page_count').get().page_count;
 const s=db.prepare('PRAGMA page_size').get().page_size;
 return p*s;
};
/** All identities are locally allocated by SQLite. JavaScript Maps are
 * optional exact-structure reuse caches, never persistent Link IDs. */
export class NumericCorpusLoader {
 constructor(db,{reuseAtoms=true,reusePairs=true}={}){
  if(!(db instanceof DatabaseSync))fail('DatabaseSync required');
  if(db.isTransaction)fail('cannot start in an outer transaction');
  this.db=db;
  this.reuseAtoms=reuseAtoms;this.reusePairs=reusePairs;
  this.atoms=new Map();this.pairs=new Map();
  this.insertAtom=db.prepare('INSERT INTO links(string,weight) VALUES(?,NULL)');
  this.insertPair=db.prepare('INSERT INTO links(from_id,to_id,string,weight) VALUES(?,?,NULL,NULL)');
  this.insertAtom.setReadBigInts(true);this.insertPair.setReadBigInts(true);
  this.loadCaches();
 }
 loadCaches(){
  this.atoms.clear();this.pairs.clear();
  // Existing independent Links are retained. Choose the oldest
  // matching representative only where explicit reuse was selected.
  for(const row of readNumericLinks(this.db)){
   if(row.from_id===null){
    if(row.weight===null&&!this.atoms.has(row.string))
     this.atoms.set(row.string,row.link_id);
   } else if(row.weight===null&&row.string===null){
    const key=pairKey(row.from_id,row.to_id);
    if(!this.pairs.has(key))this.pairs.set(key,row.link_id);
   }
  }
 }
 _atom(value,c){
  if(this.reuseAtoms&&this.atoms.has(value)){c.reusedAtoms++;return this.atoms.get(value);}
  const id=this.insertAtom.run(value).lastInsertRowid;
  assert.equal(typeof id,'bigint');
  c.insertedAtoms++;
  if(this.reuseAtoms)this.atoms.set(value,id);
  return id;
 }
 _pair(from,to,c){
  const key=pairKey(from,to);
  if(this.reusePairs&&this.pairs.has(key)){c.reusedPairs++;return this.pairs.get(key);}
  const id=this.insertPair.run(from,to).lastInsertRowid;
  assert.equal(typeof id,'bigint');
  c.insertedPairs++;
  if(this.reusePairs)this.pairs.set(key,id);
  return id;
 }
 /** One input book is one atomic SQLite transaction. Physical counters
  * are intentionally materialized once at corpus end, NOT per character. */
 appendBook(bytes,{id='untitled',maxCodePoints=500000}={}){
  if(!Buffer.isBuffer(bytes)||typeof id!=='string'||!id||
     !Number.isSafeInteger(maxCodePoints)||maxCodePoints<0)fail('invalid book/budget');
  if(this.db.isTransaction)fail('outer transaction');
  const rssStart=process.memoryUsage().rss,decodeStart=now();
  const source=utf8.decode(bytes);
  if(!Buffer.from(source,'utf8').equals(bytes))fail('source bytes not exact UTF-8');
  const scalars=[...source];
  if(scalars.length>maxCodePoints)fail('RESOURCE_LIMIT input codepoints');
  const decodeMs=millis(decodeStart);
  const c={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
  const begin=now();
  let root;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const build=(a,b)=>{
    if(b-a===0)return this._atom('',c);
    if(b-a===1)return this._atom(scalars[a],c);
    const mid=a+Math.floor((b-a)/2);
    return this._pair(build(a,mid),build(mid,b),c);
   };
   root=build(0,scalars.length);
   const buildMs=millis(begin);
   const commitStart=now();
   this.db.exec('COMMIT');
   const commitMs=millis(commitStart);
   const totalMs=millis(begin)+decodeMs;
   const inserted=c.insertedAtoms+c.insertedPairs;
   return {
    id,rootLinkId:formatLinkId(root),sourceBytes:bytes.length,codepoints:scalars.length,
    ...c,insertedLinks:inserted,sourceAliasesCreated:0,
    decodeMs:ms(decodeMs),compileAndSqlInsertMs:ms(buildMs),
    commitMs:ms(commitMs),loadTotalMs:ms(totalMs),
    insertLinksPerSecond:+(inserted/Math.max(.001,buildMs+commitMs)*1000).toFixed(1),
    inputMiBPerSecond:+(bytes.length/1048576/Math.max(.001,totalMs)*1000).toFixed(3),
    rssBeforeBytes:rssStart,rssAfterBytes:process.memoryUsage().rss,
    sqliteLogicalBytesAfter:sqlBytes(this.db),
    identity:'sqlite-signed-int64-autoincrement',
    reusePolicy:{atoms:this.reuseAtoms,pairs:this.reusePairs}
   };
  }catch(e){
   this.db.exec('ROLLBACK');
   this.loadCaches(); // No stale aliases from a failed transaction.
   throw e;
  }
 }
 finalize(){
  if(this.db.isTransaction)fail('cannot finalize inside transaction');
  const countersStart=now();rebuildNumericCounters(this.db);
  const countersMs=millis(countersStart);
  const integrityStart=now(),integrity=verifyNumericLinks(this.db);
  const integrityMs=millis(integrityStart);
  const plans=numericIndexPlans(this.db);
  if(!plans.from.some(p=>p.includes('idx_links_from'))||
     !plans.to.some(p=>p.includes('idx_links_to')))
   fail('pole indexes absent from query plan');
  return {links:integrity.links.toString(10),counterRebuildMs:ms(countersMs),
   integrityCheckMs:ms(integrityMs),sqliteLogicalBytes:sqlBytes(this.db),
   rssBytes:process.memoryUsage().rss,indexPlans:plans};
 }
}

/** Iterative exact expansion. Cycles are rejected, and a traversal budget
 * counts expanded scalar positions rather than unique physical Link rows. */
export function replayNumericRoots(db,documents,{maxCodePoints=2000000}={}){
 if(!Array.isArray(documents)||!Number.isSafeInteger(maxCodePoints)||maxCodePoints<0)
  fail('bad replay budget');
 const t=now();
 const rows=new Map(readNumericLinks(db).map(x=>[x.link_id,x]));
 const results=[];
 for(const doc of documents){
  const root=BigInt(doc.rootLinkId),active=new Set(),parts=[],stack=[{id:root,exit:false}];
  let count=0;
  while(stack.length){
   const entry=stack.pop();
   if(entry.exit){active.delete(entry.id);continue;}
   const node=rows.get(entry.id);
   if(!node)fail('missing Link '+entry.id);
   if(node.from_id===null){
    parts.push(node.string);
    count += [...node.string].length;
    if(count>maxCodePoints)fail('RESOURCE_LIMIT expanded source');
    continue;
   }
   if(active.has(entry.id))fail('cyclic source Link');
   active.add(entry.id);
   stack.push({id:entry.id,exit:true},
     {id:node.to_id,exit:false},{id:node.from_id,exit:false});
  }
  const bytes=Buffer.from(parts.join(''),'utf8');
  if(!bytes.equals(doc.bytes))fail('byte-for-byte source mismatch '+doc.id);
  results.push({id:doc.id,rootLinkId:doc.rootLinkId,
   verifiedBytes:bytes.length,expandedCodepoints:count});
 }
 return {status:'EXACT_NUMERIC_SQLITE_REPLAY_PASS',
  documents:results,replayMs:ms(millis(t)),residentLinkRows:rows.size};
}
/** Physical cold read-only database test; no source bytes in the report. */
export function coldNumericCorpusReplay(db,documents){
 if(db.isTransaction)fail('cold snapshot inside a transaction');
 const dir=mkdtempSync(join(tmpdir(),'mnc-hashless-e0-'));
 const path=join(dir,'knowledge.sqlite');
 try{
  const begin=now();
  db.exec("VACUUM INTO '"+path.replaceAll("'","''")+"'");
  const vacuumMs=millis(begin),bytes=readFileSync(path).length;
  const openStart=now();
  const cold=new DatabaseSync(path,{readOnly:true});
  try{
   const replay=replayNumericRoots(cold,documents);
   assert.equal(cold.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   return {sqliteVacuumBytes:bytes,vacuumMs:ms(vacuumMs),
    coldReadOnlyReplayMs:ms(millis(openStart)),
    ...replay,readOnly:true};
  }finally{cold.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
}
