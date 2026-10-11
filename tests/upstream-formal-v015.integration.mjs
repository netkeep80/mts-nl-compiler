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
console.log(JSON.stringify({
 status:"NATIVE_CELL_SHAPE_DIFFERENTIAL_PASS",
 scope:"structural sequence shape + opaque position identity + root-as-value",
 upstreamPinned:"c64b7e21340c6add248c8f380f3fef1292616ac6",
 semanticMetacompilerInterchange:"NOT_TESTED",
 nativeSourceJsonTransportEquivalence:"NOT_TESTED"
}));
