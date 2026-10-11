## E7 — independent full-source real-corpus check (research wave 2)

`tests/incremental-source-root-e7-real.test.mjs` fetches one unmodified **full** MDN JavaScript Grammar and types article by the already-pinned `corpus/real-sources-e0.json` exact upstream commit, Git blob SHA-1 and byte count. It never ships raw MDN source; CI log contains only its provenance and measured metrics.

The test builds the **entire** E7 source Link root one Unicode scalar/event at a time and verifies:
- exact UTF-8 decoding and SHA-256 of all source bytes;
- restoration of a retained 1024-codepoint historical root;
- current Link-root exact reconstruction via one physical `links` SQLite table;
- comparison with the independently rebuilt P0/E0 balanced-source root: same source bytes, **not necessarily** same root identity;
- selected/retained physical Link row counts and observed new Link operations per append.

The E7 binary-carry topology makes full-root construction incremental and deterministic with an O(log n) structural-operation upper bound **within this algorithm**. It does NOT prove minimal unique Link count, compressed archive optimality, semantic understanding or accepted Γ execution.

Next: repeat for all six pinned sources, benchmark `selected` vs `retained` and real archive transport size, link E5/E6 observed-rule agenda to explicitly versioned selected roots, and validate natively in accepted MTS.
