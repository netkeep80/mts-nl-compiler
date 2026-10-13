import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runPinnedFrontPilot} from '../src/w22d0-pinned-front-pilot.mjs';

const make=(n,changeHeldout=false)=>Array.from({length:n},(_,i)=>{
 const bases=[
  'мама мыла раму. мама мыла раму. абаабабб ',
  'абаб абаб бб абаб лоло лоло русская речь ',
  'скользящий фронт и повторение дуплетов. ',
  'data structures and repeated partial tokens ',
  '🧪🙂📚🧪🙂📚 абаб абаб абаб сочетания. '
 ];
 const source=changeHeldout&&i%5===4?
  ('🔬🧬 НЕИЗВЕСТНО! '.repeat(5)):
  (bases[i%bases.length].repeat(3)+String(i));
 return {id:'synthetic-'+String(i).padStart(2,'0'),bytes:Buffer.from(source,'utf8')};
});
test('W22-D0: 60 declared books split 48/12, frozen 6/8 shape, physical heldout',()=>{
 const corpus=make(60);
 const result=runPinnedFrontPilot(corpus);
 assert.equal(result.schema,'mts-nl/w22d0-pinned-front-pilot/v0');
 assert.equal(result.status,'HELDOUT_PHYSICAL_SQLITE_EXACT_REPLAY');
 assert.equal(result.corpusCount,60);
 assert.equal(result.trainCount,48);
 assert.equal(result.heldoutCount,12);
 assert.equal(result.trainSelectionSamples,4);
 assert.deepEqual(result.widths.map(w=>w.width),[6,8]);
 assert.deepEqual(result.widths.map(w=>w.candidateCount),[42,429]);
 for(const w of result.widths){
  assert.equal(w.heldout.length,12);
  assert.equal(w.tuningSamples.length,4);
  assert.ok(w.tuningSamples.every(s=>!s.id.endsWith('04')&&!s.id.endsWith('09')));
  assert.ok(w.selectedOrdinal>=0&&w.selectedOrdinal<w.candidateCount);
  assert.ok(w.tuningTrainPhysicalPairCost<=w.balancedTrainPhysicalPairCost);
  assert.equal(w.heldoutImprovedDocs+w.heldoutRegressedDocs+w.heldoutTiedDocs,12);
  assert.equal(w.heldoutDeltaPhysicalLinks,w.heldoutTotals['train-selected'].physicalLinks-
    w.heldoutTotals.balanced.physicalLinks);
  for(const row of w.heldout){
   assert.ok(corpus.findIndex(x=>x.id===row.id)%5===4,'only holdouts in evaluation');
   assert.equal(row.sampledScalars,32);
   assert.ok(row.sampleSha256.match(/^[0-9a-f]{64}$/));
   for(const mode of ['balanced','left','train-selected']){
    assert.equal(row[mode].coldReplayStatus,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
    assert.ok(row[mode].physicalLinks>0);
    assert.ok(row[mode].sqliteVacuumBytes>0);
   }
   assert.equal(row.deltaBytesVsBalanced,row['train-selected'].sqliteVacuumBytes-
    row.balanced.sqliteVacuumBytes);
  }
 }
 console.log('W22D0_SYNTHETIC_60 '+JSON.stringify({
  train:result.trainCount,heldout:result.heldoutCount,
  widths:result.widths.map(w=>({n:w.width,candidates:w.candidateCount,
   selected:w.selectedOrdinal,deltaPhysicalLinks:w.heldoutDeltaPhysicalLinks,
   deltaSqliteBytes:w.heldoutDeltaSqliteBytes,regressed:w.heldoutRegressedDocs,
   improved:w.heldoutImprovedDocs,tied:w.heldoutTiedDocs}))
 }));
});
test('W22-D0: source-only selection provably invariant under heldout alteration',()=>{
 const first=runPinnedFrontPilot(make(10),{widthsToTest:[6]});
 const altered=runPinnedFrontPilot(make(10,true),{widthsToTest:[6]});
 assert.equal(first.trainCount,8);
 assert.equal(first.heldoutCount,2);
 assert.equal(first.widths[0].selectedOrdinal,altered.widths[0].selectedOrdinal);
 assert.equal(first.widths[0].tuningTrainPhysicalPairCost,
  altered.widths[0].tuningTrainPhysicalPairCost);
 assert.deepEqual(first.widths[0].tuningSamples,altered.widths[0].tuningSamples);
 assert.notDeepEqual(first.widths[0].heldout.map(x=>x.sampleSha256),
  altered.widths[0].heldout.map(x=>x.sampleSha256));
});
test('W22-D0: same full source, same split and shape produce deterministic measurements',()=>{
 const inputs=make(10);
 const first=runPinnedFrontPilot(inputs,{widthsToTest:[6]});
 const second=runPinnedFrontPilot(inputs,{widthsToTest:[6]});
 const normal=x=>({
  ...x,widths:x.widths.map(({tuningWallMs,heldoutWallMs,...w})=>w)
 });
 assert.deepEqual(normal(first),normal(second));
 assert.ok(first.scientificLimits.noGlobalOptimality);
 assert.ok(first.scientificLimits.noSemantics);
 assert.ok(first.scientificLimits.baselineComparability.includes('identical 32-scalar'));
});
test('W22-D0: raw books and non-decodable Unicode fail closed, parameters frozen',()=>{
 const docs=make(10);
 assert.throws(()=>runPinnedFrontPilot(docs.slice(0,9)),/10..60/);
 assert.throws(()=>runPinnedFrontPilot(docs,{offset:10}),/preregistered/);
 assert.throws(()=>runPinnedFrontPilot(docs,{sampleScalars:16}),/preregistered/);
 assert.throws(()=>runPinnedFrontPilot(docs,{widthsToTest:[7]}),/preregistered/);
 assert.throws(()=>runPinnedFrontPilot(docs,{widthsToTest:[6,6]}),/preregistered/);
 const dupe=make(10);dupe[3]={...dupe[3],id:dupe[2].id};
 assert.throws(()=>runPinnedFrontPilot(dupe),/duplicate/);
 const truncated=make(10);truncated[0]={...truncated[0],bytes:Buffer.from([0xC3,0x28])};
 assert.throws(()=>runPinnedFrontPilot(truncated),/encoded|UTF-8|valid/i);
 const shorter=make(10);shorter[0]={...shorter[0],bytes:Buffer.from('xyz')};
 assert.throws(()=>runPinnedFrontPilot(shorter),/too short/);
});
