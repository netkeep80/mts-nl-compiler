# E0-Numeric: измерение скорости загрузки книг в SQLite

Scope: [issue #63](https://github.com/netkeep80/mts-nl-compiler/issues/63), physical numeric schema accepted #51/#62. Это отдельная **прямая** сборка Unicode → числовые Link в SQLite **без** старых \`a:/p:\` и без вычисления SHA для образования Link ID. Она не подменяет научный legacy E0/E1–E7 baseline: чтобы не потерять исторические контрольные значения и фальсификаторы, старый DAG пока запускается как независимый оракул сравнения структуры.

\`NumericCorpusLoader\` выделяет новые ID **только через SQLite AUTOINCREMENT**, хранит полюса как \`bigint\`; нормальные неуникальные индексы \`from_id\`/\`to_id\` уже существуют до первой вставки. Равенство структур выявляется при явно включённом \`reuseAtoms/reusePairs\` через временные exact-symbol/exact-numeric-pole Map (НЕ хеш-функция). При отключённом \`reusePairs\` несколько Link с одинаковыми полюсами сохраняются независимо. Для каждой книги применяется \`BEGIN IMMEDIATE … COMMIT\`, при ошибке \`ROLLBACK\` и сброс кэшей. После всех книг только один раз пересчитываются производные позиционные счётчики и проверяется структурная целостность. Холодный SQLite читатель открывает \`VACUUM INTO\` в режиме read-only и восстанавливает **точные исходные UTF-8 байты** каждой книги по её числовому корню.

## Метрический контракт (сериализация JSON без BigInt)

Скрипт \`scripts/compile-real-corpus-e0.mjs\` выполняет вторую независимую загрузку тех же шести закреплённых Git-источников и печатает \`E0_NUMERIC_IMPORT_DOC\` по каждому документу и \`E0_NUMERIC_IMPORT_SUMMARY\` по всему корпусу. Отчёт \`reports/real-corpus-E0.json\` содержит поле \`numericImport\` и сохраняется CI-artifact \`real-books-and-articles-e0\`.

По книге:
- \`sourceBytes\`, \`codepoints\`, \`rootLinkId\` (десятичная строка uint-положительного signed64), \`insertedAtoms\`, \`insertedPairs\`, \`reusedAtoms\`, \`reusedPairs\`, \`insertedLinks\`;
- \`decodeMs\` (strict UTF-8 and codepoint array), \`compileAndSqlInsertMs\` (построение, поиск точных повторов, выделение Link IDs, SQL INSERT вместе), \`commitMs\`, \`loadTotalMs\`;
- \`insertLinksPerSecond\`, \`inputMiBPerSecond\` (1 MiB=1048576 bytes), \`rssBeforeBytes\`/\`rssAfterBytes\`, \`sqliteLogicalBytesAfter\`.
  
По всей базе:
- \`schemaAndIndexesMs\` и \`cacheStartupMs\`, \`documentInsertionWallMs\`, суммарные compile/SQL и commit, \`aggregateInsertedLinksPerSecond\`, \`aggregateSourceMiBPerSecond\`;
- \`counterRebuildMs\`, \`integrityCheckMs\`, \`sqliteLogicalBytes\`, \`sqliteVacuumBytes\`, \`vacuumMs\`, \`coldReadOnlyReplayMs\`, \`coldStatus\`, \`indexPlans\`, \`rssBytes\`;
- \`toolchain\`: Node/SQLite/platform/architecture/CI, транзакционный режим, индексная конфигурация и explicit reuse policy.

### Как интерпретировать

Скорость вставки \`insertLinksPerSecond\` = **новые физические Link-строки** / время построения+SQL INSERT+COMMIT, *не* число исходных кодовых точек/с и *не* наблюдаемая частота дуплетов. \`inputMiBPerSecond\` = размер исходного UTF-8 / полное измеренное время загрузки; \`compileAndSqlInsertMs\` **не** означает чистое время INSERT, а включает алгоритмическую обработку — для дальнейшей оптимизации понадобятся более тонкие инструменты профилирования. Операции проверки, \`VACUUM\`, компрессии и rebuild вынесены отдельно и не маскируются внутри скорости вставки.

Первый проход по каждому документу может иметь другой cache-warmup, SQLite page cache и нагрузку GitHub runner; проценты ускорения корректно вычислять только при одинаковой машине, одинаковом прогретом/холодном режиме, повторениях и распределении. Текущий запуск — **baseline**, а не доказательство, что SQLite или компилятор достигли предельной скорости.

Ни один исходный текст не публикуется в отчёте. SHA исходного Git blob и контрольные суммы архивов сохраняются как **provenance**, но никогда как Link identity.

## Дальнейшие этапы

Старые E0 DAG \`encodeShared\` и E1–E7 экспериментальные структурные оракулы остаются на прежних временных метках до отдельной регрессии: удалять их SHA-формат механически нельзя, иначе изменятся научные сравнения и pinned evidence. Следующие PR заменят эти генераторы на явное numeric allocation / structural equality, с отдельными версиями отчёта. Цель #63 не закрыта до полного перехода всех E0–E7.
