import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newNumericLinkDb,readNumericLinks} from '../src/numeric-link-store-v1.mjs';
import {replayNumericRoots,coldNumericCorpusReplay} from '../src/numeric-corpus-loader-v1.mjs';
import {trainObservedPhrasePairs,ObservedPhraseNumericLoader}
 from '../src/observed-phrase-numeric-v0.mjs';
function expand(db,id){
 const links=new Map(readNumericLinks(db).map(row=>[row.link_id,row]));
 const walk=id=>{
  const r=links.get(id);if(!r)throw Error('missing Link');
  return r.from_id===null?r.string:walk(r.from_id)+walk(r.to_id);
 };
 return walk(BigInt(id));
}
test('W3 candidate counts are actual adjacent source occurrences and document frequencies',()=>{
 const docs=[
  {id:'a',source:'мама мыла мама мыла'},
  {id:'b',source:'МАМА мыла, мама мыла!'},
  {id:'c',source:'мама,\nмыла. мама мыла'}
 ];
 const learned=trainObservedPhrasePairs(docs);
 const row=learned.candidateReport.find(x=>x.words.join(' ')==='мама мыла');
 assert.equal(row.observedOccurrences,5);
 assert.equal(row.documents,3);
 assert.ok(learned.lexicon.has(JSON.stringify(['мама','мыла'])));
 assert.equal(learned.sourceDocuments,3);
 assert.ok(learned.totalObservedPositions>5);
});
test('W3 repeated selected phrase is a ROOT-REACHABLE ordinary SQLite Link',()=>{
 const source='мама мыла мама мыла';
 const vocab=trainObservedPhrasePairs([{id:'book',source}]);
 const db=newNumericLinkDb();
 try{
  const compiler=new ObservedPhraseNumericLoader(db,vocab.lexicon);
  const x=compiler.appendBook(Buffer.from(source),{id:'book'});
  assert.equal(x.selectedPhraseOccurrences,2);
  assert.equal(x.eligiblePhraseWindows,2);
  assert.equal(x.hashDerivedLinkIds,0);
  assert.equal(x.physicalIdentity,'sqlite-integer-autoincrement');
  assert.deepEqual(compiler.lastEvidence.selectedPhraseIds.map(id=>expand(db,id)),
   ['мама мыла ','мама мыла']);
  assert.equal(expand(db,x.rootLinkId),source);
  assert.ok(readNumericLinks(db).every(r=>typeof r.link_id==='bigint'));
  assert.equal(replayNumericRoots(db,[{id:'book',bytes:Buffer.from(source),rootLinkId:x.rootLinkId}]).status,
   'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  assert.equal(coldNumericCorpusReplay(db,[{id:'book',bytes:Buffer.from(source),rootLinkId:x.rootLinkId}]).readOnly,true);
  assert.ok(compiler.finalize().links);
 }finally{db.close();}
});
test('W3 normalization only for candidate ranking, source Unicode and punctuation remain exact',()=>{
 const docs=[
  {id:'a',source:'МАМА мыла. мама мыла, мама мыла!'},
  {id:'b',source:'мама мыла\nмама мыла\tе\u0308 🚀\r\n'}
 ];
 const vocab=trainObservedPhrasePairs(docs);
 const db=newNumericLinkDb();
 try{
  const compiler=new ObservedPhraseNumericLoader(db,vocab.lexicon);
  const roots=docs.map(({id,source})=>{
   const bytes=Buffer.from(source),x=compiler.appendBook(bytes,{id});
   assert.ok(x.selectedPhraseOccurrences>=1);
   return {id,bytes,rootLinkId:x.rootLinkId};
  });
  assert.equal(coldNumericCorpusReplay(db,roots).documents.length,2);
 }finally{db.close();}
});
test('W3 rejects duplicate source IDs, invalid UTF8 and late SQL errors atomically',()=>{
 assert.throws(()=>trainObservedPhrasePairs([]),/invalid/);
 assert.throws(()=>trainObservedPhrasePairs([{id:'a',source:'a b'},{id:'a',source:'a b'}]),/duplicate/);
 const vocab=trainObservedPhrasePairs([{id:'a',source:'x y x y'}]);
 const db=newNumericLinkDb();
 try{
  const compiler=new ObservedPhraseNumericLoader(db,vocab.lexicon);
  assert.throws(()=>compiler.appendBook(Buffer.from([0x80])),/encoded|encoding|valid|UTF/i);
  const before=readNumericLinks(db);
  db.exec("CREATE TRIGGER abortB BEFORE INSERT ON links WHEN NEW.string='!' BEGIN SELECT RAISE(ABORT,'blocked'); END;");
  assert.throws(()=>compiler.appendBook(Buffer.from('x y!'),{id:'bad'}),/blocked/);
  assert.deepEqual(readNumericLinks(db),before);
  db.exec('DROP TRIGGER abortB');
  const x=compiler.appendBook(Buffer.from('x y'),{id:'ok'});
  assert.equal(expand(db,x.rootLinkId),'x y');
 }finally{db.close();}
});
test('W3 only whitespace (not punctuation) establishes phrase candidates',()=>{
 const x=trainObservedPhrasePairs([{id:'a',source:'раз, два. раз,\nдва. раз два! раз два'}]);
 assert.equal(x.candidateReport.find(z=>z.words.join(' ')==='раз два')?.observedOccurrences,2);
 assert.equal(x.totalObservedPositions,2);
});
