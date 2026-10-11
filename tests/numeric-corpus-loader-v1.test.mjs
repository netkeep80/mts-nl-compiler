import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newNumericLinkDb,readNumericLinks,verifyNumericLinks} from '../src/numeric-link-store-v1.mjs';
import {NumericCorpusLoader,replayNumericRoots,coldNumericCorpusReplay} from '../src/numeric-corpus-loader-v1.mjs';

const utf8=x=>Buffer.from(x,'utf8');
test('no hash IDs: direct atom/pair SQLite allocation and exact repeated books',()=>{
 const db=newNumericLinkDb();
 try{
  const compiler=new NumericCorpusLoader(db);
  const text='мама🚀\nмама🚀';
  const bytes=utf8(text);
  const first=compiler.appendBook(bytes,{id:'book-1'});
  const second=compiler.appendBook(bytes,{id:'book-2'});
  assert.match(first.rootLinkId,/^[1-9][0-9]*$/);
  assert.equal(first.rootLinkId,second.rootLinkId);
  assert.ok(first.insertedLinks>0&&first.insertedPairs>0);
  assert.equal(second.insertedLinks,0);
  assert.equal(first.codepoints,[...text].length);
  assert.equal(first.sourceAliasesCreated,0);
  const rows=readNumericLinks(db);
  assert.ok(rows.every(r=>typeof r.link_id==='bigint'));
  assert.ok(rows.every(r=>r.from_id===null||typeof r.from_id==='bigint'));
  const final=compiler.finalize();
  assert.equal(final.links,String(rows.length));
  assert.ok(final.indexPlans.from.some(x=>x.includes('idx_links_from')));
  assert.ok(final.indexPlans.to.some(x=>x.includes('idx_links_to')));
  assert.equal(verifyNumericLinks(db).links,BigInt(rows.length));
  const docs=[{id:'book-1',rootLinkId:first.rootLinkId,bytes},
   {id:'book-2',rootLinkId:second.rootLinkId,bytes}];
  assert.equal(replayNumericRoots(db,docs).status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  const cold=coldNumericCorpusReplay(db,docs);
  assert.equal(cold.status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  assert.equal(cold.readOnly,true);
  assert.ok(cold.sqliteVacuumBytes>0);
 }finally{db.close();}
});

test('identity distinct from structure: reuse policy optional, equal-pole Links can coexist',()=>{
 const db=newNumericLinkDb();
 try{
  const compiler=new NumericCorpusLoader(db,{reusePairs:false});
  const result=compiler.appendBook(utf8('aaaa'),{id:'independent'});
  const pairs=readNumericLinks(db).filter(x=>x.from_id!==null);
  const repeated=pairs.filter(x=>x.from_id===pairs[0].from_id&&x.to_id===pairs[0].to_id);
  assert.ok(repeated.length>=2);
  assert.notEqual(repeated[0].link_id,repeated[1].link_id);
  compiler.finalize();
  assert.equal(replayNumericRoots(db,[{id:'independent',rootLinkId:result.rootLinkId,bytes:utf8('aaaa')}]).documents.length,1);
 }finally{db.close();}
});

test('new book contributes only newly required structural Link rows, with per-source metrics',()=>{
 const db=newNumericLinkDb();
 try{
  const compiler=new NumericCorpusLoader(db);
  const sources=['aаaа','aаaа','бббa',''];
  const docs=sources.map((source,i)=>{
   const bytes=utf8(source),m=compiler.appendBook(bytes,{id:'text-'+i});
   for(const key of ['decodeMs','compileAndSqlInsertMs','commitMs','loadTotalMs','insertLinksPerSecond','inputMiBPerSecond','sqliteLogicalBytesAfter','rssAfterBytes'])
    assert.equal(Number.isFinite(m[key]),true,key);
   assert.ok(m.sourceBytes>=0&&m.insertedLinks>=0);
   return {id:m.id,rootLinkId:m.rootLinkId,bytes,metrics:m};
  });
  assert.equal(docs[1].metrics.insertedLinks,0);
  const f=compiler.finalize();
  assert.ok(f.counterRebuildMs>=0&&f.integrityCheckMs>=0);
  assert.equal(replayNumericRoots(db,docs).documents.length,docs.length);
 }finally{db.close();}
});

test('rollback of late SQL failure clears caches and cannot publish a partial book',()=>{
 const db=newNumericLinkDb();
 try{
  const compiler=new NumericCorpusLoader(db);
  compiler.appendBook(utf8('GOOD'),{id:'accepted'});
  const before=readNumericLinks(db);
  db.exec("CREATE TRIGGER stop_bang BEFORE INSERT ON links WHEN NEW.string='!' BEGIN SELECT RAISE(ABORT,'refused symbol'); END;");
  assert.throws(()=>compiler.appendBook(utf8('G!'),{id:'rejected'}),/refused symbol/);
  assert.deepEqual(readNumericLinks(db),before);
  db.exec('DROP TRIGGER stop_bang');
  const after=compiler.appendBook(utf8('G!'),{id:'accepted-2'});
  assert.ok(after.insertedLinks>0);
  compiler.finalize();
  assert.equal(replayNumericRoots(db,[{id:'accepted-2',bytes:utf8('G!'),rootLinkId:after.rootLinkId}]).documents.length,1);
 }finally{db.close();}
});

test('malformed UTF-8, budget, and untrusted input fail without publication',()=>{
 const db=newNumericLinkDb();
 try{
  const compiler=new NumericCorpusLoader(db);
  assert.throws(()=>compiler.appendBook(Buffer.from([0xc3,0x28])),/encoded|encoding|UTF|valid/i);
  assert.throws(()=>compiler.appendBook(utf8('AB'),{maxCodePoints:1}),/RESOURCE_LIMIT/);
  assert.throws(()=>compiler.appendBook('not a Buffer'),/HASHLESS_CORPUS/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM links').get().n,0);
  const result=compiler.appendBook(utf8('🚀'),{id:'one'});
  compiler.finalize();
  assert.throws(()=>replayNumericRoots(db,[{id:'one',rootLinkId:result.rootLinkId,bytes:utf8('no')}]),/byte-for-byte/);
  assert.throws(()=>replayNumericRoots(db,[{id:'one',rootLinkId:result.rootLinkId,bytes:utf8('🚀')}],{maxCodePoints:0}),/RESOURCE_LIMIT/);
 }finally{db.close();}
});
