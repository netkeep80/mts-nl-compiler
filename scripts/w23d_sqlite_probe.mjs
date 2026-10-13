// W23-D reproducible synthetic physical-cost evidence.
// No private/copyrighted corpus is embedded.
import {balancedPhysicalTree,evaluateMarginalPhysicalCost,w23FrequencyCandidateTrees}
 from '../src/w23d-marginal-link-cost-v0.mjs';

const doc=(id,text)=>({id,text});
const single=[doc('A','aaaab')];
const learned=w23FrequencyCandidateTrees(single,
 {minOccurrences:2,maxRounds:16,maxExpansionScalars:64});
const migration=evaluateMarginalPhysicalCost(single,
 {targetId:'A',candidateTree:learned.trees.A});

const shared=[doc('A','aaaab'),doc('B','aaaab')];
const learnedShared=w23FrequencyCandidateTrees(shared,
 {minOccurrences:2,maxRounds:16,maxExpansionScalars:64});
const sharedCandidate=learnedShared.trees.A;
const preexisting=evaluateMarginalPhysicalCost(shared,{
 targetId:'A',
 baselineTrees:{A:balancedPhysicalTree('aaaab'),B:sharedCandidate},
 candidateTree:sharedCandidate
});

const report={
 schema:'mts-nl/w23d-physical-cost-report/v0',
 status:'DRY_RUN_EQUALS_INDEPENDENT_SQLITE_REBUILD_AND_COLD_REPLAY',
 sourceKind:'synthetic-controlled',
 migration:{
  retainedDeltaRows:migration.prediction.deltaStoredRows,
  activeDeltaRows:migration.prediction.deltaActiveReachable,
  inactiveHistoryAfter:migration.prediction.inactiveHistoricalRowsAfter,
  freshDeltaRows:migration.freshCounterfactual.deltaStoredRows,
  baselineVacuumBytes:migration.physicalBytes.baselineVacuumBytes,
  retainedDeltaVacuumBytes:migration.physicalBytes.deltaRetainedVacuumBytes,
  freshDeltaVacuumBytes:migration.physicalBytes.deltaFreshVacuumBytesVsBaseline
 },
 preexistingReuse:{
  retainedDeltaRows:preexisting.prediction.deltaStoredRows,
  activeDeltaRows:preexisting.prediction.deltaActiveReachable,
  deactivatedExistingRows:preexisting.prediction.deactivatedExistingRows,
  inactiveHistoryAfter:preexisting.prediction.inactiveHistoricalRowsAfter,
  reusedPairs:preexisting.prediction.reusedPairs
 },
 conclusion:{
  retainedRewriteCanReduceActiveWithoutReducingStored:true,
  freshAndMigrationObjectivesMustRemainSeparate:true,
  sqliteBytesMeasuredNotPredicted:true,
  noSemanticClaim:true
 }
};
console.log('W23D_PHYSICAL_COST_REPORT '+JSON.stringify(report));
