import {inspectLocalWindow,inspectContextualWindow} from './window-oracle.mjs';
import {scalarsOf} from './engine.mjs';

// All user-supplied text is rendered as textContent; no HTML interpolation.
const el=id=>document.getElementById(id);
const element=(type,text)=>{const x=document.createElement(type);if(text!==undefined)x.textContent=String(text);return x;};
const fmt=s=>s.replaceAll(' ','␠').replaceAll('\n','↵').replaceAll('\t','⇥').replaceAll('\r','⏎');
const n=x=>Number(x).toLocaleString('ru-RU');
const addCell=(row,text)=>row.append(element('td',text));
const state={width:8,offset:0,source:''};
function renderTable(rows){
 const table=element('table'),head=element('thead'),header=element('tr'),body=element('tbody');
 for(const h of ['Место','Уникальных пар','Reuse','Δ к balanced','Δ к left','Бинарное дерево']){
  header.append(element('th',h));
 }
 head.append(header);
 for(const r of rows){
  const tr=element('tr');
  for(const x of [r.rank,r.uniquePairs,r.repeatedPairOccurrences,r.deltaVsBalanced,
    r.deltaVsLeft,r.expression])addCell(tr,x);
  body.append(tr);
 }
 table.append(head,body);return table;
}
function contextTable(rows){
 const table=element('table'),head=element('thead'),header=element('tr'),body=element('tbody');
 for(const h of ['Место','Link во всём тексте','В окне','Общие с окружением','Reuse всего','Бинарное дерево окна'])
  header.append(element('th',h));
 head.append(header);
 for(const r of rows){
  const tr=element('tr');
  for(const item of [r.rank,r.uniqueWholePairs,r.localPairs,r.sharedWithOutside,
   r.reusedWholePairOccurrences,fmt(r.expression)])addCell(tr,item);
  body.append(tr);
 }
 table.append(head,body);return table;
}
function chip(value,label){
 const root=element('div');root.className='metric';
 const strong=element('strong',value),span=element('span',label);
 root.append(strong,span);return root;
}
function show(){
 const text=el('source').value;
 const width=Number(el('window-width').value);
 let chars;
 try{
  if(text.length>4096)throw Error('Ограничение: 2048 Unicode-скаляров');
  chars=scalarsOf(text);
  if(chars.length>2048)throw Error('Ограничение: 2048 Unicode-скаляров');
 }catch(error){
  el('window-output').hidden=true;
  el('window-context-output').hidden=true;
  el('window-context-status').textContent='';
  el('window-error').textContent=String(error.message);
  return;
 }
 const max=Math.max(0,chars.length-width),slider=el('window-offset');
 const changed=state.source!==text||state.width!==width;
 if(changed)state.offset=max; // default to the rightmost sliding front on source/mode changes
 else state.offset=Math.max(0,Math.min(max,Number(slider.value)||0));
 state.source=text;state.width=width;
 slider.max=String(max);slider.value=String(state.offset);
 el('window-prev').disabled=chars.length<width||state.offset===0;
 el('window-next').disabled=chars.length<width||state.offset>=max;
 el('window-position').textContent='Скаляры '+state.offset+'…'+(state.offset+width)+' из '+chars.length;
 if(chars.length<width){
  el('window-output').hidden=true;
  el('window-context-output').hidden=true;
  el('window-context-status').textContent='';
  el('window-preview').textContent='Ввод: '+fmt(text);
  el('window-error').textContent='Для окна '+width+' нужно минимум '+width+' Unicode-символов; сейчас '+chars.length+'. Можно уменьшить ширину до 2.';
  return;
 }
 try{
  const started=performance.now();
  const result=inspectLocalWindow(text,{width,offset:state.offset,topN:5});
  const elapsed=performance.now()-started;
  const before=chars.slice(0,state.offset).join(''),
   after=chars.slice(state.offset+width).join('');
  el('window-preview').textContent=
   (before?'…'+fmt([...before].slice(-8).join('')):'')+
   '  【'+fmt(result.windowText)+'】  '+
   (after?fmt([...after].slice(0,8).join(''))+'…':'');
  el('window-error').textContent='';
  el('window-output').hidden=false;
  const metrics=[
   chip(n(result.treeCount),'Проверенных бинарных деревьев'),
   chip(elapsed.toFixed(2)+' мс','Перебор на этом устройстве (не benchmark)'),
   chip(n(result.minimumUniquePairs),'Минимум уникальных дуплетов'),
   chip(n(result.uniqueOptima),'Оптимальных вариантов'),
   chip(n(result.balanced.uniquePairs),'Balanced · дуплетов'),
   chip(n(result.left.uniquePairs),'Left · дуплетов'),
   chip(n(result.balanced.deltaPairs),'Экономия к balanced'),
   chip(n(result.left.deltaPairs),'Экономия к left')
  ];
  el('window-metrics').replaceChildren(...metrics);
  el('window-ranked').replaceChildren(renderTable(result.candidates.map((c,i)=>({...c,rank:i+1,
   expression:fmt(c.expression)}))));
  if(chars.length<=128){
   const contextStart=performance.now();
   const context=inspectContextualWindow(text,{width,offset:state.offset,topN:5});
   const ms=performance.now()-contextStart;
   el('window-context-output').hidden=false;
   el('window-context-status').textContent='Весь ввод: '+chars.length+
    ' скаляров. Окружение группируется неизменно; отдельный замер '+ms.toFixed(2)+' мс (не benchmark).';
   el('window-context-metrics').replaceChildren(
    chip(n(context.minimumWholePairs),'Минимум Link всего'),
    chip(n(context.bestContextCostAmongLocalOptima),'Link при лучшем локальном оптимуме'),
    chip(n(context.avoidableByConsideringContext),'Выгода знания окружения'),
    chip(n(context.balanced.uniqueWholePairs),'Всего при balanced-окне'),
    chip(n(context.left.uniqueWholePairs),'Всего при left-окне'),
    chip(n(context.globalOptimumTies),'Равноценных контекстных минимумов')
   );
   el('window-context-ranked').replaceChildren(contextTable(
    context.bestCandidates.map((c,i)=>({...c,rank:i+1}))));
  }else{
   el('window-context-output').hidden=true;
   el('window-context-status').textContent='Контекстный полный пересчёт ограничен 128 Unicode-скалярами; локальный перебор остаётся доступен для текста до 2048 скаляров.';
  }

 }catch(error){
  el('window-output').hidden=true;
  el('window-context-output').hidden=true;
  el('window-context-status').textContent='';
  el('window-error').textContent=String(error.message);
 }
}
el('window-width').addEventListener('change',show);
el('window-offset').addEventListener('input',show);
el('window-prev').addEventListener('click',()=>{el('window-offset').value=String(Number(el('window-offset').value)-1);show();});
el('window-next').addEventListener('click',()=>{el('window-offset').value=String(Number(el('window-offset').value)+1);show();});
el('source').addEventListener('input',show);
el('sample').addEventListener('click',show);
el('compile').addEventListener('click',show);
show();
