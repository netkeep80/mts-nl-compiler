#!/usr/bin/env node
// W19-B1 human-readable observational report. Generate from the EXACT training fixture,
// never from remembered claims, and compare the checked-in snapshot in CI.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {trainProductiveSlots,trainCharBaseline} from '../src/w19-productive-slots-b1.mjs';

export function renderW19B1Readable(fixture,fixtureSha256){
 const {roots,suffixes,trainCells,heldoutCells}=fixture.generation;
 const name=([i,j])=>roots[i]+suffixes[j];
 const training=trainCells.map(name),heldout=heldoutCells.map(name);
 const model=trainProductiveSlots(training);
 const proposals=model.propose();
 const proposedBySurface=new Map(proposals.map(p=>[p.surface,p]));
 const trainedCells=new Set(trainCells.map(([i,j])=>i+':'+j));
 const holdoutCells=new Set(heldoutCells.map(([i,j])=>i+':'+j));
 const baselines=[0,1,2,3].map(order=>({
   order,model:trainCharBaseline(training,{order})
 }));
 const fmt=n=>n===null?'UNKNOWN':Number(n).toFixed(4);
 const lines=[
 '# W19-B1 — наблюдаемые результаты компилятора',
 '',
 '> **Исследовательский синтетический эксперимент.** Структурные кандидаты, не проверенные слова и не логические выводы. Данные автоматически строятся из закреплённого fixture и текущего кода.',
 '',
 `**Вход:** 19 учебных строк, 5 отложенных сочетаний. **SHA256 fixture:** \`${fixtureSha256}\`.`,
 '',
 `**Результат:** ${model.status}; найденный разрез после ${model.split} Unicode-скаляров; ${model.prefixTypes} первых и ${model.suffixTypes} последних частей; ${model.graph.stats.atoms} атомов + ${model.graph.stats.pairs} пар = ${model.graph.stats.nodes} Link-узлов.`,
 '',
 '## Матрица наблюдений: что реально видел алгоритм',
 '',
 'Каждая ячейка — полная строка **отдельного документа**. **Обучение** означает реальное наблюдение; **скрыто** означает, что сочетание не входило в обучение.',
 '',
 '| Первая часть / Вторая часть | '+suffixes.map(s=>'`'+s+'`').join(' | ')+' |',
 '|---|'+suffixes.map(()=>'---').join('|')+'|'
 ];
 for(let i=0;i<roots.length;i++){
  const cols=suffixes.map((s,j)=>{
    const id=i+':'+j,form=roots[i]+s;
    if(trainedCells.has(id))return 'обучение: `'+form+'`';
    if(holdoutCells.has(id))return '**скрыто: `'+form+'`**';
    return 'не использовано';
  });
  lines.push('| `'+roots[i]+'` | '+cols.join(' | ')+' |');
 }
 lines.push('','## Пять новых сочетаний: ответы компилятора','','**Ни одна строка ниже не была представлена при обучении.** Это предложения, а не изменения исходной асети.',
 '| № | Первая Link-часть | Вторая Link-часть | Предложение | Наблюдалось при обучении? | Было скрыто? | Ранг, не вероятность | n-gram log₂(order=2) |',
 '|---:|---|---|---|---|---|---:|---:|');
 for(let i=0;i<proposals.length;i++){
  const p=proposals[i],info=model.inspect(p.surface);
  lines.push('| '+(i+1)+' | `'+p.prefix+'` | `'+p.suffix+'` | **`'+p.surface+'`** | '+(info.seen?'ДА':'нет')+' | '+(heldout.includes(p.surface)?'ДА':'нет')+' | '+p.score+' | '+fmt(baselines[2].model.score(p.surface))+' |');
 }
 const count=heldout.filter(x=>proposedBySurface.has(x)).length;
 lines.push('',
 `**Синтетический результат:** ${count}/${heldout.length} заранее скрытых сочетаний предложено; предложений вне контрольного набора: ${proposals.length-count}. Это не качество анализа русского языка.`,
 '',
 '## Контрпримеры и границы',
 '',
 '| Проверка | Что произошло | Интерпретация |',
 '|---|---|---|',
 '| Перестановка символов алфавита | Разрез и Link-структура инвариантны | Алгоритм не опирается на русские буквы |',
 '| Три строки без перекрёстных повторов | `UNKNOWN_NO_PRODUCTIVE_SLOT` | Не выдумывает структуру из недостаточных данных |',
 '| Склейка всех 19 строк в поток без границ | `UNKNOWN_NO_PRODUCTIVE_SLOT` | Пока **не умеет** сегментировать непрерывный текст |',
 '| Два мира с одинаковым train и противоположными правилами допустимости | Предложения одинаковы | Статистика не определяет смысл и грамматику |',
 '| Вход test после обучения | Link-граф не меняется | Нет обучения на проверочном наборе |',
 '',
 '## Контрольные n-граммы на тех же исходных данных',
 '',
 'Это **log₂-score полной строки**; меньшее отрицательное число означает больший статистический score. Ранг слотов **не является** вероятностью и с этими числами напрямую несопоставим.',
 '',
 '| Контекст предыдущих символов | Средняя log₂-score скрытой строки |',
 '|---:|---:|'
 );
 for(const {order,model:ngram} of baselines){
  const avg=heldout.reduce((a,s)=>a+ngram.score(s),0)/heldout.length;
  lines.push('| '+order+' | '+fmt(avg)+' |');
 }
 lines.push('',
 '## Как посмотреть и воспроизвести',
 '',
 '- Исходные данные: [fixture](../tests/fixtures/w19-productive-b1-v0.json).',
 '- Исполняемая модель: [src/w19-productive-slots-b1.mjs](../src/w19-productive-slots-b1.mjs).',
 '- Исполняемые проверки: [tests/w19-productive-b1.test.mjs](../tests/w19-productive-b1.test.mjs).',
 '- Формальный отчёт JSON: `node scripts/w19_productive_b1.mjs`.',
 '- Этот наглядный отчёт: `node scripts/w19_b1_readable.mjs`.',
 '',
 '**Невыполнено:** грамматика реальных фраз, поиск слов без заранее заданных границ документов, конкурентный lossless MDL, достоверность логических выводов.',
 ''
 );
 return lines.join('\n');
}

const fixtureBytes=readFileSync(new URL('../tests/fixtures/w19-productive-b1-v0.json',import.meta.url));
const fixture=JSON.parse(fixtureBytes.toString('utf8'));
const digest=createHash('sha256').update(fixtureBytes).digest('hex');
const markdown=renderW19B1Readable(fixture,digest);
if(process.argv[1] && new URL('file://'+process.argv[1]).pathname===new URL(import.meta.url).pathname)process.stdout.write(markdown);
