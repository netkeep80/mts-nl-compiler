import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {Script,createContext} from 'node:vm';
import {compileText,compareModes,scalarsOf,learnLocalPairs} from '../docs/compiler/engine.mjs';

const modes=['balanced','left','repair'];
const examples=['','а','мама','мама мыла раму.','абабабабаб','⟼🧪📘\n\n🧪','а\u0000б\u0001в\t\r\n',
 'a\u0301á😇é🇷🇺','лоло лоло лоло лоло'];
const replayFromJSON=r=>{
 const map=new Map(r.nodes.map(n=>[n.id,n]));
 const out=[];const stack=r.root===null?[]:[r.root];
 while(stack.length){
  const n=map.get(stack.pop());
  if(!n)throw Error('broken pole reference');
  if(n.kind==='atom')out.push(n.symbol);
  else{stack.push(n.to);stack.push(n.from);}
 }
 return out.join('');
};

test('W21: all three algorithms round-trip Unicode including non-BMP, controls, combining marks',()=>{
 for(const source of examples){
  for(const mode of modes){
   const r=compileText(source,{mode});
   assert.equal(r.source,source);
   assert.equal(replayFromJSON(r),source);
   assert.equal(r.scalars,scalarsOf(source).length);
   assert.equal(r.utf8Bytes,Buffer.byteLength(source,'utf8'));
   assert.equal(r.metrics.expandedPairOccurrences,Math.max(0,r.scalars-1));
   assert.equal(r.metrics.expandedAtomOccurrences,r.scalars);
   assert.ok(r.metrics.uniqueLinks<=r.scalars+r.metrics.expandedPairOccurrences);
   assert.equal(r.metrics.uniqueLinks,r.metrics.uniqueAtoms+r.metrics.uniquePairs);
   assert.equal(r.status,r.scalars===0?'EMPTY_INPUT':'EXACT_REPLAY_PASS');
   assert.ok(r.localLinkIdWarning.includes('not SQLite'));
   assert.ok(r.scientificWarning.includes('not semantics'));
  }
 }
});
test('W21: balanced DAG reuses the same overlapping visible fragment without semantic rules',()=>{
 const balanced=compileText('мама',{mode:'balanced'});
 const left=compileText('мама',{mode:'left'});
 assert.equal(balanced.metrics.uniquePairs,2);
 assert.equal(left.metrics.uniquePairs,3);
 assert.equal(balanced.metrics.expandedPairOccurrences,3);
 assert.equal(balanced.metrics.reusedPairOccurrences,1);
 assert.equal(balanced.topPairs[0].uses,2);
 assert.equal(balanced.topPairs[0].preview,'ма');
});
test('W21: iterative Re-Pair selects frequency and verifies nonoverlapping substitutions',()=>{
 const r=compileText('абабабабаб',{mode:'repair',minOccurrences:2});
 assert.ok(r.learnedRules.length>=1);
 assert.ok(r.learnedRules.some(x=>x.length>=4));
 assert.ok(r.learnedRules.every(x=>x.disjointReplacements>=2));
 assert.ok(r.learnedRules.every(x=>x.observedAdjacent>=x.disjointReplacements));
 assert.ok(r.finalUnits<r.scalars);
 assert.equal(replayFromJSON(r),'абабабабаб');
 assert.equal(r.trainingMode,'IN_SAMPLE_SINGLE_TEXT_ONLY');
 const none=compileText('ааа',{mode:'repair',minOccurrences:2});
 assert.equal(none.learnedRules.length,0,'3 identical symbols offer only one disjoint aa occurrence');
 const enough=compileText('аааа',{mode:'repair',minOccurrences:2});
 assert.ok(enough.learnedRules.length>=1);
 assert.equal(enough.learnedRules[0].disjointReplacements,2);
});
test('W21: deterministic tie break and stable numeric session IDs',()=>{
 const text='aabbccddeeaabbccddeeaabbcc';
 const one=compileText(text,{mode:'repair'});
 const two=compileText(text,{mode:'repair'});
 assert.deepEqual(two,one);
 const compare=compareModes(text);
 assert.deepEqual(compare.map(x=>x.mode),modes);
 for(const x of compare)assert.equal(x.expandedPairOccurrences,scalarsOf(text).length-1);
});
test('W21: graph immutable pole ordering and no hash-derived or persistent Link IDs',()=>{
 const r=compileText('абба абба абба',{mode:'repair'});
 for(const n of r.nodes){
  assert.ok(Number.isSafeInteger(n.id)&&n.id>0);
  if(n.kind==='pair'){
   assert.ok(n.from<n.id&&n.to<n.id,'poles must preexist and stay immutable');
   assert.ok(n.length>1);
  }
 }
 assert.equal(new Set(r.nodes.map(n=>n.id)).size,r.nodes.length);
 assert.ok(!JSON.stringify(r).includes('sha256'));
});
test('W21: exact guard rejects bad text, unpaired surrogates and resource exhaustion',()=>{
 for(const mode of modes){
  assert.throws(()=>compileText('\uD800',{mode}),/unpaired/);
  assert.throws(()=>compileText('\uDC00',{mode}),/unpaired/);
  assert.throws(()=>compileText(null,{mode}),/Unicode string/);
  assert.throws(()=>compileText('а'.repeat(2049),{mode}),/limit exceeded/);
 }
 assert.equal(scalarsOf('😀').length,1);
 assert.throws(()=>compileText('abc',{mode:'magic'}),/invalid grouping/);
 assert.throws(()=>compileText('abc',{maxCodepoints:5000}),/resource cap/);
 assert.throws(()=>compileText('abc',{mode:'repair',maxRules:129}),/research limits/);
 assert.throws(()=>learnLocalPairs(['а'],{minOccurrences:1}),/research limits/);
});
test('W21: learned structures are not general-language predictions and cannot reveal unseen meaning',()=>{
 const r=compileText('система должна проверять запись. система должна проверять запись.');
 assert.ok(r.learnedRules.length>0);
 assert.equal(r.status,'EXACT_REPLAY_PASS');
 assert.ok(r.scientificWarning.includes('in-sample pair discovery is not'));
 // Comparing physical storage capacity to scalar count is forbidden:
 // only raw source byte count and structural unique pair count are reported.
 assert.equal(r.metrics.sqliteBytes,undefined);
 assert.equal(r.metrics.semanticAccuracy,undefined);
 assert.equal(r.metrics.probability,undefined);
});
test('W21: static Pages entry points and relative imports work under /docs/compiler',()=>{
 const html=readFileSync(new URL('../docs/compiler/index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../docs/compiler/app.mjs',import.meta.url),'utf8');
 assert.ok(html.includes('<script type="module" src="./app.mjs"></script>'));
 assert.ok(ui.includes("from './engine.mjs'"));
 assert.ok(html.includes('href="../observatory/"'));
 assert.ok(html.includes('id="source"'));
 assert.ok(html.includes('id="tree"'));
 assert.ok(html.includes('id="metrics"'));
 assert.ok(html.includes('id="comparison"'));
 assert.ok(!html.includes('https://cdn.'));
 assert.ok(!ui.includes('fetch('));
 assert.ok(!ui.includes('.innerHTML'));
 assert.ok(!ui.includes('eval('));
});
test('W21: UI executes real engine in isolated fake DOM, including hostile literal input',()=>{
 const script=readFileSync(new URL('../docs/compiler/app.mjs',import.meta.url),'utf8')
  .replace(/^import \{compileText,compareModes\} from '\.\/engine\.mjs';\n/,'');
 const callbacks=new Map();
 class FakeElement{
  constructor(tag='div'){
   this.tag=tag;this.children=[];this.attributes={};
   this.textContent='';this.hidden=false;this.disabled=false;this.value='';
   this.className='';this.open=false;
  }
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(name,fn){callbacks.set(this.id+':'+name,fn);}
 }
 const els=new Map();
 const get=id=>{
  if(!els.has(id)){const el=new FakeElement();el.id=id;els.set(id,el);}
  return els.get(id);
 };
 get('source').value='мама мама мама';
 get('mode').value='repair';get('maxRules').value='48';
 get('minOccurrences').value='2';get('maxRuleCodepoints').value='64';
 const fakeDoc={getElementById:get,createElement:t=>new FakeElement(t)};
 const context=createContext({document:fakeDoc,console,TextEncoder,compileText,compareModes,performance:{now:()=>123},
  navigator:{clipboard:{writeText:async()=>{}}}});
 new Script(script,{filename:'app.mjs'}).runInContext(context);
 assert.equal(get('result').hidden,false);
 assert.equal(get('details').hidden,false);
 assert.equal(get('copy').disabled,false);
 assert.equal(get('metrics').children.length,9);
 assert.ok(get('replay').textContent.includes('EXACT REPLAY PASS'));
 assert.equal(get('comparison').children[0].tag,'table');
 get('source').value='<img src=x onerror=alert(1)>🏴‍☠️';
 callbacks.get('compile:click')();
 assert.equal(get('result').hidden,false);
 // The source never becomes HTML markup. All links/text are created with textContent.
 assert.equal(get('source').value,'<img src=x onerror=alert(1)>🏴‍☠️');
 get('source').value='\uD800';
 callbacks.get('compile:click')();
 assert.equal(get('result').hidden,true);
 assert.ok(get('status').textContent.includes('unpaired'));
});
