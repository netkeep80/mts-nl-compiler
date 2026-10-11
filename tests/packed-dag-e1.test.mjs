import assert from "node:assert/strict";
import {test} from "node:test";
import {compileTextExact,unionCompiledGraphs} from "../src/real-corpus-e0.mjs";
import {encodePackedGraph,decodePackedGraph} from "../src/packed-dag-e1.mjs";
const inputs=["мама мама","ёж е\u0308ж 🧪","a\0b\r\nnext","χ² ∑(x)→0",""];
function fixture(){
 const compiled=inputs.map((s,i)=>compileTextExact(Buffer.from(s),{id:"doc-"+i}));
 const rows=unionCompiledGraphs(compiled);
 const docs=compiled.map(x=>({id:x.metrics.id,rootLink:x.graph.root,
  inputSha256:x.metrics.inputSha256}));
 return {compiled,rows,docs};
}
test("E1 packed transport preserves Unicode and all five documents byte-for-byte",()=>{
 const {compiled,rows,docs}=fixture();
 const packed=encodePackedGraph(rows,docs);
 const restored=decodePackedGraph(packed);
 assert.deepEqual(restored.documents.map(x=>x.id),docs.map(x=>x.id));
 for(let i=0;i<docs.length;i++)
  assert.ok(restored.documents[i].bytes.equals(Buffer.from(inputs[i])));
 assert.deepEqual(new Map(restored.rows.map(x=>[x.link_id,x])),
  new Map(rows.map(x=>[x.link_id,x])));
 assert.ok(encodePackedGraph(restored.rows,restored.documents).equals(packed));
 assert.ok(packed.length<Buffer.byteLength(JSON.stringify(rows)));
 assert.equal(compiled.length,5);
});
test("E1 data order does not influence deterministic byte encoding",()=>{
 const {rows,docs}=fixture();
 assert.ok(encodePackedGraph(rows,docs).equals(
  encodePackedGraph([...rows].reverse(),[...docs].reverse())));
});
test("E1 source constraints: refuse parallel duplicate-pole IDs, cycles, weights",()=>{
 const {rows,docs}=fixture();
 assert.throws(()=>encodePackedGraph([...rows,{...rows[0],link_id:"anything"}],docs),
  /noncanonical|duplicate/);
 assert.throws(()=>encodePackedGraph(rows.map((r,i)=>i===0?{...r,weight:0}:r),docs),
  /weight not represented/);
 assert.throws(()=>encodePackedGraph([...rows,{link_id:"p:"+("a".repeat(64)),from_id:"missing",
  to_id:"missing",string:null,weight:null}],docs),/noncanonical/);
});
test("E1 decoder rejects tampering, truncation, unsupported types, limits",()=>{
 const {rows,docs}=fixture();
 const encoded=encodePackedGraph(rows,docs);
 assert.throws(()=>decodePackedGraph(encoded.subarray(0,encoded.length-2)),/truncated/);
 assert.throws(()=>decodePackedGraph(Buffer.concat([encoded,Buffer.from([0])])),/trailing bytes/);
 assert.throws(()=>decodePackedGraph(Buffer.concat([Buffer.from("WRONG!!!"),encoded.subarray(8)])),/magic/);
 assert.throws(()=>decodePackedGraph(encoded,{maxNodes:1}),/RESOURCE_LIMIT/);
 const copy=Buffer.from(encoded);copy[copy.length-1]^=1;
 assert.throws(()=>decodePackedGraph(copy),/SHA mismatch/);
});
