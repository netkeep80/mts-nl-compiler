import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newNumericLinkDb,readNumericLinks} from '../src/numeric-link-store-v1.mjs';
import {replayNumericRoots,coldNumericCorpusReplay} from '../src/numeric-corpus-loader-v1.mjs';
import {trainUniversalRepair,summarizeRepairGrammar,UniversalRepairNumericLoader}
 from '../src/universal-repair-numeric-v0.mjs';

const book=(id,text)=>({id,bytes:Buffer.from(text,'utf8')});
function isRootReachable(db,root,target){
 const rows=new Map(readNumericLinks(db).map(r=>[r.link_id,r]));
 const seen=new Set(),stack=[BigInt(root)];
 while(stack.length){
  const id=stack.pop();if(id===target)return true;
  if(seen.has(id))continue;seen.add(id);
  const row=rows.get(id);
  if(!row)throw Error('not found');
  if(row.from_id!==null)stack.push(row.from_id,row.to_id);
 }
 return false;
}
test('language-blind recursion learns long repeated sequences, including across spaces and nonwords',()=>{
 const corpus=[book('a','xyz!xyz!xyz!xyz! xyz!xyz!'),
  book('b','xyz!xyz!xyz! ## xyz!')];
 const g=trainUniversalRepair(corpus,{maxRules:24,minOccurrences:2,maxCodepointsPerBook:200});
 assert.ok(g.ruleCount>=2);
 assert.ok(g.rules.some(x=>x.length>=4),'at least one expansion >=4 chars');
 assert.ok(g.rules.every(x=>!Object.hasOwn(x,'linkId')));
 assert.ok(g.rules.every(x=>Number.isSafeInteger(x.token)));
 const s=summarizeRepairGrammar(g);
 assert.equal(s.ruleCount,g.ruleCount);
 assert.ok(s.topRules.some(x=>x.expandedCodepoints>=4));
 const db=newNumericLinkDb();
 try{
  const compiler=new UniversalRepairNumericLoader(db,g);
  const docs=[book('a','xyz!xyz!xyz!xyz! xyz!xyz!'),
   book('b','xyz!xyz!xyz! ## xyz!'),book('unseen','🚀\r\nXYZ!\ufeff')];
  const roots=[];
  for(const d of docs){
   const o=compiler.appendBook(d.bytes,{id:d.id});
   assert.match(o.rootLinkId,/^[1-9][0-9]*$/);
   assert.equal(o.hashDerivedLinkIds,0);
   if(d.id!=='unseen')assert.ok(o.selectedLearnedOccurrences>0);
   roots.push({...d,rootLinkId:o.rootLinkId});
  }
  assert.equal(replayNumericRoots(db,roots).documents.length,3);
  const cold=coldNumericCorpusReplay(db,roots);
  assert.equal(cold.status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
  for(const row of compiler.selected.values())
   assert.equal(isRootReachable(db,roots[0].rootLinkId,BigInt(row.linkId))||
    isRootReachable(db,roots[1].rootLinkId,BigInt(row.linkId))||
    isRootReachable(db,roots[2].rootLinkId,BigInt(row.linkId)),true);
  assert.equal(compiler.finalize().links,db.prepare('SELECT COUNT(*) n FROM links').get().n.toString());
 }finally{db.close();}
});
test('training ignores held-out text and never assumes words, punctuation, or space semantics',()=>{
 const train=[book('t','......::::::......::::::'),book('u','......::::::')];
 const holdout=book('heldout','HELLO WORLD HELLO WORLD');
 const a=trainUniversalRepair(train,{maxRules:16,minOccurrences:2});
 const b=trainUniversalRepair(train,{maxRules:16,minOccurrences:2});
 assert.deepEqual(summarizeRepairGrammar(a),{
  ...summarizeRepairGrammar(b),elapsedMs:summarizeRepairGrammar(a).elapsedMs,
  pairCountingMs:summarizeRepairGrammar(a).pairCountingMs,
  nonoverlapSelectionMs:summarizeRepairGrammar(a).nonoverlapSelectionMs});
 assert.equal(a.symbols.has('H'),false);
 assert.ok(a.rules.some(r=>r.text.includes('.')));
 const db=newNumericLinkDb();
 try{
  const loader=new UniversalRepairNumericLoader(db,a);
  const o=loader.appendBook(holdout.bytes,{id:holdout.id});
  assert.equal(o.codepoints,[...holdout.bytes.toString('utf8')].length);
  assert.equal(replayNumericRoots(db,[{...holdout,rootLinkId:o.rootLinkId}]).status,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 }finally{db.close();}
});
test('source and grammar parameter falsifiers fail rather than publish partial Links',()=>{
 assert.throws(()=>trainUniversalRepair([]),/invalid/);
 assert.throws(()=>trainUniversalRepair([book('a','abc'),book('a','abc')]),/duplicate/);
 assert.throws(()=>trainUniversalRepair([book('a','abc')],{maxRules:513}),/invalid/);
 assert.throws(()=>trainUniversalRepair([{id:'a',bytes:Buffer.from([0x80])}]),/encoded|UTF|valid|encoding/i);
 const g=trainUniversalRepair([book('a','ab ab ab ab')],{minOccurrences:2,maxRules:8});
 const db=newNumericLinkDb();
 try{
  const loader=new UniversalRepairNumericLoader(db,g);
  assert.throws(()=>loader.appendBook(Buffer.from('abcdef'),{maxCodePoints:2}),/RESOURCE_LIMIT/);
  const before=readNumericLinks(db);
  db.exec("CREATE TRIGGER stop BEFORE INSERT ON links WHEN NEW.string='!' BEGIN SELECT RAISE(ABORT,'blocked'); END;");
  assert.throws(()=>loader.appendBook(Buffer.from('abc!')),/blocked/);
  assert.deepEqual(readNumericLinks(db),before);
  assert.throws(()=>loader.appendBook(Buffer.from('abc')),/previous document failed/);
 }finally{db.close();}
});
test('nonoverlapping pair training does not promote a single overlap as repeat',()=>{
 const g=trainUniversalRepair([book('x','aaa')],{maxRules:10,minOccurrences:2});
 assert.equal(g.ruleCount,0);
 const h=trainUniversalRepair([book('x','aaaa')],{maxRules:10,minOccurrences:2});
 assert.equal(h.ruleCount,1);
 assert.equal(h.rules[0].trainingDisjointReplacements,2);
});
