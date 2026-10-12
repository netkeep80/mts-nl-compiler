import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {trainProductiveSlots,trainCharBaseline,SlotLinkDAG,exactScalars}
 from '../src/w19-productive-slots-b1.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/w19-productive-b1-v0.json',import.meta.url),'utf8'));
const {roots,suffixes,trainCells,heldoutCells}=fixture.generation;
const form=([i,j])=>roots[i]+suffixes[j],train=trainCells.map(form),heldout=heldoutCells.map(form);
test('W19 B1 train-only scan finds a source-observed split and exactly the withheld cross-product',()=>{
 assert.equal(train.length,19);assert.equal(heldout.length,5);
 assert.ok(train.every(x=>!heldout.includes(x)));
 const m=trainProductiveSlots(train),initial={...m.graph.stats};
 assert.equal(m.status,'PRODUCTIVE_STRUCTURAL_HYPOTHESIS');
 assert.equal(m.split,3);assert.equal(m.prefixTypes,6);assert.equal(m.suffixTypes,4);
 assert.equal(m.supportedEvents,19);
 assert.equal(m.score,19);
 const proposals=m.propose();assert.equal(proposals.length,5);
 assert.deepEqual(new Set(proposals.map(x=>x.surface)),new Set(heldout));
 for(const x of heldout){
  const answer=m.inspect(x);
  assert.equal(answer.status,'STRUCTURAL_CANDIDATE');
  assert.equal(answer.seen,false);
  assert.ok(answer.score>0);
 }
 for(const x of train)assert.equal(m.inspect(x).seen,true);
 assert.deepEqual(m.graph.stats,initial,'heldout may not allocate Links');
});
test('W19 B1 synthetic role split is not supplied to learner; alphabet bijection keeps structure',()=>{
 const symbols=[...new Set([...train.join(''),...heldout.join('')])].sort();
 const remap=new Map(symbols.map((c,i)=>[c,String.fromCodePoint(0xE000+i)]));
 const convert=x=>[...x].map(c=>remap.get(c)).join('');
 const m=trainProductiveSlots(train),translated=trainProductiveSlots(train.map(convert));
 assert.equal(translated.split,m.split);
 assert.equal(translated.score,m.score);
 assert.deepEqual(translated.graph.stats,m.graph.stats);
 assert.deepEqual(new Set(translated.propose().map(x=>x.surface)),new Set(heldout.map(convert)));
});
test('W19 B1 no evidence returns UNKNOWN, bad Unicode refuses and links cold-decode exact text',()=>{
 assert.equal(trainProductiveSlots(['abc','def','ghi']).status,'UNKNOWN_NO_PRODUCTIVE_SLOT');
 assert.deepEqual(trainProductiveSlots(['abc','def','ghi']).propose(),[]);
 assert.throws(()=>trainProductiveSlots(['ab']),/invalid training budget/);
 assert.throws(()=>trainProductiveSlots(['a\ud800','abd']),/surrogate/);
 assert.throws(()=>trainProductiveSlots(['ab','cd'],{minDegree:1}),/budget/);
 assert.throws(()=>trainProductiveSlots(['ab','cd'],{maxSurfaceScalars:2}),/budget/);
 const graph=new SlotLinkDAG();
 for(const s of ['мама','е\u0308','ё','🚀','A⇒B','a\u0000b']){
  const root=graph.encode(s);assert.equal(graph.decode(root),s);
 }
 assert.notEqual(graph.encode('е\u0308'),graph.encode('ё'));
 assert.throws(()=>graph.decode(999999),/Link/);
});
test('W19 B1 same training cannot distinguish two worlds with opposite semantic labels',()=>{
 const a=trainProductiveSlots(train),b=trainProductiveSlots(train);
 assert.deepEqual(a.propose(),b.propose());
 for(const s of heldout){
  assert.deepEqual(a.inspect(s),b.inspect(s));
  // In world A it is licit; in world B the SAME string is forbidden.
  // No source-only algorithm has evidence distinguishing the truth labels.
 }
 assert.equal(fixture.negativeWorld.oppositeTruthLabelsForHeldout,true);
});
test('W19 B1 zero-claim n-gram baselines score heldout without modifying training',()=>{
 for(const order of [0,1,2,3]){
  const n=trainCharBaseline(train,{order});
  assert.ok(n.vocabularySize>4);
  for(const s of heldout)assert.ok(Number.isFinite(n.score(s)));
  assert.equal(n.score('🚀'),null);
 }
 assert.throws(()=>trainCharBaseline(train,{order:9}),/n-gram/);
 assert.throws(()=>trainCharBaseline(train,{alpha:0}),/n-gram/);
});
test('W19 B1 exact report deterministic and explicitly refuses semantic generalization',()=>{
 const filename=fileURLToPath(new URL('../scripts/w19_productive_b1.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[filename],{encoding:'utf8',timeout:20000});
 const replay=spawnSync(process.execPath,[filename],{encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr);
 assert.equal(replay.status,0,replay.stderr);
 assert.equal(replay.stdout,result.stdout);
 const report=JSON.parse(result.stdout);
 assert.equal(report.data.trainDocuments,19);assert.equal(report.data.heldoutDocuments,5);
 assert.equal(report.data.usesDocumentBoundaries,true);
 assert.equal(report.data.usesWordBoundaries,false);
 assert.equal(report.heldout.recovered,5);
 assert.equal(report.heldout.proposedUnknownCombinations,5);
 assert.equal(report.negativePairedWorld.identicalModelOutput,true);
 assert.equal(report.ngramBaselines.length,4);
 assert.match(report.negativePairedWorld.identifiability,/NO_SEMANTIC/);
 console.log('W19_B1 '+JSON.stringify({fixtureSha256:report.fixtureSha256,model:report.model,
   heldout:report.heldout,baseline:report.ngramBaselines.map(x=>({order:x.order,bits:x.meanLogScoreBits}))}));
});
