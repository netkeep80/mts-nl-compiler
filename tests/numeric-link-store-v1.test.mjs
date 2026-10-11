import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {
 MAX_LINK_ID,NUMERIC_LINK_SCHEMA_V1,formatLinkId,parseLinkId,
 newNumericLinkDb,importNumericGraph,readNumericLinks,
 numericIndexPlans,verifyNumericLinks,initializeNumericLinks
} from '../src/numeric-link-store-v1.mjs';

const graph=[
 {key:'а',string:'а',weight:null},
 {key:'z',string:'🚀',weight:0},
 {key:'parallel-1',from:'а',to:'z',weight:null},
 {key:'parallel-2',from:'а',to:'z',weight:0},
 {key:'self',from:'self',to:'а',weight:1},
 {key:'mutual-A',from:'mutual-B',to:'а',weight:null},
 {key:'mutual-B',from:'mutual-A',to:'z',weight:0}
];
const rowBy=(rows,id)=>rows.find(x=>x.link_id===id);

test('native 64-bit INTEGER PRIMARY KEY AUTOINCREMENT + separate indexed poles',()=>{
 const db=newNumericLinkDb();
 try{
  const list=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' ORDER BY name").all();
  assert.deepEqual(list.map(x=>x.name),['idx_links_from','idx_links_to']);
  assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='links'").get().sql,
   /INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.doesNotMatch(NUMERIC_LINK_SCHEMA_V1,/WITHOUT ROWID|UNIQUE\s*\(\s*from_id/);
  const plan=numericIndexPlans(db);
  assert.ok(plan.from.some(x=>/idx_links_from/.test(x)),JSON.stringify(plan));
  assert.ok(plan.to.some(x=>/idx_links_to/.test(x)),JSON.stringify(plan));
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 }finally{db.close();}
});

test('opaque temporary aliases map to SQLite BigInt and preserve cycles, parallel Links and weights',()=>{
 const db=newNumericLinkDb();
 try{
  const ids=importNumericGraph(db,graph);
  const rows=readNumericLinks(db);
  assert.equal(rows.length,7);
  assert.deepEqual([...ids.keys()],[...ids.keys()].sort());
  for(const id of ids.values())assert.equal(typeof id,'bigint');
  assert.equal(rowBy(rows,ids.get('а')).string,'а');
  assert.equal(rowBy(rows,ids.get('z')).string,'🚀');
  assert.equal(rowBy(rows,ids.get('self')).from_id,ids.get('self'));
  assert.equal(rowBy(rows,ids.get('mutual-A')).from_id,ids.get('mutual-B'));
  assert.equal(rowBy(rows,ids.get('mutual-B')).from_id,ids.get('mutual-A'));
  const a=rowBy(rows,ids.get('parallel-1')),b=rowBy(rows,ids.get('parallel-2'));
  assert.notEqual(a.link_id,b.link_id);
  assert.equal(a.from_id,b.from_id);
  assert.equal(a.to_id,b.to_id);
  assert.equal(a.weight,null);
  assert.equal(b.weight,0);
  assert.equal(verifyNumericLinks(db).links,7n);
  const q=db.prepare('SELECT link_id FROM links WHERE from_id=? ORDER BY link_id');q.setReadBigInts(true);
  assert.deepEqual(q.all(ids.get('а')).map(x=>x.link_id),
   [ids.get('parallel-1'),ids.get('parallel-2')]);
 }finally{db.close();}
});

test('allocation order deterministic under row permutation, no hash-derived physical identity',()=>{
 const a=newNumericLinkDb(),b=newNumericLinkDb();
 try{
  const x=importNumericGraph(a,graph);
  const y=importNumericGraph(b,[...graph].reverse());
  assert.deepEqual([...x],[...y]);
  assert.deepEqual(readNumericLinks(a),readNumericLinks(b));
  assert.equal(readNumericLinks(a)[0].link_id,1n);
 }finally{a.close();b.close();}
});

test('invalid graph rejected; transaction rolls back when SQL aborts after ID allocation',()=>{
 const db=newNumericLinkDb();
 try{
  for(const bad of [
   [{key:'dup',string:'a',weight:null},{key:'dup',string:'b',weight:null}],
   [{key:'missing',from:'unknown',to:'missing',weight:null}],
   [{key:'half',from:'half',to:'',weight:null}],
   [{key:'bad',string:'a',weight:NaN}],
   [{key:'bad',string:'a',weight:2}],
   [{key:'bad',string:'a',weight:null,hash:'untrusted'}],
  ])assert.throws(()=>importNumericGraph(db,bad),/NUMERIC_LINK_V1/);
  const before=readNumericLinks(db);
  db.exec("CREATE TRIGGER fail_late BEFORE UPDATE ON links WHEN NEW.string='REJECT' BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  assert.throws(()=>importNumericGraph(db,[{key:'k',string:'REJECT',weight:null}]),/injected failure/);
  assert.deepEqual(readNumericLinks(db),before);
  assert.equal(verifyNumericLinks(db).links,0n);
  db.exec('DROP TRIGGER fail_late');
  const ids=importNumericGraph(db,[{key:'k',string:'ok',weight:null}]);
  assert.equal(ids.get('k'),1n);
 }finally{db.close();}
});

test('committed deleted ID never reused, manual max signed 64-bit boundary fails closed',()=>{
 const db=newNumericLinkDb(),maxdb=newNumericLinkDb();
 try{
  const first=importNumericGraph(db,[{key:'a',string:'a',weight:null}]).get('a');
  db.prepare('DELETE FROM links WHERE link_id=?').run(first);
  const second=importNumericGraph(db,[{key:'b',string:'b',weight:null}]).get('b');
  assert.ok(second>first);
  maxdb.prepare('INSERT INTO links(link_id,string) VALUES(?,?)').run(MAX_LINK_ID-1n,'near-max');
  const stmt=maxdb.prepare('INSERT INTO links(string) VALUES(?)');stmt.setReadBigInts(true);
  assert.equal(stmt.run('last').lastInsertRowid,MAX_LINK_ID);
  assert.throws(()=>stmt.run('overflow'),/full|maximum|database or disk is full/i);
  assert.equal(verifyNumericLinks(maxdb).links,2n);
 }finally{db.close();maxdb.close();}
});

test('64-bit BigInt external decimal transport rejects rounding and noncanonical values',()=>{
 assert.equal(formatLinkId(MAX_LINK_ID),'9223372036854775807');
 assert.equal(parseLinkId('9223372036854775807'),MAX_LINK_ID);
 assert.equal(parseLinkId('9007199254740993'),9007199254740993n);
 for(const invalid of ['0','-1','01','1.0',' 1','9223372036854775808','a:hash','p:hash'])
  assert.throws(()=>parseLinkId(invalid),/NUMERIC_LINK_V1/);
 assert.throws(()=>formatLinkId(9007199254740993),/BigInt/);
});

test('foreign key prevents dangling references and nested import, no concurrent identity corruption',()=>{
 const db=newNumericLinkDb();
 try{
  const ids=importNumericGraph(db,[{key:'a',string:'a',weight:null}]);
  assert.throws(()=>db.prepare('INSERT INTO links(from_id,to_id) VALUES(?,?)').run(999n,ids.get('a')),/FOREIGN KEY/);
  db.exec('BEGIN IMMEDIATE');
  try{assert.throws(()=>importNumericGraph(db,[{key:'b',string:'b',weight:null}]),/nested transaction/);}
  finally{db.exec('ROLLBACK');}
 }finally{db.close();}
});
