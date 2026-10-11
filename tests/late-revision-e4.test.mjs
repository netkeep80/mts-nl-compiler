import assert from "node:assert/strict";
import {test} from "node:test";
import {analyzeLateSymbolRevision} from "../src/late-revision-e4.mjs";
const repeat=6000,early="ab".repeat(128);
const before="ab".repeat(repeat)+"cd".repeat(repeat)+"c";
test("one new symbol changes a Link decomposition >10k codepoints in the past",()=>{
 const r=analyzeLateSymbolRevision({before,receivedSymbol:"d",
  oldFragment:early,maxRounds:1});
 assert.deepEqual(r.before.selectedRule,{a:0,b:1});
 assert.deepEqual(r.after.selectedRule,{a:2,b:3});
 assert.ok(r.observation.oldFragmentDistanceFromArrival>10000);
 assert.equal(r.observation.newExternalCodepoints,1);
 assert.equal(r.revision.rootChanged,true);
 assert.equal(r.revision.zeroRuleControlUnchanged,true);
 assert.ok(r.revision.newOldProbePairs>0);
 assert.ok(r.revision.retiredOldProbePairs>0);
 assert.equal(r.countedObservedSources,1);
 assert.equal(r.probeCountedForLearning,false);
 assert.ok(r.retention.additionalLinksIfOldRetained>=0);
 console.log("E4_TEMPORAL_REVISION "+JSON.stringify(r));
});
test("E4 rejects non-event or nonexistent prior observation",()=>{
 assert.throws(()=>analyzeLateSymbolRevision({before:"abc",receivedSymbol:"xy",
  oldFragment:"a"}),/invalid event/);
 assert.throws(()=>analyzeLateSymbolRevision({before:"abc",receivedSymbol:"d",
  oldFragment:"xyz"}),/invalid event/);
});
