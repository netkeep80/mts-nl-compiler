// W22-D0: bounded train-selected 6/8-scalar regrouping shape, physically
// evaluated on EXACT pinned corpus slices. Source text is never reported.
// All selection is train-only; heldout is used for evaluation ONLY.
// Browser grammar labels are not used as physical SQLite Link identities.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {newNumericLinkDb,verifyNumericLinks} from './numeric-link-store-v1.mjs';
import {NumericCorpusLoader,replayNumericRoots,coldNumericCorpusReplay}
 from './numeric-corpus-loader-v1.mjs';
import {contextualCandidateTrees} from '../docs/compiler/window-oracle.mjs';

const fail=x=>{throw Error('W22D0: '+x);};
const clock=()=>process.hrtime.bigint();
const elapsed=t=>Math.round(Number(clock()-t)/1e6*1000)/1000;
const sha=b=>createHash('sha256').update(b).digest('hex');
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const compare=(a,b)=>a-b;
const widths=[6,8];
function decodeExact(bytes){
 if(!Buffer.isBuffer(bytes))fail('Buffer required for exact source');
 const s=utf8.decode(bytes);
 if(!Buffer.from(s,'utf8').equals(bytes))fail('invalid or altered source UTF-8');
 return s;
}
const binaryBalanced=points=>{
 if(points.length===1)return points[0];
 const m=Math.floor(points.length/2);
 return [binaryBalanced(points.slice(0,m)),binaryBalanced(points.slice(m))];
};
const binaryLeft=points=>{
 let t=points[0];
 for(let i=1;i<points.length;i++)t=[t,points[i]];
 return t;
};
function ordinalByShape(candidates,shape){
 const signature=JSON.stringify(shape);
 const entry=candidates.find(x=>JSON.stringify(x.window)===signature);
 if(!entry)fail('reference shape missing from exhaustive candidate set');
 return entry.ordinal;
}
function sourceOf(doc,{sampleScalars}){
 const exact=decodeExact(doc.bytes),points=[...exact];
 if(points.length<sampleScalars)fail('source too short for pinned pilot window: '+doc.id);
 const text=points.slice(0,sampleScalars).join('');
 return {id:doc.id,text,bytes:Buffer.from(text,'utf8'),
  sourceSha256:sha(doc.bytes),sampleSha256:sha(Buffer.from(text,'utf8')),
  sourceBytes:doc.bytes.length,sampleScalars};
}
function physicalTwoDocumentCost(targetTree,contextTree,target,context,{cold=false}={}){
 const db=newNumericLinkDb();
 try{
  const loader=new NumericCorpusLoader(db,{reuseAtoms:true,reusePairs:true});
  const record=[];
  for(const [tree,source] of [[targetTree,target],[contextTree,context]]){
   const c={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
   db.exec('BEGIN IMMEDIATE');
   let root;
   try{
    const materialize=x=>typeof x==='string'?
     loader._atom(x,c):loader._pair(materialize(x[0]),materialize(x[1]),c);
    root=materialize(tree);
    db.exec('COMMIT');
   }catch(e){
    db.exec('ROLLBACK');loader.loadCaches();throw e;
   }
   record.push({id:source.id,bytes:source.bytes,rootLinkId:String(root),c});
  }
  const verified=loader.finalize();
  const exact=replayNumericRoots(db,record,{maxCodePoints:512});
  if(exact.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS'||exact.documents.length!==2)
   fail('failed multi-document exact UTF-8 replay');
  const total=Number(verified.links);
  const insertedAtoms=record.reduce((a,d)=>a+d.c.insertedAtoms,0);
  const insertedPairs=record.reduce((a,d)=>a+d.c.insertedPairs,0);
  if(total!==insertedAtoms+insertedPairs)fail('physical SQLite row count mismatch');
  let coldEvidence=null;
  if(cold){
   const proof=coldNumericCorpusReplay(db,record);
   if(proof.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS'||!proof.readOnly)
    fail('cold read-only SQLite replay failed');
   coldEvidence={sqliteVacuumBytes:proof.sqliteVacuumBytes,
    coldReplayStatus:proof.status};
  }
  assert.equal(Number(verifyNumericLinks(db).links),total);
  return {
   physicalLinks:total,physicalPairs:insertedPairs,physicalAtoms:insertedAtoms,
   reusedPairInsertions:record.reduce((a,d)=>a+d.c.reusedPairs,0),
   ...coldEvidence
  };
 }finally{db.close();}
}
function insistCorpus(documents){
 if(!Array.isArray(documents)||documents.length<10||documents.length>60)
  fail('10..60 fully identified source documents required');
 const keys=new Set();
 for(const doc of documents){
  if(!doc||typeof doc.id!=='string'||!doc.id||keys.has(doc.id))
   fail('duplicate/missing source identifier');
  keys.add(doc.id);
  decodeExact(doc.bytes);
 }
 const train=documents.filter((_,i)=>i%5!==4);
 const heldout=documents.filter((_,i)=>i%5===4);
 if(!heldout.length||train.length<4)fail('train/heldout split unavailable');
 return {train,heldout};
}
/** Deliberately small pilot: 4 of the frozen 48 train books choose a
 * canonical TREE SHAPE. ALL heldout books measure that frozen shape without
 * allowing their bytes, lengths or scores into training.
 * The 60-book full-document W4 baseline is separately reported, not mixed
 * into snippet/32-scalar pilot metrics.
 */
export function runPinnedFrontPilot(documents,{
 sampleScalars=32,offset=8,trainSampleCount=4,widthsToTest=widths
}={}){
 const input=insistCorpus(documents);
 if(sampleScalars!==32||offset!==8||trainSampleCount!==4||
   !Array.isArray(widthsToTest)||widthsToTest.length<1||
   new Set(widthsToTest).size!==widthsToTest.length||
   widthsToTest.some(n=>n!==6&&n!==8))
  fail('only preregistered 32/8/4 and widths 6,8 allowed');
 const train=input.train.map(d=>sourceOf(d,{sampleScalars}));
 const heldout=input.heldout.map(d=>sourceOf(d,{sampleScalars}));
 const control=train[0]; // pinned, trained-only context for all heldout evaluations
 const background=binaryBalanced([...control.text]);
 const results=[];
 for(const width of widthsToTest){
  const start=clock(),trainScores=new Array(width===6?42:429).fill(0);
  const trainedSamples=train.slice(0,trainSampleCount);
  const trainRecords=[];
  for(const d of trainedSamples){
   const candidates=contextualCandidateTrees(d.text,{width,offset});
   if(candidates.length!==trainScores.length)fail('incomplete Catalan train enumeration');
   const backgroundOther=d.id===control.id?train[1]:control;
   const backgroundTree=binaryBalanced([...backgroundOther.text]);
   for(const c of candidates){
    const cost=physicalTwoDocumentCost(c.whole,backgroundTree,d,backgroundOther);
    trainScores[c.ordinal]+=cost.physicalPairs;
   }
   trainRecords.push({id:d.id,sourceSha256:d.sourceSha256,
    sampleSha256:d.sampleSha256});
  }
  const choices=trainScores.map((score,ordinal)=>({ordinal,trainPhysicalPairs:score}))
   .sort((a,b)=>a.trainPhysicalPairs-b.trainPhysicalPairs||a.ordinal-b.ordinal);
  const selected=choices[0].ordinal;
  const allShape=contextualCandidateTrees(train[0].text,{width,offset});
  const baseWindow=[...train[0].text].slice(offset,offset+width);
  const balancedOrdinal=ordinalByShape(allShape,binaryBalanced(baseWindow));
  const leftOrdinal=ordinalByShape(allShape,binaryLeft(baseWindow));
  const tuningMs=elapsed(start);
  const heldStart=clock(),rows=[];
  for(const doc of heldout){
   const candidates=contextualCandidateTrees(doc.text,{width,offset});
   const choicesByMode=[
    ['balanced',balancedOrdinal],['left',leftOrdinal],['train-selected',selected]
   ];
   const measured={};
   for(const [label,ordinal] of choicesByMode){
    measured[label]=physicalTwoDocumentCost(candidates[ordinal].whole,background,
     doc,control,{cold:true});
   }
   rows.push({
    id:doc.id,sourceSha256:doc.sourceSha256,sampleSha256:doc.sampleSha256,
    sampledScalars:doc.sampleScalars,
    ...Object.fromEntries(choicesByMode.map(([label])=>[label,measured[label]])),
    deltaLinksVsBalanced:measured['train-selected'].physicalLinks-measured.balanced.physicalLinks,
    deltaPairsVsBalanced:measured['train-selected'].physicalPairs-measured.balanced.physicalPairs,
    deltaBytesVsBalanced:measured['train-selected'].sqliteVacuumBytes-measured.balanced.sqliteVacuumBytes
   });
  }
  const totals={};
  for(const name of ['balanced','left','train-selected']){
   totals[name]={physicalLinks:rows.reduce((s,r)=>s+r[name].physicalLinks,0),
    physicalPairs:rows.reduce((s,r)=>s+r[name].physicalPairs,0),
    sqliteVacuumBytes:rows.reduce((s,r)=>s+r[name].sqliteVacuumBytes,0)};
  }
  results.push({
   width,offset,sampleScalars,
   candidateCount:trainScores.length,tuningSamples:trainRecords,
   selectedOrdinal:selected,balancedOrdinal,leftOrdinal,
   tuningTrainPhysicalPairCost:choices[0].trainPhysicalPairs,
   balancedTrainPhysicalPairCost:trainScores[balancedOrdinal],
   tuningWallMs:tuningMs,heldoutWallMs:elapsed(heldStart),
   heldout:rows,heldoutTotals:totals,
   heldoutImprovedDocs:rows.filter(r=>r.deltaLinksVsBalanced<0).length,
   heldoutRegressedDocs:rows.filter(r=>r.deltaLinksVsBalanced>0).length,
   heldoutTiedDocs:rows.filter(r=>r.deltaLinksVsBalanced===0).length,
   heldoutDeltaPhysicalLinks:totals['train-selected'].physicalLinks-totals.balanced.physicalLinks,
   heldoutDeltaSqliteBytes:totals['train-selected'].sqliteVacuumBytes-totals.balanced.sqliteVacuumBytes
  });
 }
 return {
  schema:'mts-nl/w22d0-pinned-front-pilot/v0',
  status:'HELDOUT_PHYSICAL_SQLITE_EXACT_REPLAY',
  corpusCount:documents.length,trainCount:input.train.length,heldoutCount:input.heldout.length,
  trainSelectionSamples:trainSampleCount,sourceSplit:'heldout iff zero-based book index % 5 == 4',
  fixedContextDocument:control.id,sourceBytes:documents.reduce((s,d)=>s+d.bytes.length,0),
  widths:results,scientificLimits:{
   learnedGrouping:'binary tree SHAPE only, selected on 4 training excerpts of 32 scalars',
   heldoutUsage:'all heldout source bytes used for evaluation only; never for choosing ordinals',
   sourceIndependence:'pinned full-source UTF-8 checked externally by corpus builder',
   baselineComparability:'balanced/left/train-selected measured on identical 32-scalar input and fixed training-derived context; not whole-book baselines',
   physicalIdentity:'SQLite INTEGER PRIMARY KEY AUTOINCREMENT, no hashes as Link IDs',
   goal:'measure structural Link, vacuum bytes and time; negative outcome allowed',
   noGlobalOptimality:true,noSemantics:true,noProductionFront:true
  }
 };
}
