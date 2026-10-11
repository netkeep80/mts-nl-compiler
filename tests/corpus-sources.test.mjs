import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const m = JSON.parse(readFileSync(new URL("../corpus/wikimedia-sources.json", import.meta.url), "utf8"));
const hosts = {
  ruwiki: "ru.wikipedia.org",
  ruwikibooks: "ru.wikibooks.org",
  ruwikisource: "ru.wikisource.org"
};
test("Wikimedia shortlist is discovery-only: cannot be mistaken for training authority", () => {
  assert.equal(m.schema, "mts-nl-corpus-source-candidates/v1");
  assert.equal(m.status, "DISCOVERY_ONLY");
  assert.equal(m.candidateCount, m.candidates.length);
  assert.ok(m.candidates.length >= 5);
  assert.equal(new Set(m.candidates.map(x => x.id)).size, m.candidates.length);
  for (const c of m.candidates) {
    assert.equal(new URL(c.url).protocol, "https:");
    assert.equal(new URL(c.url).hostname, hosts[c.project]);
    assert.equal(c.licenseReview, "NOT_AUDITED");
    assert.equal(c.ingestionStatus, "NOT_INGESTED");
    assert.equal(c.revisionId, null);
    assert.equal(c.textSha256, null);
    assert.ok(c.title && c.kind && c.domain);
  }
  for (const area of ["russian-language","literature","mathematics","logic","programming"])
    assert.ok(m.candidates.some(x => x.domain === area), area);
});
