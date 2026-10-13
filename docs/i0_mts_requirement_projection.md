# I0 — read-only projection of accepted MTS v0.15 requirements

Status: RESEARCH / NO SEMANTIC AUTHORITY. Owner: MTS NL Compiler issue #91.

## Inputs and authority

Two immutable, pinned GitHub source files from netkeep80/anum_docs commit
49458b680e0fde9dfbd5861e75e95c9e59bea74a:

- requirements/mts-v0.15.json (Git blob SHA1 f7729caa54f91e1a8632a094667c68e9ee330ec4)
- traceability/mts-v0.15.json (Git blob SHA1 6b43a9c8b6186ff002218b44ef69a57b24460974)

No source is taken from floating main or user-controlled HEAD. Both raw byte streams
are checked against pinned Git blobs. The report also records SHA-256 for both exact
files and for each selected requirement's decoded normative text.

The accepted source authority and individual requirement state are separate fields.
The existing traceability file records the author decision. I0 makes no new author
decision and does not elevate proposed Russian reader-wave texts.

## Reproduce

Run on Node.js 24 or newer:

    node scripts/i0_mts_requirement_projection.mjs --github > /tmp/i0-report.json

Alternatively, use an existing read-only anum_docs checkout exactly at the
pinned commit:

    node scripts/i0_mts_requirement_projection.mjs --anum-dir /path/to/anum_docs

Both sources are checked against the immutable Git blobs. Failure to obtain,
decode or verify either is an error (nonzero exit), never an empty green report.
No GitHub write access is required. The CLI writes only to stdout/stderr.

    npm test

The I0 test executes real pinned-source input retrieval from GitHub and performs
in-memory mutation tests. CI needs network access to immutable raw GitHub files.
Network failure is fail-closed, not SKIP or PASS. Synthetic corpus semantic accuracy
is not a metric of I0.

## Exact scope and output

Selection: V15-ONTO-01, V15-ONTO-02, V15-NAME-01, V15-JSON-02, V15-FRESH-01.

The deterministic JSON report contains:

- both exact input identities, Git blob SHA-1 and SHA-256;
- five real requirement IDs, normative texts and text SHA-256;
- per-requirement registry state vs accepted release status and author decision;
- JSON pointers for source registry entries, individual fields and traceability;
- raw JSON string-token UTF-8 byte offsets (including quotes, NOT decoded-text offsets);
- ownerIssue, dependsOn, requiredExecutableGates and evidenceRefs unchanged in meaning;
- computed forward and reverse indexes;
- dependency manifest and stable projection SHA-256.

The forward index is derived from the accepted registry and traceability. No data
is written back. Source relation names are not relabeled as repo-guard
requires/implements/verifies. Targets are names/paths/issue references, not
physical Link handles. A source file SHA is not a source-text SHA. A semantic
candidate is never an authority input to the projection.

## Freshness and negative oracle

assessI0Freshness(manifest, observed) returns CURRENT only when every required
source exists as exact bytes and matches both hashes. A changed input is STALE;
an unavailable input is UNKNOWN; unrelated files are ignored. These are technical
observation results, not MTS normative states.

Executable negative checks: text mutation, traceability mutation, unrelated
file, missing source, duplicate requirement ID, missing requirement or trace,
registry/trace state mismatch, proposed/invalid authority, invalid UTF-8/JSON,
candidate self-acceptance, repeatability, exact span replay.

GitHub commit pin prevents external HEAD from substituting its own authority.
The in-memory mutation oracle may diagnose structural invalidity before failing
the immutable source hash gate. It never publishes a successful report on
modified bytes.

## Comparison with repo-guard (no modification)

Existing netkeep80/repo-guard code already implements typed requirement relations,
provenance, BASE->HEAD transition checks, content-identity freshness and
requirement-aware evidence overlap. These capabilities are not copied into I0.

I0 contributes only a small reader of the different anum_docs v0.15 registry
shape and a verified, immutable source dependency projection. In particular,
there is no requirement that repo-guard parse language, nor that a file marked
as verification evidence prove semantic alignment.

Actual cross-repository author-acceptance transitions, FORMAL/Gamma interoperability,
semantic equivalence, domain verifier proof binding and automatic CI governance
are out of scope and NOT VERIFIED by I0.

## Stop condition

Evaluate whether existing JSON/Node plus repo-guard already provide the necessary
freshness and reverse tracing. I0 does not authorize I1/I2, new policy concepts,
semantic engine work or merging this Draft PR.
