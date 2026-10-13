import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareSqliteRegrouping} from '../src/w22c-sqlite-regrouping-v0.mjs';

const docs=[
 {id:'A',text:'абаабабб'},
 {id:'B',text:'абаб'},
 {id:'C',text:'мама мама'}
];
test('W22-C: real SQLite independently replays same multi-document Unicode with true Link IDs',()=>{
 const r=compareSqliteRegrouping(docs,{targetId:'A',width:4,offset:3});
 assert.equal(r.schema,'mts-nl/w22c-physical-counterfactual/v0');
 assert.equal(r.status,'PHYSICAL_SQLITE_EXACT_MULTIDOC_PASS');
 assert.equal(r.candidateCount,5);
 assert.equal(r.localMinimum,2);
 assert.equal(r.documents.length,3);
 assert.equal(r.retention.cold.status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 assert.equal(r.retention.cold.documents,3);
 assert.equal(r.retention.cold.readOnly,true);
 assert.equal(r.retention.oldLinkIdentitiesUnchanged,true);
 assert.equal(r.retention.before.inactiveTotal,0);
 assert.ok(r.retention.after.physicalTotal>=r.retention.before.physicalTotal);
 assert.ok(r.retention.nowInactiveLinks>=0);
 assert.equal(r.retention.retainedPhysicalLinks-r.retention.initialPhysicalLinks,
  r.retention.physicalRowsAdded);
 assert.equal(r.retention.after.activePairs,r.bestWholePairs);
 assert.ok(r.bestWholePairs<=r.bestWholePairsAmongLocalOptima);
 assert.ok(r.freshTop[0].activePairs===r.bestWholePairs);
 assert.equal(r.limits.persistentIdentity,'SQLite INTEGER PRIMARY KEY AUTOINCREMENT');
 assert.ok(r.limits.structuralCounters.includes('inactive history'));
 assert.equal(r.limits.corpusGlobalMinimum,false);
 console.log('W22C_MULTIDOC '+JSON.stringify({
  candidateCount:r.candidateCount,localMinimum:r.localMinimum,
  bestWholePairs:r.bestWholePairs,
  bestWholePairsAmongLocalOptima:r.bestWholePairsAmongLocalOptima,
  saving:r.wholeGraphSavingFromContext,
  baselineActive:r.retention.before.activeTotal,
  revisedActive:r.retention.after.activeTotal,
  retainedPhysical:r.retention.retainedPhysicalLinks,
  inactive:r.retention.nowInactiveLinks,
  sourceEvents:r.retention.after.expandedPairEvents,
  sqliteStructuralFromUses:r.retention.after.physicalFromUsesSum
 }));
});
test('W22-C: source root multiplicity is not SQLite from_uses or to_uses',()=>{
 const replicated=[
  {id:'X',text:'мама'},
  {id:'Y',text:'мама'}
 ];
 const r=compareSqliteRegrouping(replicated,{targetId:'Y',width:4,offset:0});
 assert.equal(r.retention.before.expandedPairEvents,6);
 assert.equal(r.retention.before.activePairs,2);
 assert.equal(r.retention.before.physicalFromUsesSum,2);
 assert.equal(r.retention.before.physicalToUsesSum,2);
 assert.equal(r.retention.before.reusedExpandedPairs,4);
 assert.ok(Object.values(r.retention.before.sourceEventsByLink).some(n=>n>=2));
 assert.ok(r.retention.after.physicalTotal>=r.retention.before.physicalTotal);
 assert.equal(r.retention.oldLinkIdentitiesUnchanged,true);
});
test('W22-C: exact Unicode, repeated roots, controls and empty-oracle gain',()=>{
 for(const text of ['🧪аб🧪аб','а\u0301a\u0301а\u0301','аааааааа']){
  const d=[{id:'left',text},{id:'right',text}];
  const width=4,offset=0;
  const r=compareSqliteRegrouping(d,{targetId:'left',width,offset});
  assert.equal(r.retention.cold.documents,2);
  assert.equal(r.retention.after.expandedAtomEvents,2*[...text].length);
  assert.equal(r.retention.after.expandedPairEvents,2*([...text].length-1));
  assert.ok(r.freshTop.every(x=>x.activePairs<=r.retention.retainedPhysicalLinks));
 }
});
test('W22-C: fail closed on missing IDs, duplicate documents, invalid Unicode and candidate budgets',()=>{
 const input=[{id:'x',text:'абаабабб'},{id:'y',text:'абаб'}];
 assert.throws(()=>compareSqliteRegrouping(input,{targetId:'missing'}),/unknown target/);
 assert.throws(()=>compareSqliteRegrouping(input,{targetId:'x',width:8,maxCandidates:4}),/budget exceeded/);
 assert.throws(()=>compareSqliteRegrouping([input[0],input[0]],{targetId:'x'}),/duplicate/);
 assert.throws(()=>compareSqliteRegrouping([{id:'x',text:'\uD800aa'},input[1]],{targetId:'x'}),/unpaired/);
 assert.throws(()=>compareSqliteRegrouping([{id:'x',text:''},input[1]],{targetId:'x'}),/length/);
 assert.throws(()=>compareSqliteRegrouping(input,{targetId:'x',offset:999}),/window offset/);
 assert.throws(()=>compareSqliteRegrouping(input,{targetId:'x',maxCandidates:0}),/budget/);
});
test('W22-C: up to 8 scalars enumerates 429 durable DB rebuild alternatives without invented identities',()=>{
 const d=[{id:'α',text:'мамамама'},{id:'β',text:'мама'}];
 const r=compareSqliteRegrouping(d,{targetId:'α',width:8,offset:0});
 assert.equal(r.candidateCount,429);
 assert.equal(r.localMinimum,3); 
 assert.equal(r.retention.after.physicalFromUsesSum,r.retention.after.physicalPairs);
 assert.equal(r.retention.after.physicalToUsesSum,r.retention.after.physicalPairs);
 assert.ok(r.retention.after.physicalTotal>=r.retention.after.activeTotal);
 assert.equal(r.limits.physicalSQLiteCost,undefined);
});
