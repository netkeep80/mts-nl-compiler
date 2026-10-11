import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {codePoints,makeTree,encodeShared,decodeShared,minimumUniquePairs} from "../src/dag.mjs";
const corpus=JSON.parse(readFileSync(new URL("../corpus/pilot.json",import.meta.url),"utf8"));
test("мама: 3 left pairs vs 2 hash-consed balanced pairs",()=>{
 const a=encodeShared(makeTree(codePoints("мама"),"left"));
 const b=encodeShared(makeTree(codePoints("мама"),"balanced"));
 assert.equal(a.links.size,3);assert.equal(b.links.size,2);
 assert.equal(decodeShared(a),"мама");assert.equal(decodeShared(b),"мама");
 assert.deepEqual(minimumUniquePairs("мама"),{minimum:2,alternatives:5});
});
test("lossless pilot across five genres, mixed Unicode and formulas",()=>{
 assert.equal(corpus.length,40);
 for(const row of corpus) {
  const g=encodeShared(makeTree(codePoints(row.text)));
  assert.equal(decodeShared(g),row.text,row.id);
 }
});
test("syntactic contrasts remain structurally distinguishable",()=>{
 for(const [a,b] of [["A→B","B→A"],["a+b*c","(a+b)*c"],["a","а"],["API","Api"],["ё","е\u0308"]])
  assert.notEqual(encodeShared(makeTree(codePoints(a))).root,
    encodeShared(makeTree(codePoints(b))).root);
});
test("exhaustive oracle announces its bound",()=>{
 assert.throws(()=>minimumUniquePairs("0123456789"),RangeError);
});
