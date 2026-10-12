import assert from 'node:assert/strict';
import {test} from 'node:test';
import {compareUniversalRepairCorpus} from '../src/universal-repair-ab-v0.mjs';
const text=(id,source)=>({id,bytes:Buffer.from(source,'utf8')});
test('W4 48/12 split analogue is fixed before training, universal numeric SQLite replay',()=>{
 const docs=Array.from({length:10},(_,i)=>text('book-'+i,
  i%5===4?'ZZZ xyz!xyz!xyz! 🚀\r\n':'xyz!xyz!xyz! '.repeat(4)+(i%2?' X':'')));
 const metrics={books:10,sourceBytes:docs.reduce((n,x)=>n+x.bytes.length,0),
  insertedLinks:1000,insertWallMs:10,sqliteVacuumBytes:99999};
 const r=compareUniversalRepairCorpus(docs,metrics,{
  maxCodepointsPerBook:200,maxRules:24,minOccurrences:2
 });
 assert.equal(r.status,'UNIVERSAL_NUMERIC_COLD_REPLAY_PASS');
 assert.deepEqual(r.split.heldout,['book-4','book-9']);
 assert.equal(r.coverage.train.books,8);
 assert.equal(r.coverage.heldout.books,2);
 assert.ok(r.grammar.ruleCount>=2);
 assert.ok(r.numericGraph.physicalLinks>0);
 assert.equal(r.numericGraph.hashDerivedLinkIds,0);
 assert.equal(r.numericGraph.coldStatus,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 assert.ok(r.numericGraph.sqliteVacuumBytes>0);
 assert.ok(r.topSelected.every(x=>/^[1-9]\d*$/.test(x.physicalLinkId)));
 assert.ok(Number.isFinite(r.comparison.universalToBalancedLinkRatio));
 assert.equal(r.comparison.wordAlignedPhysicalLinks,null);
});
test('W4 denies missing and duplicate source data and fabricated baseline',()=>{
 const docs=Array.from({length:5},(_,i)=>text('id-'+i,'abc abc abc abc'));
 assert.throws(()=>compareUniversalRepairCorpus([],{books:0}),/exact complete/);
 assert.throws(()=>compareUniversalRepairCorpus(docs,{books:4,insertedLinks:10,insertWallMs:2,sqliteVacuumBytes:100}),/exact complete/);
 const duplicate=[...docs];duplicate[1]=text('id-0','abc');
 assert.throws(()=>compareUniversalRepairCorpus(duplicate,{
  books:5,sourceBytes:10,insertedLinks:10,insertWallMs:2,sqliteVacuumBytes:100}),/duplicate/);
});
