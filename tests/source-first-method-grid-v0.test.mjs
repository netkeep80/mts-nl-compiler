import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourceContextProposals,splitByBoundaries,materializeMethods,compareMethodGrid} from '../src/source-first-method-grid-v0.mjs';
import {shapeSplitIndex,buildShapedCorpus,compareShapedGrid} from '../src/source-first-tree-shapes-v0.mjs';
import {verifyShapedNumericCorpus} from '../src/source-first-tree-shapes-sqlite-v0.mjs';
const d=(id,text)=>({id,bytes:Buffer.from(text,'utf8')});
const docs=()=>[
 d('1','ж◇луг◇ж◇луг◇ж◇луг◇'),d('2','луг◇ж◇луг◇ж◇луг◇'),
 d('3','ж◇луг◇ж◇луг◇ж◇'),d('4','луг◇ж◇луг◇ж◇луг◇'),
 d('5','ж◇луг◇ж◇луг◇ж◇')
];
test('W12 independent context frequencies count source codepoints and not learned grammar links',()=>{
 const q=sourceContextProposals(docs(),{maxProposals:6,minFrequency:1});
 assert.equal(q.observations,docs().reduce((n,x)=>n+[...x.bytes.toString('utf8')].length,0));
 assert.ok(q.proposed.some(x=>x.scalar==='◇'));
 assert.ok(q.proposed.every(x=>Number.isFinite(x.predictorScore)));
});
test('W12 context source before/after delimiters reconstruct exact scalar stream',()=>{
 for(const boundaries of [[],[{scalar:'◇',side:'before'}],[{scalar:'◇',side:'after'}],
  [{scalar:'◇',side:'before'},{scalar:'◇',side:'after'}]]){
  const text='🚀◇ж\r\n◇ж\u0308';
  assert.equal(splitByBoundaries(text,boundaries).join(''),text);
 }
 assert.deepEqual(splitByBoundaries('',[]),['']);
});
test('W12 greedy learns no more boundaries when training Link count cannot improve',()=>{
 const r=compareMethodGrid(docs(),{maxScalarsPerDocument:200,maxProposals:6,maxRounds:2,minFrequency:2});
 assert.equal(r.status,'EXACT_REPLAY_ALL_PASS');
 assert.equal(r.corpus.train,4);assert.equal(r.corpus.heldout,1);
 assert.ok(r.rows.every(x=>x.exactReplay&&x.uniqueRoots===5));
 const b=r.rows.find(x=>x.method==='balanced'),g=r.rows.find(x=>x.method==='greedyBidirectional');
 assert.ok(g.trainPhysicalLinks<=b.trainPhysicalLinks);
 assert.deepEqual(r.rows.map(x=>x.method).sort(),['balanced','bestAfter','bestBefore','bestSingle',
  'entropyOnly','frequencyOnly','greedyAfter','greedyBidirectional'].sort());
});
test('W12 fixed training boundary is invariant to heldout source substitution',()=>{
 const original=docs(),changed=original.map((x,i)=>i===4?d('5','🍀🍀🍀🍀'):x);
 const train=a=>sourceContextProposals(a.filter((_,i)=>i%5!==4),{maxProposals:6,minFrequency:2});
 assert.deepEqual(train(original),train(changed));
});
test('W12 structural tree split ranking uses only raw source frequencies and has bounded topology',()=>{
 const cp=[...'мама'];
 const counts=new Map([['ма',10],['ам',1]]);
 for(const shape of ['balanced','leftComb','rightComb','prefix2','suffix3','frequencyQuadratic']){
  const k=shapeSplitIndex(cp,0,cp.length,shape,counts);
  assert.ok(k>=1&&k<=cp.length-1);
 }
 assert.equal(shapeSplitIndex(cp,0,4,'balanced'),2);
 assert.equal(shapeSplitIndex(cp,0,4,'leftComb'),3);
 assert.equal(shapeSplitIndex(cp,0,4,'rightComb'),1);
 assert.throws(()=>shapeSplitIndex(cp,0,4,'nonsense'),/invalid/);
});
test('W12 source train ngrams/trees are Unicode exact incl BOM CRLF emoji',()=>{
 const cases=[d('a','\ufeffа 🚀\r\n🚀'),d('b','\ufeffа 🚀\r\n🚀')];
 const boundary=[{scalar:' ',side:'after'}];
 const result=buildShapedCorpus(cases,boundary,'frequencyQuadratic');
 assert.equal(result.graph.roots.length,2);
 assert.equal(result.graph.expand(result.graph.roots[0]),cases[0].bytes.toString('utf8'));
 assert.equal(result.physicalLinks,result.reachableLinks);
});
test('W12 full ablation frozen train grammar and cold physical SQLite exactly match in-memory',()=>{
 const a=docs(),boundary=[{scalar:'◇',side:'after'}];
 const scan=compareShapedGrid(a,boundary,{maxScalarsPerDocument:200,shapes:['balanced','frequencyGreedy','frequencyQuadratic','leftComb']});
 assert.equal(scan.books,5);
 for(const variant of scan.rankingByTotal){
  const sql=verifyShapedNumericCorpus(a,boundary,variant.shape,{maxScalarsPerDocument:200});
  assert.equal(sql.status,'SQLITE_COLD_EXACT_PASS');
  assert.equal(sql.physicalLinks,variant.allPhysicalLinks);
  assert.equal(sql.rootReachableLinks,sql.physicalLinks);
  assert.ok(sql.vacuumBytes>0);
 }
});