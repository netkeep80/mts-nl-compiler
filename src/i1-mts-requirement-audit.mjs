// I1 finite structural audit. Not repo-guard, not normative authority, not semantic verification.
import {createHash} from 'node:crypto';

const sorted = values => [...values].sort();
const unique = values => sorted(new Set(values));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const array = x => Array.isArray(x) ? x : [];
const strings = x => Array.isArray(x) && x.every(v => typeof v === 'string' && v.length > 0);
const fileReference = v => typeof v === 'string' && v.includes('/') && !v.startsWith('#') && !v.includes('://');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Mutated objects are accepted here ONLY to expose structural falsifiers.
// The caller must separately use I0's exact pinned byte verification before publishing a real result.
export function auditI1Registry(registry, traceability, {trackedPaths = null} = {}) {
  if (!registry || !traceability || !Array.isArray(registry.requirements) ||
      !traceability.requirements || Array.isArray(traceability.requirements) ||
      typeof traceability.requirements !== 'object') {
    return {status: 'ERROR', diagnostics: [{code: 'INVALID_SOURCE_STRUCTURE'}]};
  }
  const diagnostics = [];
  const fail = (code, subject, target = null) => diagnostics.push({code, subject, target});
  const entries = registry.requirements;
  const trace = traceability.requirements;
  const map = new Map();
  const reverse = {};
  const gatePaths = [];
  const evidencePaths = [];
  const states = {};
  for (const item of entries) {
    if (!item || typeof item.id !== 'string' || !item.id) {
      fail('INVALID_REQUIREMENT', String(item?.id ?? '<missing>'));
      continue;
    }
    if (map.has(item.id)) fail('DUPLICATE_ID', item.id);
    map.set(item.id, item);
  }
  for (const r of entries) {
    if (!r || !map.has(r.id)) continue;
    states[r.state] = (states[r.state] || 0) + 1;
    const t = trace[r.id];
    if (!t || typeof t !== 'object') { fail('MISSING_TRACE', r.id); continue; }
    if (r.state !== t.state) fail('STATE_MISMATCH', r.id);
    if (!/^#[0-9]+$/.test(r.ownerIssue ?? '') ||
        Number(r.ownerIssue.slice(1)) !== t.ownerIssue) fail('OWNER_MISMATCH', r.id);
    for (const field of ['dependsOn', 'requiredExecutableGates']) {
      const left = field === 'dependsOn' ? r.dependsOn : r.evidence?.requiredExecutableGates;
      const right = t[field];
      if (!strings(left) || !strings(right)) fail('INVALID_RELATION_FIELD', r.id, field);
      else if (new Set(left).size !== left.length || new Set(right).size !== right.length)
        fail('DUPLICATE_RELATION', r.id, field);
      else if (!eq(sorted(left), sorted(right))) fail('TRACE_MISMATCH', r.id, field);
    }
    if (!strings(r.dependsOn)) continue;
    for (const dep of r.dependsOn) {
      if (!map.has(dep)) fail('MISSING_DEPENDENCY', r.id, dep);
      (reverse[dep] ??= []).push(r.id);
    }
    if (strings(r.evidence?.requiredExecutableGates))
      gatePaths.push(...r.evidence.requiredExecutableGates);
    if (!strings(t.evidenceRefs)) fail('INVALID_EVIDENCE_REFS', r.id);
    else evidencePaths.push(...t.evidenceRefs.filter(fileReference));
  }
  for (const id of Object.keys(trace)) if (!map.has(id)) fail('ORPHAN_TRACE', id);
  const color = new Map(), stack = [];
  function dfs(id) {
    if (color.get(id) === 2) return;
    if (color.get(id) === 1) {
      fail('DEPENDENCY_CYCLE_REQUIRES_CONTRACT_REVIEW', id, stack.slice(stack.indexOf(id)).concat(id).join(' -> '));
      return;
    }
    color.set(id, 1); stack.push(id);
    for (const d of array(map.get(id)?.dependsOn)) if (map.has(d)) dfs(d);
    stack.pop(); color.set(id, 2);
  }
  for (const id of map.keys()) dfs(id);
  const gateSet = unique(gatePaths), evidenceSet = unique(evidencePaths);
  let missingFiles = null;
  if (trackedPaths !== null) {
    const tracked = new Set(trackedPaths);
    missingFiles = unique([...gateSet, ...evidenceSet].filter(p => !tracked.has(p)));
    for (const p of missingFiles) fail('MISSING_REFERENCED_FILE', p);
  }
  for (const k of Object.keys(reverse)) reverse[k] = unique(reverse[k]);
  const impact = {};
  for (const id of map.keys()) {
    const seen = new Set();
    const pending = [...(reverse[id] || [])];
    while (pending.length) {
      const next = pending.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(...(reverse[next] || []));
    }
    impact[id] = sorted(seen);
  }
  const blockers = diagnostics.filter(d => d.code !== 'DEPENDENCY_CYCLE_REQUIRES_CONTRACT_REVIEW');
  return {
    schema: 'mts-nl/i1-structural-research/v0',
    status: blockers.length ? 'RED' : diagnostics.length ? 'REVIEW' : 'STRUCTURAL_GREEN',
    diagnostics,
    counts: {
      registry: entries.length, traced: Object.keys(trace).length,
      dependencyEdges: entries.reduce((n,r) => n + array(r?.dependsOn).length, 0),
      gateReferences: gatePaths.length, uniqueGates: gateSet.length,
      uniqueLocalEvidencePaths: evidenceSet.length,
      trackedPathsChecked: trackedPaths === null ? null : new Set(trackedPaths).size,
      missingReferencedFiles: missingFiles?.length ?? null,
      states
    },
    forward: Object.fromEntries([...map].map(([id,r]) => [id, unique(array(r.dependsOn))])),
    reverse,
    reverseScope: {sourceRequirements: 'ALL_REGISTRY', indexedSources: entries.length,
      completeAcrossRegistry: diagnostics.every(d => !['DUPLICATE_ID','INVALID_REQUIREMENT','INVALID_RELATION_FIELD','MISSING_DEPENDENCY'].includes(d.code)),
      externalDependencyClosure: 'NOT_VERIFIED'},
    transitiveDependents: impact,
    evidenceStatus: 'DECLARATIONS_ONLY_NOT_EXECUTION_EVIDENCE',
    semanticVerification: 'NOT_VERIFIED',
    repoGuardKernel: 'NOT_EXECUTED'
  };
}

// Only compare explicit digest-bound artifact observations; an unbound reference
// never becomes CURRENT just because it has a plausible path.
export function assessI1ArtifactBinding(path, expectedSha256, observed) {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256 ?? '')) return {status: 'UNKNOWN', path};
  if (!Buffer.isBuffer(observed?.[path])) return {status: 'MISSING', path};
  return {status: hash(observed[path]) === expectedSha256.toLowerCase() ? 'CURRENT' : 'STALE', path};
}

// This guard rejects interpretations of declarations; it is NOT a repo-guard transition checker.
export function assessI1Claim(claim, evidence = {}) {
  if (claim === 'GATE_EXECUTED') return evidence.runExecuted === true && evidence.runVerified === true
    ? {status: 'EVIDENCED_RUN_ONLY'} : {status: 'RED', reason: 'DECLARATION_IS_NOT_EXECUTION'};
  if (claim === 'SEMANTICALLY_VERIFIED') return {status: 'NOT_VERIFIED', reason: 'NO_DOMAIN_VERIFIER'};
  if (claim === 'HEAD_AUTHORIZED' || claim === 'CANDIDATE_ACCEPTED')
    return {status: 'RED', reason: 'NO_TRUSTED_AUTHORITY'};
  return {status: 'UNKNOWN', reason: 'UNSUPPORTED_CLAIM'};
}
