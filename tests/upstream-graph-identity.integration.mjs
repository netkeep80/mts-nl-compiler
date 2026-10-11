// Runs ONLY with real pinned accepted anum_docs v0.15 as a separate CI step.
// This tests an explicit metadata registry, NOT native semantic Link identity.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {LinkGraph} from "../experiments/inference-v0.mjs";
import {makeRewriteFixture,evaluateRewrite} from "../experiments/compression-implication-v0.mjs";
import {serializeObjectTree,importObjectTree}
 from "../experiments/object-tree-json-v0.mjs";
import {createNativeRegistry,readNativeRegistry,compareRowsExactly}
 from "../experiments/native-graph-registry-v0.mjs";

const dir=process.env.UPSTREAM_MTS_PATH;
if(!dir)throw new Error("PINNED_UPSTREAM_NOT_AVAILABLE");
const moduleAt=async name=>import(pathToFileURL(resolve(dir,
 "ts/dist/src/"+name+".js")).href);
const [{Memory,ensureRootBasis},strings,sequences]=await Promise.all([
 moduleAt("memory"),moduleAt("v012-string-anum"),moduleAt("exact-sequence")
]);
const api={materializeV012StringAnum:strings.materializeV012StringAnum,
 readV012StringAnum:strings.readV012StringAnum,
 materializeExactSequence:sequences.materializeExactSequence,
 readExactSequence:sequences.readExactSequence};
const newMemory=()=>{const memory=new Memory();
 return {memory,basis:ensureRootBasis(memory)};};
const fixture=readFileSync(new URL("../experiments/fixtures/mama-object-tree.json",import.meta.url),"utf8");
const loaded=importObjectTree(fixture);
{
 const {memory,basis}=newMemory();
 const reg=createNativeRegistry(memory,basis,api,loaded.rows);
 const recovered=readNativeRegistry(memory,basis,api,reg);
 assert.equal(compareRowsExactly(loaded.rows,recovered),true);
 assert.equal(serializeObjectTree(recovered,{sequences:loaded.sequences}),fixture);
 assert.equal(reg.ids.get("ma")!==reg.ids.get("mama"),true);
 assert.equal(reg.ids.size,loaded.rows.length);
}
const g=new LinkGraph();
const rows=[
 ["первый","мама"],["второй","мама"],["форма1","ё"],
 ["форма2","е\u0308"],["текст","REST API α→β ∀x (x² + 1)"],
 ["пустая",""],["ничего","nil"],["Ид:🧪","🌌"]
];
for(const [id,s] of rows)g.atom(id,s);
g.pair("parallel:1","первый","второй");
g.pair("parallel:2","первый","второй");
g.pair("parallel:weighted","первый","второй",0);
g.pair("parallel:one","первый","второй",1);
g.pair("shared","parallel:1","parallel:1");
g.pair("self","self","форма1");
g.pair("cycle:a","cycle:b","первый");
g.pair("cycle:b","cycle:a","второй");
g.atom("__proto__","__proto__");
{
 const source=serializeObjectTree(g);
 const {memory,basis}=newMemory();
 const reg=createNativeRegistry(memory,basis,api,importObjectTree(source).rows);
 const recovered=readNativeRegistry(memory,basis,api,reg);
 assert.equal(compareRowsExactly(recovered,[...g.nodes.values()]),true);
 assert.equal(serializeObjectTree(recovered),source);
 assert.notEqual(reg.ids.get("parallel:1"),reg.ids.get("parallel:2"));
 assert.notEqual(reg.ids.get("первый"),reg.ids.get("второй"));
 assert.notEqual(reg.ids.get("форма1"),reg.ids.get("форма2"));
 assert.equal(recovered.find(x=>x.link_id==="self").from_id,"self");
 assert.equal(recovered.find(x=>x.link_id==="parallel:weighted").weight,0);
 assert.equal(recovered.find(x=>x.link_id==="parallel:1").weight,null);
 // Native registry reuses exact same handles when exported twice.
 const total=memory.linkCount;
 const again=createNativeRegistry(memory,basis,api,[...recovered].reverse());
 assert.equal(total,memory.linkCount);
 assert.equal(again.registryRoot,reg.registryRoot);
 assert.equal(again.ids.get("self"),reg.ids.get("self"));

 // Malformed metadata: two incompatible from-edges are never silently chosen.
 memory.ensure(reg.ids.get("parallel:1"),
   memory.ensure(reg.role.from,reg.ids.get("форма1")));
 assert.throws(()=>readNativeRegistry(memory,basis,api,reg),/duplicate role edge/);
}
{
 const f=makeRewriteFixture({left:"RE",right:"ST"});
 const original=serializeObjectTree(f.g);
 const baseline=evaluateRewrite(f.g,f.root);
 const {memory,basis}=newMemory();
 const reg=createNativeRegistry(memory,basis,api,importObjectTree(original).rows);
 const physicalRows=readNativeRegistry(memory,basis,api,reg);
 const replay=new LinkGraph(importObjectTree(serializeObjectTree(physicalRows)).rows);
 const outcome=evaluateRewrite(replay,f.root);
 assert.equal(serializeObjectTree(physicalRows),original);
 assert.equal(outcome.status,"QUIESCENT");
 assert.deepEqual(outcome.candidates.map(x=>x.decoded),
  baseline.candidates.map(x=>x.decoded));
 assert.deepEqual(outcome.candidates.map(x=>x.bindings),
  baseline.candidates.map(x=>x.bindings));
 assert.equal(outcome.candidates[0].exactBytes,true);
 // This local Γ replay is NOT upstream native execution of this rewrite rule.
}
{
 const {memory,basis}=newMemory();
 const reg=createNativeRegistry(memory,basis,api,loaded.rows);
 assert.throws(()=>readNativeRegistry(memory,basis,api,{...reg,maxRows:0}),
  /RESOURCE_LIMIT row count/); // intentionally invalid use corrected below
}

{
 // TEST actual v0.15 generalized structural S1/S2 using arbitrary string
 // identities decoded from our object-tree JSON through native registry.
 const {unifyStructuralRuleTemplate}=await moduleAt("structural-unification");
 const {instantiateV013StructuralTemplate}=await moduleAt("v013-structural-execution");
 const rules=await moduleAt("structural-rule");
 const g=new LinkGraph();
 for(const id of ["P","Q","a","b","x"])g.atom(id,id);
 g.pair("template:premise","P","x");
 g.pair("template:image","Q","x");
 g.pair("fact:P(a)","P","a");
 g.pair("fact:Q(a)","Q","a");
 const json=serializeObjectTree(g);
 const {memory,basis}=newMemory();
 const reg=createNativeRegistry(memory,basis,api,importObjectTree(json).rows);
 const mapped=readNativeRegistry(memory,basis,api,reg);
 assert.equal(serializeObjectTree(mapped),json);
 const p=id=>reg.ids.get(id);
 const dictionary=rules.defineStructuralRoleDictionary(memory,[p("x")]);
 assert.deepEqual(rules.readStructuralRoleDictionary(memory,dictionary).roles,
  [p("x")]);
 const premise=memory.ensure(p("P"),p("x"));
 const image=memory.ensure(p("Q"),p("x"));
 const images=sequences.materializeExactSequence(memory,[image]);
 const body=memory.ensure(premise,images);
 const rule=rules.defineStructuralRule(memory,dictionary,body);
 const theory=memory.ensureStartSelfClosed(memory.ensure(basis.U,basis.O));
 const membership=rules.admitStructuralRule(memory,theory,rule);
 rules.verifyStructuralRuleAdmission(memory,theory,rule,membership);
 const active=memory.ensure(p("P"),p("a"));
 const bindings=unifyStructuralRuleTemplate(memory,premise,active,[p("x")]);
 assert.equal(bindings.length,1);
 assert.equal(bindings[0].role,p("x"));
 assert.equal(bindings[0].value,p("a"));
 const result=instantiateV013StructuralTemplate(memory,image,bindings);
 assert.equal(result,memory.ensure(p("Q"),p("a")));
 assert.notEqual(result,memory.ensure(p("Q"),p("b")));
 const selectedOutputs=sequences.readExactSequence(memory,memory.poles(body).end);
 assert.equal(selectedOutputs.values.length,1);
 assert.equal(selectedOutputs.values[0],image);
 assert.throws(()=>unifyStructuralRuleTemplate(memory,premise,
  memory.ensure(p("Q"),p("a")),[p("x")]),/template-mismatch/);
 assert.throws(()=>rules.verifyStructuralRuleAdmission(memory,theory,rule,
  memory.ensure(p("P"),p("a"))),/rule-not-admitted/);
 console.log(JSON.stringify({
  status:"NATIVE_STRUCTURAL_S1_S2_ON_IMPORTED_IDENTITIES_PASS",
  source:"accepted structural-rule, structural-unification and v013 structural execution",
  inputMappings:["P","Q","a","b","x"],boundVariable:"x",
  proofScope:"selected rule / single-antecedent match+construct, not complete Γ",
  fullNativeGamma:"NOT_EXECUTED"
 }));
}

console.log(JSON.stringify({
 status:"NATIVE_UTF8_GRAPH_REGISTRY_ROUNDTRIP_PASS",
 source:"actual pinned MTS Memory + native StringAnum + native ExactSequence",
 scopes:["arbitrary UTF-8 labels","parallel identities","cycles",
  "null-vs-zero weight","empty-string label","local Γ replay from registry"],
 nativeSemanticLinkIdentity:"NOT_PROVED",
 nativeSourceAnetParity:"NOT_EXECUTED",
 nativeGammaRuleReplay:"NOT_EXECUTED"
}));
