import assert from "node:assert/strict";
import { test } from "node:test";
import { LinkGraph } from "../experiments/inference-v0.mjs";
import { makeRewriteFixture,evaluateRewrite } from "../experiments/compression-implication-v0.mjs";
import { importObjectTree,serializeObjectTree,parseStrictJson }
  from "../experiments/object-tree-json-v0.mjs";
import { readTransportSequence,materializeCellSequence,readCellSequence,
  bridgeTransportToCell } from "../experiments/native-exact-sequence-bridge-v0.mjs";

function build(values) {
 const g=new LinkGraph();
 for(const [id,label] of [["R","ROOT"],["nil","NIL"],["m","м"],["a","а"],["t","т"]])
  g.atom(id,label);
 const first=g.makeList(values,"nil");
 return {g,first};
}
test("empty transport null -> semantic root R, and [R] is NOT empty",()=>{
 const a=build([]);
 const j=serializeObjectTree(a.g,{sequences:{empty:{root:a.first,terminator:"nil"}}});
 const json=JSON.parse(j);
 assert.equal(json.$sequences.empty.$tree,null);
 const empty=bridgeTransportToCell(a.g,{
  root:a.first,terminator:"nil",semanticRoot:"R"});
 assert.equal(empty.cellFinal,"R");
 assert.deepEqual(empty.values,[]);
 const b=build(["R"]);
 const nonempty=bridgeTransportToCell(b.g,{
  root:b.first,terminator:"nil",semanticRoot:"R"});
 assert.notEqual(nonempty.cellFinal,"R");
 assert.deepEqual(readCellSequence(b.g,"R",nonempty.cellFinal).values,["R"]);
 assert.equal(b.g.get(nonempty.cellFinal).from_id,nonempty.cellFinal);
});
test("link-identity order and repeated values preserved by self-closed cell bridge",()=>{
 for(const values of [["m","a","m","a"],["a","a"],["R","a","R"],["m","R","t"]]) {
  const f=build(values);
  const result=bridgeTransportToCell(f.g,{root:f.first,
   terminator:"nil",semanticRoot:"R"});
  assert.deepEqual(readCellSequence(f.g,"R",result.cellFinal).values,values);
  assert.deepEqual(result.values,values);
  assert.equal(result.cells.length,values.length);
 }
});
test("JSON export/import/replay preserves native-shaped cells in single link graph",()=>{
 const f=build(["m","a","m","a"]);
 const c=bridgeTransportToCell(f.g,{root:f.first,
  terminator:"nil",semanticRoot:"R"});
 const json=serializeObjectTree(f.g,{sequences:{
  text:{root:f.first,terminator:"nil"}}});
 const imported=importObjectTree(json);
 const restored=new LinkGraph(imported.rows);
 const again=readCellSequence(restored,"R",c.cellFinal);
 assert.deepEqual(again.values,["m","a","m","a"]);
 assert.equal(restored.get(c.cellFinal).from_id,c.cellFinal);
 assert.equal(serializeObjectTree(restored,{sequences:imported.sequences}),json);
});
test("unselected arbitrary Link rules survive object-tree export and still infer",()=>{
 for(const args of [{left:"м",right:"а"},{left:"RE",right:"ST"}]) {
  const f=makeRewriteFixture(args);
  const original=evaluateRewrite(f.g,f.root);
  const json=serializeObjectTree(f.g);
  const imported=importObjectTree(json);
  const g2=new LinkGraph(imported.rows);
  const replay=evaluateRewrite(g2,f.root);
  assert.equal(replay.status,"QUIESCENT");
  assert.equal(replay.complete,true);
  assert.deepEqual(replay.candidates.map(x=>x.decoded),
   original.candidates.map(x=>x.decoded));
  assert.deepEqual(replay.candidates.map(x=>x.bindings),
   original.candidates.map(x=>x.bindings));
  assert.equal(replay.candidates[0].exactBytes,true);
  assert.equal(replay.candidates[0].rule,original.candidates[0].rule);
  assert.equal(replay.candidates[0].provenance,
   original.candidates[0].provenance);
 }
});
test("native accepted FORMAL JSON bare-entry null and arrays are not this transport",()=>{
 // Accepted anum_docs/formal/v0.15/regression/grounded-zero-role.json uses
 // GroundImage:["GroundOutput"] and "Theory->GroundRule":null.
 assert.throws(()=>parseStrictJson(
  '{"V0":{},"GroundImage":["GroundOutput"],"Theory->GroundRule":null}'
 ),/only objects, strings and null/);
 assert.throws(()=>importObjectTree(
  '{"$format":"mts-nl/anet-object-tree/v1","$links":{"A":null},"$sequences":{}}'
 ),/null only at sequence end/);
 // No canonical source/formula claim is made by the transport adapter.
});
test("malformed self-cell, malformed payload, and cyclic cell predecessor fail closed",()=>{
 const {g}=build([]);
 g.pair("wrong","m","a");
 assert.throws(()=>readCellSequence(g,"R","wrong"),/not a self-closed Cell/);
 g.pair("bad","bad","m");
 assert.throws(()=>readCellSequence(g,"R","bad"),/not a pair payload/);
 const payload=g.makeDerived("cycle","m");
 g.pair("cycle","cycle",payload);
 assert.throws(()=>readCellSequence(g,"R","cycle"),/cyclic self-closed cell chain/);
});
test("resource caps and unresolved transport root must not produce false success",()=>{
 const f=build(["m","a"]);
 assert.throws(()=>readTransportSequence(f.g,f.first,"nil",{maxCells:1}),
  /RESOURCE_LIMIT transport/);
 assert.throws(()=>bridgeTransportToCell(f.g,{
  root:f.first,terminator:"nil",semanticRoot:"R",maxCells:1}),
  /RESOURCE_LIMIT/);
 assert.throws(()=>readTransportSequence(f.g,"unknown","nil"),/Unknown Link/);
 const final=materializeCellSequence(f.g,"R",["m","a"]);
 assert.throws(()=>readCellSequence(f.g,"R",final,{maxCells:1}),/RESOURCE_LIMIT/);
});
