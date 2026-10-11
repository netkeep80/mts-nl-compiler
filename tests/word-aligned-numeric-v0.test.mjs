import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newNumericLinkDb,readNumericLinks} from '../src/numeric-link-store-v1.mjs';
import {NumericCorpusLoader,replayNumericRoots,coldNumericCorpusReplay} from '../src/numeric-corpus-loader-v1.mjs';
import {WordAlignedNumericLoader,exactWordSegments} from '../src/word-aligned-numeric-v0.mjs';

function expanded(db,id){
 const rows=new Map(readNumericLinks(db).map(r=>[r.link_id,r]));
 function walk(n,active=new Set()){
  if(active.has(n))throw Error('cycle');
  const r=rows.get(n);if(!r)throw Error('missing Link');
  if(r.from_id===null)return r.string;
  active.add(n);
  const value=walk(r.from_id,active)+walk(r.to_id,active);
  active.delete(n);return value;
 }
 return walk(BigInt(id));
}
test('exact segments cover original Unicode including combining marks and separators',()=>{
 for(const s of ['', 'мама мыла раму.\r\n', 'e\u0308 abc','\ufeffHello🚀\n','A→B', 'あいう。']){
  const seg=exactWordSegments(s);
  assert.equal(seg.map(x=>x.text).join(''),s);
  if(s.includes('мама'))assert.equal(seg[0].kind,'word');
 }
});
test('selected physical word Links and two-word phrase Links are reachable through source root',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new WordAlignedNumericLoader(db);
  const source='мама мыла мама мыла ';
  const r=loader.appendBook(Buffer.from(source),{id:'repeated phrase'});
  assert.equal(r.wordTokens,4);
  assert.equal(r.selectedPhraseNodeOccurrences,3);
  assert.equal(r.selectedPhraseUniqueLinks,2);
  const words=loader.lastEvidence.wordRoots.map(x=>expanded(db,x));
  assert.deepEqual(words,['мама','мыла','мама','мыла']);
  const phrases=loader.lastEvidence.phraseRoots.map(x=>expanded(db,x));
  assert.ok(phrases.includes('мама мыла '));
  assert.ok(phrases.filter(x=>x==='мама мыла ').length>=2);
  assert.equal(expanded(db,r.rootLinkId),source);
  assert.equal(replayNumericRoots(db,[{id:'repeated phrase',rootLinkId:r.rootLinkId,bytes:Buffer.from(source)}]).status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  assert.equal(coldNumericCorpusReplay(db,[{id:'repeated phrase',rootLinkId:r.rootLinkId,bytes:Buffer.from(source)}]).readOnly,true);
  assert.ok(loader.finalize().links);
 }finally{db.close();}
});
test('word-aligned numeric graph: selected words exist, but equal poles need not share identities',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new WordAlignedNumericLoader(db,{reuseAtoms:true,reusePairs:false});
  const r=loader.appendBook(Buffer.from('abba abba '),{id:'separate identities'});
  assert.equal(r.wordTokens,2);
  const roots=loader.lastEvidence.wordRoots;
  assert.notEqual(roots[0],roots[1]);
  assert.equal(expanded(db,roots[0]),'abba');
  assert.equal(expanded(db,roots[1]),'abba');
  assert.equal(expanded(db,r.rootLinkId),'abba abba ');
 }finally{db.close();}
});
test('balanced vs word-aligned: same text cold-replays exactly but segmentation changes phrase coverage',()=>{
 const books=['мама мыла мама мыла ','e\u0308 A→B.\n🚀','Один, два. Три!',''];
 const a=newNumericLinkDb(),b=newNumericLinkDb();
 try{
  const balanced=new NumericCorpusLoader(a),aligned=new WordAlignedNumericLoader(b);
  const oa=[],ob=[];
  for(const [i,source] of books.entries()){
   const bytes=Buffer.from(source),id='book-'+i;
   const x=balanced.appendBook(bytes,{id}),y=aligned.appendBook(bytes,{id});
   oa.push({id,rootLinkId:x.rootLinkId,bytes});
   ob.push({id,rootLinkId:y.rootLinkId,bytes});
  }
  assert.equal(replayNumericRoots(a,oa).documents.length,4);
  assert.equal(replayNumericRoots(b,ob).documents.length,4);
  assert.notDeepEqual(readNumericLinks(a),readNumericLinks(b));
  assert.ok(aligned.finalize().links);
 }finally{a.close();b.close();}
});
test('failing word-aligned book leaves SQLite and reuse maps unchanged',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new WordAlignedNumericLoader(db);
  loader.appendBook(Buffer.from('first '),{id:'ok'});
  const before=readNumericLinks(db);
  db.exec("CREATE TRIGGER stop BEFORE INSERT ON links WHEN NEW.string='!' BEGIN SELECT RAISE(ABORT,'refused'); END;");
  assert.throws(()=>loader.appendBook(Buffer.from('x !'),{id:'fail'}),/refused/);
  assert.deepEqual(readNumericLinks(db),before);
  db.exec('DROP TRIGGER stop');
  const y=loader.appendBook(Buffer.from('x !'),{id:'recovered'});
  assert.equal(expanded(db,y.rootLinkId),'x !');
 }finally{db.close();}
});
test('invalid UTF-8 and budget fail closed before publishing any Link',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new WordAlignedNumericLoader(db);
  assert.throws(()=>loader.appendBook(Buffer.from([0x80])),/encoded|encoding|valid|UTF/i);
  assert.throws(()=>loader.appendBook(Buffer.from('abcdef'),{maxCodePoints:2}),/RESOURCE_LIMIT/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM links').get().n,0);
 }finally{db.close();}
});
