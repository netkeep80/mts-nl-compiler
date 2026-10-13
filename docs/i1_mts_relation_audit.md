# I1 — read-only полнота отношений МТС и граница с repo-guard

**RESEARCH / NO AUTHORITY.** Исследовательская issue [#91](https://github.com/netkeep80/mts-nl-compiler/issues/91).
Ни модель МТС v0.15, ни repo-guard, ни отдельный semantic engine здесь не изменяются.
Положительный структурный статус **не** означает научной, предметной или авторской приёмки.

## Точные проверенные источники (13.10.2026)

| Repository | Main при аудите | Используемый источник |
| --- | --- | --- |
| mts-nl-compiler | `8e4e56ba6254acc8e7ca0f67be94e82ab9119870` | I0 merged PR #113 |
| anum_docs | `5f2bb430aa34b385a45d2c63ea3a8e2e9d912f03` | frozen `49458b680e0fde9dfbd5861e75e95c9e59bea74a` |
| repo-guard | `c19f29da366c985e2cf162ef7e75f5594f60c3a2` | source-level research, NOT_EXECUTED |

I0 pins Git blobs: registry `f7729caa54f91e1a8632a094667c68e9ee330ec4`,
traceability `6b43a9c8b6186ff002218b44ef69a57b24460974`.
Both blobs still match the newer anum_docs main. An exact match of those two blobs
is **not** evidence of full cross-repository dependency closure.

## Relation semantics — do not map by spelling

Real repo-guard `src/requirement-relations.mts` (pin above) parses authority sources
with `id` and `artifacts:[{path,relations}]`; every explicit artifact requires
`requires`. Normalized tuples are `(subject, relation, repository-path, provenance)`.
Provenance contains source path, JSON pointers, BASE/HEAD snapshot and exact revision.
Only known relations are permitted. The relation kernel rejects invalid paths,
duplicate IDs and relations. In a closed repository, `requires` supplies
tracked-path justification; typed evidence relations describe the artifact's role.

| MTS v0.15 source field | Repo-guard relation | Safe projection? |
| --- | --- | --- |
| `dependsOn(R1,R2)` | `requires(R,file)` | **NO**: requirement-to-requirement differs from requirement-to-file. |
| `requiredExecutableGates` | `verifies(R,file)` | **CONDITIONAL**: a verified repository path plus explicit authority adapter would be needed. Declared gate is not an executed run; `requires` is additionally mandatory in repo-guard artifact schema. |
| `evidenceRefs` | `implements/verifies/documents` | **NO automatic mapping**: references can be files or GitHub issues; role and correctness require separate review. |
| `ownerIssue` | Any artifact relation | **NO**: organizational owner, not an implementation artifact. |
| `state`, `authorDecision` | BASE→HEAD transition | **NO**: acceptance state/author's decision is not a transition grant. |
| `positiveVectors`, `negativeVectors` | `verifies` | **NO**: names of expected cases do not establish a successful proof. |
| Canonical FORMAL/JSON evidence | `immutable` | **NO default**: immutability is a distinct trusted policy decision. |

Repo-guard `compareRequirementRelationGraphs` computes typed tuple deltas, and
`checkRequirementTransition` requires an exact, authorized grant for relation
changes. `checkRoutineRequirementTransition` has narrower additive, same-normative
requirements and artifact constraints. These functions are not validators of MTS
`dependsOn`, nor semantic verifiers of `summary`.

Existing compiler `.github/workflows/repo-guard.yml` uses blocking enforcement at
`f0566a6599f6d37f2c76431a26bb259030c9c1b9`, **not** the current kernel
`c19f29da...`. Its successful CI run must not be described as the I1
differential execution of the later kernel.

## Actual 48-record structural experiment

The source registry/traceability were analyzed without changing GitHub:

- 48 registry entries, 48 traceability entries, 85 `dependsOn` edges;
- no missing dependency IDs, cycles, state/owner/gate inconsistencies or orphan trace IDs;
- 36 unique declared executable gate files (152 declarations);
- 61 unique local file paths from `evidenceRefs`, plus five distinct issue-like refs;
- complete pinned Git tree: 923 tracked files, not truncated; 0 missing local referenced files;
- `V15-FRESH-01` reverse = `V15-FRESH-02`, `V15-FRESH-03` (both absent from I0);
- 14 transitive dependents of `V15-FRESH-01`; 42 of `V15-AUTH-01`.

These are **structural** observations. A Git tree proves existence at the pinned
commit, not the successful execution, fresh digest binding, relevance of a test,
or correctness of its mathematical results. A dependence cycle, if introduced,
is labeled `REVIEW` pending an actual MTS contract prohibiting it, not casually
asserted forbidden.

## Reproduce without modifying the accepted data

Node.js 24+ and network access to pinned GitHub sources are required.

```sh
node scripts/i1_mts_requirement_audit.mjs --github > /tmp/i1-structure.json
# or exact checkout of anum_docs at its pinned SHA:
node scripts/i1_mts_requirement_audit.mjs --anum-dir /path/to/pinned/anum_docs
npm test
```

The CLI **first** runs I0's immutable blob and author-decision checks.
Then the complete 48-entry graph is processed. Artifact existence uses the
complete Git tree at the same source checkpoint; a missing/unavailable tree
is not treated as green. Mutations in tests are entirely in-memory.

Tests distinguish:
missing dependency (RED); partial reverse index (UNKNOWN outside sample);
registry/trace mismatch (RED); normative text change (STALE);
a changed digest-bound gate (STALE); absent gate (MISSING);
unrelated changed file (unaffected); gate declaration claimed as executed
(RED); candidate acceptance or HEAD self-authorization (RED);
structural verification claimed as semantic proof (NOT_VERIFIED);
unavailable input (UNKNOWN), corrupt source (ERROR); possible cycles (REVIEW).

The test with fabricated gate bytes is a **negative digest-binding control**,
not evidence that any real gate's content was hashed/pinned. Real file existence
was checked against the authoritative Git tree; **actual test-run evidence and
its freshness were not audited by I1**.

## Differential experiment and decision

| Claim | Node.js baseline | Repo-guard kernel | Interpretation |
| --- | --- | --- | --- |
| MTS dependsOn target exists | EXECUTED | NOT_COMPARABLE / NOT_EXECUTED | Kernel operates on artifact paths, not requirement IDs. |
| Complete reverse graph, change impact | EXECUTED | NOT_COMPARABLE / NOT_EXECUTED | Existing I0 indexing logic can be extended in a read-only audit. |
| Source identity of two normative JSON | EXECUTED (I0) | NOT_EXECUTED | No gain established beyond I0 for these bytes. |
| Declared local file exists | EXECUTED (pinned Git tree) | NOT_EXECUTED | Equivalent file-existence claims would require a trusted mapping. |
| BASE→HEAD candidate may change authority | I0 rejects unpinned normative bytes; no general cross-repo grant | SOURCE CONTRACT REVIEWED; NOT_EXECUTED | Repo-guard potentially adds a genuinely different trusted-transition guarantee, **not established for MTS**. |
| Verification semantically supports prose | NOT_VERIFIED | NOT_VERIFIED | Neither structural tool is a domain verifier. |

**Actual differentiated repo-guard result: NOT_EXECUTED.** There is no
equivalent-authority translation of this MTS registry into repo-guard's
artifact schema on this branch, nor a controlled BASE/HEAD trust context.
A local imitation of its kernel would be a misleading comparison.
External execution from an unavailable sandbox is not silently substituted
by reading TypeScript source. The existing repo-guard CI protects this PR
under its own configured policy but is *not* the differential kernel run.

Costs: one ~small read-only source analyzer, one CLI and in-memory tests;
no new semantic ontology, schema, data copy, normative source, engine or
runtime dependency. Duplication is limited to traversal/consistency checks;
source-identity enforcement reuses I0. The likely sustainable solution is
a small extension of existing read-only checks, **not** a persistent
integration contract.

**Recommendation: STOP after I1; do not start I2 or make a new permanent
integration layer.** A new contract should require a reproducible,
equivalent-input repo-guard run showing a distinct falsifier that the
existing Node/I0 checks cannot cheaply cover, together with an independently
trusted authorization boundary. The hypothesis remains OPEN, not proved.
