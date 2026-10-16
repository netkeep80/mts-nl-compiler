// W11: reconstruct **prefix-only** UTF-8 from W10 physical Link artifact, not a text dataset checkout.
// node scripts/run-source-first-v0.mjs <knowledge-large.sqlite> <large-corpus-performance.json> [output.json]
import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {collectSourceWindows,proposeSourceUnits,compareSourceFirst,
  trainSingleScalarAnchors,materializeScalarAnchor,InMemoryLinkGraph,
  trainSourceFirstPairGrammar,materializeFrozenPairGrammar}
 from '../src/source-first-frequencies-v0.mjs';
import {compareNumericSourceAnchors} from '../src/source-first-sqlite-v0.mjs';
import {compareMethodGrid} from '../src/source-first-method-grid-v0.mjs';
import {compareShapedGrid} from '../src/source-first-tree-shapes-v0.mjs';
import {verifyShapedNumericCorpus} from '../src/source-first-tree-shapes-sqlite-v0.mjs';
if(process.argv.length<4)throw Error('sqlite and performance.json required');
const db=new DatabaseSync(process.argv[2],{readOnly:true});
const perf=JSON.parse(readFileSync(process.argv[3],'utf8'));
const maxScalars=Number(process.env.W11_SCALARS_PER_BOOK??8192);
const maxProbe=Number(process.env.W11_PROBE_BUDGET??12);
if(!Number.isSafeInteger(maxScalars)||maxScalars<2||maxScalars>65536)throw Error('bad sample budget');
if(perf.books!==60||perf.perBook.length!==60)throw Error('pinned 60-book artifact required');
const q=db.prepare('SELECT from_id,to_id,string FROM links WHERE link_id=?');q.setReadBigInts(true);
const cache=new Map(),docs=[];
function readPrefix(id){
 const stack=[BigInt(id)],parts=[];let n=0;
 while(stack.length&&n<maxScalars){
  const current=stack.pop();let row=cache.get(current);
  if(!row){row=q.get(current);if(!row)throw Error('missing physical Link '+current);
   cache.set(current,row);}
  if(row.from_id===null){const s=[...row.string].slice(0,maxScalars-n).join('');parts.push(s);n += [...s].length;}
  else stack.push(row.to_id,row.from_id);
 }
 return parts.join('');
}
try{
 for(const row of perf.perBook){
  const source=readPrefix(row.rootLinkId);
  if([...source].length!==Math.min(maxScalars,row.codepoints))throw Error('source prefix length mismatch');
  docs.push({id:row.id,bytes:Buffer.from(source,'utf8')});
 }
}finally{db.close();}
const train=docs.filter((_,i)=>i%5!==4),heldout=docs.filter((_,i)=>i%5===4);
const first=collectSourceWindows(train,{maxScalarsPerDocument:maxScalars,maxWidth:6});
const candidates=proposeSourceUnits(first,{maxCandidates:256,minOccurrences:4});
const naive=compareSourceFirst(docs,{maxScalarsPerDocument:maxScalars,maxCandidates:256,maxWidth:6});
const anchor=trainSingleScalarAnchors(train,{maxScalarsPerDocument:maxScalars,maxProbe});
const chosen=anchor.selectedScalar;
const inMemory=materializeScalarAnchor(docs,chosen,{maxScalarsPerDocument:maxScalars});
const sqlite=compareNumericSourceAnchors(docs,chosen,{maxScalars});
if(inMemory.graph.physicalLinks!==sqlite.sourceFirst.physicalLinks||
 naive.results.balanced.physicalLinks!==sqlite.balanced.physicalLinks)
 throw Error('independent in-memory and SQL physical Link count disagree');
const repair=trainSourceFirstPairGrammar(train,{maxScalarsPerDocument:maxScalars,maxRules:32});
const repairGraph=materializeFrozenPairGrammar(docs,repair,{maxScalarsPerDocument:maxScalars});
const report={schema:'mts-nl/W11-source-first-physical-ab/v0',status:'NUMERIC_SQLITE_COLD_REPLAY_PASS',
  corpus:{books:docs.length,sourceRepository:perf.sourceRepository,
    originalFullCorpusBytes:perf.sourceBytes,scalarsPerBook:maxScalars,
    sampledScalars:docs.reduce((n,d)=>n+[...d.bytes.toString('utf8')].length,0),
    trainDocuments:train.length,heldoutDocuments:heldout.length,
    splitRule:'0-based document index modulo 5 == 4 is heldout'},
  sourceObservation:{overlappingWindows:first.observedSlidingWindows,
    independentProposals:candidates.length},
  learnedAnchor:{scalar:chosen,escaped:JSON.stringify(chosen),
    selectedBy:'MIN_TRAIN_UNIQUE_LINKS among context-entropy-proposed candidate atoms',
    trainBaseline:anchor.baseline.physicalLinks,
    trainingCandidateRanking:anchor.ranked.map(x=>({escaped:JSON.stringify(x.scalar),
      frequency:x.frequency,predictorScore:+x.predictorScore.toFixed(3),
      trainPhysicalLinks:x.physicalLinks}))},
  comparisons:{
    balanced:sqlite.balanced,
    rawNgramChunking:{physicalLinks:naive.results.sourceFirst.physicalLinks,
      status:'EXACT_REPLAY_PASS'},
    rawDynamicPairGrammar:{physicalLinks:repairGraph.graph.physicalLinks,
      learnedRules:repair.rules.length,status:'EXACT_REPLAY_PASS'},
    learnedAnchor:sqlite.sourceFirst
  },
  gain:{absoluteLinks:sqlite.sourceFirst.physicalLinks-sqlite.balanced.physicalLinks,
    ratio:+(sqlite.sourceFirst.physicalLinks/sqlite.balanced.physicalLinks-1).toFixed(6),
    sqliteVacuumBytesDelta:sqlite.sourceFirst.vacuumBytes-sqlite.balanced.vacuumBytes},
  limitations:['The corpus sample is first N Unicode scalars of each work, NOT the complete 60 books.',
    'The separator choice is optimized using only the 48 train documents; the 12 heldout documents are never used to select it.',
    'Physical Link counts and SQLite VACUUM bytes are real for the sample only; full-bit MDL and language semantics are not measured.',
    'Single-scalar after-boundary is a restricted search space: does not yet discover general morphemes, words, phrases, or multiple boundary types.']};
if(process.env.W12_METHOD_GRID==='1'){
 const marker=chosen===null?[]:[{scalar:chosen,side:'after'}];
 const methods=compareMethodGrid(docs,{maxScalarsPerDocument:maxScalars,
  maxProposals:Number(process.env.W12_PROPOSALS??6),maxRounds:2,minFrequency:16});
 const shapes=compareShapedGrid(docs,marker,{maxScalarsPerDocument:maxScalars,
  shapes:['balanced','frequencyGreedy','frequencyQuadratic','frequencyLog','suffix3']});
 const noBoundary=compareShapedGrid(docs,[],{maxScalarsPerDocument:maxScalars,
  shapes:['balanced','frequencyQuadratic']});
 const sql=verifyShapedNumericCorpus(docs,marker,'frequencyQuadratic',{
  maxScalarsPerDocument:maxScalars});
 const best=shapes.rankingByTotal.find(x=>x.shape==='frequencyQuadratic');
 if(sql.physicalLinks!==best.allPhysicalLinks)throw Error('W12 SQLite / train-first graph count disagreement');
 report.W12={methods,shapes,noBoundary,sql,
  status:'W12_MATCHED_TRAIN_ONLY_SQLITE_COLD_REPLAY_PASS'};
}
if(process.argv[4])writeFileSync(process.argv[4],JSON.stringify(report,null,2)+'\n');
console.log('W11_PHYSICAL_AB '+JSON.stringify(report));