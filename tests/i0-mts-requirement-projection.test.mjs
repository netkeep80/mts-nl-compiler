import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  I0_SOURCE, buildI0Projection, assessI0Freshness, checkI0Candidate,
  sha256, gitBlobSha1
} from '../src/i0-mts-requirement-projection.mjs';
import {fetchI0Inputs, projectI0Inputs} from '../scripts/i0_mts_requirement_projection.mjs';

const original = fetchI0Inputs();
const regPath = I0_SOURCE.registry.path, trPath = I0_SOURCE.traceability.path;
const clone = data => structuredClone(data);
const mutate = (inputs, path, edit) => {
  const data = JSON.parse(inputs[path].toString('utf8'));
  edit(data);
  return {...inputs, [path]: Buffer.from(JSON.stringify(data), 'utf8')};
};
const build = x => buildI0Projection({registryBytes: x[regPath], traceabilityBytes: x[trPath]});
const reject = (fn, code) => assert.throws(fn, error => {
  assert.equal(error.code, code, error.message);
  return true;
});

test('I0 pinned anum_docs v0.15: real five-requirement projection and falsifier matrix', async t => {
  const inputs = await original;
  const report = projectI0Inputs(inputs);
  const reg = JSON.parse(inputs[regPath].toString('utf8'));
  const traced = JSON.parse(inputs[trPath].toString('utf8'));

  await t.test('exact pinned Git blobs and per-file SHA-256 dependency manifest', () => {
    assert.equal(gitBlobSha1(inputs[regPath]), I0_SOURCE.registry.gitBlobSha1);
    assert.equal(gitBlobSha1(inputs[trPath]), I0_SOURCE.traceability.gitBlobSha1);
    assert.deepEqual(report.dependencyManifest.inputs.map(x => x.path), [regPath, trPath]);
    for (const entry of report.dependencyManifest.inputs) {
      assert.equal(entry.repository, I0_SOURCE.repository);
      assert.equal(entry.commit, I0_SOURCE.commit);
      assert.equal(entry.sha256, sha256(inputs[entry.path]));
    }
    assert.deepEqual(report.dependencyManifest.completeness, {requested: 5, resolved: 5, missing: 0});
    assert.equal(report.sourceCommit, I0_SOURCE.commit);
  });

  await t.test('normative text, states, author decision, source pointers and original relations', () => {
    assert.equal(report.requirements.length, 5);
    assert.deepEqual(report.requirements.map(x => x.id), [...I0_SOURCE.ids].sort());
    for (const r of report.requirements) {
      const i = reg.requirements.findIndex(x => x.id === r.id);
      const orig = reg.requirements[i], tr = traced.requirements[r.id];
      assert.ok(i >= 0);
      assert.equal(r.normativeText, orig.summary);
      assert.equal(r.requirementState, orig.state);
      assert.equal(r.requirementState, 'COMPONENT_GREEN');
      assert.equal(r.releaseStatus, 'accepted');
      assert.equal(r.authorDecision.state, 'ACCEPTED');
      assert.equal(r.ownerIssue, orig.ownerIssue);
      assert.deepEqual(r.dependsOn, [...orig.dependsOn].sort());
      assert.deepEqual(r.requiredExecutableGates, [...tr.requiredExecutableGates].sort());
      assert.deepEqual(r.evidenceRefs, [...tr.evidenceRefs].sort());
      assert.equal(r.source.requirementTextSha256, sha256(Buffer.from(orig.summary, 'utf8')));
      assert.equal(r.source.pointers.id, '/requirements/' + i + '/id');
      assert.equal(r.source.pointers.normativeText, '/requirements/' + i + '/summary');
      assert.equal(r.traceabilitySource.pointer, '/requirements/' + r.id);
      const span = r.source.normativeTextRawJsonToken;
      const raw = inputs[regPath].subarray(span.rawUtf8Start, span.rawUtf8End).toString('utf8');
      assert.equal(JSON.parse(raw), r.normativeText);
      assert.ok(raw.startsWith('"') && raw.endsWith('"'));
    }
  });

  await t.test('forward and reverse indexes retain source relation names', () => {
    assert.deepEqual(report.forward['V15-ONTO-02'].dependsOn, ['V15-ONTO-01']);
    assert.ok(report.reverse.dependsOn['V15-ONTO-01'].includes('V15-ONTO-02'));
    for (const [id, rels] of Object.entries(report.forward)) {
      for (const [kind, targets] of Object.entries(rels)) {
        if (kind === 'ownerIssue') {
          assert.ok(report.reverse.ownerIssue[targets].includes(id));
        } else {
          for (const value of targets) assert.ok(report.reverse[kind][value].includes(id));
        }
      }
    }
    assert.ok(!JSON.stringify(report).includes('"implements"'));
    assert.ok(!JSON.stringify(report).includes('"verifies"'));
  });

  await t.test('reverse index is partial: unselected dependents prevent global negative conclusions', () => {
    const selected = new Set(report.requirements.map(x => x.id));
    const registryIds = new Set(reg.requirements.map(x => x.id));
    assert.equal(registryIds.size, 48);
    assert.equal(selected.size, 5);
    assert.deepEqual(report.reverseScope, {
      sourceRequirements: 'SELECTED_ONLY',
      selectedSourceCount: 5,
      registryRequirementCount: 48,
      unindexedSourceCount: 43,
      completeAcrossRegistry: false,
      emptyOrMissingEntryMeans: 'UNKNOWN_OUTSIDE_SELECTION'
    });

    // The real accepted registry contains two external dependents of FRESH-01.
    // Neither is a projected source, so this reverse posting is absent.
    // Its absence MUST NOT be used as evidence of zero global dependents.
    const outsideFresh = reg.requirements
      .filter(x => !selected.has(x.id) && x.dependsOn.includes('V15-FRESH-01'))
      .map(x => x.id).sort();
    assert.deepEqual(outsideFresh, ['V15-FRESH-02', 'V15-FRESH-03']);
    assert.equal(report.reverse.dependsOn['V15-FRESH-01'], undefined);
    assert.equal(report.reverseScope.completeAcrossRegistry, false);
    assert.equal(report.reverseScope.emptyOrMissingEntryMeans, 'UNKNOWN_OUTSIDE_SELECTION');

    // Even a populated reverse posting omits real dependents outside the sample.
    const outsideOnto = reg.requirements
      .filter(x => !selected.has(x.id) && x.dependsOn.includes('V15-ONTO-01'))
      .map(x => x.id).sort();
    assert.deepEqual(outsideOnto, ['V15-CLOSE-01', 'V15-ONTO-03']);
    assert.deepEqual(report.reverse.dependsOn['V15-ONTO-01'], ['V15-ONTO-02']);
    assert.ok(outsideOnto.every(id => !report.reverse.dependsOn['V15-ONTO-01'].includes(id)));
  });

  await t.test('reprocessing same pinned inputs is byte deterministic', () => {
    const replay = projectI0Inputs(inputs);
    assert.equal(JSON.stringify(report), JSON.stringify(replay));
    assert.equal(report.projectionSha256, replay.projectionSha256);
    assert.equal(assessI0Freshness(report.dependencyManifest, inputs).status, 'CURRENT');
  });

  await t.test('normative text mutation invalidates binding and never passes source gate', () => {
    const modified = mutate(inputs, regPath, r => {
      r.requirements.find(x => x.id === 'V15-ONTO-01').summary += ' ';
    });
    assert.deepEqual(assessI0Freshness(report.dependencyManifest, modified), {
      status: 'STALE', changed: [regPath], unavailable: []
    });
    reject(() => build(modified), 'SOURCE_DIGEST_MISMATCH');
  });

  await t.test('traceability-only mutation invalidates trace binding', () => {
    const modified = mutate(inputs, trPath, t0 => {
      t0.requirements['V15-ONTO-01'].evidenceRefs.push('evidence/proposed-test.txt');
    });
    assert.equal(assessI0Freshness(report.dependencyManifest, modified).status, 'STALE');
    reject(() => build(modified), 'SOURCE_DIGEST_MISMATCH');
  });

  await t.test('unrelated file mutation cannot invalidate dependency-closed projection', () => {
    const observed = {...inputs, 'unrelated/readme.txt': Buffer.from('changed')};
    assert.equal(assessI0Freshness(report.dependencyManifest, observed).status, 'CURRENT');
  });

  await t.test('missing inputs remain UNKNOWN, never false PASS', () => {
    assert.deepEqual(assessI0Freshness(report.dependencyManifest, {[regPath]: inputs[regPath]}), {
      status: 'UNKNOWN', changed: [], unavailable: [trPath]
    });
    reject(() => build({[regPath]: inputs[regPath]}), 'SOURCE_UNAVAILABLE');
  });

  await t.test('duplicate normative ID fails explicitly', () => {
    const modified = mutate(inputs, regPath, r => {
      r.requirements.push(clone(r.requirements.find(x => x.id === 'V15-ONTO-01')));
    });
    reject(() => build(modified), 'DUPLICATE_ID');
  });

  await t.test('missing selected ID or trace rejects partial projection', () => {
    const missing = mutate(inputs, regPath, r => {
      r.requirements = r.requirements.filter(x => x.id !== 'V15-ONTO-01');
    });
    reject(() => build(missing), 'ORPHAN_TRACE');
    const missingTrace = mutate(inputs, trPath, r => {
      delete r.requirements['V15-ONTO-01'];
    });
    reject(() => build(missingTrace), 'MISSING_TRACE');
  });

  await t.test('registry and traceability state mismatch fails before publication', () => {
    const modified = mutate(inputs, trPath, r => {r.requirements['V15-ONTO-01'].state = 'OPEN';});
    reject(() => build(modified), 'STATE_MISMATCH');
  });

  await t.test('proposed registry cannot masquerade as accepted', () => {
    const modified = mutate(inputs, regPath, r => {r.status = 'proposed'; r.accepted = false;});
    reject(() => build(modified), 'AUTHORITY_MISMATCH');
    const alteredDecision = mutate(inputs, trPath, r => {
      r.authorDecision.state = 'NOT_RECORDED';
    });
    reject(() => build(alteredDecision), 'AUTHORITY_MISMATCH');
  });

  await t.test('untrusted source digest, invalid UTF-8 or broken JSON fails closed', () => {
    const corrupt = {...inputs, [regPath]: Buffer.from([...inputs[regPath], 255])};
    reject(() => build(corrupt), 'INVALID_UTF8');
    const brokenJson = {...inputs, [regPath]: Buffer.from('{')};
    reject(() => build(brokenJson), 'INVALID_JSON');
    const changed = {...inputs, [trPath]: Buffer.concat([inputs[trPath], Buffer.from('\n')])};
    reject(() => build(changed), 'SOURCE_DIGEST_MISMATCH');
  });

  await t.test('incomplete or tampered dependency manifest cannot claim CURRENT', () => {
    const missing = {...report.dependencyManifest, inputs: []};
    assert.equal(assessI0Freshness(missing, inputs).status, 'UNKNOWN');
    const partial = {...report.dependencyManifest, inputs: [report.dependencyManifest.inputs[0]]};
    assert.equal(assessI0Freshness(partial, inputs).status, 'UNKNOWN');
    const wrongCommit = {...report.dependencyManifest, inputs: report.dependencyManifest.inputs.map(
      (v, i) => i === 0 ? {...v, commit: 'f'.repeat(40)} : v)};
    assert.equal(assessI0Freshness(wrongCommit, inputs).status, 'UNKNOWN');
  });

  await t.test('duplicate JSON map keys cannot hide duplicate IDs', () => {
    const duplicateKey = JSON.stringify(traced).replace(
      '"V15-ONTO-01":', '"V15-ONTO-01":null,"V15-ONTO-01":'
    );
    assert.notEqual(duplicateKey, JSON.stringify(traced));
    const modified = {...inputs, [trPath]: Buffer.from(duplicateKey, 'utf8')};
    reject(() => build(modified), 'DUPLICATE_ID');
  });

  await t.test('CLI produces same deterministic machine-readable projection', () => {
    const cli = fileURLToPath(new URL('../scripts/i0_mts_requirement_projection.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, '--github'],
      {encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024});
    assert.equal(result.status, 0, result.stderr);
    const emitted = JSON.parse(result.stdout);
    assert.equal(emitted.projectionSha256, report.projectionSha256);
    assert.deepEqual(emitted.requirements.map(x => x.id), report.requirements.map(x => x.id));
  });

  await t.test('candidate claiming ACCEPTED is rejected without author admission', () => {
    assert.deepEqual(checkI0Candidate({status: 'ACCEPTED'}), {
      status: 'REJECTED', reason: 'CANDIDATE_CANNOT_SELF_AUTHORIZE'
    });
    assert.equal(checkI0Candidate({status: 'PROPOSED'}).status, 'NON_AUTHORITATIVE');
    assert.equal(checkI0Candidate({status: 'VERIFIED', accepted: true}).status, 'REJECTED');
    const forged = checkI0Candidate({status: 'PROPOSED', authorDecision: 'AUTHOR_ACCEPT'});
    assert.equal(forged.status, 'REJECTED');
    assert.equal(projectI0Inputs(inputs).projectionSha256, report.projectionSha256);
  });

  console.log('I0_RESULT ' + JSON.stringify({
    sourceCommit: report.sourceCommit,
    projectionSha256: report.projectionSha256,
    sourceDigests: report.dependencyManifest.inputs.map(x => ({path: x.path, sha256: x.sha256})),
    requirementIds: report.requirements.map(x => x.id),
    forwardEdges: report.requirements.reduce((n, x) =>
      n + x.dependsOn.length + x.requiredExecutableGates.length + x.evidenceRefs.length + 1, 0),
    authorityPromotion: 'NONE',
    semanticAccuracy: 'NOT_MEASURED'
  }));
});
