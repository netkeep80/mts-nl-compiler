# #24 — Проверка границы JSON-tree ↔ ExactSequence

**Статус: исследовательская структурная модель, не принятая совместимость с FORMAL v0.15.**

### Подтверждённый контракт источника

Проверены **живые исходники** `netkeep80/anum_docs` при `main=c64b7e21340c6add248c8f380f3fef1292616ac6`:

- `docs/specs/Формальная нотация МТС.md`: `Den([])=ExactSequence([])=R` (нормативная проекция); `null` члена объекта исходного canonical FORMAL JSON — `bare-entry`, а не терминатор.
- `ts/src/exact-sequence.ts`: `Cell(prev,value)=self⟼(prev⟼value)`. Начало `R`. Материализатор формирует `payload=ensure(current,value)`, затем `current=ensureStartSelfClosed(payload)`. Читатель проверяет `start(cell)==cell`, извлекает `payload` и возвращается к предшественнику. `R` разрешён **как значение позиции**.
- `formal/v0.15/regression/grounded-zero-role.json` содержит `"GroundImage":["GroundOutput"]` и `"Theory->GroundRule":null`. Следовательно, accepted JSON нельзя напрямую подавать в транспортный формат с запретом массивов и терминальным `null`.

### Исследовательский переход

`experiments/native-exact-sequence-bridge-v0.mjs` читает экспериментальную CONS/NIL-проекцию выбранной последовательности в упорядоченный список **Link IDs**, затем **в той же одной асети** создаёт последовательную цепь self-closed `Cell`, структурно соответствующую указанной формуле v0.15. `null` *при чтении JSON-дерева* означает остановку транспорта; при построении semantic Cell пустая последовательность представляется конкретным заданным root `R`. Значение `R` в одной из позиций обрабатывается обычным образом и **не** завершает эту последовательность.

Обратный читатель проверяет цикл по predecessor, форму Cell, форму payload, лимиты. Все новые значения — обычные Links. Селектор конкретного root явно предоставляется экспериментом; физические identifiers `cell:<SHA>` не являются доказательством идентичности с принятыми MTS Link handles. Никакого переопределения канонического `ExactSequence` или native JSON.

### Проверки и границы

Тесты: `[]` vs `[R]`; повторяющиеся символы и Unicode; экспорт с self-closed Cells через `$links` и импорт; применение того же generic Γ к правилу после JSON-транспорта с идентичным выводом и provenance; отклонение чужого canonical FORMAL JSON; неправильная self-cell и циклы; `RESOURCE_LIMIT`.

**NATIVE_METACOMPILER_REPLAY = NOT_EXECUTED.** Для полного verdict нужно независимо проверить actual native semantic ANet (root basis, no extra label atoms, source/semantic identity, exact FORMAL↔JSON common denotation) и replay на upstream `anum_docs` + frozen `amemory`. Никакой фактической совместимости пока не принимаем.

Текущий код — тестовый one-table carrier, не новая принятая семантика. PR остаётся draft, merge по exact SHA только после отдельного решения автора.


## Cross-repository native CI (additional research gate)

`.github/workflows/formal-bridge.yml` checks out public `netkeep80/anum_docs` at exact commit `c64b7e21340c6add248c8f380f3fef1292616ac6`, builds the accepted TypeScript source, runs its existing production-FORMAL refinement and Boolean package replay tests, then executes `tests/upstream-formal-v015.integration.mjs` against the **actual native `Memory`, `materializeExactSequence` and `readExactSequence`**. The differential only asserts recursive cell shape, order, identity of *mapped opaque positional values*, empty sequence and root-as-position; no mapping from arbitrary LinkGraph IDs to native accepted MTS handles is asserted.

Even when this job passes, `NATIVE_CELL_SHAPE_DIFFERENTIAL=PASS` does NOT mean `TRANSPORT→NATIVE_METACOMPILER→Γ` end-to-end PASS. The source JSON formats remain distinct, so the latter gate stays `NOT_EXECUTED` until an approved total conversion is specified and executed.

## Проверенный ограниченный мост в настоящий метакомпилятор (2026-10-11)

[CI run 38148036633](https://github.com/netkeep80/mts-nl-compiler/actions/runs/38148036633) — **SUCCESS**. Upstream `anum_docs` был собран и выполнен по exact SHA `c64b7e21340c6add248c8f380f3fef1292616ac6`.

В дополнение к accepted `v015-formal-production-refinement-f1` и `v015-boolean-package-replay-a2`, интеграционный тест берёт позиции выбранного дерева `мама` (`m,a,m,a`) и **явно** сопоставляет `m→O`, `a→C` (исследовательское соответствие ID; это не распознавание букв как полюсов МТС). Производится отдельный native source JSON с `SelectedSequence:["O","C","O","C"]`, `EmptySequence:[]`, `RootAsPosition:["R"]`, а затем настоящий `compileV015DirectJsonSourceAnet` и `denoteV015ResolvedSourceAnet` принимают его и дают искомые семантические Link handles, проверенные `materializeExactSequence`.

Результаты: `NATIVE_CELL_SHAPE_DIFFERENTIAL_PASS`, `NATIVE_FORMAL_JSON_SEQUENCE_BRIDGE_PASS`, с принятым upstream `MTS_V015_FORMAL_PRODUCTION_REFINEMENT=GREEN`. **Статус полного семантического переноса остаётся NOT_PROVED**: произвольные строки и графовые ID не сопоставлены с native handles, исходный `$links` не импортируется целиком в source ANet, правила в нашем JSON не проходили этот метакомпилятор и не исполнялись в native Γ как часть полного end-to-end. Тем более нет доказанного преобразования всей асети с preservation of contextual identities. Нельзя объявлять `MTS_v015_FULL_INTEROP=PASS`.


## Общая native source ANet для двух принятых синтаксисов

[CI 38148249587](https://github.com/netkeep80/mts-nl-compiler/actions/runs/38148249587): **SUCCESS** для exact pinned `anum_docs` и локальных проверок. Для ограниченно преобразованной последовательности `[O,C,O,C]` построены **два** независимых исходных текста — accepted FORMAL и accepted JSON — и через реальные функции `compileV015DirectFormalSourceAnet` / `compileV015DirectJsonSourceAnet` получен **один и тот же native source ANet LinkHandle** в общей памяти. Проверен `NATIVE_FORMAL_JSON_SAME_SOURCE_PASS`, затем произведена денотация соответствующих значений `ExactSequence`. Это важно, потому что проверяется не только совпадение вычисленного результата, но и совпадение **источника** в принятом native lowering. Область по-прежнему ограничена явным соответствием `m↦O`, `a↦C`, пустой последовательностью и `[R]`. Общая эквивалентность транспорта произвольной асети и native FORMAL **не доказана**.
