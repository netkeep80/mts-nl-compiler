import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {test} from "node:test";
import {learnObservedPairGrammar} from "../src/observed-pair-grammar-e2.mjs";
const d=(id,source)=>({id,source,
 inputSha256:createHash("sha256").update(Buffer.from(source,"utf8")).digest("hex")});
test("E2 learns repeat pairs on actual Unicode observations, roundtrip exact",()=>{
 const sources=[d("ru","мама мама мама"),d("en","ababababababab"),
  d("formula","x²→Σχ²→Σ"),d("unicode","ё е\u0308 🧪"),d("empty","")];
 const r=learnObservedPairGrammar(sources,{maxRounds:20});
 assert.equal(r.status,"E2_GREEDY_PAIR_GRAMMAR_EXACT_ROUNDTRIP_PASS");
 assert.ok(r.substitutionRounds>0);
 assert.equal(r.documents.length,sources.length);
 assert.ok(r.remainingPositions<r.initialCodepoints);
 assert.ok(r.graphRows>0);
 assert.ok(r.roundDetails.every(x=>x.actualNonOverlappingReplacements>0));
});
test("E2 stable under corpus document order and repeated run",()=>{
 const xs=[d("a","abcabcabcabc"),d("b","abacabacab")];
 const x=learnObservedPairGrammar(xs,{maxRounds:16});
 const y=learnObservedPairGrammar([...xs].reverse(),{maxRounds:16});
 assert.deepEqual(x,y);
});
test("E2 accepts budget zero as no learning and preserves originals",()=>{
 const x=learnObservedPairGrammar([d("x","aaaaaa")],{maxRounds:0});
 assert.equal(x.substitutionRounds,0);
 assert.equal(x.remainingPositions,x.initialCodepoints);
});
test("E2 refuses source corruption and invalid budgets",()=>{
 assert.throws(()=>learnObservedPairGrammar([{
  ...d("x","abcd"),source:"abcde"
 }]),/source hash mismatch/);
 assert.throws(()=>learnObservedPairGrammar([d("x","x"),d("x","y")]),/duplicate doc/);
 assert.throws(()=>learnObservedPairGrammar([d("x","x")],{minOccurrences:1}),/invalid grammar budget/);
 assert.throws(()=>learnObservedPairGrammar([d("x","x")],{maxRounds:-1}),/invalid grammar budget/);
});
import {topAdjacentCandidates,topExpandedDupletLinks,atomProfile}
 from "../src/pair-frequency-e2.mjs";
test("E2 top N distinguishes overlaps and physical Link incidence",()=>{
 const docs=[d("sample","aaaa")];
 const r=learnObservedPairGrammar(docs,{maxRounds:1,diagnosticTopN:5,diagnosticCheckpoints:[0,1]});
 const first=r.diagnostics.adjacentAtCheckpoints[0];
 assert.equal(first.top[0].preview,"aa");
 assert.equal(first.top[0].adjacentOccurrences,3);
 assert.equal(first.top[0].nonOverlappingReplacements,2);
 assert.equal(first.top[0].overlappingDiscarded,1);
 assert.equal(first.top[0].byDocument[0].document,"sample");
 assert.ok(r.diagnostics.topStructuralLinks.top.length>0);
});
test("E2 true expanded DAG frequency is not count of stored rows",()=>{
 const docs=[d("one","ababab"),d("two","ab")];
 const r=learnObservedPairGrammar(docs,{maxRounds:3,diagnosticTopN:10,
  diagnosticCheckpoints:[0,1,2,3]});
 const top=r.diagnostics.topStructuralLinks.top;
 assert.ok(top.some(x=>x.expandedOccurrences>=2));
 assert.ok(top.every(x=>x.byDocument.reduce((a,y)=>a+y.occurrences,0)===
  x.expandedOccurrences));
});
test("E2 diagnostics deterministic and reject excessive topN",()=>{
 const docs=[d("a","мама мама"),d("b","ababab")];
 const a=learnObservedPairGrammar(docs,{maxRounds:2,
  diagnosticTopN:4,diagnosticCheckpoints:[0,2]});
 const b=learnObservedPairGrammar([...docs].reverse(),{maxRounds:2,
  diagnosticTopN:4,diagnosticCheckpoints:[0,2]});
 assert.deepEqual(a.diagnostics,b.diagnostics);
 assert.throws(()=>learnObservedPairGrammar(docs,{diagnosticTopN:51}),/diagnostic/);
});
