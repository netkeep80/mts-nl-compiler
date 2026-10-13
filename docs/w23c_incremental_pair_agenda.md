# W23-C — Incremental Pair Replacement Agenda

Status: **experimental research**, scoped to issue #107. This stage does not change MTS v0.15, SQLite, FORMAL, requirements, E5, or the public compiler UI.

## Baseline and oracle

- Baseline main before W23-C: `baf72d4450078cf905ac3a49e7e5350264afde6a`.
- W23-A/B accepted full-rescan oracle: `src/w23-frequency-reference-v0.mjs`.
- Upstream LinksPlatform pin remains `6a6a69fc3ce42b0bd3e421c17c810ec2f37cb12b`.

The only change to the accepted oracle is an optional `includeTrace` diagnostic. With tracing disabled, rule selection, token allocation, final sequences and replay are unchanged. The trace exposes each pre-round token sequence, the complete eligible current-token pair-frequency set, selected candidate, non-overlap replacement count and post-round token sequences.

## Event-space boundary

W23-C indexes **current token adjacency after pair replacement**.

It is not E5:

- E5 observes external source-scalar adjacency when new input is appended.
- W23-C mutates the current token sequence after selecting a pair and must update the changed adjacency graph.
- Source occurrences, current-token pair counts, physical SQLite rows, `from_uses/to_uses`, and future W23-D marginal cost remain separate quantities.

No SQLite Link ID exists in this experiment. Numeric tokens remain abstract algorithmic handles.

## Incremental data structure

Each document is represented as a linked sequence of stable-position nodes.

For every live node that has a successor:

1. `edgeKey` is the reverse index from that position to its current ordered token pair.
2. A pair bucket stores the set of current left-node occurrences.
3. An indexed max-heap stores exactly one live entry per eligible pair bucket.
4. Heap order is descending frequency, then the same content-derived canonical key as the oracle.
5. Heap entries are updated in place; **stale heap entries are zero by construction**.

A selected occurrence replaces two adjacent nodes by retaining the left node as the new composite token and unlinking the right node. Only these pre-existing/new edges are touched:

- predecessor → left;
- left → right;
- right → successor;
- predecessor → replacement;
- replacement → successor.

All other adjacency positions and counts remain unchanged.

All non-overlapping occurrences for the selected pair are frozen from the same pre-round snapshot before any replacement is applied.

## Differential hard gate

`verifyIncrementalAgainstReference` runs the independent full-rescan oracle with trace enabled and hard-fails on any difference in:

- every round's complete eligible pair-frequency multiset;
- current token sequences before the round;
- selected pair and canonical tie-break;
- observed adjacency frequency;
- non-overlapping replacement count;
- replacement token allocation / pair reuse;
- current token sequences after the round;
- complete rule sequence;
- final abstract token sequences;
- exact Unicode replay.

There is no ±1 tolerance.

Mandatory controls include:

- `мама`;
- `ааа`: 2 overlapping observations, only 1 disjoint replacement, therefore no rule at `minOccurrences=2`;
- `аааа`: 3 observations / 2 replacements;
- `аааааааа`;
- `абабаб`;
- `абаабабб`;
- Russian and English repeated text;
- emoji, ZWJ and combining marks;
- tab / CRLF;
- empty input;
- multi-document counts;
- allocation-order noise;
- bounded expansion limits;
- 24 deterministic randomized differential families.

## Work metrics

The experiment reports separately:

- `initialAdjacentInspections`;
- unique `touchedAdjacencyPositions` summed per replacement round;
- index additions / removals;
- candidate-occurrence inspections;
- heap inserts / in-place updates / removals / pops / comparisons;
- stale heap entries;
- exact replay checks;
- full-rescan oracle adjacency inspections;
- elapsed wall time;
- observed Node heap delta;
- sampled incremental peak `heapUsed`.

Timing is explicitly environment-dependent. Node heap measurements are not allocator accounting and are not a physical SQLite/storage metric.

## Matched deterministic locality workload

Test workload:

- 12 documents;
- 1,000 deterministic pseudo-random Unicode scalars each;
- six repeated `::COMMON::` suffix motifs per document;
- 12,720 total Unicode scalars;
- `minOccurrences=3`;
- `maxExpansionScalars=64`;
- up to 32 rounds.

Deterministic structural result from the implementation:

| metric | full-rescan oracle | incremental |
| --- | ---: | ---: |
| rules | 32 | 32 |
| full adjacency inspections | 352,031 | — |
| initial adjacency inspections | — | 12,708 |
| touched adjacency positions | — | 9,601 |
| local adjacency work proxy | — | 22,309 |
| local/full ratio | — | **0.063372** |
| index additions | — | 6,457 |
| index removals | — | 9,693 |
| candidate occurrence inspections | — | 3,296 |
| heap stale entries | — | **0** |

Thus the incremental implementation examines/updates a much smaller **adjacency position set** on this workload. This is not yet a claim of lower physical Link count, lower SQLite bytes, semantic improvement, or guaranteed wall-time/memory improvement.

Exact CI timing and heap observations are recorded from the PR run rather than treated as stable constants.

## Scope after C

W23-C ends when the differential gate, Node CI and repo-guard are green and the PR is integrated.

Only then may W23-D begin: predict `Δcost(candidate, existingGraph, currentRoots)` against an existing immutable SQLite Link asset and independently verify the prediction by physical rebuild and cold replay.
