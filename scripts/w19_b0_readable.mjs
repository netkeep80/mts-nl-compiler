#!/usr/bin/env node
// W19-B0: readable observations generated from the actual train-only predictor.
// The checked-in Markdown snapshot must equal this executable result byte-for-byte.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {trainContextPredictor} from '../src/w19-capability-b0.mjs';

export function renderW19B0Readable(fixture,fixtureSha256){
 const train=fixture.train,heldout=fixture.heldout,pairs=fixture.pairs;
 const models=[0,1,2,3].map(order=>({order,model:trainContextPredictor(train,{order,alpha:0.5,representation:'raw'})}));
 const four=models[3].model;
 const linkLeft=trainContextPredictor(train,{order:3,alpha:0.5,representation:'link-left'});
 const linkBalanced=trainContextPredictor(train,{order:3,alpha:0.5,representation:'link-balanced'});
 const total=four.evaluate(heldout);
 const equal=JSON.stringify(total)===JSON.stringify(linkLeft.evaluate(heldout))&&
  JSON.stringify(total)===JSON.stringify(linkBalanced.evaluate(heldout));
 if(!equal)throw Error('Source prediction differs from Link grouping');
 const fmt=n=>n===null?'UNKNOWN':Number(n).toFixed(4);
 const perc=n=>n===null?'UNKNOWN':(100*n).toFixed(2)+'%';
 const lines=[
 '# W19-B0 — наблюдаемые результаты предсказания требований',
 '',
 '> **Малый синтетический контроль.** Статистические оценки, не исправление языка и не проверка логической истинности. Отчёт строится непосредственно из исполняемого алгоритма, а не из ручного описания.',
 '',
 `**Вход:** ${train.length} учебных фраз, ${heldout.length} отложенные фразы, ${pairs.length} парных проб. **SHA256 fixture:** \`${fixtureSha256}\`.`,
 '',
 `**Обучение:** ${four.observationEvents} исходных Unicode-позиций. **Проверка:** ${total.scored}/${total.events} оценённых символов; coverage ${perc(total.coverage)}.`,
 '',
 '## Какие настоящие фразы проверялись',
 '',
 'Каждая строка была отложена целиком. Условия оценки — те же для исходной статистики и Link.',
 '',
 '| № | Контрольная фраза (точные символы) | Бит/оценённый символ, order=3 | Top-1 | Top-3 | Coverage |',
 '|---:|---|---:|---:|---:|---:|'
 ];
 for(let i=0;i<heldout.length;i++){
  const text=heldout[i],ev=four.evaluate([text]);
  lines.push('| '+(i+1)+' | '+text.replaceAll('|','\\|')+' | '+fmt(ev.bitsPerScoredScalar)+' | '+perc(ev.top1Accuracy)+' | '+perc(ev.topKAccuracy)+' | '+perc(ev.coverage)+' |');
 }
 lines.push('',
 '## Сравнение с простейшей статистикой',
 '',
 '| Контекст предыдущих символов | Бит/оценённый скаляр ↓ | Top-1 ↑ | Top-3 ↑ | Coverage |',
 '|---:|---:|---:|---:|---:|');
 for(const {order,model} of models){
  const ev=model.evaluate(heldout);
  lines.push('| '+order+' | '+fmt(ev.bitsPerScoredScalar)+' | '+perc(ev.top1Accuracy)+' | '+perc(ev.topKAccuracy)+' | '+perc(ev.coverage)+' |');
 }
 lines.push('',
 '**Важный отрицательный результат:** order=3 повысил Top-1 относительно order=2, но увеличил число бит/скаляр. Нельзя выбирать параметры по уже просмотренному test.',
 '',
 '## Все контрольные изменения формулировок',
 '',
 'Знак `Δ` = (сложность альтернативы) − (сложность исходной фразы). Положительное число — статистически менее привычное продолжение, **не** доказательство ошибки.',
 '',
 '| ID | Исходная фраза | Изменённая фраза | Тип контрольного случая | Статус | Δ бит/скаляр |',
 '|---|---|---|---|---|---:|');
 const probes=four.comparePairs(pairs);
 for(let i=0;i<probes.length;i++){
  const p=probes[i],input=pairs[i];
  lines.push('| '+p.id+' | '+input.reference.replaceAll('|','\\|')+' | '+input.alternative.replaceAll('|','\\|')+' | '+p.goldKind+' | '+p.status+' | '+fmt(p.deltaBitsPerScalar)+' |');
 }
 lines.push('',
  '**Предупреждение о ложных срабатываниях:** T03 и T05 — оба допустимых варианта формулировок в рамках синтетической постановки. Их `Δ>0` указывает только на статистическую редкость. Метки `goldReview=UNREVIEWED`; независимой лингвистической или логической экспертизы нет.',
 '',
 '## Структура Link против обычных n-грамм',
 '',
 '| Способ хранения одних и тех же исходных наблюдений | Результат |',
 '|---|---|',
 '| Обычная таблица n-грамм | Эталонные предсказания |',
 '| Link контекст, левосторонняя бинаризация | '+(equal?'Совпадает с эталоном':'НЕ СОВПАДАЕТ')+' |',
 '| Link контекст, сбалансированная бинаризация | '+(equal?'Совпадает с эталоном':'НЕ СОВПАДАЕТ')+' |',
 '',
 '**Следствие:** бинаризация сама по себе не добавляет предсказательной информации. Для доказательства пользы Link нужен новый алгоритм структурных классов/шаблонов, независимый тест и matched baseline.',
 '',
 '## Как повторить',
 '',
 '- Учебный набор и парные проверки: [fixture](../tests/fixtures/w19-capability-pairs-v0.json).',
 '- Исполняемая модель: [src/w19-capability-b0.mjs](../src/w19-capability-b0.mjs).',
 '- Автоматические тесты: [tests/w19-capability-b0.test.mjs](../tests/w19-capability-b0.test.mjs).',
 '- Полный JSON: `node scripts/w19_capability_b0.mjs`.',
 '- Этот наглядный отчёт: `node scripts/w19_b0_readable.mjs`.',
 '',
 '**Невыполнено:** независимый gold, анализ правил требований, семантическая точность, вероятностное обучение MTS weight, Γ.',
 ''
 );
 return lines.join('\n');
}
const fixtureBytes=readFileSync(new URL('../tests/fixtures/w19-capability-pairs-v0.json',import.meta.url));
const fixture=JSON.parse(fixtureBytes.toString('utf8'));
const digest=createHash('sha256').update(fixtureBytes).digest('hex');
const markdown=renderW19B0Readable(fixture,digest);
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)process.stdout.write(markdown);
