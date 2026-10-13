// W22-C reproducible two/three-document SQLite counterfactual evidence.
// Only synthetic Unicode controls, never user's private text or copyrighted books.
import {compareSqliteRegrouping} from '../src/w22c-sqlite-regrouping-v0.mjs';
const documents=[
 {id:'A',text:'абаабабб'},
 {id:'B',text:'абаб'},
 {id:'C',text:'мама мама'}
];
const r=compareSqliteRegrouping(documents,{targetId:'A',width:4,offset:3});
const report={
 schema:r.schema,status:r.status,
 sourceKind:'synthetic-controlled',documents:r.documents,
 targetId:r.targetId,width:r.width,offset:r.offset,candidateCount:r.candidateCount,
 localMinimum:r.localMinimum,bestWholePairs:r.bestWholePairs,
 bestWholePairsAmongLocalOptima:r.bestWholePairsAmongLocalOptima,
 wholeGraphSavingFromContext:r.wholeGraphSavingFromContext,
 bestLocalOrdinal:r.bestLocalOrdinal,bestContextOrdinal:r.bestContextOrdinal,
 baseline:{physical:r.retention.before.physicalTotal,active:r.retention.before.activeTotal,
  sourceOccurrences:r.retention.before.expandedPairEvents,
  structuralFromUses:r.retention.before.physicalFromUsesSum},
 replacement:{physical:r.retention.after.physicalTotal,active:r.retention.after.activeTotal,
  orphanedHistoricalLinks:r.retention.after.inactiveTotal,
  sourceOccurrences:r.retention.after.expandedPairEvents,
  structuralFromUses:r.retention.after.physicalFromUsesSum},
 contrasts:[
  {secondDocument:'бб',...(()=>{
   const a=compareSqliteRegrouping([
    {id:'A',text:'абаабабб'},{id:'B',text:'бб'}],{targetId:'A',width:4,offset:3});
   return {bestLocalCost:a.bestWholePairsAmongLocalOptima,contextCost:a.bestWholePairs,
    saving:a.wholeGraphSavingFromContext,retainedPhysical:a.retention.after.physicalTotal,
    activeLinks:a.retention.after.activeTotal,inactiveLinks:a.retention.after.inactiveTotal,
    historicalIdentityUnchanged:a.retention.oldLinkIdentitiesUnchanged};
  })()},
  {secondDocument:'абаб',...(()=>{
   const b=compareSqliteRegrouping([
    {id:'A',text:'абаабабб'},{id:'B',text:'абаб'}],{targetId:'A',width:4,offset:3});
   return {bestLocalCost:b.bestWholePairsAmongLocalOptima,contextCost:b.bestWholePairs,
    saving:b.wholeGraphSavingFromContext,retainedPhysical:b.retention.after.physicalTotal,
    activeLinks:b.retention.after.activeTotal,inactiveLinks:b.retention.after.inactiveTotal,
    historicalIdentityUnchanged:b.retention.oldLinkIdentitiesUnchanged};
  })()}
 ],
 physicalRowsAdded:r.retention.physicalRowsAdded,
 historicalLinkPolesUnchanged:r.retention.oldLinkIdentitiesUnchanged,
 coldReplay:r.retention.cold.status,limits:r.limits
};
console.log('W22C_PHYSICAL_SQLITE_REPORT '+JSON.stringify(report));
