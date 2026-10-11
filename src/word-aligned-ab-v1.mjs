// W2 matched-order 60-book A/B observation; accepted E0 baseline is kept.
// This builds an entirely separate SQLite with rooted physical word/phrase Links.
import {DatabaseSync} from 'node:sqlite';
import {NUMERIC_LINK_SCHEMA_V1} from './numeric-link-store-v1.mjs';
import {WordAlignedNumericLoader} from './word-aligned-numeric-v0.mjs';
import {coldNumericCorpusReplay} from './numeric-corpus-loader-v1.mjs';

const fail=s=>{throw Error('WORD_ALIGNED_AB: '+s);};
const tick=()=>process.hrtime.bigint();
const ms=start=>+(Number(tick()-start)/1e6).toFixed(3);
export function compareWordAlignedCorpus(documents,balancedMetrics){
 if(!Array.isArray(documents)||!documents.length||
  !balancedMetrics||!Number.isSafeInteger(balancedMetrics.insertedLinks)||
  !Number.isFinite(balancedMetrics.insertWallMs)||
  !Number.isFinite(balancedMetrics.sqliteVacuumBytes)||
  balancedMetrics.insertedLinks<=0)fail('complete balanced baseline required');
 if(documents.length!==balancedMetrics.books)fail('different book count');
 const db=new DatabaseSync(':memory:');
 const schemaStart=tick();
 db.exec(NUMERIC_LINK_SCHEMA_V1);
 const schemaMs=ms(schemaStart);
 let summary;
 try{
  const loader=new WordAlignedNumericLoader(db);
  const perBook=[],roots=[],uniqueWordLinks=new Set(),uniquePhraseLinks=new Set();
  let wordTokenOccurrences=0,phraseNodeOccurrences=0;
  const importStart=tick();
  for(const doc of documents){
   if(!doc||typeof doc.id!=='string'||!Buffer.isBuffer(doc.bytes))
    fail('malformed A/B document');
   const result=loader.appendBook(doc.bytes,{id:doc.id,maxCodePoints:1000000});
   wordTokenOccurrences+=result.wordTokens;
   phraseNodeOccurrences+=result.selectedPhraseNodeOccurrences;
   for(const id of loader.lastEvidence.wordRoots)uniqueWordLinks.add(id);
   for(const id of loader.lastEvidence.phraseRoots)uniquePhraseLinks.add(id);
   roots.push({id:doc.id,bytes:doc.bytes,rootLinkId:result.rootLinkId});
   perBook.push(result);
  }
  const insertWallMs=ms(importStart);
  const finalStart=tick(),final=loader.finalize(),finalizeMs=ms(finalStart);
  const coldStart=tick();
  const cold=coldNumericCorpusReplay(db,roots);
  const coldTotalMs=ms(coldStart);
  if(cold.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS'||
   cold.documents.length!==documents.length)fail('cold replay incomplete');
  const rows=Number(final.links);
  const inserted=perBook.reduce((sum,x)=>sum+x.insertedLinks,0);
  const bytes=documents.reduce((sum,x)=>sum+x.bytes.length,0);
  if(rows!==inserted||bytes!==balancedMetrics.sourceBytes)
   fail('A/B input or Link count mismatch');
  summary={
   schema:'mts-nl/word-aligned-ab/v1',
   status:'WORD_ALIGNED_60_BOOK_COLD_REPLAY_PASS',
   experiment:'balanced-character-first, word-aligned-second, not randomized; do not infer causal speedup',
   books:roots.length,sourceBytes:bytes,
   baseline:{compiler:'balanced-character',insertedLinks:balancedMetrics.insertedLinks,
    insertWallMs:balancedMetrics.insertWallMs,
    sqliteVacuumBytes:balancedMetrics.sqliteVacuumBytes,
    rootedWordCoverage:'NOT_MEASURED'},
   wordAligned:{compiler:'exact-word-and-separator',
    insertedLinks:rows,insertWallMs,
    linkCreationPerSecond:+(rows/Math.max(.001,insertWallMs)*1000).toFixed(1),
    sqliteVacuumBytes:cold.sqliteVacuumBytes,
    rootedWordTokenOccurrences:wordTokenOccurrences,
    distinctRootedWordLinkIds:uniqueWordLinks.size,
    rootedPhraseNodeOccurrences:phraseNodeOccurrences,
    distinctRootedPhraseLinkIds:uniquePhraseLinks.size,
    coldReadOnlyStatus:cold.status,
    coldReadOnlyReplayMs:cold.coldReadOnlyReplayMs,
    physicalIdentity:'sqlite-integer-primary-key-autoincrement',
    hashDerivedLinkIds:0,
    perBook},
   measuredRatios:{
    physicalLinkRows:+(rows/balancedMetrics.insertedLinks).toFixed(6),
    sqliteVacuumBytes:+(cold.sqliteVacuumBytes/balancedMetrics.sqliteVacuumBytes).toFixed(6),
    insertionElapsed:+(insertWallMs/balancedMetrics.insertWallMs).toFixed(6)},
   phasesMs:{schemaMs,finalizeMs,
    counterRebuildMs:final.counterRebuildMs,integrityCheckMs:final.integrityCheckMs,
    coldTotalMs}
  };
  return summary;
 }finally{db.close();}
}
