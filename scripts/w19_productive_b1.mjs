#!/usr/bin/env node
// Exact no-space surface experiment; fixture generator KNOWS the latent split, learner does not.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {trainProductiveSlots,trainCharBaseline} from '../src/w19-productive-slots-b1.mjs';
const bytes=readFileSync(new URL('../tests/fixtures/w19-productive-b1-v0.json',import.meta.url));
const fixture=JSON.parse(bytes.toString('utf8'));
if(fixture.schema!=='mts-nl/W19B1/productive-blind-synthetic/v0')throw Error('W19 B1 fixture mismatch');
const {roots,suffixes,trainCells,heldoutCells}=fixture.generation;
const surface=([i,j])=>roots[i]+suffixes[j];
const train=trainCells.map(surface),heldout=heldoutCells.map(surface);
if(train.some(x=>heldout.includes(x)))throw Error('leakage in fixture split');
const model=trainProductiveSlots(train);
const proposed=model.propose();
const proposedSet=new Set(proposed.map(x=>x.surface));
const recovered=heldout.filter(s=>proposedSet.has(s));
const baselines=[0,1,2,3].map(order=>{
 const n=trainCharBaseline(train,{order});
 const heldoutScores=heldout.map(s=>({surface:s,logScoreBits:n.score(s)}));
 // This comparison NEVER equates probability of surface with licitness of a form.
 return {order,heldoutScores,meanLogScoreBits:heldoutScores.reduce((a,b)=>a+b.logScoreBits,0)/heldout.length};
});
const graphBefore={...model.graph.stats};
for(const s of heldout){
 const inspect=model.inspect(s);
 if(!['STRUCTURAL_CANDIDATE'].includes(inspect.status)||inspect.seen)throw Error('heldout root leakage/unsupported');
}
if(JSON.stringify(model.graph.stats)!==JSON.stringify(graphBefore))throw Error('read-only test created Links');
const report={
 schema:'mts-nl/W19B1/productive-slot-null-report/v0',
 fixtureSha256:createHash('sha256').update(bytes).digest('hex'),
 status:recovered.length===heldout.length?'STRUCTURAL_RECOMBINATION_FOUND_NOT_SEMANTICS':'STRUCTURAL_RECOMBINATION_INCOMPLETE',
 data:{trainDocuments:train.length,heldoutDocuments:heldout.length,sourceUnit:'one full surface per document; unknown inner split',
   usesWordBoundaries:false,usesDocumentBoundaries:true},
 model:{status:model.status,split:model.split,score:model.score,
  supportedEvents:model.supportedEvents,prefixTypes:model.prefixTypes,suffixTypes:model.suffixTypes,
  graph:model.graph.stats},
 heldout:{proposedUnknownCombinations:proposed.length,recovered:recovered.length,total:heldout.length,
  exactHeldoutRecall:recovered.length/heldout.length},
 allProposals:proposed,
 ngramBaselines:baselines,
 negativePairedWorld:{sameTrainingObservations:true,
  worldA:'withheld five candidate surfaces considered valid',
  worldB:'same withheld five candidate surfaces considered forbidden',
  identicalModelOutput:true,
  identifiability:'NO_SEMANTIC_TRUTH_INFERRED_FROM_TRAIN_ONLY'},
 caveats:[
  'No whitespace or explicitly supplied root/affix boundary in learner; one-surface-per-document boundary IS GIVEN',
  'The corpus is synthetic and highly regular; the true split is fixed by the data generator, not independent human review',
  'Link structure encodes reversible candidates, not an accepted general MTS Link graph with arbitrary roles/cycles/weights',
  'Completion coverage is not natural-language correctness; paired-world counterexample makes semantic validity unidentifiable',
  'N-gram whole-form scores are descriptive likelihood baselines, not necessarily comparable to uncalibrated slot proposal scores',
  'Do not claim improvement over n-grams based only on candidate generation under a restricted synthetic grammar'
 ]
};
console.log(JSON.stringify(report,null,2));
