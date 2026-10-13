# W19-S0 — первый проверяемый эксперимент семантических кандидатов русских требований

**Статус:** research-only Draft для issue #91.  
**Base main:** `cba8ee4baa9724ae124da68c469f20c35c8789c7`.  
**Не является:** научной приёмкой русской семантики, новым FORMAL, изменением Γ, нормативной онтологией или production parser.

## 1. Предварительный аудит

Перед S0 перепроверены актуальный `main`, #91, связанные #13/#17/#79/#85/#5, #107, будущий #24, открытые Draft PR #92/#93, repo-policy, requirements и CI.

Фактическая граница перед экспериментом:

- принятого semantic extractor для субъект/действие/объект/модальность/отрицание на `main` нет;
- `docs/compiler/engine.mjs` даёт exact Unicode replay и структурный Link-DAG, но явно не обещает semantics/probability;
- FORMAL bridge artifacts существуют как `RESEARCH_UNACCEPTED` и не являются доказанным извлечением смысла из текста;
- B0 Draft #92 уже показал: при одинаковых наблюдениях Link-контекст и обычный n-gram дают одинаковый prediction;
- B1 Draft #93 показал структурную продуктивность на синтетическом факторизованном корпусе, но paired-world falsifier доказывает неидентифицируемость semantic licitness из одних строк;
- W23 #107 отделил физическое представление и стоимость от значения.

Следовательно, S0 не повторяет B0/B1 и не пытается вывести смысл из частот.

## 2. Исследовательский вопрос

Можно ли получить воспроизводимые **кандидаты смысловых отношений**, если:

1. исходный текст сохраняется byte-exact;
2. язык и scope-правила явно заданы отдельным definition pack;
3. definition pack представим через обычные immutable atom/pair Links;
4. при удалении определения система честно abstain;
5. при одинаковом знании Link-представление сравнивается с flat-template baseline.

## 3. Корпус и definitions

Корпус: **28 синтетических русскоязычных требований**.

SHA-256 точного corpus fixture:

`964be91874b4beecad6d74341f1ef845ed42492ea010f4fc95e22c8aefeae6ae`

Definition pack SHA-256:

`183e97b2b475d8ac3a5a6af035b99816ba20b0507c0688c27f869170e4eeb6f9`

### Corpus corrigendum after independent review

Independent review of Draft #112 found one reproducible annotation-span defect in the previous corpus revision:

- case: `S09`;
- text: `Система сохраняет документ до проверки.`;
- field: `provisional.spans.temporal`;
- erroneous interval: `34..38`, which points inside `документ`;
- corrected standalone-token interval: **`51..55`**.

Historical SHA-256 of the erroneous fixture is retained in the fixture corrigendum and machine report:

`bb3e4229e560032ecfbaed4694e40d4d335d123a3b69fb12bdf6b43eef43de27`

Historical PR head carrying that revision:

`591aa567cb8d124c39db539f8f8107987e01693e`

The correction changes only annotation provenance/span metadata. Definition pack and semantic engine were not changed.

Engine SHA-256 на проверенном code head:

`e73db1ea1afea12950a88d7ee1f81220863b792f1dc3c9086e1e5af11463339a`

Файлы:

- `tests/fixtures/w19-s0-requirements-v0.json`;
- `tests/fixtures/w19-s0-definitions-v0.json`;
- `src/w19-semantic-s0.mjs`;
- `scripts/w19_semantic_s0.mjs`;
- `tests/w19-semantic-s0.test.mjs`.

Каждый пример содержит:

- точный исходный text;
- context ID;
- provisional expected relation/status;
- точные UTF-8 byte spans;
- ambiguities;
- provenance;
- controlled ablation.

**Важно:** annotations имеют статус
`PROVISIONAL_AI_AUTHORED_NOT_INDEPENDENT_GOLD`.

Semantic precision/recall/accuracy в S0 **не вычисляются**.

## 4. Никакой скрытой русской грамматики в коде

Русские слова, формы, модальности, temporal/quantifier/scope patterns находятся только в JSON definition pack.

Тест читает `src/w19-semantic-s0.mjs` и требует отсутствия кириллицы и конкретных русских лексем.

Engine содержит только generic механизмы:

- Unicode token spans;
- immutable atom/pair Link graph;
- generic JSON-like Link-record transport;
- exact definition matching;
- variable binding;
- declarative template emission;
- provenance;
- abstention.

Морфология, case folding, world knowledge и скрытые regex для русского отсутствуют.

## 5. Три режима

### A — structure only

Вход:

- exact Unicode;
- два допустимых Link fold: left и balanced;
- Unicode structural tokens/spans.

Definition pack отсутствует.

Результат на всех 28 случаях:

- `PROPOSED = 0`;
- `UNKNOWN = 28`.

Это намеренный отрицательный результат: exact structure сама по себе не даёт основания утверждать semantic relation.

### B — explicit definitions

Definition pack содержит ограниченный набор явных:

- ENTITY;
- ACTION;
- MODAL;
- NEGATION;
- QUANTIFIER;
- TEMPORAL;
- EVENT;
- PREDICATE;
- connective definitions;
- declarative full-sequence templates.

Результат:

| Status | Count |
|---|---:|
| PROPOSED | **19** |
| AMBIGUOUS | **2** |
| UNKNOWN | **7** |

Каждый candidate содержит source byte spans и IDs использованных definitions.

Semantic status никогда не повышается до `VERIFIED`.

### C — controlled ambiguity / ablation

Для поддерживаемых примеров удаляется конкретное definition/template либо снимается context.  
Для исходно ambiguous примеров, наоборот, может быть явно задан контекст.

Результат:

| Status | Count |
|---|---:|
| PROPOSED | **2** |
| AMBIGUOUS | **4** |
| UNKNOWN | **22** |

Это проверяет зависимость вывода от явного основания.

## 6. Конкретные ответы

### Обязательность и отрицание

**S01**

Исходник:

`Система должна сохранить документ.`

B:

```json
{
  "relation": "ACTION_REQUIREMENT",
  "subject": "SYSTEM",
  "action": "SAVE",
  "object": "DOCUMENT",
  "modality": "MUST",
  "polarity": "POSITIVE"
}
```

A: `UNKNOWN`.

После удаления `tpl.requirement`: C = `UNKNOWN`.

**S02**

`Система не должна сохранить документ.`

B сохраняет отличие:

```json
{
  "modality": "MUST",
  "polarity": "NEGATED",
  "negationScope": "MODAL_ACTION"
}
```

Удаление definition `не` → `UNKNOWN`.

### Квантор и scope

**S06**

`Не каждый запрос может быть отменён.`

B:

- quantifier = `EVERY`;
- negationScope = `QUANTIFIER`;
- quantifierNegated = true.

**S07**

`Каждый запрос не может быть отменён.`

B:

- quantifier = `EVERY`;
- negationScope = `MODALITY`;
- modalityNegated = true.

Обе формы не схлопываются в один candidate.

### Время

**S08**

`Система сохраняет документ после проверки.`

→ `temporal = AFTER`.

**S09**

`Система сохраняет документ до проверки.`

→ `temporal = BEFORE`.

### Условие / необходимое условие

**S10**

`Если подпись действительна, документ принимается.`

→ `CONDITION_SUFFICIENT_FOR_ACTION`.

**S11**

`Документ принимается только если подпись действительна.`

→ `ACTION_REQUIRES_CONDITION`.

S0 не объявляет эти отношения логически доказанными; это candidates по явно заданным definitions.

### Один текст, разные contexts

S16 и S17 имеют **байт-в-байт одинаковый текст**:

`Система должна сохранить ключ.`

Context `security`:

- object = `CRYPTO_KEY`.

Context `database`:

- object = `DATABASE_KEY`.

Без context (S18):

- status = `AMBIGUOUS`;
- оба candidate сохраняются;
- система не выбирает один автоматически.

Аналогичный control сделан для `банк`.

### Честный отказ

**S22**

`Системе надлежит сохранить документ.`

`надлежит` не определено → `UNKNOWN`.

Это редкая, но корректная конструкция: незнакомость не превращается в ошибку.

**S27**

`Система должна сохранить документ после верификации.`

`AFTER` наблюдаем структурно, но event `верификации` не определён.  
S0 не публикует частичный смысл как подтверждённый relation → `UNKNOWN`.

**S28**

`Если подпись действительна, документ принимается после проверки.`

Pack умеет IF и TEMPORAL отдельно, но не имеет определения их композиции.  
Результат: `UNKNOWN`, а не скрытая эвристическая композиция.

## 7. Обязательные falsifiers

### Fold invariance

Для каждого из 28 inputs:

- left Link fold;
- balanced Link fold;

дают одинаковый exact source и одинаковый semantic candidate set.

`binaryizationDisagreements = 0`.

Это подтверждает в пределах S0:

`ExactSequence representation shape != semantic authority`.

### Link vs flat baseline

Один и тот же definition pack исполняется:

1. после roundtrip через generic Link-record DAG;
2. напрямую как flat-template data.

Результат:

`linkVsFlatDisagreements = 0`.

**Следствие:** S0 не обнаружил преимущества Link-представления по semantic extraction при одинаковом знании.

Link-форма даёт проверяемую graph representability/provenance, но сама по себе не добавляет смысл.

### Span integrity after independent review

All **111 provisional source spans** are now checked generically against `exactUnicodeTokens`:

- exact UTF-8 byte slice must equal the declared surface;
- `startUtf8` must equal the start of an observed token;
- `endUtf8` must equal the end of an observed token;
- the interval must cover a complete contiguous token or documented token sequence;
- it may not cut through another observed token.

For every `PROPOSED` case, matcher evidence spans are independently token-boundary checked. When a provisional span and matcher evidence refer to the same surface, their exact UTF-8 intervals must agree.

Result after the S09 correction:

- provisional spans checked: **111/111 PASS**;
- additional provisional token-boundary defects: **0**;
- matcher/source same-surface interval conflicts: **0**.

This is fixture-integrity evidence, not independent semantic gold.

### Annotation leakage

Тест подменяет provisional annotation на заведомо ложный `VERIFIED/FAKE`.

B/C output не меняется.

Engine получает только:

- id;
- text;
- context;
- control configuration;
- definition pack.

Gold/provisional relation не передаётся.

### Unknown definitions

Удаление критического определения приводит к `UNKNOWN`, а снятие контекста у омонима — к `AMBIGUOUS`.

Никакого fallback «похожее слово, значит такой же смысл» нет.

## 8. Что S0 не доказал

Не доказаны:

- качество русского parser в реальном мире;
- morphology/generalization на невиданные формы;
- semantic equivalence парафразов;
- logical truth;
- contradiction detection;
- calibrated probability;
- преимущество Link над matched flat template по semantic accuracy;
- native semantic ANet identity;
- FORMAL v0.15 bridge;
- Γ execution;
- независимая accuracy.

Definition Link graph S0 — research transport, а не canonical MTS semantic identity.

## 9. Метрики и CI

Исправленный corpus/span-test checkpoint до обновления этой заметки:

`f93d4fb7b8b6ee011a0ae56c2fcfed888069303f`

На предшествующем полном запуске после generic span-falsifier:

- **234/234 PASS**;
- 0 failed;
- 0 skipped;
- all 111 provisional spans PASS;
- repo-guard SUCCESS.

Финальный exact PR-head CI после обновления документации фиксируется в Draft PR #112 и checkpoint #91.

repo-guard:

- SUCCESS.

Текущая штатная `.github/workflows/ci.yml` использует только `ubuntu-latest`.  
Windows replay в S0 **NOT_EXECUTED**: workflow не менялся, поскольку `.github/**` запрещён scope задачи.

## 10. Ответы на пять вопросов

### 1. Что компилятор уже действительно извлекает?

Без semantic definitions — только проверяемую структуру:

- exact Unicode;
- byte/scalar spans;
- Link representation;
- exact replay;
- structural token boundaries выбранного generic tokenizer.

**Semantic relations из одного текста/Link structure S0 не извлекает.**

### 2. Что возможно только с явными definitions?

В ограниченном definition pack S0 получает candidates для:

- subject/action/object;
- MUST/MAY/PROHIBITED;
- explicit negation scope;
- quantifier scope;
- BEFORE/AFTER;
- IF vs ONLY_IF;
- context-selected homonym meaning.

Это не знания, «выученные» из текста; это применение явно предоставленных definitions.

### 3. Что невозможно установить из доступных данных?

S0 честно не устанавливает:

- смысл незаданного `надлежит`;
- смысл незаданных `обязана/архивировать`;
- роль unsupported word order;
- неизвестное event definition;
- композицию IF + temporal relation без отдельного определения;
- выбор омонима без context;
- semantic truth/probability.

### 4. Даёт ли Link representation проверяемое преимущество?

**По semantic candidate extraction при одинаковом knowledge pack — нет.**

Link и flat baseline совпали на всех 28 случаях.

Проверяемая польза Link в S0 — представимость knowledge/evidence как immutable graph и точный provenance, но не дополнительная semantic information.

### 5. Какая минимальная следующая задача обоснована?

Сначала нужен **независимый human gold gate**, а не новый universal semantic engine:

1. независимо проверить/исправить 28 provisional annotations;
2. заморозить corpus/definition pack SHA;
3. только затем вычислять relation/span precision/recall и false positives;
4. добавить небольшой untouched набор новых формулировок для проверки переноса definitions, не расширяя pack по heldout.

До этого любые claims об accuracy являются методологически недопустимыми.

## 11. Воспроизведение

```bash
npm test
node scripts/w19_semantic_s0.mjs
```

Script выдаёт `W19S0_REPORT <json>` с полным машинным protocol по всем 28 требованиям.

S0 на этом останавливается. #24, FORMAL bridge, Γ, compression и большой semantic engine в этой работе не запускаются.
