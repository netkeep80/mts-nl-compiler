# W23-D — marginal physical Link cost against an immutable SQLite asset

Status: **experimental research**, issue #107. This stage is intentionally limited to physical Link representation. It does not alter MTS v0.15, FORMAL, requirements, SQLite schema, E5, #91, or ontology work.

## Question

Given:

- an already materialized immutable SQLite Link graph;
- the current external root set;
- one exact alternative tree for one document;

compute before mutation:

`Δcost(candidate, existingGraph, currentRoots)`

and then verify the prediction by an independent physical SQLite rebuild using real `INTEGER PRIMARY KEY AUTOINCREMENT` identities, exact pole reuse, `VACUUM INTO`, and read-only cold replay.

## Cost dimensions kept separate

W23-D does **not** collapse different quantities into one "frequency":

- `deltaStoredRows`: new persistent physical Link rows that must be appended;
- exact atom/pole reuse calls;
- `deltaActiveReachable`: change in distinct Links reachable from current roots;
- `inactiveHistoricalRowsAfter`: retained physical rows no longer reachable from current roots;
- structural `from_uses/to_uses`: references from stored physical rows;
- source-expanded pair events: root-dependent source occurrences;
- SQLite `VACUUM` bytes.

SQLite bytes are measured physically. The dry-run deliberately returns no byte prediction because page layout and serialization are not derivable exactly from row cardinality alone.

## Dry-run algorithm

The existing SQLite asset is indexed exactly as `NumericCorpusLoader` reuses it:

1. weight-null atoms by scalar string;
2. weight-null, string-null pairs by exact ordered physical pole IDs;
3. oldest matching physical Link is the reusable representative.

The candidate is recursively evaluated without writing SQLite.

Existing Links are referenced as `E:<physical-id>`; not-yet-existing candidate Links receive virtual `V:<n>` identities. A virtual pair can be reused later inside the same candidate by exact ordered virtual/existing poles.

The dry-run therefore predicts:

- inserted atoms / pairs;
- reused atom / pair calls;
- exact new stored rows;
- new and old active reachability after replacing one current root;
- deactivated existing rows;
- retained inactive history.

The prediction database is checked after the dry-run to prove that no row was written.

## Physical verification

A **separate SQLite database** independently rebuilds the exact baseline in the same document order.

Then:

1. baseline physical rows are compared with the prediction baseline;
2. the candidate is physically appended through `NumericCorpusLoader`;
3. all pre-existing `(link_id, from_id, to_id, string, weight)` identities are checked unchanged;
4. predicted insert/reuse counts must equal actual loader counters;
5. predicted stored/active/history counts must equal the physical result;
6. current roots exact-replay;
7. current roots **plus the old historical target root** exact-replay from a cold read-only SQLite snapshot.

Any mismatch is a hard failure.

A third clean SQLite database builds the candidate as if it had been chosen **before** the target version existed. This is the fresh-build counterfactual and is intentionally separate from retained migration.

## Scalar-leaf boundary

A physical grouping candidate is a binary tree over **single Unicode scalar leaves**.

A multi-scalar string such as `"abc"` cannot be supplied as one cheap physical atom. The only zero-scalar atom allowed is the whole root for an empty document. This prevents cost-model cheating by hiding already-composed source text inside one atom row.

## Controlled result 1 — W23-C-derived frequency candidate

Source: synthetic `aaaab`.

Balanced baseline has 6 active/stored Links. W23-C selects one `aa` replacement rule and, after the fixed balanced fold over remaining units, produces a candidate with 5 Links in a clean build.

Measured/predicted transition after the balanced version is already retained:

| Quantity | Result |
| --- | ---: |
| new retained rows | **+2** |
| active reachable rows | **−1** |
| inactive historical rows after transition | **3** |
| fresh candidate rows vs fresh balanced | **−1** |
| baseline VACUUM bytes | 20,480 |
| retained VACUUM byte delta | 0 |
| fresh VACUUM byte delta | 0 |

The zero byte delta is SQLite page granularity, not "zero physical cost": two rows were appended and three old rows became inactive history.

### Consequence

A grouping can be better for a **fresh build** while being more expensive as an immutable **migration**.

Those objectives must never be substituted for each other.

## Controlled result 2 — candidate already present

Two current documents contain the same exact source. One root uses the balanced form; the second already uses the W23-C-derived candidate.

Switching the first root to the already-existing candidate yields:

| Quantity | Result |
| --- | ---: |
| new retained rows | **0** |
| active reachable rows | **−3** |
| deactivated existing rows | **3** |
| inactive historical rows | **3** |

This is the only zero-row migration case demonstrated here: the required candidate structure was already physically present.

The same control also separates source and structural counts:

- source-expanded pair events: **8**;
- physical structural `from_uses` sum: **6**.

They are different measurements by construction.

## Controlled result 3 — SQLite byte growth

Source: 320 distinct CJK Unicode scalars.

Balanced baseline and a left-deep tree both require the same number of rows when built fresh because no structural subtree reuse exists.

After balanced is already retained, changing to left-deep requires **318 new rows**.

GitHub Node24 physical result:

| Quantity | Result |
| --- | ---: |
| predicted/actual appended rows | **318** |
| baseline VACUUM bytes | **49,152** |
| retained VACUUM bytes | **61,440** |
| retained byte delta | **+12,288** |
| fresh row delta | **0** |

This control proves that W23-D measures real SQLite bytes independently and that row/history growth eventually crosses page boundaries.

## Architectural result

For an append-only immutable asset with retained history and no GC:

`ΔstoredRows >= 0`

for every migration, by definition: old rows remain and only missing candidate rows can be appended.

However:

- `ΔactiveReachable` may be negative;
- fresh-build row cost may be lower than the existing representation;
- `ΔstoredRows = 0` is possible when all candidate Links already exist;
- SQLite bytes change in page-sized steps and cannot be inferred exactly from row count.

Therefore a "better grouping" must always name its objective:

1. **fresh/new source construction**;
2. **active reachable graph**;
3. **retained historical asset**;
4. **serialized SQLite bytes**.

A reduction in one does not imply a reduction in the others.

## Reproduction

- implementation: `src/w23d-marginal-link-cost-v0.mjs`;
- tests: `tests/w23d-marginal-link-cost.test.mjs`;
- machine report: `node scripts/w23d_sqlite_probe.mjs`.

The machine report uses only synthetic controlled Unicode input.

## Scientific boundary and next decision

W23-D proves the marginal-cost mechanism and shows a small controlled fresh-build advantage for one W23-C-derived candidate. It **does not** establish useful corpus-wide compression, portability, or production superiority.

The previous W22-D0 real 60-book front-shape pilot was nearly null. Therefore no production compression algorithm should be selected from the W23-D synthetic controls alone.

If the project chooses to continue the compression branch, the next valid evidence is an **independent corpus portability test of the W23-C frequency candidate under fresh-build physical Link cost**. Previously inspected W22 heldout books are not a fresh blind confirmation set.

Otherwise W23 can be closed as a completed physical-mechanics study and priority can move to #91 as already decided.
