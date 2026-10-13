# MTS NL Compiler — Research Observatory

**Status: Draft research/observability; not a release and not a claim of semantic learning.**

Open [`index.html`](./index.html) in any browser without an internet connection. The file is self-contained: all CSS, JS and **pinned evidence data** are embedded. Nothing is fetched from GitHub at display time.

## What you can inspect

- **Обзор:** number of confirmed tests, B0 prediction versus B1 structural slot results, contrasting limitations
- **B0:** log-loss and top-1 bar charts for 0–3 context codepoints, full heldout sentences, six selectable spelling/grammar/logic/modality contrasts, OOV and false-alarm counterexamples
- **B1:** 6×4 training/withheld matrix, five proposed Link recombinations, Link graph sizes, raw n-gram control, UNKNOWN on no-boundary stream and paired-world counterexample
- **История:** experiment order, PR and exact head SHA, pinned fixtures, CI and repo-guard run links

The chart axes are deliberately separated. B0 n-gram prediction accuracy cannot be plotted as if it were B1 productive heldout coverage. The source data are synthetic, not independently reviewed human gold.

## Reproducibility / source of truth

```sh
node scripts/build_observatory.mjs
node scripts/build_observatory.mjs --check
node --test tests/observatory.test.mjs
```

- [Manifest](../../data/observatory/runs-v1.json): verified, **manually pinned** results from [B0 Draft #92](https://github.com/netkeep80/mts-nl-compiler/pull/92) and [B1 Draft #93](https://github.com/netkeep80/mts-nl-compiler/pull/93)
- [Generator](../../scripts/build_observatory.mjs) converts [HTML template](../../src/observatory-template.html) + manifest into this self-contained `index.html`.
- Node CI requires **byte equality** between generated and committed HTML. A stale dashboard fails.
- The manifest pins fixture SHA256, original report blob SHA, exact source branch HEAD and matching Actions run links.
- Updating dashboard history requires a new reviewed manifest record with exact evidence. The current version does **not** automatically poll GitHub or refresh itself.
- No `.github/**`, `requirements/**`, `db/**`, or `repo-policy.json` changes are made by this research PR.

## GitHub Pages publication — separate author/infrastructure gate

This branch contains **candidate** science and a ready-to-host static directory, but GitHub Pages is **not enabled or updated** by this PR. The connector cannot modify GitHub Pages settings. After the responsible maintainer reviews and accepts the dashboard into `main`, the repository administrator can open **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, select `main` and folder `/docs`. The resulting path would be `https://netkeep80.github.io/mts-nl-compiler/observatory/` if GitHub Pages is actually enabled and its deployment completes. This is a prospective URL, **not a confirmed live deployment**.

Until then, download the offline HTML directly or use the Draft branch file. Optional automated deployment or Actions artifact collection requires an explicit design and authorization for protected workflows.

## Security and scientific limits

- No CDN, telemetry, cookies or network requests; all evidence is static and can be inspected offline.
- Link DAG display is not a general graph explorer; B1 shows only experiment-level counts and component recombinations.
- The dashboard must always show `DRAFT_RESEARCH`, `TESTED_SYNTHETIC`, `UNKNOWN`, negative baselines and explicit provenance. It must not silently turn CI green into a semantic acceptance badge.
