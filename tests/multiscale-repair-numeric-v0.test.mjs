import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newNumericLinkDb} from '../src/numeric-link-store-v1.mjs';
import {replayNumericRoots,coldNumericCorpusReplay} from '../src/numeric-corpus-loader-v1.mjs';
import {summarizeRepairGrammar,UniversalRepairNumericLoader}
 from '../src/universal-repair-numeric-v0.mjs';
import {trainMultiscaleRepair} from '../src/multiscale-repair-numeric-v0.mjs';
import {compareUniversalRepairCorpus} from '../src/universal-repair-ab-v0.mjs';
const book=(id,t)=>({id,bytes:Buffer.from(t,'utf8')});
test('W5 learns repeated multi-level 8+ character phrases with NO word boundary hints',()=>{
 const train=[
  book('a','ABCDEFGH!'.repeat(20)),
  book('b','ABCDEFGH?'.repeat(20)),
  book('c','ABCDEFGH.'.repeat(20))
 ];
 const g=trainMultiscaleRepair(train,{maxLevels:10,maxRulesPerLevel:32,
  minOccurrences:2,maxCodepointsPerBook:500});
 assert.ok(g.levels.length>=2);
 assert.ok(g.rules.some(x=>x.length>=8),'at least one 8+ character selected grammar rule');
 assert.ok(g.rules.some(x=>x.level>=2),'structures recur across multiple substitution layers');
 assert.ok(g.rules.every(x=>Number.isSafeInteger(x.token)));
 const m=summarizeRepairGrammar(g);
 assert.equal(m.ruleCount,g.ruleCount);
 assert.ok(m.topRules.some(x=>x.expandedCodepoints>=4));
 const db=newNumericLinkDb();
 try{
  const c=new UniversalRepairNumericLoader(db,g);
  const d=book('heldout','ABCDEFGH!ABCDEFGH?🚀\r\nABCDEFGH.');
  const a=c.appendBook(d.bytes,{id:d.id});
  assert.equal(a.hashDerivedLinkIds,0);
  assert.ok(a.selectedLearnedOccurrences>0);
  assert.equal(coldNumericCorpusReplay(db,[{...d,rootLinkId:a.rootLinkId}]).status,
    'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 }finally{db.close();}
});
test('W5 deterministic corpus split, byte replay and measured long-sequence coverage',()=>{
 const docs=Array.from({length:10},(_,i)=>book('x'+i,
  'abcdefgh!'.repeat(12)+(i%5===4?'🚀\r\n':'A')));
 const b={books:10,sourceBytes:docs.reduce((n,x)=>n+x.bytes.length,0),
  insertedLinks:1000,insertWallMs:10,sqliteVacuumBytes:100000};
 const a=compareUniversalRepairCorpus(docs,b,{algorithm:'multiscale',
  maxLevels:8,maxRulesPerLevel:16,maxCodepointsPerBook:200,minOccurrences:2});
 assert.equal(a.algorithm,'multiscale');
 assert.equal(a.split.train.length,8);
 assert.equal(a.split.heldout.length,2);
 assert.ok(a.grammar.ruleCount>0);
 assert.ok(a.coverage.heldout.covered>0);
 assert.ok(a.numericGraph.physicalLinks>0);
 assert.equal(a.numericGraph.hashDerivedLinkIds,0);
 assert.ok(a.selectedLengthHistogram['8-15']>=0||
  a.selectedLengthHistogram['4-7']>=0);
 assert.throws(()=>compareUniversalRepairCorpus(docs,b,{algorithm:'unknown'}),/unsupported/);
});
test('W5 rejects fabricated sources and empty training bounds',()=>{
 assert.throws(()=>trainMultiscaleRepair([]),/invalid/);
 assert.throws(()=>trainMultiscaleRepair([book('a','aaa')],{maxLevels:33}),/invalid/);
 assert.throws(()=>trainMultiscaleRepair([book('a','aaa'),book('a','aaa')]),/duplicate/);
 assert.throws(()=>trainMultiscaleRepair([{id:'invalid',bytes:Buffer.from([0x80])}]),/encoded|valid|UTF|encoding/i);
});
