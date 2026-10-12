import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectSourceWindows,proposeSourceUnits,segmentSource,InMemoryLinkGraph,
 trainSingleScalarAnchors,materializeScalarAnchor,compareSourceFirst,
 trainSourceFirstPairGrammar,materializeFrozenPairGrammar}
 from '../src/source-first-frequencies-v0.mjs';
import {SourceFirstNumericLoader,compareNumericSourceAnchors}
 from '../src/source-first-sqlite-v0.mjs';
import {newNumericLinkDb} from '../src/numeric-link-store-v1.mjs';
import {coldNumericCorpusReplay} from '../src/numeric-corpus-loader-v1.mjs';
const doc=(id,s)=>({id,bytes:Buffer.from(s,'utf8')});
const corpus=()=>[doc('a','кот|дом|кот|дом|кот|дом|'),doc('b','дом|кот|дом|кот|дом|'),
 doc('c','кот|дом|кот|дом|кот|'),doc('d','дом|кот|дом|кот|дом|'),
 doc('e','кот|дом|кот|дом|кот|')];
test('W11 histogram counts complete overlapping source windows, NOT balanced Link events',()=>{
 const h=collectSourceWindows([doc('a','aaaa'),doc('b','aa')],{maxWidth:3});
 assert.equal(h.frequency.get('aa'),4);
 assert.equal(h.frequency.get('aaa'),2);
 assert.equal(h.observedSlidingWindows,6);
 assert.equal(h.documentFrequency.get('aa'),2);
 assert.equal(h.documentFrequency.get('aaa'),1);
 assert.equal(h.frequency.has('a'+'a'.repeat(3)),false);
 assert.deepEqual([...segmentSource([...'aaaa'],[{text:'aaa',length:3,count:2}])],['aaa','a']);
});
test('W11 strict UTF8, scalar length, BOM, emoji and document separation',()=>{
 const h=collectSourceWindows([doc('a','🚀\ufeff\r\n'),doc('b','\u0308🚀')],{maxWidth:3});
 assert.equal(h.frequency.get('🚀\ufeff'),1);
 assert.equal(h.frequency.has('\n\u0308'),false);
 assert.equal(h.frequency.get('🚀\ufeff\r'),1);
 assert.equal(h.sourceScalars,6);
 assert.throws(()=>collectSourceWindows([doc('x','ok'),doc('x','ok')]),/duplicate/);
 assert.throws(()=>collectSourceWindows([{id:'x',bytes:Buffer.from([0xff])}]),/UTF|encoding|noncanonical|encoded/i);
});
test('W11 frozen units cannot change raw source; double-pole is a composite Link',()=>{
 const h=collectSourceWindows([doc('x','aaaa'),doc('y','aaaa')]);
 const proposed=proposeSourceUnits(h,{minOccurrences:3});
 const g=new InMemoryLinkGraph();
 const r=g.add('aaaa',{units:proposed});
 assert.equal(g.expand(r.root),'aaaa');
 assert.ok(g.nodes.some(x=>x.left!==null&&x.left===x.right));
 assert.equal(g.physicalLinks,g.reachableLinks);
});
test('W11 learned separator is chosen from corpus, not from a whitespace predicate',()=>{
 const docs=corpus();
 const a=trainSingleScalarAnchors(docs,{maxProbe:12,minOccurrences:2});
 const translation=x=>x.replaceAll('|','◇');
 const translated=docs.map(d=>doc(d.id,translation(d.bytes.toString('utf8'))));
 const b=trainSingleScalarAnchors(translated,{maxProbe:12,minOccurrences:2});
 assert.equal(a.selectedScalar,'|');
 assert.equal(b.selectedScalar,'◇');
 const ga=materializeScalarAnchor(docs,a.selectedScalar);
 const gb=materializeScalarAnchor(translated,b.selectedScalar);
 assert.equal(ga.graph.physicalLinks,gb.graph.physicalLinks);
});
test('W11 training choice unaffected by any heldout-only source change',()=>{
 const docs=corpus(),train=docs.filter((_,i)=>i%5!==4);
 const x=trainSingleScalarAnchors(train,{maxProbe:12,minOccurrences:2});
 const mutated=docs.map((d,i)=>i===4?doc('e','🦊♟🦊♟🦊♟'):d);
 const y=trainSingleScalarAnchors(mutated.filter((_,i)=>i%5!==4),{maxProbe:12,minOccurrences:2});
 assert.deepEqual(x,y);
});
test('W11 train-only blind A/B and actual SQLite cold replay share exact link count',()=>{
 const docs=corpus(),split=docs.filter((_,i)=>i%5!==4);
 const chosen=trainSingleScalarAnchors(split,{maxProbe:12,minOccurrences:2});
 assert.equal(chosen.selectedScalar,'|');
 const result=compareSourceFirst(docs,{maxScalarsPerDocument:100,maxCandidates:20,maxWidth:4});
 assert.equal(result.status,'EXACT_REPLAY_PASS');
 assert.equal(result.trainDocuments,4);
 assert.equal(result.heldoutDocuments,1);
 const inMemory=materializeScalarAnchor(docs,chosen.selectedScalar);
 const stored=compareNumericSourceAnchors(docs,chosen.selectedScalar,{maxScalars:100});
 assert.equal(stored.sourceFirst.physicalLinks,inMemory.graph.physicalLinks);
 assert.equal(stored.sourceFirst.coldStatus,'EXACT_NUMERIC_SQLITE_REPLAY_PASS');
 const balanced=new InMemoryLinkGraph();for(const d of docs)balanced.add(d.bytes.toString('utf8'));
 assert.equal(stored.balanced.physicalLinks,balanced.physicalLinks);
});
test('W11 dynamic grammar re-counts structural pairs after using raw source counts on first pass',()=>{
 const docs=corpus(),g=trainSourceFirstPairGrammar(docs,{maxRules:8,minOccurrences:2});
 assert.equal(g.firstPassObservedPairs,docs.reduce((n,d)=>n+[...d.bytes.toString('utf8')].length-1,0));
 assert.ok(g.rules.length>=1);
 const {graph}=materializeFrozenPairGrammar(docs,g,{maxScalarsPerDocument:100});
 assert.ok(graph.physicalLinks>0);
});