// #30: Actual accepted v0.15 A9 Γ produces a three-generation cascade
// from one selected observation event. Weight is priority metadata ONLY:
// varying it MUST NOT change pure logical entailment.
// Upstream native Γ is test-side, not a production-exported API.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {pathToFileURL} from "node:url";
import {LinkGraph} from "../experiments/inference-v0.mjs";
import {makeRewriteFixture,decodeSequence} from "../experiments/compression-implication-v0.mjs";
import {extractSingleImageRewrite} from "../experiments/retention-oracle-v0.mjs";
import {serializeObjectTree,importObjectTree} from "../experiments/object-tree-json-v0.mjs";
import {createNativeRegistry,readNativeRegistry,compareRowsExactly}
 from "../experiments/native-graph-registry-v0.mjs";

const sourceDir=process.env.UPSTREAM_MTS_PATH;
if(!sourceDir)throw Error("UPSTREAM_MTS_PATH missing");
const root=resolve(sourceDir);
const nativeModule=name=>import(pathToFileURL(resolve(root,"ts/dist/src/"+name+".js")).href);
const [{Memory,ensureRootBasis},str,seq,struct,{defineContext}]=await Promise.all([
 nativeModule("memory"),nativeModule("v012-string-anum"),
 nativeModule("exact-sequence"),nativeModule("structural-rule"),nativeModule("state")
]);
const api={
 materializeV012StringAnum:str.materializeV012StringAnum,
 readV012StringAnum:str.readV012StringAnum,
 materializeExactSequence:seq.materializeExactSequence,
 readExactSequence:seq.readExactSequence
};
const file=resolve(root,"ts/dist/test/v015-structural-aset-gamma-core-a9a.test.js");
const existing=readFileSync(file,"utf8");
for(const required of ["function gammaStructuralAset(","function activeMemberships(","main();"])
 if(!existing.includes(required))throw Error("Unexpected upstream A9 boundary");
const copy=join(dirname(file),"v015-structural-aset-gamma-core-a9a.cascade-only.js");
writeFileSync(copy,existing+"\nexport { gammaStructuralAset, aset, activeMemberships };\n");
const {gammaStructuralAset,aset,activeMemberships}=await import(pathToFileURL(copy).href);

function runOneObservedCharacter(ruleWeight,{cyclic=false}={}) {
 // Previously available prefix "мам" is *not* a selected active rule fact.
 // The new t4 observation is a distinct occurrence and causes one new active context.
 const f=makeRewriteFixture({left:"м",right:"а"});
 const {g}=f;
 g.atom("event:role","new-character-event");
 g.atom("occurrence:t4","а");
 g.atom("compressed:role","compressed-sequence");
 g.atom("theory:opaque","theory");
 g.atom("context:opaque","context");
 g.atom("K:observation","K");
 const arrival=g.makeDerived("event:role","occurrence:t4");
 const raw=f.root;
 const savedPrefix=g.makeDerived(g.makeDerived("atom:X","atom:Y"),"atom:X");
 assert.equal(decodeSequence(g,savedPrefix),"мам");
 assert.equal(decodeSequence(g,raw),"мама");
 const generic=extractSingleImageRewrite(g,f.rule,"nil");
 const candidate=g.makeDerived(g.makeDerived("atom:X","atom:Y"),
  g.makeDerived("atom:X","atom:Y"));
 const recognized=g.makeDerived("compressed:role",candidate);
 const spec=[
  {name:"observation-to-raw",vars:[],lhs:arrival,outputs:[raw]},
  {name:"rewrite-implication",vars:generic.variables,lhs:generic.lhs,outputs:[generic.rhs]},
  {name:"recognized-structure",vars:[],lhs:candidate,outputs:[recognized]}
 ];
 if(cyclic)spec.push({name:"reverse-to-observation",vars:[],
  lhs:recognized,outputs:[arrival]});
 // Testing metadata interpretation only. The original empirical occurrence
 // count stays 1 for both weights; the accepted Γ sees *selected structures*.
 g.get(f.rule).weight=ruleWeight;
 const originalJson=serializeObjectTree(g);
 const loaded=importObjectTree(originalJson);
 const graph=new LinkGraph(loaded.rows);
 const memory=new Memory(),basis=ensureRootBasis(memory);
 const registry=createNativeRegistry(memory,basis,api,loaded.rows);
 const restored=readNativeRegistry(memory,basis,api,registry);
 assert.equal(compareRowsExactly(restored,loaded.rows),true);
 assert.equal(serializeObjectTree(restored),originalJson);
 const get=id=>{
  const handle=registry.ids.get(id);
  if(!handle)throw Error("Unmapped source ID "+id);
  return handle;
 };
 // Selected semantic subset only: refuse cycles and duplicate native pole-ids.
 const cache=new Map(),reverse=new Map(),visiting=new Set();
 function project(id){
  if(cache.has(id))return cache.get(id);
  if(visiting.has(id))throw Error("cyclic native projection "+id);
  visiting.add(id);
  const r=graph.get(id),handle=r.from_id===null?get(id):
   memory.ensure(project(r.from_id),project(r.to_id));
  visiting.delete(id);
  const prior=reverse.get(handle);
  if(prior!==undefined&&prior!==id)throw Error("identity collision: "+id+" / "+prior);
  reverse.set(handle,id);cache.set(id,handle);return handle;
 }
 const theory=memory.ensure(get("theory:opaque"),get("context:opaque"));
 const environment=memory.ensure(basis.C,theory);
 const admissions=spec.map(r=>{
  const vars=r.vars.map(project);
  const antecedent=project(r.lhs);
  const outputHandles=r.outputs.map(project);
  const dictionary=struct.defineStructuralRoleDictionary(memory,vars);
  const image=seq.materializeExactSequence(memory,outputHandles);
  const rule=struct.defineStructuralRule(memory,dictionary,memory.ensure(antecedent,image));
  const admission=struct.admitStructuralRule(memory,theory,rule);
  return {...r,admission};
 });
 // M0 before any selected occurrence: all rules exist but no trigger.
 const baseline=aset([environment,...admissions.map(x=>x.admission)]);
 const silent=gammaStructuralAset(memory,baseline);
 assert.equal(silent.rawRuleMatches,0);
 assert.equal(silent.quiescent,true);
 // Append one truly new externally observed occurrence to selected state.
 const K=project("K:observation");
 const firstTruth=memory.ensure(K,project(arrival));
 const context=defineContext(memory,environment,firstTruth);
 const selected=memory.ensure(environment,context);
 const newMembers=new Set(baseline.members);
 for(const link of [firstTruth,context,selected])newMembers.add(link);
 let state=aset(newMembers);
 assert.equal(activeMemberships(memory,state).length,1);
 const observations=new Map([["t4",{text:"а",source:"external-symbol"}]]);
 const seenEventCount=observations.size;
 const endpointTrace=[],waveStats=[];
 const maxRounds=cyclic?8:4;
 for(let i=0;i<maxRounds;i++){
  const active=activeMemberships(memory,state);
  const items=active.map(x=>memory.poles(x.truth).end);
  assert.equal(items.length,1);
  endpointTrace.push(items[0]);
  const response=gammaStructuralAset(memory,state);
  waveStats.push({matches:response.rawRuleMatches,
   zero:response.zero,positive:response.positive,
   noMatch:response.noMatch,quiescent:response.quiescent});
  state=response.after;
  if(response.quiescent)break;
 }
 // Exactly three distinct rule firings; the next reaction is quiescent.
 if(!cyclic) {
  assert.deepEqual(waveStats.map(x=>x.matches),[1,1,1,0]);
  assert.deepEqual(waveStats.map(x=>x.positive),[1,1,1,0]);
  assert.deepEqual(waveStats.map(x=>x.noMatch),[0,0,0,1]);
  assert.equal(endpointTrace[0],project(arrival));
  assert.equal(endpointTrace[1],project(raw));
  assert.equal(endpointTrace[2],project(candidate));
  assert.equal(endpointTrace[3],project(recognized));
  assert.equal(waveStats[3].quiescent,true);
  // old prefix is unchanged; candidate can be decoded exactly.
  const leafText=new Map([[get("atom:X"),"м"],[get("atom:Y"),"а"]]);
  function decode(h,seen=new Set()){
   if(leafText.has(h))return leafText.get(h);
   if(seen.has(h))throw Error("selected decoded cycle");
   seen.add(h);
   const p=memory.poles(h),s=decode(p.start,seen)+decode(p.end,seen);
   seen.delete(h);return s;
  }
  assert.equal(decode(project(raw)),decode(project(candidate)));
  assert.equal(decode(project(candidate)),"мама");
 }
 if(cyclic) {
  assert.deepEqual(waveStats.map(x=>x.matches),[1,1,1,1,1,1,1,1]);
  assert.equal(waveStats.some(x=>x.quiescent),false);
  assert.equal(new Set(endpointTrace).size,4);
  // This is a bounded harness test. Accepted Γ does NOT implement automatic
  // cycle discovery; the outer scheduler MUST report RESOURCE_LIMIT.
 }
 // No internally generated conclusion is new empirical observation.
 assert.equal(observations.size,seenEventCount);
 return {weight:ruleWeight,trace:endpointTrace.map(h=>
  h===project(arrival)?"arrival":h===project(raw)?"raw":
  h===project(candidate)?"compressed":"recognized"),
  waveStats,observations:seenEventCount,
  status:cyclic?"RESOURCE_LIMIT":"QUIESCENT",
  rules:admissions.length};
}
const low=runOneObservedCharacter(0);
const high=runOneObservedCharacter(1);
assert.deepEqual(low.trace,high.trace);
assert.deepEqual(low.waveStats,high.waveStats);
assert.equal(low.observations,1);
const oscillating=runOneObservedCharacter(0.5,{cyclic:true});
assert.equal(oscillating.status,"RESOURCE_LIMIT");
assert.equal(oscillating.observations,1);
console.log(JSON.stringify({
 status:"NATIVE_A9_THREE_GENERATION_OBSERVATION_CASCADE_PASS",
 trace:low.trace,weightAblation:"weight 0 vs 1 does not modify logical entailment",
 externalObservations:1,observationsAfterGeneratedOutputs:low.observations,
 opposingRules:"8-generation bounded cycle, RESOURCE_LIMIT not QUIESCENT",
 semantics:"real accepted A9 test-side Γ with selected Theory/Context snapshots",
 nativeProductionGammaApi:"NOT_EXPORTED",
 fullNativeSemanticGraph:"NOT_PROVED",
 probabilityWeightInterpretation:"UNDECIDED"
}));
