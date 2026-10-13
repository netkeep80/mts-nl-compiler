// No independent gold present; structural validation only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSources,validateAnnotations,headers} from '../scripts/w19_g0_validate.mjs';
const b=validateSources();
const row=(overrides={})=>{
 const o={case_id:'H001',stage:'TEXT',annotator:'A1',reading:'R1',field:'subject',value:'Система',surface:'Система',start_utf8:'0',end_utf8:'14',judgement:'PRESENT',evidence:'explicit noun phrase',note:'' ,...overrides};
 return headers.annotation.split('\t').map(k=>o[k]).join('\t');
};
const annotated=(...lines)=>headers.annotation+'\n'+lines.join('\n')+'\n';
test('G0 frozen provenance/manifest and no fabricated labels',()=>{
 assert.equal(b.blind.length,28);assert.equal(b.holdout.length,33);assert.equal(b.origins.length,33);
 assert.equal(b.manifest.human_gold,'NOT_COLLECTED');
 assert.equal(b.manifest.holdout_machine_seen,'NO');
 assert.equal(b.manifest.holdout_status,'FROZEN_PRE_INFERENCE');
 assert.equal(b.origins.filter(x=>x.kind==='QUOTED_PUBLIC_REPO').length,3);
 assert.equal(readFileSync(new URL('../data/w19-g0/annotation-template.tsv',import.meta.url),'utf8'),headers.annotation+'\n');
});
test('G0 accepts one manually authored TEXT row, does NOT call it gold',()=>{
 const r=validateAnnotations(annotated(row({value:'system actor'})),b);
 assert.deepEqual(r,{rows:1,annotators:1,stageText:1,stageDefinitions:0});
});
test('G0 rejects invalid or truncated spans',()=>{
 assert.throws(()=>validateAnnotations(annotated(row({end_utf8:'5'})),b),/span/);
 assert.throws(()=>validateAnnotations(annotated(row({start_utf8:'1'})),b),/span/);
});
test('G0 rejects wrong fields, stages, predictions and duplicate rows',()=>{
 assert.throws(()=>validateAnnotations(annotated(row({field:'templateId'})),b),/field/);
 assert.throws(()=>validateAnnotations(annotated(row({stage:'PREDICTED'})),b),/stage/);
 assert.throws(()=>validateAnnotations(annotated(row({evidence:'tpl.requirement'})),b),/leaked/);
 assert.throws(()=>validateAnnotations(annotated(row(),row()),b),/duplicate/);
 assert.throws(()=>validateAnnotations(annotated(row({case_id:'S01'})),b),/unknown case/);
});
test('G0 enforces per-reading two-stage coverage only after TEXT',()=>{
 assert.throws(()=>validateAnnotations(annotated(row({stage:'DEFINITIONS',field:'coverage',judgement:'SUPPORTED',surface:'',start_utf8:'',end_utf8:'',evidence:'tpl.requirement'})),b),/without TEXT/);
 const r=validateAnnotations(annotated(row(),row({stage:'DEFINITIONS',field:'coverage',judgement:'UNSUPPORTED',surface:'',start_utf8:'',end_utf8:'',value:'',evidence:'no supporting template'})),b);
 assert.equal(r.stageDefinitions,1);
});
test('G0 no semantic scoring or machine interpretation imports',()=>{
 const source=readFileSync(new URL('../scripts/w19_g0_validate.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/from ['"]\.\.\/src\/w19-semantic-s0/);
 assert.doesNotMatch(source,/HUMAN_GOLD_PASS/);
});
