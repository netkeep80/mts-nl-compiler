import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newNumericLinkDb,readNumericLinks,verifyNumericLinks,
  rebuildNumericCounters} from '../src/numeric-link-store-v1.mjs';
import {replayNumericRoots,coldNumericCorpusReplay}
  from '../src/numeric-corpus-loader-v1.mjs';
import {exactFrontierShapes,planExactReassociation,
  materializeImprovingReassociation}
  from '../src/exact-reassociation-oracle-v0.mjs';

function fixture(chars=['🦊','ж','⟐','🌌']){
 const db=newNumericLinkDb();
 const atom=db.prepare('INSERT INTO links(string,weight) VALUES(?,NULL)');
 const pair=db.prepare('INSERT INTO links(from_id,to_id,string,weight) VALUES(?,?,NULL,NULL)');
 atom.setReadBigInts(true);pair.setReadBigInts(true);
 const leaves=chars.map(x=>atom.run(x).lastInsertRowid);
 const [a,b,c,d]=leaves;
 const ab=pair.run(a,b).lastInsertRowid;
 const abc=pair.run(ab,c).lastInsertRowid;
 const old=pair.run(abc,d).lastInsertRowid;
 const cd=pair.run(c,d).lastInsertRowid;
 rebuildNumericCounters(db);
 return {db,frontier:leaves.map(String),oldRoot:String(old),
  retainedRoots:[String(cd)],text:chars.join('')};
}
const args=f=>({oldRoot:f.oldRoot,frontier:f.frontier,
  retainedRoots:f.retainedRoots});
test('exhaustive 4/5/6 binary regroupings are 5/14/42',()=>{
 assert.deepEqual([4,5,6].map(w=>exactFrontierShapes(w).length),[5,14,42]);
 assert.throws(()=>exactFrontierShapes(7),/unsupported window/);
});
test('exact reachable oracle prefers shared Link over local frequency proxy',()=>{
 const f=fixture();
 try {
  const oldRows=readNumericLinks(f.db);
  const plan=planExactReassociation(f.db,args(f));
  assert.equal(plan.evaluatedTrees,5);
  assert.equal(plan.oldExpandedScalars,4);
  assert.equal(plan.improve,true);
  assert.equal(plan.selected.reachableDelta,-1);
  assert.equal(plan.selected.newPhysicalRows,1);
  assert.equal(plan.selected.retiredReachableLinks,2);
  assert.equal(plan.selected.introducedLinkCount,1);
  assert.deepEqual(readNumericLinks(f.db),oldRows,'oracle must be read-only');
  const actual=materializeImprovingReassociation(f.db,args(f));
  assert.equal(actual.status,'NEW_ROOT_MATERIALIZED');
  assert.equal(actual.insertedPhysicalRows,1);
  assert.equal(actual.rootPublication,'EXTERNAL_NOT_ATOMIC');
  assert.equal(readNumericLinks(f.db).length,oldRows.length+1,
   'append-only physical count grows even when rooted reachability improves');
  const docs=[{id:'new',bytes:Buffer.from(f.text,'utf8'),rootLinkId:actual.rootLinkId},
   {id:'old',bytes:Buffer.from(f.text,'utf8'),rootLinkId:f.oldRoot},
   {id:'pinned',bytes:Buffer.from('⟐🌌','utf8'),rootLinkId:f.retainedRoots[0]}];
  assert.equal(replayNumericRoots(f.db,docs).status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  assert.equal(coldNumericCorpusReplay(f.db,docs).status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  assert.equal(verifyNumericLinks(f.db).links,BigInt(oldRows.length+1));
 }finally{f.db.close();}
});
test('pinned old root blocks false garbage-collection savings',()=>{
 const f=fixture();
 try {
  const p=planExactReassociation(f.db,{...args(f),
    retainedRoots:[...f.retainedRoots,f.oldRoot]});
  assert.equal(p.improve,false);
  assert.ok(p.candidates.every(x=>x.reachableDelta>=0));
  const before=readNumericLinks(f.db);
  const result=materializeImprovingReassociation(f.db,{...args(f),
    retainedRoots:[...f.retainedRoots,f.oldRoot]});
  assert.equal(result.status,'NO_IMPROVEMENT');
  assert.equal(result.rootLinkId,f.oldRoot);
  assert.deepEqual(readNumericLinks(f.db),before);
 }finally{f.db.close();}
});
test('unsafe input and source-changing leaf order rejected, no allocation',()=>{
 const f=fixture();
 try {
  const before=readNumericLinks(f.db);
  assert.throws(()=>planExactReassociation(f.db,{...args(f),
    frontier:[...f.frontier].reverse()}),/changes exact source/);
  assert.throws(()=>planExactReassociation(f.db,{...args(f),
    frontier:f.frontier.slice(0,3)}),/frontier width/);
  assert.throws(()=>planExactReassociation(f.db,{...args(f),
    oldRoot:'1.0'}),/noncanonical/);
  assert.throws(()=>planExactReassociation(f.db,{...args(f),
    retainedRoots:['9999999']}),/missing physical/);
  assert.deepEqual(readNumericLinks(f.db),before);
 }finally{f.db.close();}
});
test('SQL failure atomically rolls back new Link materialization',()=>{
 const f=fixture();
 try {
  const original=readNumericLinks(f.db);
  f.db.exec(`CREATE TRIGGER w7_reject BEFORE INSERT ON links
    WHEN NEW.from_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'W7_INJECTED_FAILURE'); END`);
  assert.throws(()=>materializeImprovingReassociation(f.db,args(f)),
    /W7_INJECTED_FAILURE/);
  assert.equal(f.db.isTransaction,false);
  assert.deepEqual(readNumericLinks(f.db),original);
  assert.equal(replayNumericRoots(f.db,[{id:'original',rootLinkId:f.oldRoot,
    bytes:Buffer.from(f.text,'utf8')}]).status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 }finally{f.db.close();}
});
test('oracle handles six nonword leaves, duplicate physical pairs without asserting link identity',()=>{
 const f=fixture(['🙂','∅','⊙','☃','α','!']);
 try {
  const [a,b,c,d,e,g]=f.frontier;
  // Build a left-associated 6-character old root and a reusable 6th suffix.
  const pair=f.db.prepare('INSERT INTO links(from_id,to_id,string,weight) VALUES(?,?,NULL,NULL)');
  pair.setReadBigInts(true);
  const combine=(x,y)=>String(pair.run(BigInt(x),BigInt(y)).lastInsertRowid);
  const old=combine(combine(combine(combine(a,b),c),d),combine(e,g));
  const suffix=combine(e,g);
  // Identical poles are allowed in two independently allocated physical Links.
  const duplicate=combine(e,g);
  assert.notEqual(suffix,duplicate);
  rebuildNumericCounters(f.db);
  const p=planExactReassociation(f.db,{oldRoot:old,frontier:f.frontier,
    retainedRoots:[suffix]});
  assert.equal(p.evaluatedTrees,42);
  assert.equal(p.oldExpandedScalars,6);
  assert.equal(p.candidates.length,42);
  assert.ok(p.candidates.every(x=>x.newPhysicalRows>=0));
  assert.equal(replayNumericRoots(f.db,[{id:'six',rootLinkId:old,
    bytes:Buffer.from('🙂∅⊙☃α!','utf8')}]).status,
    'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 }finally{f.db.close();}
});


test('all frontier widths 4/5/6 demonstrate strictly smaller reachable DAG with real SQLite reuse',()=>{
 const alphabet=['α','🧿','∅','ζ','🌌','⟐'];
 for(const width of [4,5,6]){
  const db=newNumericLinkDb();
  try{
   const atom=db.prepare('INSERT INTO links(string,weight) VALUES(?,NULL)');
   const pair=db.prepare('INSERT INTO links(from_id,to_id,string,weight) VALUES(?,?,NULL,NULL)');
   atom.setReadBigInts(true);pair.setReadBigInts(true);
   const chars=alphabet.slice(0,width);
   const leaves=chars.map(x=>atom.run(x).lastInsertRowid);
   let old=leaves[0];
   for(const leaf of leaves.slice(1))old=pair.run(old,leaf).lastInsertRowid;
   const pinned=pair.run(leaves[width-2],leaves[width-1]).lastInsertRowid;
   rebuildNumericCounters(db);
   const input={oldRoot:String(old),frontier:leaves.map(String),retainedRoots:[String(pinned)]};
   const plan=planExactReassociation(db,input);
   assert.equal(plan.evaluatedTrees,exactFrontierShapes(width).length);
   assert.equal(plan.improve,true,'width '+width+' must find retained physical reuse');
   assert.equal(plan.selected.reachableDelta,-1);
   assert.equal(plan.selected.newPhysicalRows,1);
   const oldPhysical=readNumericLinks(db).length;
   const applied=materializeImprovingReassociation(db,input);
   assert.equal(applied.insertedPhysicalRows,1);
   assert.equal(readNumericLinks(db).length,oldPhysical+1);
   const expected=Buffer.from(chars.join(''),'utf8');
   const roots=[
    {id:'new'+width,rootLinkId:applied.rootLinkId,bytes:expected},
    {id:'old'+width,rootLinkId:String(old),bytes:expected},
    {id:'pinned'+width,rootLinkId:String(pinned),
      bytes:Buffer.from(chars.slice(-2).join(''),'utf8')}
   ];
   assert.equal(coldNumericCorpusReplay(db,roots).status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  }finally{db.close();}
 }
});
