import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {I0_SOURCE, assessI0Freshness, checkI0Candidate} from '../src/i0-mts-requirement-projection.mjs';
import {fetchI0Inputs, projectI0Inputs} from '../scripts/i0_mts_requirement_projection.mjs';
import {auditI1Inputs, readPinnedTree} from '../scripts/i1_mts_requirement_audit.mjs';
import {auditI1Registry, assessI1ArtifactBinding, assessI1Claim} from '../src/i1-mts-requirement-audit.mjs';

const inputsPromise = fetchI0Inputs();
const treePromise = readPinnedTree();
const clone = structuredClone;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('I1: actual pinned 48-requirement registry, complete reverse and negative controls', async t => {
  const [inputs, tree] = await Promise.all([inputsPromise, treePromise]);
  const r = JSON.parse(inputs[I0_SOURCE.registry.path]);
  const tr = JSON.parse(inputs[I0_SOURCE.traceability.path]);
  const baseline = auditI1Inputs(inputs, tree);
  await t.test('actual complete structural scope and local file existence', () => {
    assert.equal(baseline.status, 'STRUCTURAL_GREEN', JSON.stringify(baseline.diagnostics));
    assert.equal(baseline.counts.registry, 48);
    assert.equal(baseline.counts.traced, 48);
    assert.equal(baseline.counts.dependencyEdges, 85);
    assert.equal(baseline.counts.uniqueGates, 36);
    assert.equal(baseline.counts.gateReferences, 152);
    assert.equal(baseline.counts.missingReferencedFiles, 0);
    assert.equal(baseline.reverseScope.completeAcrossRegistry, true);
    assert.equal(baseline.reverseScope.externalDependencyClosure, 'NOT_VERIFIED');
    assert.equal(baseline.comparison.repoGuardRelationKernel, 'NOT_EXECUTED');
    assert.equal(baseline.evidenceStatus, 'DECLARATIONS_ONLY_NOT_EXECUTION_EVIDENCE');
    assert.equal(baseline.semanticVerification, 'NOT_VERIFIED');
  });
  await t.test('I0 partial reverse is never global and full index restores both FRESH dependents', () => {
    const i0 = projectI0Inputs(inputs);
    assert.equal(i0.reverseScope.completeAcrossRegistry, false);
    assert.equal(i0.reverse.dependsOn['V15-FRESH-01'], undefined);
    assert.deepEqual(baseline.reverse['V15-FRESH-01'], ['V15-FRESH-02', 'V15-FRESH-03']);
    assert.equal(baseline.transitiveDependents['V15-FRESH-01'].length, 14);
  });
  await t.test('broken dependsOn target: RED even if registry and trace agree', () => {
    const a = clone(r), b = clone(tr);
    const x = a.requirements.find(x => x.id === 'V15-FRESH-02');
    x.dependsOn.push('V15-MISSING-999');
    b.requirements[x.id].dependsOn.push('V15-MISSING-999');
    const result = auditI1Registry(a, b);
    assert.equal(result.status, 'RED');
    assert.ok(result.diagnostics.some(d => d.code === 'MISSING_DEPENDENCY'));
  });
  await t.test('registry vs trace contradictory state or gate: RED', () => {
    const a = clone(tr);a.requirements['V15-ONTO-01'].state = 'OPEN';
    assert.ok(auditI1Registry(r, a).diagnostics.some(d => d.code === 'STATE_MISMATCH'));
    const b = clone(tr);b.requirements['V15-ONTO-01'].requiredExecutableGates = [];
    assert.ok(auditI1Registry(r, b).diagnostics.some(d => d.code === 'TRACE_MISMATCH'));
  });
  await t.test('cycles get typed review, not fabricated contractual prohibition', () => {
    const a = clone(r),b = clone(tr);
    a.requirements.find(x => x.id === 'V15-ONTO-01').dependsOn.push('V15-ONTO-02');
    b.requirements['V15-ONTO-01'].dependsOn.push('V15-ONTO-02');
    const result = auditI1Registry(a, b);
    assert.equal(result.status, 'REVIEW');
    assert.ok(result.diagnostics.some(d => d.code === 'DEPENDENCY_CYCLE_REQUIRES_CONTRACT_REVIEW'));
  });
  await t.test('changed normative text: pinned source STALE and self-authorizing HEAD rejected', () => {
    const modified = Buffer.from(inputs[I0_SOURCE.registry.path]);
    const changed = Buffer.from(modified.toString().replace('One-Link ontology:', 'Altered-Link ontology:'));
    assert.notDeepEqual(changed, modified);
    const observed = {...inputs, [I0_SOURCE.registry.path]:changed};
    const manifest = projectI0Inputs(inputs).dependencyManifest;
    assert.equal(assessI0Freshness(manifest, observed).status, 'STALE');
    assert.throws(() => auditI1Inputs(observed, tree), /I0_(?:SOURCE_HASH_MISMATCH|.*)/);
    assert.deepEqual(assessI1Claim('HEAD_AUTHORIZED'), {status:'RED',reason:'NO_TRUSTED_AUTHORITY'});
  });
  await t.test('verification artifact changed: stale; absent: missing; unrelated change: no effect', () => {
    const gate = 'ts/test/v015-formal-production-refinement-f1.test.ts';
    const expected = Buffer.from('historically pinned gate bytes');
    const binding = sha(expected);
    assert.equal(assessI1ArtifactBinding(gate, binding, {[gate]: expected}).status, 'CURRENT');
    assert.equal(assessI1ArtifactBinding(gate, binding, {[gate]: Buffer.from('changed')}).status, 'STALE');
    assert.equal(assessI1ArtifactBinding(gate, binding, {}).status, 'MISSING');
    assert.equal(assessI1ArtifactBinding(gate, null, {[gate]: expected}).status, 'UNKNOWN');
    assert.equal(assessI1ArtifactBinding(gate, binding,
      {[gate]:expected, 'docs/unrelated.md':Buffer.from('changed')}).status, 'CURRENT');
  });
  await t.test('missing gate file is a separate diagnostic on real registry', () => {
    const missing = 'ts/test/v015-formal-production-refinement-f1.test.ts';
    const subset = tree.filter(p => p !== missing);
    const result = auditI1Registry(r,tr,{trackedPaths:subset});
    assert.equal(result.status,'RED');
    assert.ok(result.diagnostics.some(d => d.code === 'MISSING_REFERENCED_FILE' && d.subject === missing));
  });
  await t.test('gate declaration and verifies reference cannot self-assert execution or semantics', () => {
    assert.equal(assessI1Claim('GATE_EXECUTED').status, 'RED');
    assert.equal(assessI1Claim('SEMANTICALLY_VERIFIED').status, 'NOT_VERIFIED');
    assert.equal(assessI1Claim('CANDIDATE_ACCEPTED').status, 'RED');
    assert.equal(checkI0Candidate({status:'ACCEPTED'}).status, 'REJECTED');
  });
  await t.test('unavailable/polluted input never yields PASS', () => {
    const manifest = projectI0Inputs(inputs).dependencyManifest;
    const missing = {...inputs};delete missing[I0_SOURCE.registry.path];
    assert.equal(assessI0Freshness(manifest, missing).status, 'UNKNOWN');
    assert.throws(() => auditI1Inputs(missing, tree));
    assert.throws(() => auditI1Inputs({...inputs,
      [I0_SOURCE.traceability.path]:Buffer.from('{broken')}, tree));
  });
});
