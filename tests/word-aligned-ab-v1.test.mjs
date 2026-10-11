import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newNumericLinkDb} from '../src/numeric-link-store-v1.mjs';
import {NumericCorpusLoader,coldNumericCorpusReplay} from '../src/numeric-corpus-loader-v1.mjs';
import {compareWordAlignedCorpus} from '../src/word-aligned-ab-v1.mjs';

test('W2 balanced / word aligned same input, numeric physical identity and cold byte-exact replay',()=>{
 const docs=[
  {id:'mama',bytes:Buffer.from('мама мыла мама мыла ')},
  {id:'unicode',bytes:Buffer.from('\ufeffe\u0308 A→B 🚀\r\n')},
  {id:'punctuation',bytes:Buffer.from('Он сказал: «Дело!» И всё.')},
 ];
 const db=newNumericLinkDb();
 try{
  const baseline=new NumericCorpusLoader(db);
  const roots=docs.map(x=>({...x,rootLinkId:baseline.appendBook(x.bytes,{id:x.id}).rootLinkId}));
  baseline.finalize();
  const vac=coldNumericCorpusReplay(db,roots);
  const ref={books:docs.length,sourceBytes:docs.reduce((n,x)=>n+x.bytes.length,0),
   insertedLinks:db.prepare('SELECT COUNT(*) AS n FROM links').get().n,
   insertWallMs:10,sqliteVacuumBytes:vac.sqliteVacuumBytes};
  const result=compareWordAlignedCorpus(docs,ref);
  assert.equal(result.status,'WORD_ALIGNED_60_BOOK_COLD_REPLAY_PASS');
  assert.equal(result.wordAligned.coldReadOnlyStatus,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  assert.equal(result.wordAligned.hashDerivedLinkIds,0);
  assert.equal(result.baseline.rootedWordCoverage,'NOT_MEASURED');
  assert.ok(result.wordAligned.rootedWordTokenOccurrences>=8);
  assert.ok(result.wordAligned.rootedPhraseNodeOccurrences>=1);
  assert.ok(result.wordAligned.distinctRootedWordLinkIds>0);
  assert.ok(result.wordAligned.sqliteVacuumBytes>0);
  assert.equal(result.wordAligned.perBook.length,docs.length);
  assert.ok(Number.isFinite(result.measuredRatios.insertionElapsed));
 }finally{db.close();}
});
test('W2 mismatched baseline or malformed corpus cannot fabricate benchmark',()=>{
 assert.throws(()=>compareWordAlignedCorpus([],{insertedLinks:1,insertWallMs:1,sqliteVacuumBytes:1,books:0}),/complete/);
 assert.throws(()=>compareWordAlignedCorpus([{id:'x',bytes:Buffer.from('x')}],
  {insertedLinks:1,insertWallMs:1,sqliteVacuumBytes:1,sourceBytes:1,books:2}),/different book count/);
 assert.throws(()=>compareWordAlignedCorpus([{id:'x',bytes:Buffer.from([0x80])}],
  {insertedLinks:1,insertWallMs:1,sqliteVacuumBytes:1,sourceBytes:1,books:1}),/encoded|encoding|valid|UTF/i);
});
