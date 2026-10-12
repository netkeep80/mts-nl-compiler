// W12 independent SQLite materialization of source-first tree shapes.
// Same physical schema & node identity policy as accepted W11; no normative changes.
import {NumericCorpusLoader,coldNumericCorpusReplay} from './numeric-corpus-loader-v1.mjs';
import {newNumericLinkDb} from './numeric-link-store-v1.mjs';
import {exactScalars,collectSourceWindows} from './source-first-frequencies-v0.mjs';
import {splitByBoundaries} from './source-first-method-grid-v0.mjs';
import {shapeSplitIndex,buildShapedCorpus} from './source-first-tree-shapes-v0.mjs';
const fail=s=>{throw Error('SOURCE_FIRST_SHAPE_SQLITE: '+s);};
export class ShapedNumericLoader extends NumericCorpusLoader{
 appendShaped(bytes,{id='source',boundaries=[],shape='balanced',frequencies=new Map(),maxScalars=8192}={}){
  if(this.db.isTransaction||typeof id!=='string'||!id||!Number.isSafeInteger(maxScalars)||maxScalars<0)fail('input/transaction');
  const cp=exactScalars(bytes);
  if(cp.length>maxScalars)fail('RESOURCE_LIMIT');
  const counts={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
  const compose=(chars,start,end)=>{
   const n=end-start;
   if(n===0)return this._atom('',counts);
   if(n===1)return this._atom(chars[start],counts);
   const cut=shapeSplitIndex(chars,start,end,shape,frequencies);
   return this._pair(compose(chars,start,cut),compose(chars,cut,end),counts);
  };
  const balanced=(ids,start=0,end=ids.length)=>{
   if(start===end)return this._atom('',counts);
   if(end-start===1)return ids[start];
   const cut=start+Math.floor((end-start)/2);
   return this._pair(balanced(ids,start,cut),balanced(ids,cut,end),counts);
  };
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const units=splitByBoundaries(cp,boundaries);
   const ids=units.map(s=>compose([...s],0,[...s].length));
   const root=balanced(ids);
   this.db.exec('COMMIT');
   return {id,rootLinkId:root.toString(),sourceBytes:bytes.length,codepoints:cp.length,
    insertedLinks:counts.insertedAtoms+counts.insertedPairs};
  }catch(e){this.db.exec('ROLLBACK');this.loadCaches();throw e;}
 }
}
export function verifyShapedNumericCorpus(documents,boundaries,shape,{maxScalarsPerDocument=8192}={}){
 const train=documents.filter((_,i)=>i%5!==4);
 const freq=shape.startsWith('frequency')?collectSourceWindows(train,{minWidth:2,maxWidth:8,maxScalarsPerDocument}).frequency:new Map();
 const inMemory=buildShapedCorpus(documents,boundaries,shape,{maxScalarsPerDocument,frequencies:freq});
 const db=newNumericLinkDb();
 try{
  const loader=new ShapedNumericLoader(db),records=[];
  for(const d of documents){
   const bytes=Buffer.from(exactScalars(d.bytes).slice(0,maxScalarsPerDocument).join(''),'utf8');
   const x=loader.appendShaped(bytes,{id:d.id,boundaries,shape,frequencies:freq,maxScalars:maxScalarsPerDocument});
   records.push({...x,bytes});
  }
  const final=loader.finalize(),cold=coldNumericCorpusReplay(db,records);
  const physicalLinks=Number(final.links);
  if(physicalLinks!==inMemory.physicalLinks)fail('in-memory versus physical SQLite Link count differs');
  if(cold.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS'||cold.documents.length!==documents.length)fail('cold replay failure');
  if(db.prepare('PRAGMA foreign_key_check').all().length)fail('foreign_key_check');
  return {status:'SQLITE_COLD_EXACT_PASS',books:records.length,shape,
   physicalLinks,rootReachableLinks:inMemory.reachableLinks,
   vacuumBytes:cold.sqliteVacuumBytes,atomicCounters:'VERIFIED_BY_NUMERIC_STORE',
   coldReadOnly:true,sourceScalars:inMemory.sourceScalars};
 }finally{db.close();}
}