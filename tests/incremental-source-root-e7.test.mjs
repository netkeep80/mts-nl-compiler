import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {IncrementalSourceRoot} from '../src/incremental-source-root-e7.mjs';
import {leaf,pair,makeTree,encodeShared} from '../src/dag.mjs';
import {sqliteReplay} from '../src/real-corpus-e0.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
function reference(points){
 if(!points.length)return encodeShared(leaf(''));
 const groups=[];let offset=0;
 while(offset<points.length){
  let power=1;
  while(power*2<=points.length-offset)power*=2;
  groups.push(makeTree(points.slice(offset,offset+power),'balanced'));
  offset+=power;
 }
 let tree=groups[0];for(let i=1;i<groups.length;i++)tree=pair(tree,groups[i]);
 return encodeShared(tree);
}

test('E7 every prefix matches independent power-of-two DAG oracle and exact bytes',()=>{
 const texts=['','мама','ма'.repeat(70),'A→B; Б→A','ё е\u0308 🚀\r\n','αβ'.repeat(30)];
 for(const input of texts){
  const e=new IncrementalSourceRoot({maxCodePoints:1000});
  const cp=[...input];
  for(let i=0;i<=cp.length;i++){
   const original=cp.slice(0,i).join('');
   const independent=reference(cp.slice(0,i));
   assert.equal(e.snapshot().root,independent.root,'independent structural root '+i);
   assert.equal(e.snapshot().sourceSha256,sha(Buffer.from(original)));
   assert.equal(e.decode(),original);
   assert.equal(e.snapshot().sourceBytes,Buffer.byteLength(original));
   const live=e.selectedRows();
   assert.deepEqual(live.length,independent.atoms.size+independent.links.size);
   assert.deepEqual(e.selectedRows(),live);
   if(i<cp.length){
    const result=e.append(cp[i],{eventId:'source:'+i});
    assert.equal(result.status,'APPLIED');
   }
  }
  assert.ok(e.snapshot().work.maxNewLinksPerAppend<=
   2*Math.ceil(Math.log2(Math.max(2,cp.length+1)))+2);
 }
});

test('E7 old roots remain immutable, exact eventId replay is idempotent',()=>{
 const e=new IncrementalSourceRoot();
 const first=e.append('м',{eventId:'s:0'});
 const rootBefore=first.root;
 const second=e.append('а',{eventId:'s:1'});
 const snapshot=e.snapshot();
 const duplicate=e.append('а',{eventId:'s:1'});
 assert.equal(duplicate.status,'REPLAY_NOOP');
 assert.deepEqual(e.snapshot(),snapshot);
 assert.equal(e.decode(rootBefore),'м');
 assert.equal(e.decode(second.root),'ма');
 assert.throws(()=>e.append('б',{eventId:'s:1'}),/contradictory/);
});

test('E7 budget fail-closed; no partially published Link rows or event IDs',()=>{
 const e=new IncrementalSourceRoot({maxCodePoints:2,maxRows:3});
 e.append('A',{eventId:'0'});
 const before=e.snapshot();
 assert.throws(()=>e.append('B',{eventId:'1'}),/RESOURCE_LIMIT Link rows/);
 assert.deepEqual(e.snapshot(),before);
 assert.equal(e.decode(),'A');
 assert.equal(e.events.has('1'),false);
 const bounded=new IncrementalSourceRoot({maxCodePoints:1});
 bounded.append('a',{eventId:'x'});
 assert.throws(()=>bounded.append('b',{eventId:'y'}),/RESOURCE_LIMIT codepoints/);
 assert.equal(bounded.decode(),'a');
});

test('E7 rejects malformed Unicode and bounded decode',()=>{
 const e=new IncrementalSourceRoot();
 for(const input of ['', '\ud800', 'ab', '\udc00'])
  assert.throws(()=>e.append(input,{eventId:'bad'}),/scalar/);
 assert.throws(()=>e.append('x',{eventId:''}),/eventId/);
 for(const [i,c] of [...'мама'].entries())e.append(c,{eventId:''+i});
 assert.throws(()=>e.decode(e.root,{maxCodePoints:3}),/RESOURCE_LIMIT/);
});

test('E7 selected root replays through the sole physical SQLite links table',()=>{
 const e=new IncrementalSourceRoot();
 const source='мама → χ²\n🚀';
 for(const [i,s] of [...source].entries())e.append(s,{eventId:'e'+i});
 const rows=e.selectedRows();
 const compiled=[{graph:{root:e.root},source,metrics:{id:'e7',inputSha256:sha(Buffer.from(source))}}];
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));
  const result=sqliteReplay(db,rows,compiled);
  assert.equal(result.status,'SQLITE_ONE_TABLE_EXACT_REPLAY_PASS');
  assert.equal(result.rows,rows.length);
  assert.equal(result.pairRows,rows.filter(r=>r.from_id!==null).length);
 }finally{db.close();}
});
