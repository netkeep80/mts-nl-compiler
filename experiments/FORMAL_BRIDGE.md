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
