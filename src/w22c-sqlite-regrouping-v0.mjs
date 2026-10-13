// W22-C: isolated SQLite evidence for immutable persistent Link poles.
// Counterfactuals rebuild the SAME multi-document corpus in independent DBs.
// Historical deployment simulation appends a new root; never mutates old poles.
// No semantic inference, weights, corpus licensing claims or true global optimum.
import {newNumericLinkDb,readNumericLinks,verifyNumericLinks,formatLinkId} from './numeric-link-store-v1.mjs';
import {NumericCorpusLoader,replayNumericRoots,coldNumericCorpusReplay} from './numeric-corpus-loader-v1.mjs';
import {scalarsOf} from '../docs/compiler/engine.mjs';
import {contextualCandidateTrees} from '../docs/compiler/window-oracle.mjs';

const fail=x=>{throw Error('W22C_SQLITE: '+x);};
const balanced=s=>{
 if(s.length===1)return s[0];
 const mid=Math.floor(s.length/2);
 return [balanced(s.slice(0,mid)),balanced(s.slice(mid))];
};
const stableFields=r=>[r.link_id,r.from_id,r.to_id,r.string,r.weight]
 .map(x=>x===null?null:String(x));
function validateDocuments(documents,targetId){
 if(!Array.isArray(documents)||documents.length<2||documents.length>8)
  fail('2..8 source documents required');
 const ids=new Set();let total=0;
 for(const d of documents){
  if(!d||typeof d.id!=='string'||!d.id||ids.has(d.id)||
   typeof d.text!=='string')fail('duplicate or invalid document');
  ids.add(d.id);const chars=scalarsOf(d.text);
  if(chars.length<1||chars.length>128)fail('each document length must be 1..128 scalars');
  total+=chars.length;
 }
 if(total>512)fail('corpus exceeds 512 Unicode scalars');
 if(!ids.has(targetId))fail('unknown target document');
}
function writerFor(db){
 const loader=new NumericCorpusLoader(db,{reuseAtoms:true,reusePairs:true});
 const write=tree=>{
  const c={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
  const recur=t=>typeof t==='string'?loader._atom(t,c):
   loader._pair(recur(t[0]),recur(t[1]),c);
  if(db.isTransaction)fail('cannot nest write');
  db.exec('BEGIN IMMEDIATE');
  try{
   const root=recur(tree);
   db.exec('COMMIT');
   return {rootLinkId:formatLinkId(root),...c};
  }catch(error){
   db.exec('ROLLBACK');loader.loadCaches();throw error;
  }
 };
 return {loader,write};
}
function physicalEvidence(db,rootDocs){
 const rows=readNumericLinks(db),byId=new Map(rows.map(r=>[r.link_id,r]));
 const reachable=new Set(),sourceEvents=new Map();
 const visitOnce=id=>{
  if(reachable.has(id))return;
  const row=byId.get(id);if(!row)fail('missing persisted Link');
  reachable.add(id);
  if(row.from_id!==null){visitOnce(row.from_id);visitOnce(row.to_id);}
 };
 let expandedAtomEvents=0,expandedPairEvents=0;
 for(const doc of rootDocs){
  const root=BigInt(doc.rootLinkId);
  visitOnce(root);
  const stack=[root];
  while(stack.length){
   const id=stack.pop(),row=byId.get(id);
   if(!row)fail('dangling source root');
   const key=formatLinkId(id);
   sourceEvents.set(key,(sourceEvents.get(key)??0)+1);
   if(row.from_id===null)expandedAtomEvents++;
   else{expandedPairEvents++;stack.push(row.to_id,row.from_id);}
   if(expandedAtomEvents>512||expandedPairEvents>512)fail('source event budget exceeded');
  }
 }
 const active=[...reachable].map(id=>byId.get(id));
 const activeAtoms=active.filter(r=>r.from_id===null).length;
 const activePairs=active.length-activeAtoms;
 const totalAtoms=rows.filter(r=>r.from_id===null).length;
 const totalPairs=rows.length-totalAtoms;
 const poleFrom=rows.reduce((s,r)=>s+Number(r.from_uses),0);
 const poleTo=rows.reduce((s,r)=>s+Number(r.to_uses),0);
 if(poleFrom!==totalPairs||poleTo!==totalPairs)
  fail('stored poles have inconsistent structural counters');
 const expandedScalarCount=rootDocs.reduce((s,d)=>s+scalarsOf(d.text).length,0);
 if(expandedAtomEvents!==expandedScalarCount||
  expandedPairEvents!==expandedScalarCount-rootDocs.length)
  fail('source occurrences mismatched expanded forest');
 const reusedExpandedPairs=expandedPairEvents-activePairs;
 if(reusedExpandedPairs<0)fail('source usage tally not physical graph');
 const rowSummary=Object.freeze({
  physicalTotal:rows.length,physicalAtoms:totalAtoms,physicalPairs:totalPairs,
  activeTotal:active.length,activeAtoms,activePairs,
  inactiveTotal:rows.length-active.length,
  expandedAtomEvents,expandedPairEvents,reusedExpandedPairs,
  physicalFromUsesSum:poleFrom,physicalToUsesSum:poleTo,
  sourceEventsByLink:Object.fromEntries([...sourceEvents].sort(
   (a,b)=>BigInt(a[0])<BigInt(b[0])?-1:1)),
  physicalCountersAreGlobalRowsNotSourceObservations:true
 });
 const replay=replayNumericRoots(db,rootDocs,{maxCodePoints:512});
 if(replay.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS')fail('non-exact source replay');
 const integrity=verifyNumericLinks(db);
 if(Number(integrity.links)!==rows.length)fail('SQLite physical count mismatch');
 return rowSummary;
}
function makeFresh(documents,targetId,targetTree){
 const db=newNumericLinkDb();
 try{
  const w=writerFor(db),roots=[];
  for(const d of documents){
   const tree=d.id===targetId?targetTree:balanced(scalarsOf(d.text));
   roots.push({...d,...w.write(tree)});
  }
  w.loader.finalize();
  const evidence=physicalEvidence(db,roots);
  if(evidence.inactiveTotal!==0)fail('fresh corpus has dead Links');
  return {evidence,roots:roots.map(x=>({id:x.id,rootLinkId:x.rootLinkId}))};
 }finally{db.close();}
}
function retainedReplacement(documents,targetId,baselineTree,revisedTree){
 const db=newNumericLinkDb();
 try{
  const w=writerFor(db),baselineRoots=[];
  for(const d of documents){
   const tree=d.id===targetId?baselineTree:balanced(scalarsOf(d.text));
   baselineRoots.push({...d,...w.write(tree)});
  }
  w.loader.finalize();
  const originalRows=readNumericLinks(db);
  const before=physicalEvidence(db,baselineRoots);
  const target=documents.find(x=>x.id===targetId);
  const revision=w.write(revisedTree);
  const activeRoots=baselineRoots.map(d=>d.id===targetId?
   {...target,...revision}:d);
  w.loader.finalize();
  const rowsAfter=readNumericLinks(db),historical=new Map(rowsAfter.map(r=>[r.link_id,r]));
  for(const old of originalRows){
   const current=historical.get(old.link_id);
   if(!current||JSON.stringify(stableFields(old))!==JSON.stringify(stableFields(current)))
    fail('historical Link poles or scalar value mutated');
  }
  const after=physicalEvidence(db,activeRoots);
  const cold=coldNumericCorpusReplay(db,activeRoots);
  if(cold.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS'||!cold.readOnly)
   fail('retained replacement cold replay failed');
  return {
   before,after,
   oldLinkIdentitiesUnchanged:true,
   initialPhysicalLinks:before.physicalTotal,
   retainedPhysicalLinks:after.physicalTotal,
   physicalRowsAdded:after.physicalTotal-before.physicalTotal,
   nowInactiveLinks:after.inactiveTotal,
   activeDelta:after.activeTotal-before.activeTotal,
   sourceOccurrencesRemainRootDependent:true,
   cold:{status:cold.status,documents:cold.documents.length,readOnly:cold.readOnly,
    sqliteVacuumBytes:cold.sqliteVacuumBytes}
  };
 }finally{db.close();}
}
export function compareSqliteRegrouping(documents,{
 targetId,width=4,offset=0,maxCandidates=429
}={}){
 validateDocuments(documents,targetId);
 if(!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>429)
  fail('invalid exhaustive budget');
 const target=documents.find(d=>d.id===targetId);
 const variants=contextualCandidateTrees(target.text,{width,offset});
 if(variants.length>maxCandidates)fail('candidate budget exceeded');
 const scores=variants.map(c=>{
  const fresh=makeFresh(documents,targetId,c.whole);
  return {ordinal:c.ordinal,windowPairs:c.windowPairs,
   ...fresh.evidence,roots:fresh.roots};
 });
 // The experiment fixes all other document trees, document ordering and policy.
 const ranked=scores.slice().sort((a,b)=>a.activePairs-b.activePairs||
  a.windowPairs-b.windowPairs||a.ordinal-b.ordinal);
 const minimumLocal=Math.min(...scores.map(x=>x.windowPairs));
 const amongLocal=ranked.find(x=>x.windowPairs===minimumLocal);
 const globalBest=ranked[0];
 const originalVariant=variants.find(x=>x.ordinal===amongLocal.ordinal);
 const updatedVariant=variants.find(x=>x.ordinal===globalBest.ordinal);
 const retention=retainedReplacement(documents,targetId,
  originalVariant.whole,updatedVariant.whole);
 if(retention.before.activePairs!==amongLocal.activePairs)
  fail('baseline SQLite independent rebuild disagrees with retained baseline');
 if(retention.after.activePairs!==globalBest.activePairs)
  fail('active SQLite counterfactual disagrees with fresh rebuild');
 return {
  schema:'mts-nl/w22c-physical-counterfactual/v0',
  status:'PHYSICAL_SQLITE_EXACT_MULTIDOC_PASS',
  documents:documents.map(d=>({id:d.id,sourceUtf8Bytes:Buffer.byteLength(d.text),
   unicodeScalars:scalarsOf(d.text).length})),targetId,width,offset,
  candidateCount:variants.length,
  localMinimum:minimumLocal,
  bestWholePairs:globalBest.activePairs,
  bestWholePairsAmongLocalOptima:amongLocal.activePairs,
  wholeGraphSavingFromContext:amongLocal.activePairs-globalBest.activePairs,
  bestLocalOrdinal:amongLocal.ordinal,bestContextOrdinal:globalBest.ordinal,
  bestContextWindowPairs:globalBest.windowPairs,
  freshTop:ranked.slice(0,5).map(x=>({
   ordinal:x.ordinal,windowPairs:x.windowPairs,activePairs:x.activePairs,
   activeTotal:x.activeTotal,expandedPairEvents:x.expandedPairEvents,
   sourceEventCount:Object.values(x.sourceEventsByLink).reduce((s,n)=>s+n,0)
  })),
  retention,
  limits:{
   noRowMutations:true,
   historicSqliteRowsRetained:true,
   persistentIdentity:'SQLite INTEGER PRIMARY KEY AUTOINCREMENT',
   canonicalReuse:'explicit reuse by exact ordered numeric poles',
   structuralCounters:'from_uses/to_uses count distinct persisted rows, including inactive history',
   sourceFrequencies:'expanded root walk, reported separately, never structural pole counts',
   normalizedAgainstOneInput:false,
   corpusGlobalMinimum:false,
   outsideWindowGroupingFixed:true,
   maxDocuments:8,maxTotalSourceScalars:512
  }
 };
}
