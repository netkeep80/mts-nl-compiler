#!/usr/bin/env node
// Deterministic pinned-evidence dashboard, zero network/CDN. Node >=24 in project CI.
// The JSON is a snapshot of verified Draft reports, never a live GitHub API claim.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const sourceURL=new URL('../data/observatory/runs-v1.json',import.meta.url);
const templateURL=new URL('../src/observatory-template.html',import.meta.url);
const outputURL=new URL('../docs/observatory/index.html',import.meta.url);

export function validateEvidence(data){
 assert.equal(data.schema,'mts-nl/observatory/runs-v1');
 assert.match(data.asOf,/^20\d\d-\d\d-\d\d$/);
 assert.ok(data.provenance.includes('NOT live'));
 assert.ok(Array.isArray(data.sources)&&Array.isArray(data.experiments));
 assert.ok(data.experiments.length>0);
 assert.equal(new Set(data.sources.map(x=>x.id)).size,data.sources.length);
 assert.equal(new Set(data.experiments.map(x=>x.id)).size,data.experiments.length);
 assert.deepEqual(data.experiments.map(x=>x.id),data.sources.map(x=>x.id));
 for(const src of data.sources){
  assert.match(src.id,/^[A-Za-z0-9-]+$/);
  assert.ok(Number.isInteger(src.pr)&&src.pr>0);
  assert.match(src.head,/^[a-f0-9]{40}$/);
  assert.match(src.fixtureSha256,/^[a-f0-9]{64}$/);
  assert.match(src.markdownBlobSha,/^[a-f0-9]{40}$/);
  for(const key of ['ci','guard','report']){
   const u=new URL(src[key]);
   assert.equal(u.protocol,'https:');
   assert.equal(u.hostname,'github.com');
   assert.ok(u.pathname.startsWith('/netkeep80/mts-nl-compiler/'));
  }
 }
 for(const exp of data.experiments){
  assert.ok(exp.title&&exp.lead&&exp.limitation);
  assert.equal(exp.review,'DRAFT_RESEARCH');
  assert.equal(exp.evidence,'TESTED_SYNTHETIC');
  assert.equal(exp.testsPassed,exp.testsTotal);
  assert.ok(Number.isInteger(exp.testsTotal)&&exp.testsTotal>0);
  assert.ok(exp.population.train>0&&exp.population.holdout>0);
  assert.ok(Array.isArray(exp.controls)&&exp.controls.length>=3);
 }
 const B0=data.experiments.find(e=>e.id==='B0');
 const B1=data.experiments.find(e=>e.id==='B1');
 if(B0){
  assert.equal(B0.heldout.length,B0.population.holdout);
  assert.equal(B0.contrasts.length,6);
  assert.deepEqual(B0.baselines.map(x=>x.order),[0,1,2,3]);
  assert.ok(B0.contrasts.some(x=>x.status==='ABSTAIN_OOV'));
  assert.ok(B0.contrasts.filter(x=>x.control==='VALID_CONTROL_UNREVIEWED').length>=2);
  assert.ok(B0.baselines[3].bitsPerScalar>B0.baselines[2].bitsPerScalar,
    'B0 counterexample: more context worsens log loss');
 }
 if(B1){
  assert.equal(B1.proposals.length,B1.population.holdout);
  assert.equal(B1.roots.length*B1.suffixes.length,B1.population.train+B1.population.holdout);
  assert.equal(B1.holdoutCells.length,B1.population.holdout);
  assert.equal(new Set(B1.proposals.map(x=>x.surface)).size,B1.proposals.length);
  assert.equal(B1.linkGraph.total,B1.linkGraph.atoms+B1.linkGraph.pairs);
  for(const [i,j] of B1.holdoutCells){
   const candidate=B1.roots[i]+B1.suffixes[j];
   assert.ok(B1.proposals.some(x=>x.surface===candidate),'reported proposal not in withheld');
  }
  assert.ok(B1.controls.some(x=>x.result==='UNKNOWN'));
 }
}

export function renderObservatory(data,htmlTemplate){
 validateEvidence(data);
 const marker='__OBSERVATORY_DATA__';
 assert.equal(htmlTemplate.split(marker).length,2,'exactly one data marker required');
 // Escaping is important even for pinned JSON: never close a script element with external data.
 const payload=JSON.stringify(data).replace(/</g,'\\u003c').replace(/>/g,'\\u003e')
  .replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const html=htmlTemplate.replace(marker,payload);
 assert.ok(!html.includes(marker));
 assert.equal(html.match(/<script/g)?.length,2,'one inert data script, one local application script');
 assert.ok(!/<script[^>]+src\s*=/i.test(html),'no remote dependencies allowed');
 return html;
}

const isDirectRun=Boolean(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url);
if(isDirectRun){
 const data=JSON.parse(readFileSync(sourceURL,'utf8'));
 const template=readFileSync(templateURL,'utf8');
 const html=renderObservatory(data,template);
 if(process.argv.includes('--check')){
  assert.equal(readFileSync(outputURL,'utf8'),html,'docs/observatory/index.html stale: run node scripts/build_observatory.mjs');
 }else{
  mkdirSync(new URL('../docs/observatory/',import.meta.url),{recursive:true});
  writeFileSync(outputURL,html,'utf8');
 }
 const checksum=createHash('sha256').update(html).digest('hex');
 console.log(JSON.stringify({mode:process.argv.includes('--check')?'CHECK_PASS':'BUILT',
  bytes:Buffer.byteLength(html),sha256:checksum,experiments:data.experiments.map(x=>x.id)}));
}
