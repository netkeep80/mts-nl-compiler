import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {newNumericLinkDb,readNumericLinks} from '../src/numeric-link-store-v1.mjs';
import {CountedNumericCorpusLoader,topObservedWords,top100Markdown}
 from '../src/corpus-top-report-v1.mjs';

test('TOP ranks expanded source occurrences, not unique SQL rows or pole counts',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  const first=loader.appendBook(Buffer.from('aaaa'),{id:'one'});
  const second=loader.appendBook(Buffer.from('aaaa'),{id:'two'});
  assert.equal(first.rootLinkId,second.rootLinkId);
  const top=loader.topLinks(10);
  assert.equal(top.books,2);
  assert.equal(top.denominatorPairEvents,6);
  assert.equal(top.top[0].preview,'aa');
  assert.equal(top.top[0].count,4);
  assert.equal(top.top[0].documents,2);
  assert.equal(top.top[0].empiricalRate,+(4/6).toPrecision(8));
  assert.equal(top.top[0].expandedCodepoints,2);
  assert.ok(/^[1-9][0-9]*$/.test(top.top[0].id));
  assert.equal(top.top[1].preview,'aaaa');
  assert.equal(top.top[1].count,2);
  assert.equal(top.top[1].documents,2);
  assert.ok(readNumericLinks(db).every(r=>typeof r.link_id==='bigint'));
  assert.ok(loader.finalize().links);
 }finally{db.close();}
});
test('word and phrase frequencies count actual source token windows, not Link pointers',()=>{
 const words=topObservedWords([
  {id:'a',source:'Мама мыла раму. Мама мыла раму!'},
  {id:'b',source:'Мама мыла окно.'}],10);
 assert.deepEqual(words.classes.map(x=>x.name),['word','two-words','three-words']);
 assert.equal(words.classes[0].top[0].text,'мама');
 assert.equal(words.classes[0].top[0].count,3);
 assert.equal(words.classes[0].top[0].documents,2);
 assert.equal(words.classes[1].top[0].text,'мама мыла');
 assert.equal(words.classes[1].top[0].count,3);
 assert.equal(words.classes[2].top[0].text,'мама мыла раму');
 assert.equal(words.classes[2].top[0].count,2);
 assert.equal(words.classes[2].top[0].documents,1);
 assert.equal(words.classes[2].top.some(x=>x.text.includes('раму мама')),false);
 assert.equal(words.notLinkWeights,true);
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  loader.appendBook(Buffer.from('aaa'),{id:'short'});
  const md=top100Markdown(loader.topLinks(10),words);
  assert.match(md,/TOP 100/);
  assert.match(md,/mama|мама/);
  assert.match(md,/observed/);
 }finally{db.close();}
});
test('empty and erroneous corpora cannot silently produce complete TOP100',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  assert.equal(loader.topLinks(100).top.length,0);
  assert.throws(()=>loader.appendBook(Buffer.from([0x80]),{id:'invalid'}));
  assert.throws(()=>loader.topLinks(100),/invalid\/incomplete/);
  assert.throws(()=>loader.appendBook(Buffer.from('aa'),{id:'retry'}),/fresh database/);
 }finally{db.close();}
});
test('large corpus manifest is exactly pinned and has >=60 distinct full works',()=>{
 const fs=JSON.parse(readFileSync(new URL('../corpus/large-books-v1.json',import.meta.url),'utf8'));
 assert.equal(fs.books.length,60);
 assert.equal(new Set(fs.books.map(x=>x.path)).size,60);
 assert.equal(fs.books.reduce((n,b)=>n+b.expectedBytes,0),fs.expectedTotalSourceBytes);
 assert.equal(fs.expectedTotalSourceBytes,19701816);
 assert.ok(fs.books.every(b=>b.repoPath.startsWith('prose/')&&b.expectedBytes>=125000));
});
