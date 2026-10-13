import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compressFrequencyReference} from '../src/w23-frequency-reference-v0.mjs';
import {benchmarkW23C,compressFrequencyIncremental,verifyIncrementalAgainstReference}
 from '../src/w23-incremental-pair-agenda-v0.mjs';

const doc=(id,text)=>({id,text});
const canonicalRule=r=>r&&({canonical:r.canonical,expanded:r.expanded,
 adjacentFrequency:r.adjacentFrequency,nonOverlappingReplacements:r.nonOverlappingReplacements});

test('W23-C mandatory overlap controls match full-rescan oracle at every round',()=>{
 for(const [id,text] of [['mama','мама'],['aaa','ааа'],['aaaa','аааа'],
  ['a8','аааааааа'],['ababab','абабаб'],['mixed','абаабабб']]){
  const out=verifyIncrementalAgainstReference([doc(id,text)],{maxRounds:64,minOccurrences:2});
  assert.equal(out.status,'W23_C_DIFFERENTIAL_PASS');
  assert.equal(out.incremental.replay[0],text);
 }
 const aaa=compressFrequencyIncremental([doc('aaa','ааа')],{includeTrace:true,maxRounds:8});
 assert.equal(aaa.ruleCount,0);
 assert.equal(aaa.trace[0].pairFrequencies.find(x=>x.expanded==='аа').frequency,2);
 assert.equal(aaa.trace[0].chosen,null);
 const aaaa=compressFrequencyIncremental([doc('aaaa','аааа')],{includeTrace:true,maxRounds:8});
 assert.deepEqual(canonicalRule(aaaa.rules[0]),{canonical:aaaa.rules[0].canonical,
  expanded:'аа',adjacentFrequency:3,nonOverlappingReplacements:2});
});

test('W23-C Unicode, whitespace and multi-document current-token indexes remain exact',()=>{
 const combining='e\u0301';
 const documents=[
  doc('ru','мама мыла раму, мама снова мыла раму.'),
  doc('en','the link repeats; the link repeats; the link repeats.'),
  doc('unicode',`🙂🙂 ${combining} ${combining} 👩‍💻👩‍💻`),
  doc('ws','a\tb\r\na\tb\r\n'),doc('empty','')
 ];
 const out=verifyIncrementalAgainstReference(documents,{maxRounds:64,minOccurrences:2});
 assert.deepEqual(out.incremental.replay,documents.map(x=>x.text));
 assert.equal(out.incremental.work.heapStaleEntries,0);
 assert.ok(out.incremental.work.indexAdditions>0);
 assert.ok(out.incremental.work.indexRemovals>0);
});

test('W23-C tie-break is content-stable despite unrelated token allocation',()=>{
 const a=compressFrequencyIncremental([doc('x','абвгабдг')],{maxRounds:1,minOccurrences:2});
 const b=compressFrequencyIncremental([doc('noise','я'),doc('x','абвгабдг')],{maxRounds:1,minOccurrences:2});
 assert.equal(a.rules[0].expanded,b.rules[0].expanded);
 assert.equal(a.rules[0].canonical,b.rules[0].canonical);
 verifyIncrementalAgainstReference([doc('x','абвгабдг')],{maxRounds:8,minOccurrences:2});
 verifyIncrementalAgainstReference([doc('noise','я'),doc('x','абвгабдг')],{maxRounds:8,minOccurrences:2});
});

test('W23-C deterministic randomized differential fuzz compares every frequency snapshot',()=>{
 const alphabet=[...'абвгдеж🙂XYZ\t\n'];
 for(let seed=1;seed<=24;seed++){
  let state=(seed*0x9E3779B1)>>>0;
  const docs=[];
  for(let d=0;d<1+(seed%4);d++){
   let text='';const n=8+(state%80);
   for(let i=0;i<n;i++){
    state=(1664525*state+1013904223)>>>0;text+=alphabet[state%alphabet.length];
   }
   docs.push(doc('s'+seed+'d'+d,text));
  }
  const options={maxRounds:32,minOccurrences:2+(seed%3),maxExpansionScalars:2+(seed%15)};
  const out=verifyIncrementalAgainstReference(docs,options);
  assert.equal(out.incremental.work.heapStaleEntries,0);
 }
});

test('W23-C respects bounded expansion eligibility exactly like the oracle',()=>{
 const documents=[doc('a','abcabcabcabc'),doc('b','abcabc')];
 for(const maxExpansionScalars of [2,3,4,6]){
  const out=verifyIncrementalAgainstReference(documents,
   {maxRounds:32,minOccurrences:2,maxExpansionScalars});
  assert.deepEqual(out.incremental.rules,out.reference.rules);
 }
});

test('W23-C matched benchmark reports locality and does not assert timing or memory wins',()=>{
 const alphabet=[...'абвгдеж🙂XYZ'];let state=0xC0FFEE;const documents=[];
 for(let d=0;d<12;d++){
  let text='';
  for(let i=0;i<1000;i++){
   state=(1664525*state+1013904223)>>>0;text+=alphabet[state%alphabet.length];
  }
  text+='::COMMON::'.repeat(6);documents.push(doc('p'+d,text));
 }
 const options={maxRounds:32,minOccurrences:3,maxExpansionScalars:64};
 const diff=verifyIncrementalAgainstReference(documents,options);
 assert.equal(diff.status,'W23_C_DIFFERENTIAL_PASS');
 const b=benchmarkW23C(documents,options);
 assert.equal(b.rules,diff.incremental.ruleCount);
 assert.ok(b.reference.fullScanAdjacentInspections>b.incremental.localAdjacencyWorkProxy);
 assert.ok(b.adjacencyWorkRatio<0.2);
 assert.equal(b.incremental.heapStaleEntries,0);
 assert.equal(b.timingIsEnvironmentDependent,true);
 assert.equal(b.memoryIsSampledNodeHeapNotAllocationAccounting,true);
 console.log('W23C_MATCHED_BENCHMARK '+JSON.stringify(b));
});

test('W23-B trace extension is observational and leaves default oracle result semantics intact',()=>{
 const documents=[doc('x','абабаб')],options={maxRounds:16,minOccurrences:2};
 const plain=compressFrequencyReference(documents,options);
 const traced=compressFrequencyReference(documents,{...options,includeTrace:true});
 assert.deepEqual(plain.rules,traced.rules);
 assert.deepEqual(plain.finalSequences,traced.finalSequences);
 assert.deepEqual(plain.replay,traced.replay);
 assert.ok(Array.isArray(traced.trace));
 assert.equal(Object.hasOwn(plain,'trace'),false);
});