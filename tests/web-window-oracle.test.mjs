import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createContext,Script} from 'node:vm';
import {inspectLocalWindow} from '../docs/compiler/window-oracle.mjs';
import {compileText,scalarsOf} from '../docs/compiler/engine.mjs';

const catalan={2:1,3:2,4:5,5:14,6:42,7:132,8:429};
test('W22: exact exhaustive Catalan counts and baseline Link structures',()=>{
 const all='мамамама';
 for(let width=2;width<=8;width++){
  const slice=[...all].slice(0,width).join('');
  const r=inspectLocalWindow(all,{width,offset:0});
  assert.equal(r.treeCount,catalan[width]);
  assert.equal(r.windowText,slice);
  assert.equal(r.balanced.uniquePairs,compileText(slice,{mode:'balanced'}).metrics.uniquePairs);
  assert.equal(r.left.uniquePairs,compileText(slice,{mode:'left'}).metrics.uniquePairs);
  assert.ok(r.minimumUniquePairs<=r.balanced.uniquePairs);
  assert.ok(r.minimumUniquePairs<=r.left.uniquePairs);
  assert.ok(r.minimumUniquePairs>0);
  assert.ok(r.uniqueOptima>0&&r.uniqueOptima<=r.treeCount);
  assert.ok(r.candidates.every(c=>c.repeatedPairOccurrences===width-1-c.uniquePairs));
  assert.equal(r.status,'EXHAUSTIVE_LOCAL_WINDOW');
  assert.equal(r.limits.globalOptimality,false);
 }
});
test('W22: мама local grouping has 2 unique pairs vs left 3, no semantic boundaries',()=>{
 const x=inspectLocalWindow('мама',{width:4,offset:0});
 assert.equal(x.treeCount,5);
 assert.equal(x.minimumUniquePairs,2);
 assert.equal(x.balanced.uniquePairs,2);
 assert.equal(x.left.uniquePairs,3);
 assert.equal(x.left.deltaPairs,1);
 assert.equal(x.balanced.deltaPairs,0);
 assert.equal(x.candidates[0].uniquePairs,2);
 assert.ok(x.candidates[0].expression.includes('⟼'));
});
test('W22: repeated symbols and nonrepeating symbols expose structural negative controls',()=>{
 const a=inspectLocalWindow('аааааааа',{width:8});
 assert.equal(a.treeCount,429);
 assert.equal(a.minimumUniquePairs,3);
 assert.equal(a.balanced.uniquePairs,3);
 assert.equal(a.left.uniquePairs,7);
 assert.equal(a.left.deltaPairs,4);
 const independent=inspectLocalWindow('абвгдеёж',{width:8});
 assert.equal(independent.minimumUniquePairs,7);
 assert.equal(independent.left.deltaPairs,0);
 assert.equal(independent.balanced.deltaPairs,0);
});
test('W22: each ranked candidate expands in exact Unicode scalar order and is deterministic',()=>{
 for(const text of ['мама баба','🧪🙂🧪🙂🧪🙂🧪🙂','abc"ab\\c','а\u0301а\u0301а\u0301а\u0301','    аб  ']){
  const points=scalarsOf(text),width=Math.min(8,points.length);
  const x=inspectLocalWindow(text,{width,offset:0,topN:20});
  const y=inspectLocalWindow(text,{width,offset:0,topN:20});
  assert.deepEqual(y,x);
  for(const c of x.candidates){
   const lexical=(c.expression.match(/"(?:\\.|[^"\\])*"/g)??[]).map(s=>JSON.parse(s)).join('');
   assert.equal(lexical,x.windowText,'rendered tree must cold-decode as source');
   assert.ok(c.uniquePairs>=x.minimumUniquePairs);
   assert.equal(c.deltaVsBalanced,x.balanced.uniquePairs-c.uniquePairs);
   assert.equal(c.deltaVsLeft,x.left.uniquePairs-c.uniquePairs);
  }
  assert.equal(x.candidates[0].uniquePairs,x.minimumUniquePairs);
  assert.ok(x.candidates.every((c,i,a)=>i===0||a[i-1].uniquePairs<=c.uniquePairs));
 }
});
test('W22: sliding front moves one Unicode scalar at a time including emoji and CR/LF',()=>{
 const text='☀️🧪\nмама';
 const points=[...text];
 const width=6;
 for(let offset=0;offset<=points.length-width;offset++){
  const x=inspectLocalWindow(text,{width,offset});
  assert.equal(x.offset,offset);
  assert.equal(x.rightFront,offset+width);
  assert.equal(x.windowText,points.slice(offset,offset+width).join(''));
  assert.equal(x.sourceScalars,points.length);
 }
 const suffix=inspectLocalWindow(text,{width});
 assert.equal(suffix.offset,points.length-width);
 assert.equal(suffix.windowText,points.slice(-width).join(''));
});
test('W22: fails closed on invalid Unicode, out-of-bound widths and offsets',()=>{
 assert.throws(()=>inspectLocalWindow('\uD800aaaaaaa',{width:8}),/unpaired/);
 assert.throws(()=>inspectLocalWindow('12345678',{width:9}),/width/);
 assert.throws(()=>inspectLocalWindow('12345678',{width:1}),/width/);
 assert.throws(()=>inspectLocalWindow('12345678',{width:8,offset:1}),/offset/);
 assert.throws(()=>inspectLocalWindow('12345678',{width:8,offset:-1}),/offset/);
 assert.throws(()=>inspectLocalWindow('1234',{width:8}),/shorter/);
 assert.throws(()=>inspectLocalWindow('12345678',{width:8,topN:100}),/topN/);
 assert.throws(()=>inspectLocalWindow('',{width:2}),/shorter/);
});
test('W22: window inspector is transparent about physical and global limits',()=>{
 const result=inspectLocalWindow('мама мыла раму',{width:8});
 assert.equal(result.limits.physicalLinkIds,false);
 assert.equal(result.limits.contextReusedPairs,false);
 assert.equal(result.limits.probabilityModel,false);
 assert.equal(result.limits.sourceTraining,'in-sample structural enumeration; not an independent heldout test');
 assert.equal(result.treeCount,429);
 assert.ok(result.balanced.deltaPairs>=0);
});
test('W22: browser window front updates width, slider and visible grounded optimal cases',()=>{
 const source=readFileSync(new URL('../docs/compiler/window-ui.mjs',import.meta.url),'utf8')
  .replace(/^import \{inspectLocalWindow\} from '\.\/window-oracle\.mjs';\n/,'')
  .replace(/^import \{scalarsOf\} from '\.\/engine\.mjs';\n/m,'');
 const handlers=new Map();
 class Fake{
  constructor(id=''){this.id=id;this.value='';this.max='0';this.textContent='';this.hidden=false;
   this.disabled=false;this.children=[];this.className='';this.tag='div';}
  addEventListener(type,fn){handlers.set(this.id+':'+type,fn);}
  replaceChildren(...parts){this.children=parts;}
  append(...parts){this.children.push(...parts);}
 }
 const elements=new Map(),get=id=>{
  if(!elements.has(id))elements.set(id,new Fake(id));
  return elements.get(id);
 };
 get('source').value='мама мыла раму. мама мыла раму.';
 get('window-width').value='8';get('window-offset').value='0';
 const document={getElementById:get,createElement(tag){const el=new Fake();el.tag=tag;return el;}};
 new Script(source).runInContext(createContext({document,inspectLocalWindow,scalarsOf,console}));
 assert.equal(get('window-output').hidden,false);
 assert.ok(get('window-metrics').children.length>=6);
 assert.ok(get('window-ranked').children[0].tag==='table');
 assert.equal(get('window-offset').value,String([...get('source').value].length-8));
 assert.ok(get('window-position').textContent.includes(' из '));
 assert.equal(get('window-next').disabled,true);
 handlers.get('window-prev:click')();
 assert.equal(get('window-next').disabled,false);
 assert.equal(get('window-offset').value,String([...get('source').value].length-9));
 get('window-width').value='4';
 handlers.get('window-width:change')();
 assert.equal(get('window-output').hidden,false);
 get('source').value='мама';
 handlers.get('source:input')();
 assert.ok(get('window-preview').textContent.includes('мама'));
 assert.equal(get('window-metrics').children[1].children[0].textContent,'2');
 get('source').value='�\uD800';
 handlers.get('source:input')();
 assert.equal(get('window-output').hidden,true);
 assert.ok(get('window-error').textContent.includes('unpaired'));
});
test('W22: Pages entrypoint imports the bounded oracle and avoids network/unsafe HTML',()=>{
 const html=readFileSync(new URL('../docs/compiler/index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../docs/compiler/window-ui.mjs',import.meta.url),'utf8');
 assert.ok(html.includes('src="./window-ui.mjs"'));
 assert.ok(html.includes('id="window-width"'));
 assert.ok(html.includes('id="window-offset"'));
 assert.ok(html.includes('id="window-ranked"'));
 assert.ok(ui.includes("from './window-oracle.mjs'"));
 assert.ok(!ui.includes('.innerHTML'));
 assert.ok(!ui.includes('fetch('));
 assert.ok(!ui.includes('eval('));
});
