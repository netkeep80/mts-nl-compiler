// E4 observational late-revision oracle. This re-runs an immutable full
// corpus with the same deterministic pair learner. It is NOT event-driven Γ.
import {createHash} from "node:crypto";
import {learnObservedPairGrammar} from "./observed-pair-grammar-e2.mjs";
const sha=s=>createHash("sha256").update(Buffer.from(s,"utf8")).digest("hex");
const fail=s=>{throw Error("E4 late revision: "+s);};
const observation=(id,source)=>({id,source,inputSha256:sha(source)});
function reachable(rows,root){
 const m=new Map(rows.map(r=>[r.link_id,r])),seen=new Set(),pairs=new Set(),todo=[root];
 while(todo.length){
  const id=todo.pop();if(seen.has(id))continue;
  const row=m.get(id);if(!row)fail("missing selected Link");
  seen.add(id);
  if(row.from_id!==null){pairs.add(id);todo.push(row.from_id,row.to_id);}
 }
 return pairs;
}
export function analyzeLateSymbolRevision({before,receivedSymbol,oldFragment,maxRounds=1,
 rootGrouping="content-stable"}){
 if(typeof before!=="string"||typeof oldFragment!=="string"||
    typeof receivedSymbol!=="string"||[...receivedSymbol].length!==1||
    !before.includes(oldFragment)||oldFragment.length===0||
    !Number.isSafeInteger(maxRounds)||maxRounds<1)
  fail("invalid event/old fragment");
 const probe=observation("probe:old",oldFragment),after=before+receivedSymbol;
 const run=(text,rounds)=>learnObservedPairGrammar(
  [observation("observed:only",text)],{
   maxRounds:rounds,probeDocuments:[probe],rootGrouping,includeSelectedRows:true
  });
 const prev=run(before,maxRounds),next=run(after,maxRounds);
 const rootOf=r=>{
  const id=r.probeRoots.find(x=>x.id===probe.id)?.rootLink;
  if(!id||!r.selectedRows)fail("missing restored old probe");
  return {id,pairs:reachable(r.selectedRows,id)};
 };
 const old=rootOf(prev),now=rootOf(next);
 const noRuleA=rootOf(run(before,0)),noRuleB=rootOf(run(after,0));
 if(noRuleA.id!==noRuleB.id)fail("no-rule control unexpectedly changed");
 const priorIds=new Set(prev.selectedRows.map(r=>r.link_id));
 const union=priorIds.size+next.selectedRows.filter(r=>!priorIds.has(r.link_id)).length;
 const externalDistance=[...before.slice(before.indexOf(oldFragment)+oldFragment.length)].length;
 const ruleOf=x=>x.roundDetails[0]?{
  a:x.roundDetails[0].a,b:x.roundDetails[0].b}:null;
 return {
  status:"E4_FULL_REPLAY_LATE_OLD_PROBE_VERIFIED",
  observation:{newSymbol:receivedSymbol,newExternalCodepoints:1,
   previousSha256:sha(before),updatedSha256:sha(after),oldProbeSha256:probe.inputSha256,
   oldFragmentCodepoints:[...oldFragment].length,
   oldFragmentDistanceFromArrival:externalDistance},
  before:{selectedRule:ruleOf(prev),uniqueDuplets:prev.graphPairRows,
   oldProbeRoot:old.id,oldProbeReachableDuplets:old.pairs.size},
  after:{selectedRule:ruleOf(next),uniqueDuplets:next.graphPairRows,
   oldProbeRoot:now.id,oldProbeReachableDuplets:now.pairs.size},
  revision:{rootChanged:old.id!==now.id,
   commonOldPairs:[...old.pairs].filter(id=>now.pairs.has(id)).length,
   newOldProbePairs:[...now.pairs].filter(id=>!old.pairs.has(id)).length,
   retiredOldProbePairs:[...old.pairs].filter(id=>!now.pairs.has(id)).length,
   zeroRuleControlUnchanged:noRuleA.id===noRuleB.id},
  retention:{oldAndNewUnionLinks:union,latestSelectedLinks:next.graphRows,
   additionalLinksIfOldRetained:union-next.graphRows},
  countedObservedSources:1,probeCountedForLearning:false,
  implementation:"FULL_BATCH_RECOMPUTE_NOT_NATIVE_GAMMA"
 };
}
