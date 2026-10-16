# W9 / M1.0–M1.1: настоящий обратимый побитовый baseline

**Статус:** исследовательский эксперимент. Не принятая новая семантика МТС, не SQLite Link database и не система, открывающая морфемы. Связано с #79 (самоорганизация) и #10 (MDL). Следующие этапы A2/A3 ещё НЕ реализованы.

## Транспорт и инвариант

`src/m1-reversible-mdl-v0.mjs` использует только поток **Unicode scalar values**, без `split(' ')`, предиката букв, пунктуации, языка, морфем, границ слов и словаря.

Принимаются только канонические корректные UTF-8 байты. Исходные `BOM/U+FEFF`, `CR`, `LF`, combining sequences, пробелы и пунктуация сохраняются без нормализации. Не-UTF-8 байты отклоняются; для них пока нет режима fallback.

Формат `M1L0` (не протокол МТС):

```
"M1L0"                  4 bytes
atomCount                unsigned LEB128
atom[0..atomCount-1]     Unicode codepoints, unsigned LEB128, first-appearance order
ruleCount                unsigned LEB128
rule[i].left,right       unsigned LEB128; each references an earlier atom/rule
numberOfDocuments        unsigned LEB128
per document:
  originalByteCount       unsigned LEB128
  parseTokenCount         unsigned LEB128
  parseToken[]            unsigned LEB128 ID
  when ID=atomCount+ruleCount: one *additional* ULEB128 exact scalar escape
```

All binary definitions are topologically ordered. A token ID references an atom or rule, except one reserved escape ID for unseen scalars. All bytes of the header, alphabet, grammar, source lengths, root token streams and escapes **are counted** as `8 * serializedBuffer.length`. No free probability tables, words, transient SHA-derived IDs or metadata. Document names/IDs are external caller labels and not part of the binary format; **document order and bytes** are preserved. Local coded ranks are not SQLite Link IDs.

A separate decoder accepts only canonical integers, existing backward references, exact output lengths and bounded expansions; then reconstructs document Buffers without the originals. It is tested on a fresh Buffer. `encode(decode(buffer)) == buffer` holds for its supported canonical frames. The training wrapper also verifies exact source bytes.

## A0 vs A1

- **A0:** greedy most-frequent adjacent pair by *realized nonoverlapping* count, may accept a cost-neutral/costly rule. No prior knowledge of words.
- **A1:** evaluates top 24 pair candidates from an immutable proposal snapshot. Each candidate is serialized independently with the **actual full bit cost**. Commits the best negative `ΔencodedBits`. After main loop, tries exact fixed-grammar DP reparse and dropping the last rule; accepts only if complete transmitted bits decrease. A1 is not a global grammar minimum, nor a complete split/rotation/bundled-search optimizer.
- `scoreM1Frozen`: heldout docs are parsed with **frozen** training atoms/rules. Unknown scalars use explicit paid escape references. Training grammar is never modified by heldout; the heldout bit count subtracts the complete model-only frame, and full transmitted bit count (model+test) is also reported.

**Important research limit:** although the format reports exact bits, ULEB128 token IDs are *not an entropy-optimal code*. In particular, all tokens below 128 have 8-bit reference codes. The decoded UTF-8 may be shorter than the encoded model; that is a legitimate negative result, not a bug. Changing the codec requires a separate comparison and re-validation, not pretending Shannon entropy is a real transmitted frame.

## Fixed five-seed no-space synthetic experiment

The evaluator generates 8 artificial roots × 4 suffixes, hides predetermined combinations by `(rootIndex + 2*suffixIndex + seed) % 7 == 0`, samples 560 exposed forms with a fixed LCG seed, concatenates them **without separators**, and scores withheld combinations ×5. Root/suffix identities are **not** provided to the trainer; they are used only to construct inputs. Max 35 rules. This is a **smoke test**, not a statistical proof or morphology benchmark.

Results from locally executed Node 22 test (bits for full standalone frames):

| Seed | Initial bits | A0 training bits | A1 training bits | A0 heldout bits/scalar | A1 heldout bits/scalar |
|---:|---:|---:|---:|---:|---:|
| 1 | 18,160 | 6,392 | 6,360 | 4.16 | 4.16 |
| 2 | 18,160 | 6,792 | 6,768 | 4.20 | 4.20 |
| 3 | 18,160 | 6,688 | 6,688 | 3.36 | 3.36 |
| 4 | 18,160 | 6,888 | 6,864 | 3.70 | 3.70 |
| 5 | 18,160 | 6,832 | 6,832 | 4.16 | 4.16 |

**Interpretation:** A1 saves 0–32 bits of **train** over A0 (for this fixed setting), but has **zero heldout advantage** in all five seeds. Exact grammar reuse works. No discovery of productive class, morpheme or role has been demonstrated. A3 is needed before the main hypothesis is tested.

## What is NOT supported

- A2 predictive context/boundary generator, A3 learned classes/templates, and generative role transfer.
- Stable empirical morpheme boundary precision/recall and the larger controlled paired-world surrogate.
- Exact reassociation/rotation, general beam/bundle acceptance, complete garbage collection of logical rules.
- SQLite authority, physical Link row counts, root reachability, physical GC, actual full 60-book run.
- Claims about `word-aligned`, semantic understanding, optimality or MTS v0.15 contracts.

## Next gate

1. Freeze the M1L0 wire contract and independent decoder as a test oracle.
2. Implement A2 *proposal-only* left/right context signatures without changing bit-codec, then measure if it changes candidate search results at matched budget.
3. Implement A3: paid class definitions, occurrence-bound template bindings, composite shadow/bundle trials; train-only tuning and withheld-combination evaluation.
4. Independently verify synthetic vs matched n-gram surrogate and alphabet bijection (with controlled code-width differences). Only then scale to pinned 60 books / 48 training / 12 locked heldout.
5. Keep SQLite atomically published roots and reachable garbage collection behind #78; no inference from MDL bits to physical Link reduction.

## M1.2 — A2: контекстная очередь предложений, тот же битовый кодек

A2 реализована **только как proposal-ranking**, а не как отдельный языковой
классификатор или новый предиктивный код. Формат `M1L0`, полная стоимость
`8 * wire.length`, алфавит, декодер, frozen heldout и критерий
`ΔactualEncodedBits < 0` **строго совпадают с A1**. Поэтому любые различия
можно приписывать только поисковой стратегии, а не смене стоимости данных.

Для каждого соседства двух *текущих числовых токенов* `(x,y)` считаются:

- `f_xy` — число всех смежных позиций в текущем разборе; отдельно `m_xy` — число
  непересекающихся возможных замен, как в A1;
- `f_x, f_y` — реальные токенные частоты;
- `N_adj` — число смежных позиций в пределах отдельных документов;
- частоты предыдущего элемента перед парой и следующего за парой (без
  перехода через границы документов); их две эмпирические энтропии.

Контекстная эвристика с псевдосчётом `0.5`:

```
PMI(x,y) = log2(((f_xy+0.5)*(N_adj+1))/((f_x+0.5)*(f_y+0.5)))
flankH(x,y) = H(preceding | xy) + H(following | xy)
rank(x,y) = m_xy * max(0, PMI(x,y))
            + 0.5 * log2(1+m_xy) * flankH(x,y)
```

Это **не вероятность границы**, не доказательство морфемы и не измеренная
экономия битов; score только ранжирует предложения. В каждом epoch половина
бюджета `topCandidates` отводится под наиболее частые пары; остальные
отбираются по контекстному score с пропуском дубликатов. При нехватке
контекстных кандидатов оставшиеся позиции дополняются частотными. Общий
бюджет и итоговый точный MDL-арбитраж не изменились.

### Фальсификаторы

1. Синтетическая неоднородная частотная матрица (178 независимых двоек):
   `[E,F]` имеет **меньшую частоту** (18 против 60), но значительно большую
   условную PMI; при бюджете 2 A2 ставит его рядом с одним частотным
   кандидатом. Это тест *proposal*, не доказательство лучшего сжатия.
2. Полная алфавитная биекция `U+0020 -> '~'` (равная цена scalar ID) не
   изменяет правила, парсы, битовую стоимость A2 или побайтовое восстановление.
   Следовательно нет специальной обработки пробела.
3. A2 пять раз обучается на точно том же blind no-space train и frozen heldout,
   что A0/A1, сохраняя byte-exact восстановление, запрет дообучения и полный
   transmitted bit count. Новые тесты работают на фактическом кодеке.

### Результат: заранее сохранённый пятисерийный тест

| Seed | A1 train bits | A2 train bits | A1 heldout bits/scalar | A2 heldout bits/scalar | Context-origin accepted |
|--:|--:|--:|--:|--:|--:|
| 1 | 6360 | 6360 | 4.16 | 4.16 | 0 |
| 2 | 6768 | 6768 | 4.20 | 4.20 | 0 |
| 3 | 6688 | 6688 | 3.36 | 3.36 | 0 |
| 4 | 6864 | 6864 | 3.70 | 3.70 | 0 |
| 5 | 6832 | 6832 | 4.16 | 4.16 | 0 |

**Отрицательный результат:** в этом бюджете (24 proposals, 35 правил)
контекстный shortlist не изменил победителей точного `Δbits`, конечные
словарь/парсы или heldout. Это ограничение именно данной A2 эвристики и
корпуса; не доказательство бесполезности контекста вообще. Данные
пяти seed не дают статистического доказательства языковой продуктивности.

Следующий независимый барьер **M1.3**: платные классы/слоты с
occurrence-specific bindings и независимым сериализованным декодером.
Обновлённый формат должен иметь новый magic/version, чтобы не объявлять
обратную совместимость там, где её нет. Затем проверить скрытые комбинации
`root×affix` и paired-world null-sources; без этого не заявлять морфологию.
**CI/gov evidence:** M1.2 expands the draft from M1.1 to 694 net new lines. The pull-request research budget is now explicitly 860 lines (repository shared cap 4000); the original 530-line intent correctly blocked the earlier workflow event. A new event is required after editing PR metadata, since rerunning a historical event reuses its original PR payload.
