import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {
  exactUnicodeTokens,prepareLinkDefinitionPack,interpretLink,interpretFlat,
  runS0Case,runS0Corpus,digestObject
} from '../src/w19-semantic-s0.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/w19-s0-requirements-v0.json',import.meta.url),'utf8'));
const pack=JSON.parse(readFileSync(new URL('./fixtures/w19-s0-definitions-v0.json',import.meta.url),'utf8'));
const byId=id=>fixture.examples.find(x=>x.id===id);
const core=r=>({status:r.status,candidates:r.candidates.map(x=>x.relation)});
const sorted=x=>JSON.stringify(x,Object.keys(x).sort());

test('W19-S0 fixture is 28 provisional cases with exact UTF-8 annotation spans',()=>{
  assert.equal(fixture.examples.length,28);
  assert.equal(fixture.status,'SYNTHETIC_PROVISIONAL_NOT_INDEPENDENT_GOLD');
  assert.equal(fixture.metricPolicy.semanticPrecisionRecallAccuracy,'NOT_SCORED_UNTIL_INDEPENDENT_GOLD');
  const ids=new Set();
  for(const e of fixture.examples){
    assert.ok(!ids.has(e.id));ids.add(e.id);
    assert.equal(e.provisional.review,'PROVISIONAL_AI_AUTHORED_NOT_INDEPENDENT_GOLD');
    assert.equal(e.provenance.independentHumanReview,'NOT_PERFORMED');
    const bytes=Buffer.from(e.text,'utf8');
    for(const span of Object.values(e.provisional.spans)){
      assert.equal(bytes.subarray(span.startUtf8,span.endUtf8).toString('utf8'),span.surface,e.id);
    }
  }
});

test('W19-S0 engine contains no Cyrillic grammar or lexical shortcuts',()=>{
  const source=readFileSync(new URL('../src/w19-semantic-s0.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/[А-Яа-яЁё]/u);
  for(const forbidden of ['должна','каждый','сохранить','подпись','банк','ключ'])
    assert.ok(!source.includes(forbidden));
});

test('Mode A structure only never invents semantic candidates',()=>{
  const out=runS0Corpus(fixture.examples,pack);
  assert.equal(out.metrics.modeA.proposed,0);
  assert.equal(out.metrics.modeA.unknown,28);
  assert.equal(out.metrics.exactReplayFailures,0);
  for(const c of out.cases){
    assert.equal(c.A.left.status,'UNKNOWN');
    assert.deepEqual(c.A.left.semanticCandidates,[]);
    assert.equal(c.A.left.observed.replayStatus,'EXACT_UNICODE_REPLAY_PASS');
  }
});

test('Mode B Link definitions equal flat-template baseline and provisional fixture expectations',()=>{
  const out=runS0Corpus(fixture.examples,pack);
  assert.equal(out.metrics.linkVsFlatDisagreements,0);
  assert.equal(out.metrics.binaryizationDisagreements,0);
  assert.equal(out.metrics.semanticAccuracy,'NOT_SCORED_NO_INDEPENDENT_GOLD');
  assert.equal(out.metrics.probabilityMetrics,'NOT_DEFINED');
  for(const c of out.cases){
    const e=byId(c.id);
    assert.equal(c.B.link.status,e.provisional.status,c.id);
    if(e.provisional.status==='PROPOSED'){
      assert.equal(c.B.link.candidates.length,1,c.id);
      assert.deepEqual(c.B.link.candidates[0].relation,e.provisional.relation,c.id);
    }
  }
});

test('controlled C ablations remove grounds or expose contextual ambiguity honestly',()=>{
  const out=runS0Corpus(fixture.examples,pack);
  for(const c of out.cases){
    const e=byId(c.id);
    assert.equal(c.C.link.status,e.control.expectedStatus,c.id);
    assert.ok(!c.C.link.candidates.some(x=>x.status==='VERIFIED'));
  }
  assert.equal(out.cases.find(x=>x.id==='S16').C.link.status,'AMBIGUOUS');
  assert.equal(out.cases.find(x=>x.id==='S18').C.link.status,'PROPOSED');
});

test('negation, quantifier scope, temporal direction and if/only-if remain distinct',()=>{
  const out=runS0Corpus(fixture.examples,pack),get=id=>out.cases.find(x=>x.id===id).B.link.candidates[0].relation;
  assert.notDeepEqual(get('S01'),get('S02'));
  assert.equal(get('S02').negationScope,'MODAL_ACTION');
  assert.equal(get('S06').negationScope,'QUANTIFIER');
  assert.equal(get('S07').negationScope,'MODALITY');
  assert.equal(get('S08').temporal,'AFTER');
  assert.equal(get('S09').temporal,'BEFORE');
  assert.equal(get('S10').relation,'CONDITION_SUFFICIENT_FOR_ACTION');
  assert.equal(get('S11').relation,'ACTION_REQUIRES_CONDITION');
});

test('same exact string can resolve differently by explicit context and abstains without it',()=>{
  const prepared=prepareLinkDefinitionPack(pack);
  const s16=interpretLink(byId('S16').text,{contextId:'security',prepared});
  const s17=interpretLink(byId('S17').text,{contextId:'database',prepared});
  const s18=interpretLink(byId('S18').text,{contextId:null,prepared});
  assert.equal(byId('S16').text,byId('S17').text);
  assert.notDeepEqual(core(s16),core(s17));
  assert.equal(s16.candidates[0].relation.object,'CRYPTO_KEY');
  assert.equal(s17.candidates[0].relation.object,'DATABASE_KEY');
  assert.equal(s18.status,'AMBIGUOUS');
  assert.deepEqual(s18.candidates.map(x=>x.relation.object).sort(),['CRYPTO_KEY','DATABASE_KEY']);
});

test('rare/unknown constructions stay UNKNOWN rather than partial semantic hallucinations',()=>{
  const out=runS0Corpus(fixture.examples,pack);
  for(const id of ['S22','S23','S24','S25','S26','S27','S28']){
    const c=out.cases.find(x=>x.id===id);
    assert.equal(c.B.link.status,'UNKNOWN',id);
    assert.deepEqual(c.B.link.candidates,[],id);
  }
});

test('different ExactSequence binaryizations do not alter interpretation',()=>{
  const prepared=prepareLinkDefinitionPack(pack);
  for(const e of fixture.examples){
    const left=interpretLink(e.text,{contextId:e.contextId??null,prepared,shape:'left'});
    const balanced=interpretLink(e.text,{contextId:e.contextId??null,prepared,shape:'balanced'});
    assert.deepEqual(core(left),core(balanced),e.id);
    assert.equal(left.replayStatus,'EXACT_UNICODE_REPLAY_PASS');
    assert.equal(balanced.replayStatus,'EXACT_UNICODE_REPLAY_PASS');
  }
});

test('Link-definition graph replay is deterministic and preserves definition data exactly',()=>{
  const a=prepareLinkDefinitionPack(pack),b=prepareLinkDefinitionPack(pack);
  assert.deepEqual(a.pack,pack);
  assert.deepEqual(a.graphStats,b.graphStats);
  assert.deepEqual(a.definitionRoots,b.definitionRoots);
  assert.equal(digestObject(a.pack),digestObject(pack));
});

test('provisional annotation is not an input to the semantic engine',()=>{
  const e=byId('S01');
  const original=runS0Case(e,pack);
  const poisoned={...e,provisional:{status:'VERIFIED',relation:{relation:'FAKE'},spans:{},review:'FAKE'}};
  const altered=runS0Case(poisoned,pack);
  assert.deepEqual(core(original.B.link),core(altered.B.link));
  assert.deepEqual(core(original.C.link),core(altered.C.link));
});

test('token spans are exact observations, not semantic truth or probability',()=>{
  const tokens=exactUnicodeTokens('Если подпись действительна, документ принимается.');
  assert.deepEqual(tokens.map(x=>x.surface),['Если','подпись','действительна',',','документ','принимается','.']);
  assert.ok(tokens.every(x=>Number.isSafeInteger(x.startUtf8)&&x.endUtf8>x.startUtf8));
  const out=runS0Corpus(fixture.examples,pack);
  assert.equal(out.metrics.probabilityMetrics,'NOT_DEFINED');
  assert.ok(!JSON.stringify(out).includes('"probability"'));
});


test('W19-S0 machine protocol is deterministic, complete and explicitly not gold accuracy',()=>{
  const script=fileURLToPath(new URL('../scripts/w19_semantic_s0.mjs',import.meta.url));
  const run=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:20000});
  assert.equal(run.status,0,run.stderr);
  const line=run.stdout.split('\n').find(x=>x.startsWith('W19S0_REPORT '));
  assert.ok(line,'missing W19S0_REPORT');
  const report=JSON.parse(line.slice('W19S0_REPORT '.length));
  assert.equal(report.status,'RESEARCH_REPLAY_COMPLETE');
  assert.equal(report.cases.length,28);
  assert.deepEqual(report.metrics.modeA,{proposed:0,unknown:28});
  assert.deepEqual(report.metrics.modeB,{proposed:19,ambiguous:2,unknown:7});
  assert.deepEqual(report.metrics.modeC,{proposed:2,ambiguous:4,unknown:22});
  assert.equal(report.metrics.linkVsFlatDisagreements,0);
  assert.equal(report.metrics.binaryizationDisagreements,0);
  assert.equal(report.metrics.exactReplayFailures,0);
  assert.deepEqual(report.metrics.provisionalDiagnosticMismatches,[]);
  assert.equal(report.annotationPolicy.independentGold,false);
  assert.equal(report.annotationPolicy.engineReceivesProvisionalAnnotation,false);
  assert.equal(report.annotationPolicy.accuracyMetrics,'NOT_SCORED_NO_INDEPENDENT_GOLD');
  for(const value of Object.values(report.sourceDigests))assert.match(value,/^[0-9a-f]{64}$/);
  console.log('W19S0_SUMMARY '+JSON.stringify({
    corpusSha256:report.sourceDigests.corpusSha256,
    definitionPackSha256:report.sourceDigests.definitionPackSha256,
    engineSha256:report.sourceDigests.engineSha256,
    modeA:report.metrics.modeA,modeB:report.metrics.modeB,modeC:report.metrics.modeC,
    linkVsFlatDisagreements:report.metrics.linkVsFlatDisagreements,
    binaryizationDisagreements:report.metrics.binaryizationDisagreements,
    goldAccuracy:report.annotationPolicy.accuracyMetrics
  }));
});
