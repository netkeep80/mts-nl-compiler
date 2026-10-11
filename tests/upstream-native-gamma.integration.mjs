// #28: REAL pinned v0.15 A9 test-side Γ on an imported compression rule.
// This does not expose a native production API or assert FULL source ANet parity.
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

const upstream=process.env.UPSTREAM_MTS_PATH;
if(!upstream)throw Error("UPSTREAM_MTS_PATH required");
const root=resolve(upstream);
const moduleAt=async name=>import(pathToFileURL(resolve(root,"ts/dist/src/"+name+".js")).href);
const [{Memory,ensureRootBasis},strings,exact,rules,{defineContext,readContext}]=await Promise.all([
 moduleAt("memory"),moduleAt("v012-string-anum"),moduleAt("exact-sequence"),
 moduleAt("structural-rule"),moduleAt("state")
]);
const api={
 materializeV012StringAnum:strings.materializeV012StringAnum,
 readV012StringAnum:strings.readV012StringAnum,
 materializeExactSequence:exact.materializeExactSequence,
 readExactSequence:exact.readExactSequence
};

// Export only the exact existing upstream test-side function in an ephemeral copy.
// Calling this imports upstream's original main() assertions as well.
const location=resolve(root,"ts/dist/test/v015-structural-aset-gamma-core-a9a.test.js");
const original=readFileSync(location,"utf8");
for(const t of ["function gammaStructuralAset(","function planStructuralAset(","main();"])
 if(!original.includes(t))throw Error("upstream test source changed: "+t);
const temporary=join(dirname(location),"v015-structural-aset-gamma-core-a9a.bridge-only.js");
writeFileSync(temporary,original+"\nexport { gammaStructuralAset, aset, activeMemberships };\n");
const {gammaStructuralAset,aset,activeMemberships}=await import(pathToFileURL(temporary).href);

const fixture=makeRewriteFixture({left:"м",right:"а"});
for(const id of ["native:Kpos","native:Kzero","native:Knone","native:ZERO","native:NO_MATCH"])
 fixture.g.atom(id,id);
const source=serializeObjectTree(fixture.g);
const restored=importObjectTree(source);
const g=new LinkGraph(restored.rows);
const memory=new Memory(),basis=ensureRootBasis(memory);
const registry=createNativeRegistry(memory,basis,api,restored.rows);
const replay=readNativeRegistry(memory,basis,api,registry);
assert.equal(compareRowsExactly(restored.rows,replay),true);
assert.equal(serializeObjectTree(replay),source);
const lookup=id=>{
 const anchor=registry.ids.get(id);
 if(anchor===undefined)throw Error("source row unregistered: "+id);
 return anchor;
};

// Declared *selected subset* projection: acyclic and unique-pole ONLY.
// This is not a semantic mapping of all arbitrary cyclic or parallel source IDs.
const projected=new Map(),reverse=new Map(),visiting=new Set();
function project(id){
 if(projected.has(id))return projected.get(id);
 if(visiting.has(id))throw Error("selected semantic cycle: "+id);
 const row=g.get(id);
 visiting.add(id);
 const value=row.from_id===null?lookup(id):
  memory.ensure(project(row.from_id),project(row.to_id));
 visiting.delete(id);
 const prior=reverse.get(value);
 if(prior!==undefined&&prior!==id)throw Error("semantic pair collision "+prior+" / "+id);
 projected.set(id,value);reverse.set(value,id);
 return value;
}
const shape=extractSingleImageRewrite(g,fixture.rule,"nil");
assert.equal(shape.variables.length,2);
const roles=shape.variables.map(project);
const lhs=project(shape.lhs),rhs=project(shape.rhs);
const theory=memory.ensure(lookup("theory"),lookup("context"));
const environment=memory.ensure(basis.C,theory);
const dictionary=rules.defineStructuralRoleDictionary(memory,roles);
const rule=rules.defineStructuralRule(memory,dictionary,
 memory.ensure(lhs,exact.materializeExactSequence(memory,[rhs])));
const zeroDictionary=rules.defineStructuralRoleDictionary(memory,[]);
const zeroRule=rules.defineStructuralRule(memory,zeroDictionary,
 memory.ensure(project("native:ZERO"),exact.materializeExactSequence(memory,[])));
const shadowRule=rules.defineStructuralRule(memory,zeroDictionary,
 memory.ensure(project("native:NO_MATCH"),
  exact.materializeExactSequence(memory,[project("native:ZERO")])));
const admission=rules.admitStructuralRule(memory,theory,rule);
const zeroAdmission=rules.admitStructuralRule(memory,theory,zeroRule);
const shadowAdmission=rules.admitStructuralRule(memory,theory,shadowRule);
const items=[
 {K:project("native:Kpos"),endpoint:project(fixture.root)},
 {K:project("native:Kzero"),endpoint:project("native:ZERO")},
 {K:project("native:Knone"),endpoint:project("native:NO_MATCH")}
];
const slots=items.map(v=>{
 const truth=memory.ensure(v.K,v.endpoint);
 const context=defineContext(memory,environment,truth);
 const edge=memory.ensure(environment,context);
 return {...v,truth,context,edge};
});
const before=aset([environment,admission,zeroAdmission,
 ...slots.flatMap(s=>[s.truth,s.context,s.edge])]);
assert.equal(activeMemberships(memory,before).length,3);
assert.equal(before.members.has(shadowAdmission),false);
const first=gammaStructuralAset(memory,before);
assert.deepEqual([first.rawRuleMatches,first.transitioned,first.noMatch,first.zero,
 first.positive,first.createdChildren,first.createdClosures],[2,2,1,1,1,1,1]);
assert.equal(first.after.members.has(slots[0].edge),false);
assert.equal(first.after.members.has(slots[1].edge),false);
assert.equal(first.after.members.has(slots[2].edge),true);
assert.equal(first.after.members.has(slots[0].context),true);
assert.equal(first.after.members.has(slots[0].truth),true);
assert.equal(first.after.members.has(memory.ensureEndSelfClosed(slots[1].context)),true);
const x=lookup("atom:X"),y=lookup("atom:Y");
const repeated=memory.ensure(memory.ensure(x,y),memory.ensure(x,y));
const nextTruth=memory.ensure(slots[0].K,repeated);
assert.equal(first.after.members.has(nextTruth),true);
const children=[...first.after.members].filter(h=>{
 try{const state=readContext(memory,h);
  return state.parent===slots[0].context&&state.current===nextTruth;
 }catch{return false;}
});
assert.equal(children.length,1);
assert.equal(first.after.members.has(memory.ensure(environment,children[0])),true);
const atomText=new Map([[x,g.get("atom:X").string],[y,g.get("atom:Y").string]]);
function decodeProjected(h,stack=new Set()){
 if(atomText.has(h))return atomText.get(h);
 if(stack.has(h))throw Error("cyclic selected sequence projection");
 stack.add(h);
 const p=memory.poles(h),value=decodeProjected(p.start,stack)+decodeProjected(p.end,stack);
 stack.delete(h);
 return value;
}
assert.equal(decodeProjected(items[0].endpoint),decodeSequence(g,fixture.root));
assert.equal(decodeProjected(repeated),decodeSequence(g,fixture.root));
const second=gammaStructuralAset(memory,first.after);
assert.equal(second.rawRuleMatches,0);
assert.equal(second.quiescent,true);
assert.equal(second.after.members.has(shadowAdmission),false);
assert.equal(second.after.members.has(slots[2].edge),true);
console.log(JSON.stringify({
 status:"NATIVE_A9_TEST_GAMMA_IMPORTED_REWRITE_PASS",
 source:"selected compression Link-rule from object-tree JSON and native registry",
 decoded:decodeProjected(repeated),
 first:[first.rawRuleMatches,first.noMatch,first.zero,first.positive],
 nextQuiescent:second.quiescent,
 semantics:"accepted test-side A9 S1/S2 and atomic membership reaction",
 nativeProductionGammaApi:"NOT_EXPORTED",
 fullGraphSemanticParity:"NOT_PROVED"
}));
