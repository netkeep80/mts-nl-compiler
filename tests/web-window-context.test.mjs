import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inspectContextualWindow,inspectLocalWindow} from '../docs/compiler/window-oracle.mjs';

test('W22-B: locally unique-optimal grouping is provably worse with fixed outside context',()=>{
 const source='абаабабб',offset=3,width=4;
 const local=inspectLocalWindow(source,{width,offset});
 const contextual=inspectContextualWindow(source,{width,offset});
 assert.equal(local.windowText,'абаб');
 assert.equal(local.minimumUniquePairs,2);
 assert.equal(contextual.treeCount,5);
 assert.equal(contextual.minimumWholePairs,5);
 assert.equal(contextual.bestContextCostAmongLocalOptima,6);
 assert.equal(contextual.avoidableByConsideringContext,1);
 assert.equal(contextual.bestCandidates[0].uniqueWholePairs,5);
 assert.ok(contextual.bestCandidates[0].localPairs>local.minimumUniquePairs,
  'context-aware global optimum deliberately rejects local optimum');
 assert.ok(contextual.globalOptimumTies>=1);
 assert.equal(contextual.limits.physicalSQLiteCost,false);
});
test('W22-B: whole-input and local metrics agree only when the window covers all source',()=>{
 for(const source of ['мама','аааааааа','abcdefgh','🧪🧪🧪🧪']){
  const width=[...source].length;
  const local=inspectLocalWindow(source,{width,offset:0});
  const contextual=inspectContextualWindow(source,{width,offset:0});
  assert.equal(contextual.minimumWholePairs,local.minimumUniquePairs);
  assert.equal(contextual.bestContextCostAmongLocalOptima,local.minimumUniquePairs);
  assert.equal(contextual.avoidableByConsideringContext,0);
  assert.equal(contextual.balanced.uniqueWholePairs,local.balanced.uniquePairs);
  assert.equal(contextual.left.uniqueWholePairs,local.left.uniquePairs);
  assert.equal(contextual.bestCandidates[0].sharedWithOutside,0);
 }
});
test('W22-B: every enumerated contextual tree reconstructs exact Unicode',()=>{
 const samples=['мама мыла раму','абабббб','🧪🧪🌷\n🧪🧪','a\u0301a\u0301a\u0301a\u0301','ш ш ш ш'];
 for(const source of samples){
  const n=[...source].length,width=Math.min(6,n);
  for(let offset=0;offset<=n-width;offset++){
   const result=inspectContextualWindow(source,{width,offset,topN:20});
   assert.equal(result.treeCount,width===6?42:width===5?14:width===4?5:width===3?2:1);
   assert.ok(result.minimumWholePairs<=result.balanced.uniqueWholePairs);
   assert.ok(result.minimumWholePairs<=result.left.uniqueWholePairs);
   assert.ok(result.avoidableByConsideringContext>=0);
   assert.ok(result.bestCandidates.every(x=>x.uniqueWholePairs>=result.minimumWholePairs));
   assert.ok(result.bestCandidates.every(x=>x.reusedWholePairOccurrences===n-1-x.uniqueWholePairs));
  }
 }
});
test('W22-B: fixed context, positions and ranked outcomes are deterministic',()=>{
 const source='абаабабб';
 const a=inspectContextualWindow(source,{width:4,offset:3,topN:5});
 const b=inspectContextualWindow(source,{width:4,offset:3,topN:5});
 assert.deepEqual(a,b);
 assert.equal(a.windowText,'абаб');
 assert.equal(a.sourceScalars,8);
 assert.equal(a.limits.outsideGrouping,'balanced outside window, fixed left-associative attachment (prefix⟼window)⟼suffix');
 assert.ok(a.bestCandidates.every((x,i,arr)=>i===0||arr[i-1].uniqueWholePairs<=x.uniqueWholePairs));
});
test('W22-B: source and Unicode resource limits fail closed',()=>{
 assert.throws(()=>inspectContextualWindow('x'.repeat(129),{width:8}),/128 Unicode/);
 assert.equal(inspectContextualWindow('🧪'.repeat(128),{width:8}).treeCount,429);
 assert.throws(()=>inspectContextualWindow('\uD800abcdefg',{width:8}),/unpaired/);
 assert.throws(()=>inspectContextualWindow('abc',{width:8}),/shorter/);
 assert.throws(()=>inspectContextualWindow('abcdefgh',{width:8,offset:1}),/offset/);
});
