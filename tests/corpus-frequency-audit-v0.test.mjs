import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newNumericLinkDb,readNumericLinks} from '../src/numeric-link-store-v1.mjs';
import {CountedNumericCorpusLoader} from '../src/corpus-top-report-v1.mjs';
import {auditCorpusFrequencies,frequencyAuditMarkdown} from '../src/corpus-frequency-audit-v0.mjs';
const doc=(id,text)=>({id,bytes:Buffer.from(text,'utf8')});
function run(documents,fn){
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  for(const d of documents)loader.appendBook(d.bytes,{id:d.id});
  loader.finalize();
  return fn({db,loader});
 }finally{db.close();}
}

test('W10 actual scalar frequencies conserved in Link terminals independent of pair grouping',()=>{
 const docs=[doc('a',', ааа ааа, ааа '),doc('b',' ааа а, ааа')];
 run(docs,({db,loader})=>{
  const a=auditCorpusFrequencies(docs,loader,{topN:30});
  assert.equal(a.status,'SOURCE_ATOM_TREE_CONSERVATION_PASS');
  assert.equal(a.sourceScalars,docs.reduce((n,d)=>n+[...d.bytes.toString('utf8')].length,0));
  const scalar=new Map(a.scalarTop.map(x=>[x.text,x.count]));
  assert.ok(scalar.get('а')>scalar.get(' '));
  assert.ok(scalar.get(' ')>scalar.get(','),'spaces counted independently from comma-space nodes');
  assert.equal(a.checkedAtoms,3);
  assert.equal(a.observedPairEvents,a.sourcePairWindows);
  assert.equal(a.checkedTopLinkNodes>0,true);
  assert.equal(a.syllableLikeTop.some(x=>x.text==='аа'),false,
   'two-vowel sequence is not a single-nucleus orthographic candidate');
  const md=frequencyAuditMarkdown(a);
  assert.match(md,/Независимая проверка частот/);
  assert.match(md,/Буквы/);
  const atoms=readNumericLinks(db).filter(x=>x.from_id===null);
  assert.equal(atoms.some(x=>x.string===' '),true);
  assert.ok(atoms.every(x=>x.to_id===null));
 });
});

test('W10 overlapping source bigrams != observed balanced-tree Link node events',()=>{
 const docs=[doc('one','aaaa'),doc('two','aa')];
 run(docs,({db,loader})=>{
  const a=auditCorpusFrequencies(docs,loader);
  const row=a.bigramTop.find(x=>x.text==='aa');
  assert.equal(row.count,4,'three overlapping windows in aaaa, one in aa');
  assert.equal(row.balancedTreeOccurrences,3,'two balanced nodes from aaaa, one from aa');
  assert.equal(row.sampledTop1000LinkOccurrences,3);
  const coverage=new Map(a.structuralCoverageByLength.map(x=>[x.scalars,x]));
  assert.deepEqual(coverage.get(2),{scalars:2,sourceWindows:4,nodeEvents:3,fraction:0.75});
  assert.deepEqual(coverage.get(3),{scalars:3,sourceWindows:2,nodeEvents:0,fraction:0});
  assert.deepEqual(coverage.get(4),{scalars:4,sourceWindows:1,nodeEvents:1,fraction:1});
  assert.match(frequencyAuditMarkdown(a),/Доля окон исходника/);
  const atom=readNumericLinks(db).find(x=>x.from_id===null);
  const selfPolePair=readNumericLinks(db).find(x=>x.from_id===atom.link_id&&x.to_id===atom.link_id);
  assert.ok(selfPolePair,'equal poles create a composite aa Link');
  assert.equal(selfPolePair.string,null,'a self-equal endpoint pair is not an atom');
 });
});

test('W10 correct Unicode scalars: BOM, combining marks, CR/LF, emoji and empty source',()=>{
 const docs=[doc('mixed','\ufeffa\u0308\r\n🚀, 🚀'),doc('empty','')];
 run(docs,({loader})=>{
  const a=auditCorpusFrequencies(docs,loader);
  const chars=new Map(a.scalarTop.map(x=>[x.text,x.count]));
  for(const c of ['\ufeff','\u0308','\r','\n','🚀',',',' '])assert.ok(chars.has(c));
  assert.equal(chars.get('🚀'),2);
  assert.equal(a.sourcePairWindows,[...'\ufeffa\u0308\r\n🚀, 🚀'].length-1);
 });
});

test('W10 mismatched atomic and structural event counters fail closed',()=>{
 const docs=[doc('x','abcabc')];
 run(docs,({loader})=>{
  const original=loader.pairEvents;loader.pairEvents++;
  assert.throws(()=>auditCorpusFrequencies(docs,loader),/structural event conservation/);
  loader.pairEvents=original;
  const id=[...loader.atomCounts.keys()][0],entry=loader.atomCounts.get(id);
  entry.count++;
  assert.throws(()=>auditCorpusFrequencies(docs,loader),/atomic count differs/);
 });
});

test('W10 no cross-document ngram windows, no linguistic hints, Cyrillic posthoc filter',()=>{
 const docs=[doc('first','лес'),doc('second','у')];
 run(docs,({loader})=>{
  const a=auditCorpusFrequencies(docs,loader);
  assert.equal(a.sourcePairWindows,2);
  assert.ok(a.bigramTop.some(x=>x.text==='ле'));
  assert.equal(a.bigramTop.some(x=>x.text==='су'),false);
  assert.ok(a.syllableLikeTop.some(x=>x.text==='ле'));
  assert.equal(a.syllableLikeTop.some(x=>x.text==='су'),false);
 });
});