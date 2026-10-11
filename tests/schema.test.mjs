import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {loadRows,validateClosure,rebuildCounters,counterMismatches} from '../src/store.mjs';
import {readNumericLinks,formatLinkId,parseLinkId,numericIndexPlans} from '../src/numeric-link-store-v1.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const open=()=>{const db=new DatabaseSync(':memory:');db.exec(read('../db/schema.sql'));return db;};
const atom=(link_id,string,weight=null)=>({link_id,from_id:null,to_id:null,string,weight});
const pair=(link_id,from_id,to_id,string=null,weight=null)=>({link_id,from_id,to_id,string,weight});

test('canonical SQLite has one subject table + internal sqlite_sequence and separately indexed poles',()=>{
 const db=open();
 try{
  const subject=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  assert.deepEqual(subject.map(x=>x.name),['links']);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").get());
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_links_%' ORDER BY name").all().map(r=>r.name);
  assert.deepEqual(names,['idx_links_from','idx_links_to']);
  const plans=numericIndexPlans(db);
  assert.match(plans.from.join(' '),/idx_links_from/);
  assert.match(plans.to.join(' '),/idx_links_to/);
  const rows=JSON.parse(read('../data/links.json'));
  loadRows(db,rows);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM links').get().n,rows.length);
  assert.deepEqual(counterMismatches(db),[]);
 }finally{db.close();}
});
test('legacy source maps to numeric SQLite IDs with labeled/parallel links and accurate caches',()=>{
 const db=open();
 try{
  const rows=[atom('m','м'),atom('a','а'),pair('ma','m','a','ма',1),
   pair('ma2','m','a',null,0),pair('mama','ma','ma','мама',.8)];
  const ids=loadRows(db,rows).idMap;
  validateClosure(db);
  assert.equal(typeof ids.get('ma'),'bigint');
  assert.notEqual(ids.get('ma'),ids.get('ma2'));
  assert.equal(parseLinkId(formatLinkId(ids.get('m'))),ids.get('m'));
  const q=db.prepare('SELECT from_uses,to_uses FROM links WHERE link_id=?');q.setReadBigInts(true);
  assert.deepEqual({...q.get(ids.get('ma'))},{from_uses:1n,to_uses:1n});
  assert.deepEqual({...q.get(ids.get('m'))},{from_uses:2n,to_uses:0n});
  const weighted=db.prepare('SELECT weight FROM links WHERE link_id=?').get(ids.get('m'));
  assert.equal(weighted.weight,null);
  const pairRows=readNumericLinks(db).filter(x=>x.from_id===ids.get('m')&&x.to_id===ids.get('a'));
  assert.equal(pairRows.length,2);
  assert.equal(pairRows.find(x=>x.link_id===ids.get('ma')).string,'ма');
  assert.deepEqual(counterMismatches(db),[]);
  for(const invalid of [
   [pair('bad','m','',null,.3)],
   [pair('bad','m','a',null,-.1)],
   [pair('bad','m','a',null,1.1)],
   [atom('m','duplicate'),atom('m','again')]
  ])assert.throws(()=>loadRows(db,invalid));
  assert.deepEqual(counterMismatches(db),[]);
 }finally{db.close();}
});
test('counter rebuild after numeric mutations; dangling pair fails exact closure check',()=>{
 const db=open();
 try{
  const ids=loadRows(db,[atom('a','a'),pair('aa','a','a')]).idMap;
  assert.deepEqual(counterMismatches(db),[]);
  const extra=db.prepare('INSERT INTO links(from_id,to_id) VALUES(?,?)');extra.setReadBigInts(true);
  const third=extra.run(ids.get('aa'),ids.get('a')).lastInsertRowid;
  assert.equal(typeof third,'bigint');
  assert.notDeepEqual(counterMismatches(db),[]);
  rebuildCounters(db);assert.deepEqual(counterMismatches(db),[]);
  db.prepare('DELETE FROM links WHERE link_id=?').run(third);
  rebuildCounters(db);assert.deepEqual(counterMismatches(db),[]);
  assert.throws(()=>extra.run(10000n,ids.get('a')),/FOREIGN KEY/);
  validateClosure(db);
 }finally{db.close();}
});
