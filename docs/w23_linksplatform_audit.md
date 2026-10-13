# W23-A/B — LinksPlatform sequence algorithms audit and frequency reference

Status: **experimental research evidence**, not a change to MTS v0.15, SQLite schema, requirements, or public semantic contracts.

## Reproducibility pins

- MTS NL Compiler baseline: `0a028a395a5bdafa13f477dc9031931aacb8cb9c` (`main`, 2026-10-13).
- Baseline main CI: Actions `38386782128`, SUCCESS.
- LinksPlatform upstream: `linksplatform/Data.Doublets.Sequences` at `6a6a69fc3ce42b0bd3e421c17c810ec2f37cb12b`.
- Upstream license at that revision: Unlicense / public domain dedication.
- Research issues: #107 (W23), #104 (W22-D).

Repository governance is advisory, but `requirements/**`, `db/schema.sql`, `.github/**`, `repo-policy.json`, `.anet/memory.json` and the PR template are governance paths. This wave touches none of them.

## Source-review map

| Upstream component | Pinned source finding | Existing MTS NL Compiler analogue | W23 decision |
| --- | --- | --- | --- |
| `BalancedVariantConverter` | Repeatedly pairs adjacent elements by levels; an odd last element is carried unchanged to the next level. | W21 `engine.mjs` and W22 `window-oracle.mjs` use recursive half-split balanced trees. | **Not identical for non-power-of-two / odd lengths.** Add explicit structural comparison later; do not add another generic balanced implementation now. |
| `CompressingConverter` | Shared `LinkFrequenciesCache`, selected pair replacement, non-overlap substitution, affected-neighbour frequency updates. | W4 `trainUniversalRepair` fully rescans current token adjacencies each round. E5 incrementally counts *external append observations* but does not maintain a replacement agenda. | Add a full-rescan W23 reference oracle first; Stage C may optimize only if it stays equivalent under the same objective. |
| `OptimalVariantConverter` + local-level converter | Element level is max(left-pair frequency, right-pair frequency); equal-level runs are grouped and levels adjusted. | W22 enumerates all 42 (width 6) / 429 (width 8) binary trees and supplies an exact bounded comparator. | Implement later only as a heuristic and compare against W22. Upstream `OptimalVariantSequenceTests.cs` is entirely commented out at the pinned revision. |
| `DefaultSequenceAppender` | Walks the right spine by height, stacks left subtrees, rebuilds the affected path with `GetOrCreate`. | E5 append updates one newly observed source adjacency and rematerializes subscribed views only if the selected observed pair changes. | Different hypotheses: height-based tree append vs frequency observation. Keep separate. |
| `LinkFrequenciesCache` | Caches pair frequencies and may seed a newly observed pair from an existing Link counter. `ValidateFrequencies` tolerates a ±1 discrepancy and contains a TODO asking why cache frequency is always one greater. | W4/E5 counts are source observations; W22-C separately reports physical pole counters and expanded source occurrences. | Never merge these event spaces. |
| `CachedFrequencyIncrementingSequenceIndex` | Incrementally increases cached frequencies when an indexed sequence is added; unknown cache entries stop the indexed scan and are initialized afterwards. | No exact equivalent. | Reuse the idea only after event semantics are fixed. |

### Balanced tree difference is substantive

For five leaves `a b c d e`, LinksPlatform level-pairing produces the shape equivalent to `(((a b) (c d)) e)`. The current MTS browser/W22 recursive half split produces `((a b) (c (d e)))`. Thus “balanced” is not one universal tree shape here.

## P0 comparator defect: executable counterexample

Pinned C# `CompressingConverter.UpdateMaxDoublet` contains:

`frequency > minFrequency && (maxFrequency > frequency)
    || maxFrequency == frequency && source + target > bestSource + bestTarget`

C# gives `&&` higher precedence than `||`. `ResetMaxDoublet()` sets `maxFrequency = 0`. For a normal first candidate with `frequency = 2` and default `minFrequency = 1`:

`2 > 1 && 0 > 2  -> false
0 == 2            -> false
selected          -> false`

Normal initial counting produces positive frequencies, so a freshly reset maximum cannot be initialized by this predicate. `Compress()` calls `ReplaceDoublets` only when `_maxDoubletData.Frequency > 0`. For sequences longer than two, the normal positive-frequency path therefore does not enter frequency replacement after a fresh reset.

The pinned C++ sibling uses `maxFrequency < frequency` and explicit grouping around the max/tie expression, i.e. the opposite comparison required to initialize and then improve a maximum.

`tests/w23-frequency-reference.test.mjs` provides:
1. a dependency-free executable model of the exact pinned C# predicate;
2. a tiny real C# program launched through `dotnet`. On GitHub Actions the C# execution is mandatory; local environments without `dotnet` skip only that cross-language confirmation.

No upstream repository is modified.

## Tie-break risk is separate

Both pinned variants use numeric `source + target` for equal-frequency ties. W23 cannot use that as canonical determinism because pairs such as `(1,4)` and `(2,3)` collide, physical Link IDs depend on allocation history, and fixed-width unsigned addition may wrap.

The reference ranks equal-frequency candidates lexicographically by an ordered structural key derived from their children and Unicode atoms. Local token numbers are implementation handles only.

## First independent reference implementation

`src/w23-frequency-reference-v0.mjs` is deliberately a **full-rescan correctness oracle**, not the final fast algorithm.

Contract:
1. Exact Unicode input; unpaired surrogate input is rejected.
2. Frequency = adjacent occurrences in the **current abstract token sequences** across supplied documents.
3. Rank by descending frequency then deterministic structural key.
4. Confirm left-to-right non-overlapping replacement count before accepting a candidate.
5. Exact ordered poles reuse one abstract composite token.
6. Rebuild the next reference frequency table from scratch after every round.
7. Expand final token sequences and require exact source replay.

The token numbers are explicitly **abstract**. They are not string hashes, browser IDs, SQLite IDs, or evidence of physical Link savings. W23-D must execute candidates against the numeric SQLite store and compare predicted deltas with an independent physical rebuild.

## Small correctness measurements

Algorithmic observations only; no corpus-performance claim:

| Input | Rules | Final abstract tokens | Full-rescan adjacency inspections | First pair | Adjacent observations | Non-overlap replacements |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| `мама` | 1 | 2 | 4 | `ма` | 2 | 2 |
| `аааа` | 1 | 2 | 4 | `аа` | 3 | 2 |
| `аааааааа` | 2 | 2 | 11 | `аа` | 7 | 4 |
| `абабаб` | 1 | 3 | 7 | `аб` | 3 | 3 |
| `абаабабб` | 1 | 5 | 11 | `аб` | 3 | 3 |

Tests additionally cover empty text, Russian/English repeated sentences, emoji, combining marks, tabs/CRLF, deterministic pseudo-random input, a no-repeat control, cross-document accumulation, tie stability under unrelated token allocation, and the overlap falsifier `ааа` (two adjacent observations but only one disjoint replacement, therefore no rule at `minOccurrences=2`).

## Relation to W22-D0

W22-D0 measured only a frozen *tree shape* selected on short train windows: width 6 saved one physical Link over 12 reused heldout snippets; width 8 saved none; both had zero SQLite VACUUM-byte delta. W23 does not reinterpret this as failure of recurring phrase DAGs. It changes the next objective from shape-only selection to frequency/reuse/marginal persistent cost.

The original 12 W4 heldout books are now a **reused benchmark**, not untouched blind data for W23 tuning.

## Next falsifiable steps

1. **W23-C incremental replacement agenda:** update only adjacencies touched by each non-overlapping replacement. After every mutation compare the complete frequency multiset, selected candidate and final rewrite with this full-rescan reference. Any mismatch is a bug.
2. **W23-D physical marginal cost:** predict `ΔstoredRows`, reused physical Links, active reachable delta and retained historic rows from a frozen SQLite snapshot; independently rebuild in SQLite and require exact agreement.
3. **W23-E matched comparison:** LinksPlatform level-balanced, current balanced/left, W4 Re-Pair, local levels, incremental frequency agenda, append and W22 exhaustive window oracle.
4. Only then: the 60-book reused benchmark plus a separately pinned untouched multilingual/domain-diverse confirmation corpus and Observatory publication.
