import assert from 'node:assert/strict';
import {test} from 'node:test';
import {leaf,makeTree,codePoints,encodeShared,decodeShared} from '../src/dag.mjs';
import {newNumericLinkDb,readNumericLinks,verifyNumericLinks,formatLinkId} from '../src/numeric-link-store-v1.mjs';
import {migrateLegacyLinks,validateLegacyLinkRows,decodeNumericSource} from '../src/numeric-legacy-bridge-v1.mjs';

const atom=(link_id,string,weight=null)=>({link_id,from_id:null,to_id:null,string,weight});
const pair=(link_id,from_id,to_id,string=null,weight=null)=>({link_id,from_id,to_id,string,weight});
const source=[
 atom('m','м'),atom('a','а'),
 pair('ma','m','a','ма',null),
 pair('ma2','m','a',null,0),
 pair('self','self','ma','самоссылка',1),
 pair('cycle-A','cycle-B','ma'),
 pair('cycle-B','cycle-A','m')
];
test('legacy string alias migration preserves full five-field Link graph with numeric physical IDs',()=>{
 const db=newNumericLinkDb();
 try{
  const x=migrateLegacyLinks(db,source);
  assert.equal(x.numericLinks,7);
  assert.deepEqual(x.restored,validateLegacyLinkRows(source));
  const rows=readNumericLinks(db);
  assert.equal(rows.length,7);
  assert.ok(rows.every(r=>typeof r.link_id==='bigint'));
  const id=x.idMap;
  assert.notEqual(id.get('ma'),id.get('ma2'));
  assert.equal(rows.find(r=>r.link_id===id.get('ma')).string,'ма');
  assert.equal(rows.find(r=>r.link_id===id.get('ma2')).string,null);
  assert.equal(rows.find(r=>r.link_id===id.get('ma')).from_id,id.get('m'));
  assert.equal(rows.find(r=>r.link_id===id.get('self')).from_id,id.get('self'));
  assert.equal(rows.find(r=>r.link_id===id.get('cycle-A')).from_id,id.get('cycle-B'));
  assert.equal(rows.find(r=>r.link_id===id.get('cycle-B')).from_id,id.get('cycle-A'));
  assert.equal(verifyNumericLinks(db).links,7n);
 }finally{db.close();}
});
test('independent ordering of external legacy keys does not alter numeric graph identity allocation',()=>{
 const a=newNumericLinkDb(),b=newNumericLinkDb();
 try{
  const x=migrateLegacyLinks(a,source),y=migrateLegacyLinks(b,[...source].reverse());
  assert.deepEqual([...x.idMap],[...y.idMap]);
  assert.deepEqual(readNumericLinks(a),readNumericLinks(b));
  assert.deepEqual(x.restored,y.restored);
 }finally{a.close();b.close();}
});
test('repeated semantically identical links get distinct new numeric identities',()=>{
 const db=newNumericLinkDb();
 try{
  const x=migrateLegacyLinks(db,[atom('a','x'),pair('b','a','a')]);
  const y=migrateLegacyLinks(db,[atom('a','x'),pair('b','a','a')]);
  assert.notEqual(x.idMap.get('a'),y.idMap.get('a'));
  assert.notEqual(x.idMap.get('b'),y.idMap.get('b'));
  assert.equal(verifyNumericLinks(db).links,4n);
 }finally{db.close();}
});
test('E0/DAG legacy hash-addressed source imports into SQLite without hash-addressed physical IDs',()=>{
 const input='мама🚀A→B м\u0430ма';
 const g=encodeShared(makeTree(codePoints(input),'balanced'));
 const rows=[
  ...[...g.atoms].map(([link_id,string])=>atom(link_id,string)),
  ...[...g.links].map(([link_id,v])=>pair(link_id,v.from_id,v.to_id))
 ];
 const db=newNumericLinkDb();
 try{
  const m=migrateLegacyLinks(db,rows);
  assert.equal(m.numericLinks,rows.length);
  const root=m.idMap.get(g.root);
  assert.equal(typeof root,'bigint');
  assert.equal(decodeNumericSource(db,root),input);
  assert.equal(decodeShared(g),input);
  assert.ok(readNumericLinks(db).every(r=>!String(r.link_id).startsWith('p:')));
  assert.equal(typeof formatLinkId(root),'string');
 }finally{db.close();}
});
test('malformed input never publishes partial new Link rows',()=>{
 const db=newNumericLinkDb();
 try{
  const invalid=[
   [atom('m','м'),atom('m','а')],
   [pair('missing','a','not-present')],
   [atom('a','a',1.1)],
   [{...atom('a','a'),origin:'injected'}],
   [pair('bad','x',null)],
  ];
  for(const rows of invalid)assert.throws(()=>migrateLegacyLinks(db,rows),/NUMERIC_LEGACY_MIGRATION/);
  assert.equal(readNumericLinks(db).length,0);
 }finally{db.close();}
});
test('decoded cyclic selected source must explicitly reject and enforce budget',()=>{
 const db=newNumericLinkDb();
 try{
  const r=migrateLegacyLinks(db,source);
  assert.throws(()=>decodeNumericSource(db,r.idMap.get('self')),/cyclic/);
  assert.throws(()=>decodeNumericSource(db,r.idMap.get('ma'),{maxCodePoints:1}),/RESOURCE_LIMIT/);
  assert.equal(decodeNumericSource(db,r.idMap.get('ma')),'ма');
 }finally{db.close();}
});
