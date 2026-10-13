import {compileText,compareModes} from './engine.mjs';

// DOM renders user-provided content only through textContent (never innerHTML).
const byId=id=>document.getElementById(id);
const node=(tag,text,className)=>{
 const element=document.createElement(tag);
 if(text!==undefined)element.textContent=String(text);
 if(className)element.className=className;
 return element;
};
const fill=(parent,...children)=>parent.replaceChildren(...children);
const number=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:3});
const printable=s=>s.replaceAll('\n','↵').replaceAll('\r','⏎')
 .replaceAll('\t','⇥').replaceAll(' ','␠');
function table(headers,rows){
 const t=node('table'),thead=node('thead'),header=node('tr'),body=node('tbody');
 for(const name of headers)header.append(node('th',name));
 thead.append(header);
 for(const values of rows){
  const row=node('tr');
  for(const val of values)row.append(node('td',val===null?'—':val));
  body.append(row);
 }
 t.append(thead,body);return t;
}
function metric(label,value){
 const card=node('div',undefined,'metric'),bold=node('strong',value),caption=node('span',label);
 card.append(bold,caption);return card;
}
function renderTree(result){
 const root=byId('tree');
 if(result.root===null){fill(root,node('p','Нет Link: введена пустая строка.'));return;}
 const nodes=new Map(result.nodes.map(x=>[x.id,x]));
 const visits=new Map(result.topPairs.map(x=>[x.id,x.uses]));
 let displayed=0;
 function branch(id,depth){
  const item=nodes.get(id);
  if(!item)throw Error('Dangling Link '+id);
  const unit=node('div',undefined,'line-tree');
  if(item.kind==='atom'){
   unit.append(node('span','L'+id+' = '+JSON.stringify(printable(item.symbol))+' [атом]'));
   return unit;
  }
  const summary=node('summary','L'+id+' = (L'+item.from+' ⟼ L'+item.to+') · '+item.length+
    ' скал. · '+(visits.get(id)??0)+' использ. · '+printable(item.preview));
  const detail=node('details');detail.append(summary);
  if(depth<6&&displayed<120){
   displayed++;
   const left=branch(item.from,depth+1),right=branch(item.to,depth+1);
   detail.append(left,right);
   if(depth<2)detail.open=true;
  }else detail.append(node('p','Дальнейшие Link не развёрнуты в интерфейсе.','small muted'));
  unit.append(detail);return unit;
 }
 fill(root,branch(result.root,0));
}
function renderComparison(results){
 const headers=['Метод','Уникальных пар','Уникальных атомов','Повторно использованных пар','Правил'];
 const labels={balanced:'Сбалансированная',left:'Левая',repair:'Частотная Re-Pair'};
 const rows=results.map(x=>[labels[x.mode],number(x.uniquePairs),number(x.uniqueAtoms),
  number(x.reusedPairOccurrences),number(x.learnedRules)]);
 fill(byId('comparison'),table(headers,rows));
}
function renderRules(result){
 const rows=result.learnedRules.map(r=>[
  'R'+r.token,'R'+r.left+' ⟼ R'+r.right,printable(r.text),
  number(r.observedAdjacent),number(r.disjointReplacements),number(r.length)
 ]);
 if(!rows.length){fill(byId('rules'),node('p','Нет повторяющихся пар, удовлетворяющих порогу.','small muted'));return;}
 fill(byId('rules'),table(['Правило','Полюса локальных токенов','Фрагмент','Смежных','Замен','Скал.'],rows));
}
function renderPairs(result){
 const selected=result.topPairs.slice(0,100);
 const rows=selected.map(x=>['L'+x.id,'L'+x.from+' ⟼ L'+x.to,
  printable(x.preview),number(x.length),number(x.uses)]);
 if(!rows.length){fill(byId('pairs'),node('p','В этой последовательности нет дуплетов.','small muted'));return;}
 fill(byId('pairs'),table(['Link','Полюса','Значение (префикс)','Скал.','Исп.'],rows));
}
function setStatus(text,error=false){
 const el=byId('status');
 el.hidden=!text;
 el.className=error?'error':'notice';
 el.textContent=text;
}
let last=null;
function compile(){
 const source=byId('source').value;
 const options={
  mode:byId('mode').value,maxCodepoints:2048,
  maxRules:Number(byId('maxRules').value),
  minOccurrences:Number(byId('minOccurrences').value),
  maxRuleCodepoints:Number(byId('maxRuleCodepoints').value)
 };
 try{
  const started=performance.now();
  const result=compileText(source,options);
  const all=compareModes(source,options);
  const elapsed=performance.now()-started;
  last={result,comparison:all};
  byId('result').hidden=false;byId('details').hidden=false;
  byId('resultStatus').textContent=result.status;
  const m=result.metrics;
  fill(byId('metrics'),
   metric('Unicode-скаляров',number(result.scalars)),
   metric('UTF-8 байт исходника',number(result.utf8Bytes)),
   metric('Уникальных атомов',number(m.uniqueAtoms)),
   metric('Уникальных дуплетов',number(m.uniquePairs)),
   metric('Уникальных Link всего',number(m.uniqueLinks)),
   metric('Использований пар в дереве',number(m.expandedPairOccurrences)),
   metric('Сэкономлено экземпляров пар за счёт reuse',number(m.reusedPairOccurrences)),
   metric('Доля повторно используемых пар',number(m.reuseRate*100)+'%'),
   metric('Изучено правил Re-Pair',number(m.learnedRules))
  );
  byId('replay').textContent=result.status==='EMPTY_INPUT'?
   'Пустой текст: построение не требуется.':'EXACT REPLAY PASS: развёртывание корня L'+result.root+
    ' побуквенно совпало с исходным текстом, включая Unicode, пробелы и переносы строк.';
  byId('runtime').textContent='Время в этом браузере: '+elapsed.toFixed(2)+
   ' мс (не benchmark). '+result.localLinkIdWarning;
  renderComparison(all);renderRules(result);renderPairs(result);renderTree(result);
  byId('copy').disabled=false;
  setStatus('Готово. '+(result.mode==='repair'?'Правила изучены на том же вводе (in-sample).':'Режим без обучения.')+
   ' Исходный текст не отправлялся на сервер.');
 }catch(error){
  last=null;byId('copy').disabled=true;byId('result').hidden=true;byId('details').hidden=true;
  setStatus(error instanceof Error?error.message:String(error),true);
 }
}
byId('compile').addEventListener('click',compile);
byId('source').addEventListener('keydown',e=>{
 if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();compile();}
});
byId('sample').addEventListener('click',()=>{
 byId('source').value='мама мыла раму.\nмама мыла раму. ⟼ 🧪\nмама мыла раму.';
 compile();
});
byId('copy').addEventListener('click',async()=>{
 if(!last)return;
 try{
  await navigator.clipboard.writeText(JSON.stringify(last,null,2));
  setStatus('JSON с метриками и графом скопирован в буфер обмена.');
 }catch(e){setStatus('Не удалось скопировать JSON в этом браузере: '+String(e),true);}
});
compile();
