import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {trainContextPredictor,corpusDigest,ContextLinkGraph,scalars} from '../src/w19-capability-b0.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/w19-capability-pairs-v0.json',import.meta.url),'utf8'));
const create=(representation)=>trainContextPredictor(fixture.train,{representation,order:3,alpha:0.5});

test('W19 B0: raw/left/balanced Link context models predict exactly same train-source frequencies',()=>{
 const raw=create('raw'),left=create('link-left'),balanced=create('link-balanced');
 assert.equal(raw.trainingDocuments,10);
 assert.equal(raw.observationEvents,fixture.train.reduce((n,s)=>n+[...s].length,0));
 assert.equal(raw.trainingDigest,left.trainingDigest);
 assert.equal(left.trainingDigest,balanced.trainingDigest);
 assert.ok(left.graph.stats.pairs>0);
 assert.ok(balanced.graph.stats.pairs>0);
 const beforeL={...left.graph.stats},beforeB={...balanced.graph.stats};
 // Test evaluation must NOT add new Link nodes or observation counts.
 assert.deepEqual(left.evaluate(fixture.heldout),raw.evaluate(fixture.heldout));
 assert.deepEqual(balanced.evaluate(fixture.heldout),raw.evaluate(fixture.heldout));
 assert.deepEqual(left.comparePairs(fixture.pairs),raw.comparePairs(fixture.pairs));
 assert.deepEqual(balanced.comparePairs(fixture.pairs),raw.comparePairs(fixture.pairs));
 assert.deepEqual(left.graph.stats,beforeL);assert.deepEqual(balanced.graph.stats,beforeB);
 const prediction=left.predict('Система дол');
 assert.ok(Math.abs(prediction.distribution.reduce((sum,x)=>sum+x.probability,0)-1)<1e-12);
 assert.deepEqual(prediction,raw.predict('Система дол'));
 assert.equal(left.graph.nodes.length,beforeL.nodes);
 assert.ok(left.evaluate(fixture.heldout).scored>0);
});
test('W19 B0: Unicode, binaryization and cold Link context decoding remain exact',()=>{
 const cases=['', 'мама 🚀', '\r\n\0', 'е\u0308≠ё', 'a+b*c', 'A⇒B'];
 for(const shape of ['left','balanced']){
  const graph=new ContextLinkGraph(shape);
  for(const c of cases){const root=graph.encode(scalars(c));assert.equal(graph.decode(root),c);}
  const before={...graph.stats};
  assert.equal(graph.encode(scalars('unseen'),{create:false}),null);
  assert.deepEqual(graph.stats,before);
 }
 assert.notEqual(corpusDigest(['ab','c']),corpusDigest(['a','bc']));
 assert.throws(()=>scalars('\ud800'),/surrogate/);
});
test('W19 B0: OOV abstains rather than treating unknown event as calibrated probability',()=>{
 const model=trainContextPredictor(['abab','abac'],{order:2,representation:'link-balanced'});
 assert.deepEqual(model.vocabulary,['a','b','c']);
 const before={...model.graph.stats};
 const result=model.evaluate(['ab🚀']);
 assert.equal(result.events,3);assert.equal(result.scored,2);assert.equal(result.abstained,1);
 assert.equal(result.coverage,2/3);
 assert.deepEqual(model.graph.stats,before);
 assert.throws(()=>model.evaluate(['ab'],{topK:8}),/topK/);
 assert.throws(()=>trainContextPredictor(['abc'],{order:9}),/order/);
 assert.throws(()=>trainContextPredictor(['abc'],{alpha:0}),/smoothing/);
 assert.throws(()=>trainContextPredictor(['\udc00']),/surrogate/);
});
test('W19 B0: unknown context backs off without training and logical contrast is never a semantic verdict',()=>{
 const m=trainContextPredictor(['ababab','acacac'],{order:4,representation:'link-left'});
 const p=m.predict('zzzz');assert.equal(p.contextLength,0);
 const before={...m.graph.stats};
 const scored=m.comparePairs([{id:'logic',goldKind:'logic-not-statistics',
   reference:'abab',alternative:'acac'}]);
 assert.equal(scored[0].status,'STATISTICAL_ONLY');
 assert.equal(typeof scored[0].deltaBitsPerScalar,'number');
 assert.ok(!Object.hasOwn(scored[0],'isLogicalError'));
 assert.deepEqual(m.graph.stats,before);
});
test('W19 B0: standalone report deterministic, labels unreviewed, distinct source and heldout',()=>{
 const command=fileURLToPath(new URL('../scripts/w19_capability_b0.mjs',import.meta.url));
 const one=spawnSync(process.execPath,[command],{encoding:'utf8',timeout:20000});
 const two=spawnSync(process.execPath,[command],{encoding:'utf8',timeout:20000});
 assert.equal(one.status,0,one.stderr);assert.equal(two.status,0,two.stderr);
 assert.equal(one.stdout,two.stdout);
 const report=JSON.parse(one.stdout);
 assert.equal(report.fixtureStatus,'SYNTHETIC_UNREVIEWED_NOT_HUMAN_GOLD');
 assert.deepEqual(report.equality,{rawVsLinkLeft:true,rawVsLinkBalanced:true});
 assert.equal(report.split.goldIndependent,false);
 assert.equal(report.split.heldoutDocuments,4);
 assert.equal(report.results[0].pairProbes.length,6);
 assert.deepEqual(report.unigramToTrigramBaselines.map(x=>x.order),[0,1,2,3]);
 assert.deepEqual(report.unigramToTrigramBaselines[3].heldout,report.results[0].heldout);
 assert.equal(report.validControlsAnomalyWarning,2);

 assert.ok(report.results.every(r=>r.heldout.scored>0));
 assert.ok(report.results[0].pairProbes.some(p=>p.goldKind==='both-valid-modal-contrast'));
 assert.ok(report.results[0].pairProbes.some(p=>p.goldKind==='rare-but-grammatically-valid'));
 console.log('W19_B0 '+JSON.stringify({fixtureSha256:report.fixtureSha256,
  observationEvents:report.results[0].observationEvents,
  heldout:report.results[0].heldout,
  pairStatuses:report.results[0].pairProbes.map(p=>({id:p.id,status:p.status,delta:p.deltaBitsPerScalar})),
  equality:report.equality,
  baselines:report.unigramToTrigramBaselines.map(x=>({order:x.order,
    bitsPerScoredScalar:x.heldout.bitsPerScoredScalar,top1Accuracy:x.heldout.top1Accuracy})),
  validControlsAnomalyWarning:report.validControlsAnomalyWarning}));
});

test('W19 B0 readable observation shows actual heldout phrases, every contrast and baseline',()=>{
 const filename=fileURLToPath(new URL('../scripts/w19_b0_readable.mjs',import.meta.url));
 const result=spawnSync(process.execPath,[filename],{encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr);
 const md=result.stdout;
 assert.equal(md,readFileSync(new URL('../docs/w19_b0_results.md',import.meta.url),'utf8'),'Published per-phrase observation must exactly match executable model output');
 for(const required of ['W19-B0 — наблюдаемые результаты','T01','T02','T03','T04','T05','T06',
  'Система должна проверять журнал.','ABSTAIN_OOV','Link контекст, сбалансированная бинаризация']){
  assert.ok(md.includes(required),'missing observable test result: '+required);
 }
 console.log('W19_B0_MARKDOWN_BEGIN\n'+md+'W19_B0_MARKDOWN_END');
});
