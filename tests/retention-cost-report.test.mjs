import assert from "node:assert/strict";
import {test} from "node:test";
import {makeRewriteFixture} from "../experiments/compression-implication-v0.mjs";
import {runRetentionExperiment} from "../experiments/retention-oracle-v0.mjs";

test("measured full-row JSON cost report: three sample rewrites",()=>{
 const fixtures=[
  {name:"мама",left:"м",right:"а"},
  {name:"RESTREST",left:"RE",right:"ST"},
  {name:"x²x²",left:"x",right:"²"}
 ];
 const results=[];
 for(const f of fixtures){
  const {symbolic,executable,switchResult,materializedPhysicalLinks}=
    runRetentionExperiment(makeRewriteFixture(f));
  const profile=x=>({
   retainedLinks:x.retainedLinks,
   retainedPairs:x.retainedPairs,
   retainedAtoms:x.retainedAtoms,
   serializedBytes:x.serializedBytes
  });
  const a=profile(switchResult.before);
  const b=profile(switchResult.versioned);
  const c=profile(switchResult.proofRetained);
  const d=profile(switchResult.oldExternallyPinned);
  assert.equal(symbolic.valid,true);
  assert.equal(executable.candidates[0].exactBytes,true);
  assert.equal(a.retainedPairs-b.retainedPairs,1);
  assert.ok(c.retainedPairs>a.retainedPairs);
  results.push({text:f.name,source:a,optimisticWithoutProof:b,
   withProof:c,withProofAndLegacyRoot:d,
   materializedPhysicalLinks,
   note:"JSON includes 7 physical columns + root selectors; NOT full MDL"});
 }
 console.log("RETENTION_COST_REPORT_V0="+JSON.stringify(results));
});
