# #20 — Reachability and retention-cost experiment

Research-only; stacked on #19. **No destructive GC, merge or accepted MTS change.**

The Link-stored rule `(((X,Y),X),Y) -> ((X,Y),(X,Y))` is independently checked by a **free-monoid token oracle**: both patterns flatten to the variable word `X,Y,X,Y`. This provides a conditional proof of decoded equality for arbitrary string substitutions in an ordered-pair sequence interpretation, not full native FORMAL conformance.

The same generic `infer()` from PR #16 generates the alternative Link root and proof; no special host compression opcode. The experiment then models **four different root retention profiles** from the same one-table graph: (A) original selected input, (B) v2 context selected without retained proof as a hypothetical lower bound, (C) v2 context + proof retained, (D) v2 context + proof + legacy reference pinned.

Versioned contexts avoid accidentally making both old and new root members of a single active context. A separate technical root selector chooses which membership is observable; this is a harness projection, **not** an accepted runtime authority. All views remain pure binary Links, and the collector never deletes or overwrites source graph data.

The proof references the original premise, so its retention keeps the old sequence root alive. The optimistic profile may save a pair but discards proof from selected persistent roots; that is **not** accepted safe evidence policy. Full serialized UTF-8 JSON includes technical root selectors and all seven physical columns with recomputed positional counters. These bytes are a measured encoding cost, **not MDL or an entropy codec**.

The tests verify source substitution, negative invalid rewrites, unchanged old context, proof pins, distinct contexts, one-table SQLite replay with correct counters, deterministic ordering, no sneaky mutation on invalid input, and 64 new mixed Unicode fragment pairs.

Remaining research: authoritative current-root versioning and proof archival policy, actual safe GC, complete cost over licensed corpus, independent formal conformance to v0.15 ExactSequence, and trained rules. No semantic policy accepted and **no merge without author approval**.

Run with Node.js 24+ `npm test`. Obtain GitHub CI evidence before asserting PASS.
