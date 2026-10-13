// W23-D: dry-run marginal PHYSICAL Link cost against an existing immutable
// SQLite asset, with independent retained-history rebuild + cold replay proof.
// This does not change MTS semantics and does not treat source observations,
// structural pole counters, or abstract W23-C tokens as physical Link identities.
import {newNumericLinkDb,readNumericLinks,verifyNumericLinks,formatLinkId}
 from './numeric-link-store-v1.mjs';
import {NumericCorpusLoader,coldNumericCorpusReplay,replayNumericRoots}
 from './numeric-corpus-loader-v1.mjs';
import {compressFrequencyIncremental} from './w23-incremental-pair-agenda-v0.mjs';

const fail=x=>{throw Error('W23D_COST: '+x);};
const refExisting=id=>'E:'+String(id);
const refVirtual=id=>'V:'+id;
const pairRefKey=(a,b)=>a+'|'+b;
const stableRow=r=>[r.link_id,r.from_id,r.to_id,r.string,r.weight]
 .map(x=>x===null?null:String(x));
const validText=s=>typeof s==='string'&&Buffer.from(s,'utf8').toString('utf8')===s&&
 ![...s].some(ch=>{const cp=ch.codePointAt(0);return cp>=0xD800&&cp<=0xDFFF;});

export function balancedPhysicalTree(text){
 if(!validText(text))fail('invalid Unicode text');
 const points=[...text];
 const build=(a,b)=>{
  if(a===b)return '';
  if(a+1===b)return points[a];
  const m=a+Math.floor((b-a)/2);
  return [build(a,m),build(m,b)];
 };
 return build(0,points.length);
}

function expandTree(tree,{maxNodes=16384}={}){
 let seen=0;
 const walk=(x,isRoot=false)=>{
  if(++seen>maxNodes)fail('tree node budget exceeded');
  if(typeof x==='string'){
   if(!validText(x))fail('invalid atom text');
   const n=[...x].length;
   if(n!==1&&!(isRoot&&n===0))
    fail('physical tree atom must be exactly one Unicode scalar');
   return x;
  }
  if(!Array.isArray(x)||x.length!==2)fail('binary tree required');
  return walk(x[0],false)+walk(x[1],false);
 };
 return walk(tree,true);
}

function balancedUnits(units){
 if(units.length===0)return '';
 if(units.length===1)return units[0];
 const m=Math.floor(units.length/2);
 return [balancedUnits(units.slice(0,m)),balancedUnits(units.slice(m))];
}

// Converts the accepted W23-C abstract replacement result into one exact
// physical-tree candidate per document. Final unresolved units are grouped by
// a fixed balanced fold; this final fold is part of the candidate definition.
export function w23FrequencyCandidateTrees(documents,options={}){
 if(!Array.isArray(documents)||!documents.length)fail('documents required');
 const out=compressFrequencyIncremental(documents,options);
 const scalarTokens=new Map(),tokenTrees=new Map();
 let nextToken=1;
 for(const d of documents){
  if(!d||typeof d.id!=='string'||!d.id||!validText(d.text))fail('invalid document');
  for(const scalar of [...d.text]){
   if(scalarTokens.has(scalar))continue;
   const token=nextToken++;
   scalarTokens.set(scalar,token);tokenTrees.set(token,scalar);
  }
 }
 for(const rule of out.rules){
  const left=tokenTrees.get(rule.leftToken),right=tokenTrees.get(rule.rightToken);
  if(left===undefined||right===undefined)fail('W23-C rule references unknown token');
  const tree=[left,right];
  if(expandTree(tree)!==rule.expanded)fail('W23-C rule expansion mismatch');
  if(rule.createdAbstractPair){
   if(rule.token!==nextToken)fail('unexpected W23-C created token order');
   tokenTrees.set(rule.token,tree);nextToken++;
  }else{
   const known=tokenTrees.get(rule.token);
   if(known===undefined||JSON.stringify(known)!==JSON.stringify(tree))
    fail('W23-C pair reuse mismatch');
  }
 }
 const trees={};
 for(const [i,d] of documents.entries()){
  const units=out.finalSequences[i].map(token=>{
   const tree=tokenTrees.get(token);if(tree===undefined)fail('unknown W23-C final token');return tree;
  });
  const tree=balancedUnits(units);
  if(expandTree(tree)!==d.text)fail('W23-C physical candidate replay mismatch');
  trees[d.id]=tree;
 }
 return {trees,agenda:out,finalGrouping:'balanced fold over remaining W23-C units'};
}

function validateInputs(documents,targetId,baselineTrees,candidateTree){
 if(!Array.isArray(documents)||documents.length<1||documents.length>8)
  fail('1..8 documents required');
 const ids=new Set();let scalars=0;
 for(const d of documents){
  if(!d||typeof d.id!=='string'||!d.id||ids.has(d.id)||!validText(d.text))
   fail('invalid or duplicate document');
  ids.add(d.id);scalars+=[...d.text].length;
 }
 if(scalars>2048)fail('source scalar budget exceeded');
 if(!ids.has(targetId))fail('unknown target document');
 if(baselineTrees!==undefined&&
   (baselineTrees===null||typeof baselineTrees!=='object'||Array.isArray(baselineTrees)))
  fail('baselineTrees must be object');
 const target=documents.find(d=>d.id===targetId);
 if(expandTree(candidateTree)!==target.text)fail('candidate does not exactly replay target');
 for(const d of documents){
  const tree=Object.hasOwn(baselineTrees??{},d.id)?
   baselineTrees[d.id]:balancedPhysicalTree(d.text);
  if(expandTree(tree)!==d.text)fail('baseline tree does not exactly replay '+d.id);
 }
}

function materializeTree(db,loader,tree){
 const c={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
 const recur=x=>typeof x==='string'?loader._atom(x,c):
  loader._pair(recur(x[0]),recur(x[1]),c);
 db.exec('BEGIN IMMEDIATE');
 try{
  const root=recur(tree);db.exec('COMMIT');
  return {rootLinkId:formatLinkId(root),...c};
 }catch(e){db.exec('ROLLBACK');loader.loadCaches();throw e;}
}

function buildBaseline(db,documents,baselineTrees){
 const loader=new NumericCorpusLoader(db,{reuseAtoms:true,reusePairs:true}),roots=[];
 for(const d of documents){
  const tree=Object.hasOwn(baselineTrees??{},d.id)?
   baselineTrees[d.id]:balancedPhysicalTree(d.text);
  roots.push({...d,bytes:Buffer.from(d.text,'utf8'),...materializeTree(db,loader,tree)});
 }
 loader.finalize();
 return {loader,roots};
}

function physicalSnapshot(db,roots){
 const rows=readNumericLinks(db),byId=new Map(rows.map(r=>[r.link_id,r])),seen=new Set();
 const visit=id=>{
  if(seen.has(id))return;
  const row=byId.get(id);if(!row)fail('missing root-reachable physical Link');
  seen.add(id);
  if(row.from_id!==null){visit(row.from_id);visit(row.to_id);}
 };
 for(const d of roots)visit(BigInt(d.rootLinkId));
 const totalAtoms=rows.filter(r=>r.from_id===null).length,totalPairs=rows.length-totalAtoms;
 let activeAtoms=0;
 for(const id of seen)if(byId.get(id).from_id===null)activeAtoms++;
 const activePairs=seen.size-activeAtoms;
 const fromUses=rows.reduce((n,r)=>n+Number(r.from_uses),0);
 const toUses=rows.reduce((n,r)=>n+Number(r.to_uses),0);
 if(fromUses!==totalPairs||toUses!==totalPairs)fail('structural counters inconsistent');
 const sourceExpandedPairEvents=roots.reduce((n,d)=>n+Math.max(0,[...d.text].length-1),0);
 const replay=replayNumericRoots(db,roots,{maxCodePoints:4096});
 if(replay.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS')fail('snapshot replay failed');
 verifyNumericLinks(db);
 return {
  storedRows:rows.length,storedAtoms:totalAtoms,storedPairs:totalPairs,
  activeRows:seen.size,activeAtoms,activePairs,
  inactiveHistoricalRows:rows.length-seen.size,
  structuralFromUsesSum:fromUses,structuralToUsesSum:toUses,
  sourceExpandedPairEvents,
  sourceEventsAreNotStructuralCounters:true
 };
}

function dryRunCandidate(db,currentRoots,targetId,candidateTree){
 const rows=readNumericLinks(db),byId=new Map(rows.map(r=>[r.link_id,r]));
 const atoms=new Map(),pairs=new Map();
 for(const row of rows){
  if(row.from_id===null){
   if(row.weight===null&&!atoms.has(row.string))atoms.set(row.string,row.link_id);
  }else if(row.weight===null&&row.string===null){
   const key=pairRefKey(refExisting(row.from_id),refExisting(row.to_id));
   if(!pairs.has(key))pairs.set(key,row.link_id);
  }
 }
 const stagedAtoms=new Map(),stagedPairs=new Map(),stagedRows=new Map();
 let nextVirtual=1;
 const c={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
 const atom=value=>{
  const existing=atoms.get(value);
  if(existing!==undefined){c.reusedAtoms++;return refExisting(existing);}
  const staged=stagedAtoms.get(value);
  if(staged!==undefined){c.reusedAtoms++;return staged;}
  const ref=refVirtual(nextVirtual++);
  stagedAtoms.set(value,ref);stagedRows.set(ref,{from:null,to:null,string:value});
  c.insertedAtoms++;return ref;
 };
 const pair=(from,to)=>{
  const key=pairRefKey(from,to);
  const existing=pairs.get(key);
  if(existing!==undefined){c.reusedPairs++;return refExisting(existing);}
  const staged=stagedPairs.get(key);
  if(staged!==undefined){c.reusedPairs++;return staged;}
  const ref=refVirtual(nextVirtual++);
  stagedPairs.set(key,ref);stagedRows.set(ref,{from,to,string:null});
  c.insertedPairs++;return ref;
 };
 const recur=x=>typeof x==='string'?atom(x):pair(recur(x[0]),recur(x[1]));
 const candidateRoot=recur(candidateTree);
 const beforeRoots=currentRoots.map(d=>refExisting(BigInt(d.rootLinkId)));
 const afterRoots=currentRoots.map(d=>d.id===targetId?candidateRoot:refExisting(BigInt(d.rootLinkId)));
 const reachable=roots=>{
  const seen=new Set(),visit=ref=>{
   if(seen.has(ref))return;seen.add(ref);
   if(ref.startsWith('E:')){
    const row=byId.get(BigInt(ref.slice(2)));if(!row)fail('dry-run missing existing Link');
    if(row.from_id!==null){visit(refExisting(row.from_id));visit(refExisting(row.to_id));}
   }else{
    const row=stagedRows.get(ref);if(!row)fail('dry-run missing virtual Link');
    if(row.from!==null){visit(row.from);visit(row.to);}
   }
  };
  roots.forEach(visit);return seen;
 };
 const before=reachable(beforeRoots),after=reachable(afterRoots);
 const beforeExisting=new Set([...before].filter(x=>x.startsWith('E:')));
 const afterExisting=new Set([...after].filter(x=>x.startsWith('E:')));
 const afterVirtual=new Set([...after].filter(x=>x.startsWith('V:')));
 const deactivated=[...beforeExisting].filter(x=>!afterExisting.has(x)).length;
 const newlyActiveExisting=[...afterExisting].filter(x=>!beforeExisting.has(x)).length;
 const storedRowsAfter=rows.length+stagedRows.size;
 return {
  candidateRootRef:candidateRoot,
  predicted:{...c,
   deltaStoredRows:stagedRows.size,
   storedRowsBefore:rows.length,storedRowsAfter,
   activeRowsBefore:before.size,activeRowsAfter:after.size,
   deltaActiveReachable:after.size-before.size,
   activeNewRows:afterVirtual.size,newlyActiveExistingRows:newlyActiveExisting,
   deactivatedExistingRows:deactivated,
   inactiveHistoricalRowsAfter:storedRowsAfter-after.size,
   deltaInactiveHistorical:(storedRowsAfter-after.size)-(rows.length-before.size)
  },
  plannedRows:[...stagedRows].map(([ref,row])=>({ref,...row}))
 };
}

function rootsWithRevision(roots,targetId,targetDoc,revision){
 return roots.map(d=>d.id===targetId?
  {...targetDoc,bytes:Buffer.from(targetDoc.text,'utf8'),...revision}:d);
}

function verifyOldRowsUnchanged(before,after){
 const map=new Map(after.map(r=>[r.link_id,r]));
 for(const old of before){
  const now=map.get(old.link_id);
  if(!now||JSON.stringify(stableRow(old))!==JSON.stringify(stableRow(now)))
   fail('historical Link identity mutated');
 }
}

export function evaluateMarginalPhysicalCost(documents,{
 targetId,baselineTrees={},candidateTree
}={}){
 validateInputs(documents,targetId,baselineTrees,candidateTree);
 const target=documents.find(d=>d.id===targetId);

 // Prediction database: exact existing physical graph, never mutated after dry-run.
 const predictionDb=newNumericLinkDb();
 let prediction,baselineSnapshot,baselineCold,baselineRows,baselineRoots;
 try{
  ({roots:baselineRoots}=buildBaseline(predictionDb,documents,baselineTrees));
  baselineSnapshot=physicalSnapshot(predictionDb,baselineRoots);
  baselineRows=readNumericLinks(predictionDb);
  prediction=dryRunCandidate(predictionDb,baselineRoots,targetId,candidateTree);
  if(readNumericLinks(predictionDb).length!==baselineRows.length)
   fail('dry-run mutated prediction database');
  baselineCold=coldNumericCorpusReplay(predictionDb,baselineRoots);
 }finally{predictionDb.close();}

 // Independent retained-history rebuild with real AUTOINCREMENT identities.
 const retainedDb=newNumericLinkDb();
 let retainedSnapshot,retainedCold,historyCold,actualWrite,retainedRows;
 try{
  const built=buildBaseline(retainedDb,documents,baselineTrees);
  if(JSON.stringify(readNumericLinks(retainedDb).map(stableRow))!==
     JSON.stringify(baselineRows.map(stableRow)))
   fail('independent baseline rebuild disagrees');
  const oldRows=readNumericLinks(retainedDb);
  actualWrite=materializeTree(retainedDb,built.loader,candidateTree);
  built.loader.finalize();
  retainedRows=readNumericLinks(retainedDb);verifyOldRowsUnchanged(oldRows,retainedRows);
  const activeRoots=rootsWithRevision(built.roots,targetId,target,actualWrite);
  retainedSnapshot=physicalSnapshot(retainedDb,activeRoots);
  retainedCold=coldNumericCorpusReplay(retainedDb,activeRoots);
  const oldTarget=built.roots.find(d=>d.id===targetId);
  historyCold=coldNumericCorpusReplay(retainedDb,[...activeRoots,
   {...target,bytes:Buffer.from(target.text,'utf8'),id:targetId+'@historical',
    rootLinkId:oldTarget.rootLinkId}]);
 }finally{retainedDb.close();}

 const p=prediction.predicted;
 const physicalRowsAdded=retainedSnapshot.storedRows-baselineSnapshot.storedRows;
 for(const [name,a,b] of [
  ['insertedAtoms',p.insertedAtoms,actualWrite.insertedAtoms],
  ['insertedPairs',p.insertedPairs,actualWrite.insertedPairs],
  ['reusedAtoms',p.reusedAtoms,actualWrite.reusedAtoms],
  ['reusedPairs',p.reusedPairs,actualWrite.reusedPairs],
  ['deltaStoredRows',p.deltaStoredRows,physicalRowsAdded],
  ['activeRowsAfter',p.activeRowsAfter,retainedSnapshot.activeRows],
  ['inactiveHistoricalRowsAfter',p.inactiveHistoricalRowsAfter,retainedSnapshot.inactiveHistoricalRows]
 ])if(a!==b)fail('dry-run prediction mismatch '+name+': '+a+' != '+b);

 // Independent fresh active rebuild answers a different question: what if this
 // candidate had been chosen before materializing the target version?
 const freshDb=newNumericLinkDb();
 let freshSnapshot,freshCold;
 try{
  const activeTrees={...baselineTrees,[targetId]:candidateTree};
  const built=buildBaseline(freshDb,documents,activeTrees);
  freshSnapshot=physicalSnapshot(freshDb,built.roots);
  freshCold=coldNumericCorpusReplay(freshDb,built.roots);
 }finally{freshDb.close();}

 return {
  schema:'mts-nl/w23d-marginal-physical-link-cost/v0',
  status:'DRY_RUN_EQUALS_INDEPENDENT_SQLITE_REBUILD_AND_COLD_REPLAY',
  targetId,
  documents:documents.map(d=>({id:d.id,unicodeScalars:[...d.text].length,
   sourceUtf8Bytes:Buffer.byteLength(d.text)})),
  prediction:p,
  verification:{
   exactPredictionMatch:true,historicalLinkIdentitiesUnchanged:true,
   physicalRowsAdded,
   retained:retainedSnapshot,
   baseline:baselineSnapshot,
   coldActive:{status:retainedCold.status,readOnly:retainedCold.readOnly,
    sqliteVacuumBytes:retainedCold.sqliteVacuumBytes},
   coldHistory:{status:historyCold.status,readOnly:historyCold.readOnly,
    documents:historyCold.documents.length}
  },
  physicalBytes:{
   baselineVacuumBytes:baselineCold.sqliteVacuumBytes,
   retainedVacuumBytes:retainedCold.sqliteVacuumBytes,
   deltaRetainedVacuumBytes:retainedCold.sqliteVacuumBytes-baselineCold.sqliteVacuumBytes,
   freshCandidateVacuumBytes:freshCold.sqliteVacuumBytes,
   deltaFreshVacuumBytesVsBaseline:freshCold.sqliteVacuumBytes-baselineCold.sqliteVacuumBytes,
   dryRunBytePrediction:null,
   reason:'SQLite page layout/serialization is measured physically, not inferred from Link count'
  },
  freshCounterfactual:{
   baselineStoredRows:baselineSnapshot.storedRows,
   candidateStoredRows:freshSnapshot.storedRows,
   deltaStoredRows:freshSnapshot.storedRows-baselineSnapshot.storedRows,
   baselineActiveRows:baselineSnapshot.activeRows,
   candidateActiveRows:freshSnapshot.activeRows,
   deltaActiveRows:freshSnapshot.activeRows-baselineSnapshot.activeRows,
   status:freshCold.status
  },
  limits:{
   persistentIdentity:'SQLite INTEGER PRIMARY KEY AUTOINCREMENT',
   exactReuse:'oldest existing weight-null atom or exact ordered physical pole pair',
   currentRoots:'external experimental root set; roots are not stored in links table',
   retainedHistory:true,
   sourceObservationsSeparate:true,
   structuralPoleCountersSeparate:true,
   dryRunDoesNotPredictSQLiteBytes:true,
   maxDocuments:8,maxSourceScalars:2048,
   noSemantics:true,noGlobalOptimality:true
  }
 };
}
