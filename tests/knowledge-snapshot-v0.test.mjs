import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonicalPhysicalLinks,logicalGraphDigest,buildKnowledgeSnapshot} from '../src/knowledge-snapshot-v0.mjs';
const schema=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex');
const atom=(link_id,string,weight=null)=>({link_id,from_id:null,to_id:null,string,weight});
const pair=(link_id,from_id,to_id,weight=null)=>({link_id,from_id,to_id,string:null,weight});
const fixture=[atom('α','а'),atom('б','б'),pair('pair-2','α','б',0),
 pair('pair-1','α','б',null),pair('cycle','cycle','pair-1',1)];
test('bootstrap actual Git-owned data/links.json materializes reproducibly',()=>{
 const links=JSON.parse(readFileSync(new URL('../data/links.json',import.meta.url),'utf8'));
 const first=buildKnowledgeSnapshot({rows:links,schemaSql:schema});
 const second=buildKnowledgeSnapshot({rows:links,schemaSql:schema});
 assert.deepEqual(first.manifest,second.manifest);
 assert.equal(sha(first.sqlite),sha(second.sqlite));
 assert.equal(first.manifest.graph.sha256,logicalGraphDigest(links).sha256);
 assert.equal(first.manifest.sqliteSha256,sha(first.sqlite));
 assert.equal(first.manifest.sourceStatus,'BOOTSTRAP_UNTRAINED__NOT_SEMANTICALLY_VERIFIED');
});
test('permutations preserve exact cycle/parallel IDs and null vs zero weight',()=>{
 const a=buildKnowledgeSnapshot({rows:fixture,schemaSql:schema});
 const b=buildKnowledgeSnapshot({rows:[...fixture].reverse(),schemaSql:schema});
 assert.deepEqual(a.manifest,b.manifest);
 assert.ok(a.sqlite.equals(b.sqlite));
 assert.equal(a.manifest.graph.links,5);
 assert.equal(canonicalPhysicalLinks(fixture)[0].link_id,'cycle');
 assert.notEqual(logicalGraphDigest(fixture).sha256,
   logicalGraphDigest(fixture.map(x=>x.link_id==='pair-1'?{...x,weight:0}:x)).sha256);
 assert.equal(a.manifest.sqliteBytes,a.sqlite.length);
});
test('invalid source Link structures fail before SQLite publication',()=>{
 const bad=[
  [atom('dup','a'),atom('dup','b')],
  [pair('missing','none','none')],
  [atom('atom',null)],
  [pair('half','x',null)],
  [atom('nan','n',Number.NaN)],
  [{...atom('extra','x'),frequency:1}],
  [pair('bad','', 'x')]
 ];
 for(const rows of bad)assert.throws(()=>buildKnowledgeSnapshot({rows,schemaSql:schema}),/KNOWLEDGE_SNAPSHOT_INVALID/);
 assert.throws(()=>buildKnowledgeSnapshot({rows:fixture,schemaSql:'',productVersion:'0.1.0'}),/KNOWLEDGE_SNAPSHOT_INVALID/);
 assert.throws(()=>buildKnowledgeSnapshot({rows:fixture,schemaSql:schema,productVersion:'bad'}),/KNOWLEDGE_SNAPSHOT_INVALID/);
});

test('cold independent SQLite consumer is read-only with same physical identity graph',()=>{
 const built=buildKnowledgeSnapshot({rows:fixture,schemaSql:schema});
 const dir=mkdtempSync(join(tmpdir(),'mnc-rg324-cold-'));
 try{
  const path=join(dir,'knowledge.sqlite');
  writeFileSync(path,built.sqlite);
  const cold=new DatabaseSync(path,{readOnly:true});
  try{
   assert.equal(cold.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   const actual=cold.prepare('SELECT link_id,from_id,to_id,string,weight FROM links ORDER BY link_id').all();
   assert.deepEqual(actual.map(({link_id,from_id,to_id,string,weight})=>({link_id,from_id,to_id,string,weight})),canonicalPhysicalLinks(fixture));
   assert.throws(()=>cold.exec("INSERT INTO links(link_id,string) VALUES('extra','invalid')"),/readonly/i);
  }finally{cold.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
