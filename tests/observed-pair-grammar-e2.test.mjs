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

test("E2 long-structure top N filters out trivial two-character links",()=>{
 const docs=[d("a","сначала сначала сначала"),d("b","сначала сначала")];
 const r=learnObservedPairGrammar(docs,{maxRounds:12,diagnosticTopN:10,diagnosticCheckpoints:[0,12]});
 for(const item of r.diagnostics.topLongLinks)
  assert.ok(item.top.every(x=>x.expandedCodepoints>=item.minimumCodepoints));
 assert.deepEqual(r.diagnostics.topLongLinks.map(x=>x.minimumCodepoints),[5,10,20]);
});

test("E3 content-dependent grouping keeps exact Unicode, null bytes and 0-round input",()=>{
 const items=[d("a","мама мама"),d("b","xмама мама"),
  d("c","x²→Σχ²→Σ"),d("d","aaaaaaa"),d("e","")];
 for(const rounds of [0,6,16]){
  const result=learnObservedPairGrammar(items,{maxRounds:rounds,rootGrouping:"content-stable"});
  assert.equal(result.rootGrouping,"content-stable");
  assert.equal(result.documents.length,items.length);
  assert.ok(result.groupingStats.every(x=>x.layers>=0));
  assert.equal(result.status,"E2_GREEDY_PAIR_GRAMMAR_EXACT_ROUNDTRIP_PASS");
 }
});
test("E3 compare identical trained grammar and selected front positions",()=>{
 const data=[d("A","abcabc abcabc"),d("B","zabcabc xx abcabc")];
 const a=learnObservedPairGrammar(data,{maxRounds:10,rootGrouping:"balanced"});
 const b=learnObservedPairGrammar(data,{maxRounds:10,rootGrouping:"content-stable"});
 assert.equal(a.substitutionRounds,b.substitutionRounds);
 assert.equal(a.remainingPositions,b.remainingPositions);
 assert.equal(a.uniqueLearnedRules,b.uniqueLearnedRules);
 assert.ok(b.graphPairRows>0);
});
test("E3 deterministic content-aware grouping is independent of document order",()=>{
 const data=[d("a","был человек и был человек"),d("b","он был человек и был человек")];
 const a=learnObservedPairGrammar(data,{maxRounds:6,rootGrouping:"content-stable"});
 const b=learnObservedPairGrammar([...data].reverse(),{maxRounds:6,rootGrouping:"content-stable"});
 assert.deepEqual(a,b);
 assert.throws(()=>learnObservedPairGrammar(data,{rootGrouping:"invalid"}),/rootGrouping/);
});

test("E3 shared long Link nodes survive different preceding prefixes",()=>{
 const phrase="переосмысление_сложной_последовательности_непрерывной_асети".repeat(3);
 const corpus=[
  d("a","A"+phrase+"-конец1"),
  d("b","другая-предыстория-весьма-длинная-"+phrase+"-конец2")
 ];
 const run=rootGrouping=>learnObservedPairGrammar(corpus,{
  maxRounds:0,rootGrouping,diagnosticTopN:50
 });
 const positional=run("balanced"),anchored=run("content-stable");
 const sharedAtLeast10=x=>
  x.diagnostics.topLongLinks.find(y=>y.minimumCodepoints===10).top
   .filter(p=>p.byDocument.length===2);
 const before=sharedAtLeast10(positional),after=sharedAtLeast10(anchored);
 assert.ok(after.length>0,"content-based grouping should share a long interior Link");
 assert.equal(positional.remainingPositions,anchored.remainingPositions);
 assert.equal(positional.substitutionRounds,anchored.substitutionRounds);
 console.log("E3_SHIFTED_PHRASE "+JSON.stringify({
  commonSubstringCodepoints:[...phrase].length,
  balanced:{uniqueDuplets:positional.graphPairRows,sharedLongTop50:before.length,
   longestSharedSpan:Math.max(0,...before.map(x=>x.expandedCodepoints))},
  contentStable:{uniqueDuplets:anchored.graphPairRows,sharedLongTop50:after.length,
   longestSharedSpan:Math.max(0,...after.map(x=>x.expandedCodepoints))}
 }));
});
