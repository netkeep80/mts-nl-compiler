import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Script,createContext} from 'node:vm';
import {renderObservatory,validateEvidence} from '../scripts/build_observatory.mjs';

const input=JSON.parse(readFileSync(new URL('../data/observatory/runs-v1.json',import.meta.url),'utf8'));
const template=readFileSync(new URL('../src/observatory-template.html',import.meta.url),'utf8');
const page=readFileSync(new URL('../docs/observatory/index.html',import.meta.url),'utf8');
const clone=()=>JSON.parse(JSON.stringify(input));

test('W20: committed offline HTML is exactly regenerated from the pinned evidence manifest',()=>{
 const expected=renderObservatory(input,template);
 assert.equal(page,expected,'stale dashboard: run node scripts/build_observatory.mjs');
 const script=fileURLToPath(new URL('../scripts/build_observatory.mjs',import.meta.url));
 const run=spawnSync(process.execPath,[script,'--check'],{encoding:'utf8',timeout:10000});
 assert.equal(run.status,0,run.stderr);
 const result=JSON.parse(run.stdout);
 assert.equal(result.mode,'CHECK_PASS');
 assert.deepEqual(result.experiments,['B0','B1']);
 console.log('OBSERVATORY_BUILD '+JSON.stringify(result));
});
test('W20: evidence references and negative outcomes cannot be silently dropped',()=>{
 validateEvidence(input);
 assert.deepEqual(input.sources.map(x=>x.pr),[92,93]);
 assert.equal(input.experiments[0].testsPassed,158);
 assert.equal(input.experiments[1].testsPassed,160);
 const b0=input.experiments[0],b1=input.experiments[1];
 assert.deepEqual(b0.baselines.map(x=>x.order),[0,1,2,3]);
 assert.equal(b0.population.testEvents,126);
 assert.equal(b0.contrasts.length,6);
 assert.ok(b0.contrasts.some(x=>x.status==='ABSTAIN_OOV'));
 assert.ok(b0.baselines[3].bitsPerScalar>b0.baselines[2].bitsPerScalar);
 assert.equal(b1.proposals.length,5);
 assert.equal(b1.linkGraph.total,53);
 assert.equal(b1.holdoutCells.length,5);
 assert.ok(b1.controls.some(x=>x.result==='UNKNOWN'));
 assert.ok(b1.controls.some(x=>x.result==='UNIDENTIFIABLE'));
});
test('W20: reader can view every example without a network dependency',()=>{
 assert.equal((page.match(/<script/g)||[]).length,2);
 assert.ok(page.includes('<html lang="ru">'));
 assert.ok(page.includes('data-view="B0"'));
 assert.ok(page.includes('data-view="B1"'));
 assert.ok(page.includes('data-view="history"'));
 assert.ok(page.includes('data-case'));
 assert.ok(page.includes('case-filter'));
 assert.ok(page.includes('aria-current'));
 assert.ok(page.includes('matrix'));
 assert.ok(page.includes('log loss')||page.includes('log-loss'));
 assert.ok(!/<script[^>]+src\s*=/i.test(page));
 assert.ok(!/https?:\/\/(?:cdn\.|fonts\.|unpkg\.|jsdelivr\.)/i.test(page));
 assert.equal(page.includes('__OBSERVATORY_DATA__'),false);
});
test('W20: fail closed for forged/missing evidence or an external source link',()=>{
 const wrong=clone();
 wrong.sources[0].head='badsha';
 assert.throws(()=>validateEvidence(wrong));
 const url=clone();
 url.sources[0].ci='https://example.org/evil';
 assert.throws(()=>validateEvidence(url));
 const divergent=clone();
 divergent.experiments[0].testsPassed=157;
 assert.throws(()=>validateEvidence(divergent));
 const semantic=clone();
 semantic.experiments[0].review='ACCEPTED_SEMANTIC';
 assert.throws(()=>validateEvidence(semantic));
 const hidden=clone();
 hidden.experiments[1].proposals.pop();
 assert.throws(()=>validateEvidence(hidden));
});
test('W20: inert JSON embedding cannot break out into an executable HTML script',()=>{
 const evil=clone();
 evil.experiments[0].title='</script><img src=x onerror=alert(1)>';
 const html=renderObservatory(evil,template);
 assert.equal((html.match(/<script/g)||[]).length,2);
 assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
 assert.ok(html.includes('\\u003c/script\\u003e'));
 const text=html.match(/<script id="observatory-data" type="application\/json">([^]*?)<\/script>/);
 assert.ok(text);
 const parsed=JSON.parse(text[1]);
 assert.equal(parsed.experiments[0].title,evil.experiments[0].title);
});

test('W20: dashboard JavaScript compiles and all four views render with offline DOM mock',()=>{
 const found=[...page.matchAll(/<script[^>]*>([^]*?)<\/script>/g)];
 assert.equal(found.length,2);
 const js=found[1][1];
 const compiled=new Script(js,{filename:'observatory-inline.js'});
 const handlers=new Map();
 const nav=['overview','B0','B1','history'].map(view=>({
  dataset:{view},setAttribute(name,value){this[name]=value;}
 }));
 const cases=Array.from({length:6},(_,i)=>({dataset:{case:String(i)},
   setAttribute(name,value){this[name]=value;}}));
 const elements={
  'observatory-data':{textContent:found[0][1]},
  asof:{textContent:''},
  content:{innerHTML:'',setAttribute(){}},
  'case-detail':{innerHTML:''},
  'runhistory-rows':{innerHTML:''}
 };
 const doc={
  getElementById(id){return elements[id]??null;},
  querySelectorAll(selector){if(selector==='.navbtn')return nav;if(selector==='[data-case]')return cases;
   if(selector==='.sample')return cases;return [];},
  addEventListener(type,handler){handlers.set(type,handler);}
 };
 const loc={hash:''};
 const browser={
  history:{replaceState(a,b,to){loc.hash=to;}},
  addEventListener(type,handler){handlers.set('window:'+type,handler);}
 };
 const context=createContext({document:doc,location:loc,window:browser,URL,console});
 compiled.runInContext(context);
 assert.ok(elements.content.innerHTML.includes('Наблюдаем результаты'));
 for(const view of ['B0','B1','history','overview']){
  const control={dataset:{view}};
  handlers.get('click')({target:{closest:()=>control}});
  assert.equal(loc.hash,'#'+view);
  assert.ok(elements.content.innerHTML.length>500,'view must contain substantive data');
 }
 handlers.get('click')({target:{closest:()=>({dataset:{view:'B0'}})}});
 assert.ok(elements['case-detail'].innerHTML.includes('Исходная формулировка'));
 handlers.get('click')({target:{closest:()=>({dataset:{case:'5'}})}});
 assert.ok(elements['case-detail'].innerHTML.includes('UNKNOWN / OOV'));
 assert.equal(nav.find(x=>x.dataset.view==='B0')['aria-current'],'page');
});

test('W20: run ledger includes verified failures and exact links, without claiming it is complete',()=>{
 assert.equal(input.runHistory.length,10);
 assert.equal(input.runHistory.filter(x=>x.status==='FAIL').length,2);
 assert.ok(input.runHistory.every(x=>x.evidence.endsWith('/'+x.runId)));
 assert.ok(input.historyDisclosure.includes('NOT complete CI history'));
 const b0Runs=input.runHistory.filter(x=>x.experiment==='B0'&&x.kind==='CI');
 assert.deepEqual(b0Runs.map(x=>x.testsPassed),[157,158,158]);
 assert.deepEqual(input.runHistory.filter(x=>x.experiment==='B1'&&x.kind==='CI').map(x=>x.testsPassed),[158,159,160]);
 assert.ok(page.includes('История экспериментов'));
 assert.ok(page.includes('data-runfilter="FAIL"'));
});
test('W20: run ledger filter displays failures and their original remediation notes',()=>{
 const scripts=[...page.matchAll(/<script[^>]*>([^]*?)<\/script>/g)];
 assert.equal(scripts.length,2);
 const contextElement={innerHTML:'',setAttribute(){}};
 const tbody={innerHTML:''};
 const nav=['overview','B0','B1','history'].map(view=>({dataset:{view},setAttribute(){}}));
 const tabs=['all','CI','GUARD','FAIL'].map(runfilter=>({dataset:{runfilter},setAttribute(n,v){this[n]=v;}}));
 const handlers=new Map();
 const documentMock={
  getElementById(id){return ({'observatory-data':{textContent:scripts[0][1]},content:contextElement,
   asof:{textContent:''},'runhistory-rows':tbody})[id]??null;},
  querySelectorAll(q){return q==='.navbtn'?nav:q==='[data-runfilter]'?tabs:[];},
  addEventListener(n,f){handlers.set(n,f);}
 };
 const locationMock={hash:''};
 const browser={history:{replaceState(a,b,h){locationMock.hash=h;}},addEventListener(){}};
 new Script(scripts[1][1]).runInContext(createContext({document:documentMock,window:browser,location:locationMock,console}));
 handlers.get('click')({target:{closest:()=>({dataset:{view:'history'}})}});
 assert.ok(contextElement.innerHTML.includes('Реальные запуски CI'));
 handlers.get('click')({target:{closest:()=>({dataset:{runfilter:'FAIL'}})}});
 assert.ok(tbody.innerHTML.includes('38325370129'));
 assert.ok(tbody.innerHTML.includes('38325526140'));
 assert.ok(!tbody.innerHTML.includes('38323249637'));
 assert.equal(tabs.find(x=>x.dataset.runfilter==='FAIL')['aria-pressed'],'true');
 const noHistory=clone();noHistory.runHistory=[];
 assert.throws(()=>validateEvidence(noHistory),/chronology/);
 const allGreen=clone();for(const x of allGreen.runHistory)x.status='PASS';
 assert.throws(()=>validateEvidence(allGreen),/cherry-pick/);
});

test('W20: root README links to configured official GitHub Pages site',()=>{
 const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
 const pages='https://netkeep80.github.io/mts-nl-compiler/observatory/';
 assert.ok(readme.includes('[Открыть Observatory — официальный GitHub Pages]('+pages+')'));
 assert.ok(readme.includes('HTML в main'));
 assert.ok(readme.includes('исследовательскими статическими снимками'));
 assert.ok(!readme.includes('raw.githack.com'),'disallow obsolete third-party preview');
});
