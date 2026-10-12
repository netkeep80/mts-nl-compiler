#!/usr/bin/env node
// W19 B0: deterministic research report; no AI judgement, no semantic correction.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {trainContextPredictor} from '../src/w19-capability-b0.mjs';
const bytes=readFileSync(new URL('../tests/fixtures/w19-capability-pairs-v0.json',import.meta.url));
const fixture=JSON.parse(bytes.toString('utf8'));
if(fixture.schema!=='mts-nl/W19B0/controlled-fixture/v0')throw Error('W19 B0 fixture schema');
const kinds=['raw','link-left','link-balanced'];
const results=kinds.map(representation=>{
 const model=trainContextPredictor(fixture.train,{order:3,alpha:0.5,representation});
 return {representation,trainDocuments:model.trainingDocuments,
  trainingDigest:model.trainingDigest,observationEvents:model.observationEvents,
  vocabularySize:model.vocabulary.length,graph:model.graph?.stats??null,
  heldout:model.evaluate(fixture.heldout),pairProbes:model.comparePairs(fixture.pairs)};
});
const unigramToTrigramBaselines=[0,1,2,3].map(order=>{
 const model=trainContextPredictor(fixture.train,{order,alpha:0.5,representation:'raw'});
 return {order,observationEvents:model.observationEvents,heldout:model.evaluate(fixture.heldout)};
});
const raw=results[0];
for(const other of results.slice(1)){
 if(other.trainingDigest!==raw.trainingDigest
   ||JSON.stringify(other.heldout)!==JSON.stringify(raw.heldout)
   ||JSON.stringify(other.pairProbes)!==JSON.stringify(raw.pairProbes))
   throw Error('W19 B0 invariant failure: Link grouping changed source prediction');
}
const report={
 schema:'mts-nl/W19B0/predictive-null-report/v0',
 status:'STRUCTURAL_PREDICTION_NULL_EQUIVALENCE_ONLY',
 claim:'Link context encoding and raw n-gram statistics are predictively equivalent by construction; no semantic inference',
 fixtureSha256:createHash('sha256').update(bytes).digest('hex'),
 fixtureStatus:fixture.status,
 scorer:'empirical source-position next Unicode scalar frequency, add-alpha 0.5, suffix backoff, train-known alphabet only',
 order:3,
 split:{trainDocuments:fixture.train.length,heldoutDocuments:fixture.heldout.length,
   pairCount:fixture.pairs.length,goldIndependent:false},
 results,
 unigramToTrigramBaselines,
 validControlsAnomalyWarning:results[0].pairProbes.filter(p=>
    ['both-valid-modal-contrast','rare-but-grammatically-valid'].includes(p.goldKind)
    &&p.status==='STATISTICAL_ONLY'&&p.deltaBitsPerScalar>0).length,
 equality:{rawVsLinkLeft:true,rawVsLinkBalanced:true},
 warnings:[
  'Observation events are original source positions, not from_uses/to_uses or generated predictions',
  'Heldout distribution is a next-scalar probability only over train-known characters; unseen scalars abstain',
  'Paired contrasts are synthetic/unreviewed; relative bits are NOT grammar/spelling/logic judgements',
  'No evidence of Link semantic benefit over equal-order n-gram model',
  'No cross-language OOD or real independent gold acceptance in this B0 run'
 ]
};
console.log(JSON.stringify(report,null,2));
