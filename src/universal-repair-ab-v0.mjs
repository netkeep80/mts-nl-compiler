// W4: fixed 48/12 train/held-out physical Link comparison. No words known.
import {DatabaseSync} from 'node:sqlite';
import {NUMERIC_LINK_SCHEMA_V1} from './numeric-link-store-v1.mjs';
import {coldNumericCorpusReplay} from './numeric-corpus-loader-v1.mjs';
import {trainUniversalRepair,summarizeRepairGrammar,UniversalRepairNumericLoader}
 from './universal-repair-numeric-v0.mjs';
import {trainMultiscaleRepair} from './multiscale-repair-numeric-v0.mjs';

const fail=s=>{throw Error('UNIVERSAL_AB: '+s);};
const now=()=>process.hrtime.bigint(),ms=t=>+(Number(now()-t)/1e6).toFixed(3);
export function compareUniversalRepairCorpus(documents,baseline,options={}){
 if(!Array.isArray(documents)||documents.length<5||
   !baseline||baseline.books!==documents.length||
   !Number.isSafeInteger(baseline.insertedLinks)||baseline.insertedLinks<1||
   !Number.isFinite(baseline.insertWallMs)||!Number.isFinite(baseline.sqliteVacuumBytes))
  fail('exact complete corpus and baseline required');
 const ids=new Set();
 for(const d of documents){
  if(!d||typeof d.id!=='string'||!d.id||ids.has(d.id)||
   !Buffer.isBuffer(d.bytes))fail('invalid duplicate or non-byte source');
  ids.add(d.id);
 }
 const train=documents.filter((d,i)=>i%5!==4);
 const heldout=documents.filter((d,i)=>i%5===4);
 if(!train.length||!heldout.length)fail('empty training or held-out partition');
 const {algorithm='greedy',...trainingOptions}=options;
 if(algorithm!=='greedy'&&algorithm!=='multiscale')
  fail('unsupported training algorithm');
 const grammar=algorithm==='multiscale'?
  trainMultiscaleRepair(train,trainingOptions):
  trainUniversalRepair(train,trainingOptions);
 if(!grammar.rules.length)fail('no learned repeated binary structures');
 const db=new DatabaseSync(':memory:');
 const schemaAt=now();db.exec(NUMERIC_LINK_SCHEMA_V1);const schemaMs=ms(schemaAt);
 try{
  const loader=new UniversalRepairNumericLoader(db,grammar);
  const docs=[],perBook=[],parts={train:{books:0,codepoints:0,covered:0,selected:0},
    heldout:{books:0,codepoints:0,covered:0,selected:0}};
  const importStart=now();
  for(let i=0;i<documents.length;i++){
   const d=documents[i],partition=i%5===4?'heldout':'train';
   const r=loader.appendBook(d.bytes,{id:d.id,maxCodePoints:1000000});
   docs.push({id:d.id,bytes:d.bytes,rootLinkId:r.rootLinkId});
   perBook.push({...r,partition});
   const p=parts[partition];
   p.books++;p.codepoints+=r.codepoints;
   p.covered+=r.selectedCoveredCodepoints;
   p.selected+=r.selectedLearnedOccurrences;
  }
  const insertWallMs=ms(importStart);
  const finalizeAt=now(),f=loader.finalize(),finalizeWallMs=ms(finalizeAt);
  const replayAt=now(),cold=coldNumericCorpusReplay(db,docs);
  const replayWallMs=ms(replayAt);
  if(cold.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS'||cold.documents.length!==documents.length)
   fail('cold replay did not verify all source bytes');
  const physical=Number(f.links),inserted=perBook.reduce((n,x)=>n+x.insertedLinks,0);
  const sourceBytes=documents.reduce((n,x)=>n+x.bytes.length,0);
  if(physical!==inserted||sourceBytes!==baseline.sourceBytes)fail('A/B count or corpus mismatch');
  for(const p of Object.values(parts))
   p.coverageRate=p.codepoints?+(p.covered/p.codepoints).toFixed(6):0;
  const topSelected=[...loader.selected].sort((a,b)=>b[1].count-a[1].count||
      a[0]-b[0]).slice(0,100).map(([token,value],i)=>{
    const t=grammar.terms.get(token);
    return {rank:i+1,localGrammarToken:token,physicalLinkId:value.linkId,
     actualSelectedOccurrences:value.count,documents:value.documents,
     expandedCodepoints:t.length,
     preview:[...t.text].slice(0,64).join('')};
  });
  const lengthHistogram={};
  for(const [token,v] of loader.selected){
   const length=grammar.terms.get(token).length;
   const band=length>=32?'32+':length>=16?'16-31':length>=8?'8-15':
     length>=4?'4-7':length===3?'3':'2';
   lengthHistogram[band]=(lengthHistogram[band]??0)+v.count;
  }
  return {
   schema:'mts-nl/universal-repair-corpus-ab/v0',
   algorithm,
   status:'UNIVERSAL_NUMERIC_COLD_REPLAY_PASS',
   caveat:'Re-Pair-like bounded sampled training; not globally minimal grammar, timings fixed order',
   sourceBytes,books:documents.length,
   split:{method:'heldout iff zero-based index modulo 5 equals 4',
    train:train.map(d=>d.id),heldout:heldout.map(d=>d.id)},
   grammar:summarizeRepairGrammar(grammar,{topN:50}),
   coverage:parts,selectedLengthHistogram:lengthHistogram,topSelected,
   numericGraph:{physicalLinks:physical,sqliteVacuumBytes:cold.sqliteVacuumBytes,
    insertWallMs,linksPerSecond:+(physical/(insertWallMs/1000)).toFixed(1),
    coldReadOnlyReplayMs:cold.coldReadOnlyReplayMs,
    hashDerivedLinkIds:0,coldStatus:cold.status,
    perBook},
   comparison:{
    balancedPhysicalLinks:baseline.insertedLinks,
    balancedSqliteBytes:baseline.sqliteVacuumBytes,
    universalToBalancedLinkRatio:+(physical/baseline.insertedLinks).toFixed(6),
    universalToBalancedSizeRatio:+(cold.sqliteVacuumBytes/baseline.sqliteVacuumBytes).toFixed(6),
    wordAlignedPhysicalLinks:baseline.wordAlignedAB?.wordAligned?.insertedLinks??null,
    wordAlignedSqliteBytes:baseline.wordAlignedAB?.wordAligned?.sqliteVacuumBytes??null,
    universalToWordAlignedLinkRatio:baseline.wordAlignedAB?.wordAligned?.insertedLinks?
      +(physical/baseline.wordAlignedAB.wordAligned.insertedLinks).toFixed(6):null,
    universalToWordAlignedSizeRatio:baseline.wordAlignedAB?.wordAligned?.sqliteVacuumBytes?
      +(cold.sqliteVacuumBytes/baseline.wordAlignedAB.wordAligned.sqliteVacuumBytes).toFixed(6):null
   },
   phaseMs:{schemaMs,finalizeWallMs,counterRebuildMs:f.counterRebuildMs,
    integrityCheckMs:f.integrityCheckMs,replayWallMs}
  };
 }finally{db.close();}
}
