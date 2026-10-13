# W19-G0-A — независимая оценка русскоязычных требований

**Статус:** RESEARCH / G0-A PROTOCOL READY; HUMAN GOLD NOT COLLECTED; G0-B NOT EXECUTED.
**Issue:** #91. **S0:** Draft PR #112, immutable for this experiment.
**Accepted baseline:** 6d9f74625aa35df407563a6cbb046a467894f46b.
**Source of truth:** pinned Git objects; research TSV is neither normative MTS v0.15 nor FORMAL syntax.

## 1. Independent audit of S0 (observed source, not hypothesis)

Read at Draft head 31ff96a52b11cae97aabaa9801cbf1c93b0bb849: docs/w19_s0_semantic_candidates.md, src/w19-semantic-s0.mjs, both fixture JSON files, tests/w19-semantic-s0.test.mjs, scripts/w19_semantic_s0.mjs.

* 41 exact lexemes and eight fixed-length, whole-utterance templates. Tokens are contiguous Unicode L/M/N runs or individual non-space punctuation. Token order and case matter; no lemmatization, inflection rules, spell correction, syntactic parser or semantic composition.
* Applicability of contextual lexemes: when contextId is absent (null/undefined), context restrictions are not enforced; all matching surface homonyms become eligible. When present, lexical definitions with contexts not including it are filtered. No automatic context inference.
* Match recursively consumes a complete token stream. An unsupported token, reordered clause, additional conjunction or nested conditional prevents a complete match. A candidate consists of a template-defined relation and evidence spans; emit slots read only the matched lexeme's predefined concept or surface.
* Status is a cardinality test on **distinct emitted relations**: no candidate = UNKNOWN, one = PROPOSED, more than one = AMBIGUOUS. Matching paths that emit the same relation collapse; evidence for alternative paths can be discarded by deduplication. No uncertainty calibration or probabilistic semantics.
* Missing and incorrect definitions are different error sources. Missing form/template ordinarily gives UNKNOWN. A lexeme with the wrong concept, or a pattern that happens to fit the wrong syntactic reading, can yield a confident-looking PROPOSED. Context mismatch yields UNKNOWN or AMBIGUOUS; neither is automatically semantically justified.
* Source Link DAG performs byte-exact replay of scalar text. LinkValueStore serializes a JSON-like definition pack and decodes it; interpretLink and interpretFlat invoke the SAME matchTemplates implementation. This establishes representation parity at identical knowledge, **not** a Link-specific semantic advantage or native FORMAL semantics.
* The S0 provisional labels are authored in the course of designing the cases and definition pack. Tests compare B to those labels and count 111 structurally sound provisional spans. This checks fixture consistency, not human semantic accuracy. S09 previously had a span inside the word документ; corrected to 51..55 for the standalone до. Structural span validity alone is not semantic correctness.
* A/B/C results supplied and source-pinned in PR #112: A = 0/0/28, B = 19/2/7, C = 2/4/22 for PROPOSED/AMBIGUOUS/UNKNOWN; Link/flat disagreements 0; left/balanced disagreements 0; semantic accuracy NOT_SCORED.
* Undefined capability set: inference of subject/object under arbitrary word order; grammaticality; logical contradiction; scope nesting; multiple events; pronoun coreference; unknown-form morphology; semantic equivalence of paraphrases; relation truth; generalization.
* Falsifier: a structural pass, a PROPOSED status and a zero-disagreement comparison are each insufficient to establish correct language understanding.

## 2. Experimental strata and freeze boundary

S0 **audit stratum**: 28 pre-exposed synthetic examples; useful for checking errors in an existing definition-tuned setting, never untouched generalization.

HOLDOUT **transfer stratum**: 33 newly collected examples with exact text + context fixed in data/w19-g0/holdout.tsv. 30 intentionally constructed positive/negative probes; three short sourced Russian repository statements. Origins, source blob pins and class tags are in origins.tsv, **not** the blind packet. The real-source subset is small and not representative of domain requirements.

For each stratum the annotator receives ONLY the corresponding three-column blind file (case_id, context, text) and the standalone docs/w19_g0_annotator_instructions.md. **Do not distribute this audit document to annotators**: it contains S0 machine statuses, audit findings and mapping/provenance references that would break blindness. The annotator must not receive origins, mapping, S0 provisional guesses, machine reports or template IDs. Stage DEFINITIONS access is separately gated until TEXT is locked. A holdout context may be an experimental disambiguator; it is not an automatic answer.

Blind S0 IDs B001..B028 use a frozen permutation, with its correspondence to S0 IDs kept in manifest.txt **outside the annotator distribution**. No human evaluations exist at this checkpoint.

Frozen manifest.txt records SHA-256 over exact UTF-8 bytes (including LF), S0 full Git head, engine SHA, pack SHA, corpus SHA, and SOURCE-ORDER correspondence. Commit the corpus and manifest *before* any interpreter run. Do not read S0 predictions on holdout while designing, adjudicating or tuning this fixture. A repeated run after revision is not a fresh independent holdout test.

The source reference for three real excerpts is the accepted baseline's README.md and docs/architecture.md at pinned blob SHA. No extraction from English normative anum_docs summary. Russian research descriptions in other repositories would be proposed, not authoritative.

## 3. Independent annotation — two locked stages

**Stage TEXT (linguistic meaning, blind).** Give the annotator the source sentence and context only. Read each statement as Russian; identify subject(s), action(s), object(s), modality (MUST/MAY/PROHIBITED or justified alternative), negation and its scope, quantifiers and scope, conditions (necessary vs sufficient), temporal order, context, grammatical validity, possible contradiction. Do not force absent roles or resolve a pronoun without grounds. If distinct readings are defensible, create R1, R2, ... with separate rows; record uncertainty and rationale. Every explicitly observed supporting span is UTF-8 half-open [start,end) over the exact displayed text, never a character index. Missing/implicit spans are left blank and explained.

**Lock Stage TEXT before showing definitions**: individual files are immutable and hash-pinned; L1 is not edited in light of pack or interpreter behavior. Never show the provisional S0 relation/expectedStatus during Stage TEXT.

**Stage DEFINITIONS (epistemic coverage, separately blinded from predictions).** Only after TEXT lock, provide frozen definition pack at PR #112 (path tests/fixtures/w19-s0-definitions-v0.json, pinned SHA). For each L1 reading, record SUPPORTED / UNSUPPORTED / UNRESOLVED for whether the frozen pack's literal lexemes and complete templates *can justify that interpretation*. Cite exact definition IDs in evidence only at this second stage. Distinguish absent definitions from semantic disagreement; pack completeness is not natural-language truth. Partial lexical recognition without a complete compositional template is not full support. The task is to assess derivability under the defined matcher, not to repeat its predicted status.

**Independent annotators:** aim for two fluent Russian speakers independently. Both lock their TEXT and DEFINITIONS stages separately. Capture pseudonymous IDs, attest no machine-output exposure, background, dates, hashes, any communication/disagreements. A single annotator's data is not independent agreement. AI formatting assistance is not independent human gold. A separate adjudicator resolves disputed cases only after both original answers are locked, preserving both raw annotations and dated dispute log. Record gold SHA only after this step; do not rewrite originals. Cross-layer disagreement is evidence; never force full consensus without justification.

## 4. Research TSV annotation transport (NOT normative)

Files with these 12 tab-separated columns: case_id, stage, annotator, reading, field, value, surface, start_utf8, end_utf8, judgement, evidence, note. UTF-8 with LF, no embedded tabs/CR/LF. The empty template contains ONLY a header: it is not a completed annotation or gold.

* case_id: B001..B028 or H001..H033, as allocated in blind input.
* stage: TEXT or DEFINITIONS. annotator: pseudonym [A-Za-z][A-Za-z0-9_-]*; reading R1, R2, ... for alternatives.
* field: subject, action, object, modality, negation, negation_scope, quantifier, quantifier_scope, condition, temporal, context, syntax, logic, ambiguity, coverage. Optional :1/:2 suffix denotes multiple role occurrences.
* TEXT judgements: PRESENT / ABSENT / UNCERTAIN. DEFINITIONS judgements: SUPPORTED / UNSUPPORTED / UNRESOLVED (use field=coverage for whole reading).
* value: actual linguistic interpretation (free text), not forced to match emit vocabulary. surface and offsets identify **observed source** when applicable; for inferred relations use empty surface/offsets and explain why. evidence: source reasoning in TEXT, explicit pack IDs only in DEFINITIONS. note: competing readings, uncertainty, justification or limitations.

To express multiple actions, emit action:1 and action:2. To express two defensible readings, use R1 and R2 with their own rows. ABSENT with blank value is distinct from UNKNOWN due to limited definitions; UNKNOWN is a *machine output*, not a human TEXT judgement. Do not collapse "если" (sufficient condition) into "только если" (necessary condition). Preserve ambiguous/ill-formed requirements instead of silently correcting them. A contradiction requires assumptions about the shared subject, time and context; state these explicitly.

The validator checks header, IDs, stages, duplicate rows, legal field names, span byte boundaries, TEXT-before-DEFINITIONS for each reading, and manifest/fixture SHA. It cannot certify expertise, true independence, correctness, evidence sufficiency or gold status. It prints **FORMAT_VALIDATED_NOT_GOLD** only; no automatic HUMAN_GOLD_PASS.

## 5. Scoring specification — DEFERRED until actual independent humans

Predicted PROPOSED/AMBIGUOUS/UNKNOWN vs independent validity/coverage of every L1 reading: publish a full confusion/cross tab, do not label UNKNOWN "correct" by definition. Report denominators and numerators by dataset and category.

Interpretation: compare normalized semantic relations/fields with the **set** of admissible adjudicated readings; count a predicted relation correct only if equivalent to one supported reading, preserving necessary/sufficient, negation scope and quantifier scope. Define null/absent vs missing explicitly. For each field compute TP, FP, FN and precision TP/(TP+FP), recall TP/(TP+FN), F1 2TP/(2TP+FP+FN); undefined denominators are N/A, not 100%. Report exact-structure matches across all required fields; multi-action clause alignment needs one-to-one pairing (not loose token equality).

Spans: exact UTF-8 interval, token-level overlap precision/recall, partial overlap and boundary errors, repeated-substring anchoring. A well-formed UTF-8 span is not automatically correct. Include both micro/macro summaries if denominators permit, stratify by class, source kind, and S0 vs holdout.

Abstention and ambiguity: UNKNOWN fraction (count/N), coverage of issued candidates, precision among issued candidates, justified vs unjustified refusals, and proposed-but-false cases. Distinguish incomplete pack, invalid definition, tokenizer, unknown inflection, order, scope, context, unsupported composition, matcher defect, ambiguity, annotation defect, insufficient information. Double-code causes if necessary and retain primary cause.

Agreement: independent raw exact field agreement and nominal Krippendorff alpha/Cohen kappa on applicable, compatible categorical decisions; multi-label agreement separately. Uncertain/ambiguous gold needs multiple readings and adjudication; no false single-label simplification. Record chance-correction assumptions and denominators; with one annotator: N/A.

Representation control: identical texts, contexts, pack, operations and scoring for Link vs flat and left vs balanced. A shared matcher yielding identical outputs cannot demonstrate a Link *semantic* advantage. Provenance, compactness, replay, storage reuse and computational cost are separate hypotheses and require their own measurements. No interpreting raw frequencies as calibrated semantic probabilities.

At 33 holdout cases and 28 S0 cases, any accuracy is a small-sample, corpus-conditional estimate with uncertainty; never extrapolate to Russian requirements generally. Do not use gold/holdout for tuning, then cite the same holdout as independent evidence.

## 6. Execution and guardrails

On Node.js 24+ (works with ordinary LF/UTF-8 paths on Linux and Windows):

    node scripts/w19_g0_validate.mjs --check
    node --test tests/w19_g0_validate.test.mjs
    node scripts/w19_g0_validate.mjs --annotations path/to/A1.tsv

Send only the standalone annotator instructions and the appropriate blind TSV to human raters; the audit protocol stays with the experiment operator. An annotation file must not be committed to the shared branch until consent/provenance and blindness are reviewed. Keep the original independently produced artifacts. Verify external S0 file digests against manifest before future G0-B; S0 is in unmerged Draft #112, not in this branch.

Stage G0-A stops here for real independent annotation. No S0 semantic engine, tokenizer, definitions, accepted MTS, formalism, Γ, policy or workflows changed. G0-B and semantic metrics are NOT_EXECUTED. This PR is research tooling only: MERGED is not SCIENTIFICALLY ACCEPTED. No merge without Author approval.

## 7. Provisional claims and falsifiers

SUPPORTED: exact literal matching under explicit definitions and deterministic representation replay in S0; confirmed status-count boundaries; independent annotation protocol and frozen holdout artifacts after CI.
INCONCLUSIVE: correct interpretation of ordinary Russian, scope composition, context resolution beyond explicit ID, Link semantic advantage, generalization.
NOT_EXECUTED: real human gold agreement, semantic precision/recall/F1, cross-stratum transfer, per-error causal tallies, true Link vs flat gold evaluation on holdout.
