import assert from "node:assert/strict";
import {test} from "node:test";
import {externalObservationLedger,candidateEvidenceScore} from
 "../experiments/evidence-score-oracle-v0.mjs";
const obs=(id,text="ма",context="prefix")=>
 ({id,kind:"external",context,observation:text});
const gen=id=>({id,kind:"generated",context:"prefix",observation:"ма"});
const score=e=>candidateEvidenceScore(e,{context:"prefix",observation:"ма"});
test("repeat provenance in many proofs is one external observation",()=>{
 const e=[obs("t4"),obs("t4"),obs("t4")];
 assert.equal(externalObservationLedger(e).count,1);
 assert.equal(score(e).independentCount,1);
 assert.equal(score(e).score,0.5);
});
test("10k self-generated Link proofs have no independent evidence weight",()=>{
 const e=[obs("t4")],original=score(e);
 for(let i=0;i<10000;i++)e.push(gen("proof:"+i));
 assert.deepEqual(score(e),original);
 assert.equal(externalObservationLedger(e).ignoredGenerated,10000);
});
test("second independent external observation updates uncalibrated score",()=>{
 assert.equal(score([obs("t4")]).score,0.5);
 assert.equal(score([obs("t4"),obs("t5")]).score,2/3);
 assert.equal(score([gen("proof:1")]).independentCount,0);
 assert.equal(score([gen("proof:1")]).kind,"UNCALIBRATED_RANK_NOT_PROBABILITY");
});
test("replay and source ordering produce same evidence count",()=>{
 const a=[obs("z"),gen("proof:0"),obs("a")];
 const b=[obs("a"),obs("z"),gen("proof:0")];
 assert.deepEqual(externalObservationLedger(a),externalObservationLedger(b));
});
test("contradictory external ID and invalid event data fail closed",()=>{
 assert.throws(()=>externalObservationLedger([obs("a"),obs("a","other")]),
  /conflicting observation/);
 assert.throws(()=>externalObservationLedger([obs("a"),null]),/bad event/);
 assert.throws(()=>externalObservationLedger([{
  id:"x",kind:"unknown",context:"prefix",observation:"ма"
 }]),/invalid provenance/);
 assert.throws(()=>candidateEvidenceScore([obs("a")],{
  context:"prefix",observation:"ма",smoothing:0}),/invalid smoothing/);
});
