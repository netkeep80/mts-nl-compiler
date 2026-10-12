# W17N0 — нативный Node.js read-only слой асети Link, без SQLite

Статус: **исследовательский**, подготовлен в продолжение W17 [#89](https://github.com/netkeep80/mts-nl-compiler/pull/89), stacked on W15 [#86](https://github.com/netkeep80/mts-nl-compiler/pull/86). Не меняет нормативную МТС v0.15, числовую схему SQLite и `main`. Не является новым механизмом семантического вывода / вероятностей / обучения.

## Реальная граница интеграции

- `src/w17-native-link-runtime-v0.mjs`: Node-native W15F1-progressive decoder с типизированными массивами индексов, атомов, длинами поддеревьев. Не использует SQLite, Python или словарную логику. **Только неизменяемые знания**, без публикации новых корней и Γ; никакого чтения/записи runtime working state.
- `FrozenLinkAseti.fromWire(w15Buffer)`: полностью нативный Node путь. Проверяет header, noncanonical LEB128, запрещённые атомы и дубль Unicode scalar, топологию всех бинарных Link, bit-padding, budget и root byte/scalar lengths. Node не знает физических SQLite ID. Числовые Link ID в этом модуле **локальные порядковые индексы сериализованного графа**, не их SQLite-эквиваленты.
- `FrozenLinkAseti.fromArchive(zipPath, {decompressXZ,expectedArchiveSHA256?,verifyDocuments?})`: ZIP_STORED с ровно двумя членами (`manifest.json`, `links.w15f1.xz`), SHA XZ, SHA W15 и опциональной внешней SHA всего ZIP, source SHA всех документов при `verifyDocuments=true`. **Внешний XZ backend передаётся явно**: штатный Node.js 24 не умеет читать XZ. Его установка/поставка — отдельная задача; нельзя заявлять native Windows installer-ready. Если API вызван без backend, немедленная ошибка, **нет** Python/SQLite fallback.
- API: `link(index)`, `roots`, `documents`, `scalars(doc,start?,stop?)`, `slice(doc,start?,stop?)`, `find(doc,substring,{maxHits?})`, `digest(doc)`, `verifyDocumentDigests()`. Адресация диапазонов и поиска — в Unicode scalars, не в UTF-8 bytes. KMP поиск пересекает произвольные границы бинарных Link.
- `scripts/w17_native_query.mjs`: **временный исследовательский CLI для Linux/macOS с установленной `xz`**. В нём XZ через явный `spawnSync('xz')`, без SQLite и Python. Не включать его в Windows installer до добавления переносимого распаковщика с фиксированной версией и тестами расхода ресурсов. Основного production `compile()` в текущем `main` пока нет: интегрирован только слой доступа к данным; не выдавать его за весь готовый компилятор.

## Измеренный полный W17-архив, 60 закреплённых книг

Из W17 research-only архива SHA256 `3bfb90b955a4511fa97c1fad6873ea5d742fd226fdbc8df2a4c1035829074391` (8 113 814 bytes): W15F1 9 723 277 bytes, 1 951 822 Links и 60 корней. **Все 60/60 SHA-256 UTF-8 восстановленных документов совпали** с архивным манифестом; поиск и срезы работают без раскрытия книг на диск. Синтетические CI-тесты дополнительно проверяют Cyrillic+emoji, crossing Link boundary, повреждение заголовка, truncated wire, чужие члены ZIP, поддельную SHA документа/архива, отсутствии обязательного XZ backend.

Отдельный запуск текущей лабораторной машины Linux Node **v22.16.0**:

| Этап | Время / результат |
|---|---:|
| Холодный W17 archive ZIP→XZ→Node DAG, проверка wire SHA | 1 128,9 мс |
| Дополнительный точный SHA-256 replay 60 документов | 1 086,9 мс |
| 1000 срезов длины до 20 Unicode scalars (hot) | 2,9 мс |
| 20 поисков ` что ` с лимитом 100 совпадений на одном документе (hot) | 47,1 мс |
| RSS после этих этапов | 116 420 608 bytes (≈111 MiB) |

Эти цифры **наблюдения одного прогона, не p95, не Windows и не Node24**. Сравнение с прежним Python W17R1 следует делать только на одинаковой машине и одинаковых режимах SHA и maxHits; результаты разных реализаций не гарантируют speedup приложения. Текущий Node индекс по-прежнему использует **O(количеству Links) RAM**, многогигабайтные пакеты W18 требуют страницы/чанки и независимого memory gate.

## Воспроизводимость

```bash
node --test tests/w17-native-link-runtime-v0.test.mjs
# Linux research adapter, requires locally installed xz:
node scripts/w17_native_query.mjs --archive w17-aseti-60-research.zip --list --verify-all
node scripts/w17_native_query.mjs --archive w17-aseti-60-research.zip --document 0 --slice 80:95 --find ' что '
```

По умолчанию `fromArchive` пересчитывает все SHA документов. В тестах и малом latency-бенчмарке режим без него включается **явно**. SHA самого архива обеспечивает подлинность только при независимом закреплении его значения; внутренние SHA из самоподписанного манифеста защищают целостность передачи, но **не доказывают доверенное происхождение**.

## Следующие обязательные gates

1. Портативная XZ-декомпрессия в дистрибутиве для Windows 10/11, независимый fuzz/truncation/oversized-stream test и контроль точных расхода RAM/CPU/места.
2. Отдельная API-граница read-only frozen Link knowledge и mutable рабочей асети Γ. Не путать локальный ordinal W15 с физическими integer64 SQLite ID, доказательствами или контекстными ролями.
3. Аналогичные full 60-book и split heldout reproducibility gate на Node 24, затем clean-install offline Windows test. Границы из W18 large packset — в будущем; **не создавал их сейчас**.
4. Публичная поставка запрещена без отдельного per-book rights review и фиксированного package digest.