// This integration test is deliberately launched ONLY in pinned upstream CI.
// It imports actual accepted anum_docs source built at the exact selected SHA.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { LinkGraph } from "../experiments/inference-v0.mjs";
import { importObjectTree } from "../experiments/object-tree-json-v0.mjs";
import { bridgeTransportToCell,readCellSequence }
  from "../experiments/native-exact-sequence-bridge-v0.mjs";

const dir=process.env.UPSTREAM_MTS_PATH;
if(!dir)throw new Error("NATIVE_UPSTREAM_BOUNDARY_NOT_EXECUTED: UPSTREAM_MTS_PATH missing");
const importFrom=async relative=>import(pathToFileURL(resolve(dir,relative)).href);
const [{Memory,ensureRootBasis},{materializeExactSequence,readExactSequence}]=await Promise.all([
 importFrom("ts/dist/src/memory.js"),
 importFrom("ts/dist/src/exact-sequence.js")
]);
const fixture=readFileSync(new URL("../experiments/fixtures/mama-object-tree.json",import.meta.url),"utf8");
const restored=importObjectTree(fixture);
const g=new LinkGraph(restored.rows);
g.atom("R","ROOT"); // experimental ID representation of the chosen root; not native identity
const seq=restored.sequences.text;
const local=bridgeTransportToCell(g,{
 root:seq.root,terminator:seq.terminator,semanticRoot:"R"
});
assert.deepEqual(local.values,["m","a","m","a"]);
const upstream=new Memory();
const basis=ensureRootBasis(upstream);
// A tested *opaque* value-ID mapping for the two symbols; not a claim
// that the graph-label "м" has canonical native encoding basis.O.
const nativeValues=local.values.map(id=>id==="m"?basis.O:id==="a"?basis.C:
 (()=>{throw new Error("unmapped native value");})());
const final=materializeExactSequence(upstream,nativeValues);
const read=readExactSequence(upstream,final);
assert.equal(read.values.length,local.values.length);
for(let i=0;i<read.values.length;i++){
 assert.equal(read.values[i],nativeValues[i]);
 const cell=read.cells[i],prev=i===0?upstream.root:read.cells[i-1];
 const poles=upstream.poles(cell);
 assert.equal(poles.start,cell);
 const payload=upstream.poles(poles.end);
 assert.equal(payload.start,prev);
 assert.equal(payload.end,nativeValues[i]);
 const syntheticCell=g.get(local.cells[i]);
 const syntheticPayload=g.get(syntheticCell.to_id);
 assert.equal(syntheticCell.from_id,syntheticCell.link_id);
 assert.equal(syntheticPayload.from_id,i===0?"R":local.cells[i-1]);
 assert.equal(syntheticPayload.to_id,local.values[i]);
}
assert.equal(materializeExactSequence(upstream,nativeValues),final);
assert.equal(materializeExactSequence(upstream,[]),upstream.root);
const singleton=materializeExactSequence(upstream,[upstream.root]);
assert.notEqual(singleton,upstream.root);
assert.deepEqual(readExactSequence(upstream,singleton).values,[upstream.root]);
const transportBack=readCellSequence(g,"R",local.cellFinal).values;
assert.deepEqual(transportBack,local.values);

// A bounded, explicit conversion of sequence *positions* in our transport
// to ACCEPTED native JSON (which intentionally uses arrays). The mapping of
// 'm'/'a' to basis.O/C is supplied by this test, never guessed from characters.
const {
 materializeNativeSyntaxGrammar
}=await importFrom("ts/dist/src/native-syntax-grammar.js");
const {
 materializeV015SourceAnetProfile,denoteV015ResolvedSourceAnet
}=await importFrom("ts/dist/src/v015-source-anet.js");
const {
 compileV015DirectJsonSourceAnet
}=await importFrom("ts/dist/src/v015-direct-json-source.js");
const converted=local.values.map(id=>{
 if(id==="m")return "O";
 if(id==="a")return "C";
 throw new Error("explicit FORMAL value mapping missing");
});
const nativeJson=JSON.stringify({
 O:"♂∞",C:"∞♀",
 SelectedSequence:converted,
 EmptySequence:[],
 RootAsPosition:["R"]
});
const nativeCompilerMemory=new Memory();
const b=ensureRootBasis(nativeCompilerMemory);
let cursor=nativeCompilerMemory.ensure(b.U,b.L);
const fresh=()=>{
 cursor=nativeCompilerMemory.ensureStartSelfClosed(cursor);return cursor;
};
const profile=Object.freeze({
 blockForm:fresh(),bareForm:fresh(),bindingForm:fresh(),bundleForm:fresh(),
 itemRole:fresh(),bareValueRole:fresh(),bindingNameRole:fresh(),
 bindingValueRole:fresh(),bundleAnchorRole:fresh(),bundleBodyRole:fresh()
});
const rules=[
 {form:profile.blockForm,fields:[
  {role:profile.itemRole,target:"child",min:0,max:null}
 ]},
 {form:profile.bareForm,fields:[
  {role:profile.bareValueRole,target:"carrier",min:1,max:1}
 ]},
 {form:profile.bindingForm,fields:[
  {role:profile.bindingNameRole,target:"carrier",min:1,max:1},
  {role:profile.bindingValueRole,target:"carrier",min:1,max:1}
 ]},
 {form:profile.bundleForm,fields:[
  {role:profile.bundleAnchorRole,target:"carrier",min:1,max:1},
  {role:profile.bundleBodyRole,target:"child",min:1,max:1}
 ]}
];
const grammarRoot=materializeNativeSyntaxGrammar(nativeCompilerMemory,b,{
 syntaxTag:fresh(),markerSeed:fresh(),rules
});
const sourceProfile=materializeV015SourceAnetProfile(nativeCompilerMemory,profile);
const lowered=compileV015DirectJsonSourceAnet(nativeCompilerMemory,b,grammarRoot,
 sourceProfile,new TextEncoder().encode(nativeJson));
const semantic=denoteV015ResolvedSourceAnet(nativeCompilerMemory,b,grammarRoot,
 sourceProfile,lowered.sourceAset);
const expectedSelected=materializeExactSequence(nativeCompilerMemory,
 [b.O,b.C,b.O,b.C]);
const expectedRootPosition=materializeExactSequence(nativeCompilerMemory,[b.R]);
const values=new Set(semantic.bindings.map(x=>x.value));
assert.equal(values.has(expectedSelected),true,
 "native metacompiler did not denote the mapped object-tree sequence");
assert.equal(values.has(b.R),true,"empty native ExactSequence must denote R");
assert.equal(values.has(expectedRootPosition),true,
 "singleton [R] must remain nonempty");
console.log(JSON.stringify({
 status:"NATIVE_FORMAL_JSON_SEQUENCE_BRIDGE_PASS",
 scope:"explicit O/C basis mapping; selected sequence, empty, root-position",
 actualCompiler:"compileV015DirectJsonSourceAnet + denoteV015ResolvedSourceAnet",
 upstreamPinned:"c64b7e21340c6add248c8f380f3fef1292616ac6",
 totalObjectTreeGraphEquivalence:"NOT_PROVED",
 arbitraryStringAtomMapping:"NOT_PROVED",
 wholeRuleSetGammaReplay:"NOT_EXECUTED"
}));

console.log(JSON.stringify({
 status:"NATIVE_CELL_SHAPE_DIFFERENTIAL_PASS",
 scope:"structural sequence shape + opaque position identity + root-as-value",
 upstreamPinned:"c64b7e21340c6add248c8f380f3fef1292616ac6",
 semanticMetacompilerInterchange:"NOT_TESTED",
 nativeSourceJsonTransportEquivalence:"NOT_TESTED"
}));
