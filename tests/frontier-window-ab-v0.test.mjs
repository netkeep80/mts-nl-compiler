import test from 'node:test';
import assert from 'node:assert/strict';
import {trainFrontierWindow,compareFrontierWindows}
  from '../src/frontier-window-ab-v0.mjs';

const input=(id,text)=>({id,bytes:Buffer.from(text,'utf8')});
const corpus=()=>Array.from({length:60},(_,i)=>{
  // Deliberately no lexical hints; repeated symbols and Unicode scalars only.
  const motif='◊🙂qp₀⌁';
  const text=(motif+'Ω'+motif+'λ').repeat(7)+(i%5===4?'🦊':'⟐');
  return input('synthetic-'+i,text);
});
test('all three bounded trailing fronts independently cold-replay 60 exact UTF-8 sources',()=>{
  const docs=corpus();
  const bytes=docs.reduce((n,x)=>n+x.bytes.length,0);
  const out=compareFrontierWindows(docs,{books:60,sourceBytes:bytes,insertedLinks:1000},{
    maxCodepointsPerBook:200,maxSelectedPhrases:60});
  assert.equal(out.status,'ALL_WINDOWS_60_BOOK_EXACT_REPLAY_PASS');
  assert.deepEqual(out.variants.map(x=>x.grammar.catalanPerWindow),[5,14,42]);
  for(const [i,v] of out.variants.entries()){
    const w=i+4;
    assert.equal(v.window,w);
    assert.equal(v.status,'EXACT_60_BOOK_NUMERIC_SQLITE_REPLAY_PASS');
    assert.ok(v.grammar.trailingWindows>0);
    assert.ok(v.grammar.uniqueWindowParses>0);
    assert.equal(v.grammar.candidateBinaryTreesEvaluated,
      v.grammar.uniqueWindowParses*v.grammar.catalanPerWindow);
    assert.ok(v.numericGraph.physicalLinks>0);
    assert.equal(v.coverage.train.codepoints>0,true);
    assert.equal(v.coverage.heldout.codepoints>0,true);
    assert.ok(Object.keys(v.grammar.selectedLengthHistogram).every(x=>+x<=w));
  }
});
test('heldout never enters frequency census, winning parses or numeric dictionary',()=>{
  const docs=corpus(),heldout=docs.map((d,i)=>i%5===4?
    input(d.id,'🧿'.repeat(91)):d);
  for(const window of [4,5,6]){
    const a=trainFrontierWindow(docs.filter((_,i)=>i%5!==4),{window});
    const b=trainFrontierWindow(heldout.filter((_,i)=>i%5!==4),{window});
    assert.deepEqual(a.topSelected,b.topSelected);
    assert.equal(a.uniqueWindowParses,b.uniqueWindowParses);
    assert.equal(a.candidateBinaryTreesEvaluated,b.candidateBinaryTreesEvaluated);
  }
});
test('invalid training input and invalid windows fail closed',()=>{
  const docs=[input('x','abcdefghijklmnop')];
  assert.throws(()=>trainFrontierWindow(docs,{window:7}),/invalid training/);
  assert.throws(()=>trainFrontierWindow([docs[0],docs[0]]),/invalid document/);
  assert.throws(()=>trainFrontierWindow([input('bad','a')],{
    window:4,maxCodepointsPerBook:3}),/invalid training/);
});
test('selected phrase roots can be wider than pairs and never exceed selected frontier',()=>{
  const docs=Array.from({length:12},(_,i)=>input('d'+i,'XY🙂₀XY🙂₀XY🙂₀'.repeat(10)));
  for(const window of [4,5,6]){
    const g=trainFrontierWindow(docs,{window,minOccurrences:3});
    assert.ok(g.rules.length>0);
    assert.ok(g.rules.every(x=>x.length>=2&&x.length<=window));
    assert.ok(g.rules.some(x=>x.length===window));
    assert.equal(g.catalanPerWindow,[null,null,null,null,5,14,42][window]);
  }
});
