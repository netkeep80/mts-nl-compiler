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

test("E4 probe source does not contribute to learning counts or change selected rule",async()=>{
 const {learnObservedPairGrammar}=await import("../src/observed-pair-grammar-e2.mjs");
 const {createHash}=await import("node:crypto");
 const d=(id,source)=>({id,source,
  inputSha256:createHash("sha256").update(Buffer.from(source,"utf8")).digest("hex")});
 const train=[d("source","abababcdcd")],probe=[d("probe","ababababab")];
 const plain=learnObservedPairGrammar(train,{maxRounds:2,rootGrouping:"content-stable"});
 const withProbe=learnObservedPairGrammar(train,{maxRounds:2,rootGrouping:"content-stable",
  probeDocuments:probe});
 assert.deepEqual(withProbe.roundDetails,plain.roundDetails);
 assert.equal(withProbe.remainingPositions,plain.remainingPositions);
 assert.equal(withProbe.substitutionRounds,plain.substitutionRounds);
 assert.equal(withProbe.probeRoots.length,1);
 assert.equal(withProbe.documents.length,plain.documents.length+1);
 assert.throws(()=>learnObservedPairGrammar(train,{
  maxRounds:1,probeDocuments:[d("source","abab")]
 }),/duplicate external\/probe/);
 assert.throws(()=>learnObservedPairGrammar(train,{
  maxRounds:1,probeDocuments:[d("new","💡")]
 }),/probe character not in the observed alphabet/);
});
