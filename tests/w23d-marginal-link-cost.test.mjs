import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {balancedPhysicalTree,evaluateMarginalPhysicalCost,w23FrequencyCandidateTrees}
 from '../src/w23d-marginal-link-cost-v0.mjs';

const doc=(id,text)=>({id,text});
const leftTree=text=>{
 const points=[...text];let tree=points[0]??'';
 for(let i=1;i<points.length;i++)tree=[tree,points[i]];
 return tree;
};

test('W23-D: W23-C candidate predicts retained cost exactly while fresh active graph saves one Link',()=>{
 const documents=[doc('A','aaaab')];
 const learned=w23FrequencyCandidateTrees(documents,
  {minOccurrences:2,maxRounds:16,maxExpansionScalars:64});
 const candidate=learned.trees.A;
 const r=evaluateMarginalPhysicalCost(documents,{targetId:'A',candidateTree:candidate});
 assert.equal(r.status,'DRY_RUN_EQUALS_INDEPENDENT_SQLITE_REBUILD_AND_COLD_REPLAY');
 assert.equal(learned.agenda.ruleCount,1);
 assert.equal(learned.agenda.rules[0].expanded,'aa');
 assert.equal(r.prediction.deltaStoredRows,2);
 assert.equal(r.prediction.insertedAtoms,0);
 assert.equal(r.prediction.insertedPairs,2);
 assert.equal(r.prediction.deltaActiveReachable,-1);
 assert.equal(r.prediction.inactiveHistoricalRowsAfter,3);
 assert.equal(r.verification.physicalRowsAdded,2);
 assert.equal(r.verification.retained.storedRows,8);
 assert.equal(r.verification.retained.activeRows,5);
 assert.equal(r.freshCounterfactual.baselineStoredRows,6);
 assert.equal(r.freshCounterfactual.candidateStoredRows,5);
 assert.equal(r.freshCounterfactual.deltaStoredRows,-1);
 assert.equal(r.verification.coldActive.status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 assert.equal(r.verification.coldActive.readOnly,true);
 assert.equal(r.verification.coldHistory.status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 assert.equal(r.verification.coldHistory.documents,2);
 assert.equal(r.physicalBytes.dryRunBytePrediction,null);
 console.log('W23D_FREQUENCY_MIGRATION '+JSON.stringify({
  rules:learned.agenda.ruleCount,
  retainedDeltaRows:r.prediction.deltaStoredRows,
  activeDelta:r.prediction.deltaActiveReachable,
  inactiveHistory:r.prediction.inactiveHistoricalRowsAfter,
  freshDeltaRows:r.freshCounterfactual.deltaStoredRows,
  baselineBytes:r.physicalBytes.baselineVacuumBytes,
  retainedDeltaBytes:r.physicalBytes.deltaRetainedVacuumBytes,
  freshDeltaBytes:r.physicalBytes.deltaFreshVacuumBytesVsBaseline
 }));
});

test('W23-D: exact candidate already present in another current root adds zero rows',()=>{
 const documents=[doc('A','aaaab'),doc('B','aaaab')];
 const learned=w23FrequencyCandidateTrees(documents,
  {minOccurrences:2,maxRounds:16,maxExpansionScalars:64});
 const candidate=learned.trees.A;
 const baselineTrees={A:balancedPhysicalTree('aaaab'),B:candidate};
 const r=evaluateMarginalPhysicalCost(documents,{targetId:'A',baselineTrees,candidateTree:candidate});
 assert.equal(r.prediction.deltaStoredRows,0);
 assert.equal(r.prediction.insertedAtoms,0);
 assert.equal(r.prediction.insertedPairs,0);
 assert.ok(r.prediction.reusedPairs>0);
 assert.equal(r.prediction.deltaActiveReachable,-3);
 assert.equal(r.prediction.deactivatedExistingRows,3);
 assert.equal(r.prediction.inactiveHistoricalRowsAfter,3);
 assert.equal(r.verification.physicalRowsAdded,0);
 assert.equal(r.verification.retained.storedRows,r.verification.baseline.storedRows);
 assert.equal(r.verification.retained.activeRows,5);
 assert.equal(r.verification.retained.sourceExpandedPairEvents,8);
 assert.equal(r.verification.retained.structuralFromUsesSum,6);
 assert.notEqual(r.verification.retained.sourceExpandedPairEvents,
  r.verification.retained.structuralFromUsesSum);
});

test('W23-D: no-op candidate is zero marginal cost and keeps active/history stable',()=>{
 const documents=[doc('ru','мама🙂мама'),doc('ws','a\tb\r\na\tb')];
 const candidate=balancedPhysicalTree(documents[0].text);
 const r=evaluateMarginalPhysicalCost(documents,{targetId:'ru',candidateTree:candidate});
 assert.equal(r.prediction.deltaStoredRows,0);
 assert.equal(r.prediction.deltaActiveReachable,0);
 assert.equal(r.prediction.deltaInactiveHistorical,0);
 assert.equal(r.verification.physicalRowsAdded,0);
 assert.equal(r.verification.retained.activeRows,r.verification.baseline.activeRows);
 assert.equal(r.verification.retained.inactiveHistoricalRows,0);
 assert.equal(r.freshCounterfactual.deltaStoredRows,0);
 assert.equal(r.verification.coldHistory.documents,3);
});

test('W23-D: Unicode frequency candidate exact-replays in retained, history and fresh rebuilds',()=>{
 const documents=[doc('u','🙂a🙂a🙂'),doc('c','e\u0301e\u0301')];
 const learned=w23FrequencyCandidateTrees(documents,
  {minOccurrences:2,maxRounds:16,maxExpansionScalars:16});
 const r=evaluateMarginalPhysicalCost(documents,
  {targetId:'u',candidateTree:learned.trees.u});
 assert.equal(r.verification.coldActive.status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 assert.equal(r.verification.coldHistory.status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 assert.equal(r.freshCounterfactual.status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 assert.equal(r.verification.exactPredictionMatch,true);
 assert.equal(r.verification.historicalLinkIdentitiesUnchanged,true);
});

test('W23-D: pair-count prediction includes candidate-local reuse, not source occurrence fiction',()=>{
 const documents=[doc('A','abababab')];
 const candidate=[[['a','b'],['a','b']],[['a','b'],['a','b']]];
 const r=evaluateMarginalPhysicalCost(documents,{targetId:'A',candidateTree:candidate});
 assert.equal(r.prediction.insertedAtoms,0);
 assert.ok(r.prediction.reusedAtoms>=8);
 assert.ok(r.prediction.reusedPairs>0);
 assert.equal(r.prediction.deltaStoredRows,r.verification.physicalRowsAdded);
 assert.equal(r.verification.retained.sourceEventsAreNotStructuralCounters,true);
 assert.equal(r.limits.sourceObservationsSeparate,true);
 assert.equal(r.limits.structuralPoleCountersSeparate,true);
});

test('W23-D: physical VACUUM bytes are independently measured and can grow with retained history',()=>{
 const text=Array.from({length:320},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
 const r=evaluateMarginalPhysicalCost([doc('large',text)],
  {targetId:'large',candidateTree:leftTree(text)});
 assert.ok(r.prediction.deltaStoredRows>200);
 assert.equal(r.prediction.deltaStoredRows,r.verification.physicalRowsAdded);
 assert.ok(r.physicalBytes.deltaRetainedVacuumBytes>0);
 assert.equal(r.physicalBytes.dryRunBytePrediction,null);
 assert.equal(r.freshCounterfactual.deltaStoredRows,0,
  'unique-symbol trees have the same fresh row cardinality despite different shape');
 console.log('W23D_SQLITE_BYTES '+JSON.stringify({
  addedRows:r.prediction.deltaStoredRows,
  baselineBytes:r.physicalBytes.baselineVacuumBytes,
  retainedBytes:r.physicalBytes.retainedVacuumBytes,
  retainedDeltaBytes:r.physicalBytes.deltaRetainedVacuumBytes,
  freshDeltaRows:r.freshCounterfactual.deltaStoredRows
 }));
});

test('W23-D: machine report preserves fresh-vs-retained objective separation',()=>{
 const script=fileURLToPath(new URL('../scripts/w23d_sqlite_probe.mjs',import.meta.url));
 const run=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:20000});
 assert.equal(run.status,0,run.stderr);
 const line=run.stdout.split('\n').find(x=>x.startsWith('W23D_PHYSICAL_COST_REPORT '));
 assert.ok(line,'missing W23-D machine report');
 const report=JSON.parse(line.slice('W23D_PHYSICAL_COST_REPORT '.length));
 assert.equal(report.schema,'mts-nl/w23d-physical-cost-report/v0');
 assert.equal(report.status,'DRY_RUN_EQUALS_INDEPENDENT_SQLITE_REBUILD_AND_COLD_REPLAY');
 assert.equal(report.migration.retainedDeltaRows,2);
 assert.equal(report.migration.activeDeltaRows,-1);
 assert.equal(report.migration.freshDeltaRows,-1);
 assert.equal(report.preexistingReuse.retainedDeltaRows,0);
 assert.equal(report.preexistingReuse.activeDeltaRows,-3);
 assert.equal(report.conclusion.freshAndMigrationObjectivesMustRemainSeparate,true);
});

test('W23-D: fail closed on altered text, bad baselines, duplicate IDs and resource limits',()=>{
 assert.throws(()=>evaluateMarginalPhysicalCost([doc('A','abc')],
  {targetId:'A',candidateTree:['a','b']}),/candidate does not exactly replay/);
 assert.throws(()=>evaluateMarginalPhysicalCost([doc('A','abc')],
  {targetId:'A',baselineTrees:{A:['a','b']},candidateTree:balancedPhysicalTree('abc')}),
  /baseline tree does not exactly replay/);
 assert.throws(()=>evaluateMarginalPhysicalCost([doc('A','abc'),doc('A','abc')],
  {targetId:'A',candidateTree:balancedPhysicalTree('abc')}),/duplicate/);
 assert.throws(()=>evaluateMarginalPhysicalCost([doc('A','abc')],
  {targetId:'missing',candidateTree:balancedPhysicalTree('abc')}),/unknown target/);
 const huge='a'.repeat(2049);
 assert.throws(()=>evaluateMarginalPhysicalCost([doc('A',huge)],
  {targetId:'A',candidateTree:balancedPhysicalTree(huge)}),/scalar budget/);
 assert.throws(()=>balancedPhysicalTree('\ud800'),/invalid Unicode/);
});
