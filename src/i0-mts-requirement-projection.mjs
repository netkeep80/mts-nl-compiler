// I0: read-only observation of the accepted MTS requirement registry and traceability.
// This module does not interpret language, import a semantic engine, or grant authority.
import {createHash} from 'node:crypto';

export const I0_SOURCE = Object.freeze({
  repository: 'netkeep80/anum_docs',
  commit: '49458b680e0fde9dfbd5861e75e95c9e59bea74a',
  registry: Object.freeze({
    path: 'requirements/mts-v0.15.json',
    gitBlobSha1: 'f7729caa54f91e1a8632a094667c68e9ee330ec4'
  }),
  traceability: Object.freeze({
    path: 'traceability/mts-v0.15.json',
    gitBlobSha1: '6b43a9c8b6186ff002218b44ef69a57b24460974'
  }),
  ids: Object.freeze([
    'V15-ONTO-01', 'V15-ONTO-02', 'V15-NAME-01',
    'V15-JSON-02', 'V15-FRESH-01'
  ])
});

export class I0ProjectionError extends Error {
  constructor(code, detail = '') {
    super('I0_' + code + (detail ? ': ' + detail : ''));
    this.name = 'I0ProjectionError';
    this.code = code;
  }
}
const fail = (code, detail) => { throw new I0ProjectionError(code, detail); };
const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
export const sha256 = bytes => sha('sha256', bytes);
export const gitBlobSha1 = bytes => sha('sha1', Buffer.concat([
  Buffer.from('blob ' + bytes.length + '\0', 'utf8'), bytes
]));
const pointerPart = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const ordered = values => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const uniqueStrings = (values, label) => {
  if (!Array.isArray(values) || values.some(v => typeof v !== 'string' || !v)) fail('INVALID_FIELD', label);
  if (new Set(values).size !== values.length) fail('DUPLICATE_EDGE', label);
  return ordered(values);
};
const expectObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_FIELD', label);
  return value;
};
const sourceBytes = (value, label) => {
  if (!Buffer.isBuffer(value)) fail('SOURCE_UNAVAILABLE', label + ': exact source Buffer required');
  return value;
};

// Offset points to the raw JSON token, including quotes; text spans refer to
// decoded UTF-8 and are NOT interchangeable with raw file offsets.
function rawJsonTokenSpan(bytes, jsonPointer) {
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  let position = 0;
  let found;
  const space = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
  const stringToken = () => {
    const start = position++;
    if (text[start] !== '"') fail('INVALID_JSON', 'expected JSON string');
    while (position < text.length) {
      if (text[position] === '\\') { position += 2; continue; }
      if (text[position++] === '"') return {start, end: position, value: JSON.parse(text.slice(start, position))};
    }
    fail('INVALID_JSON', 'unterminated string');
  };
  const walk = pointer => {
    space();
    const start = position;
    if (text[position] === '{') {
      position++;
      space();
      const keys = new Set();
      while (text[position] !== '}') {
        const key = stringToken();
        if (keys.has(key.value)) fail(pointer === '/requirements' ? 'DUPLICATE_ID' : 'INVALID_JSON', 'duplicate JSON key at ' + pointer + '/' + pointerPart(key.value));
        keys.add(key.value);
        space();
        if (text[position++] !== ':') fail('INVALID_JSON', 'missing colon');
        walk(pointer + '/' + pointerPart(key.value));
        space();
        if (text[position] === '}') break;
        if (text[position++] !== ',') fail('INVALID_JSON', 'missing comma');
        space();
      }
      position++;
    } else if (text[position] === '[') {
      position++;
      space();
      let index = 0;
      while (text[position] !== ']') {
        walk(pointer + '/' + index++);
        space();
        if (text[position] === ']') break;
        if (text[position++] !== ',') fail('INVALID_JSON', 'missing array comma');
      }
      position++;
    } else if (text[position] === '"') {
      stringToken();
    } else {
      while (position < text.length && !/[\s,\]}]/.test(text[position])) position++;
    }
    if (pointer === jsonPointer) {
      if (found) fail('INVALID_JSON', 'duplicate pointer ' + jsonPointer);
      found = {
        pointer: jsonPointer,
        rawUtf8Start: Buffer.byteLength(text.slice(0, start), 'utf8'),
        rawUtf8End: Buffer.byteLength(text.slice(0, position), 'utf8')
      };
    }
  };
  try { walk(''); } catch (error) {
    if (error instanceof I0ProjectionError) throw error;
    fail('INVALID_JSON', error.message);
  }
  if (!found) fail('INVALID_POINTER', jsonPointer);
  return found;
}

function parsePinned(bytes, descriptor, source) {
  sourceBytes(bytes, descriptor.path);
  let decoded;
  try { decoded = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { fail('INVALID_UTF8', descriptor.path); }
  try { return JSON.parse(decoded); }
  catch { fail('INVALID_JSON', descriptor.path); }
}

function manifestEntry(descriptor, bytes, source) {
  return {
    repository: source.repository,
    commit: source.commit,
    path: descriptor.path,
    gitBlobSha1: gitBlobSha1(bytes),
    sha256: sha256(bytes)
  };
}

function exactStrings(left, right, label) {
  const a = uniqueStrings(left, label + ' registry');
  const b = uniqueStrings(right, label + ' traceability');
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('TRACE_MISMATCH', label);
  return a;
}

export function buildI0Projection({registryBytes, traceabilityBytes, source = I0_SOURCE} = {}) {
  if (!source || source.repository !== I0_SOURCE.repository ||
      source.commit !== I0_SOURCE.commit ||
      source.registry?.gitBlobSha1 !== I0_SOURCE.registry.gitBlobSha1 ||
      source.traceability?.gitBlobSha1 !== I0_SOURCE.traceability.gitBlobSha1 ||
      source.registry?.path !== I0_SOURCE.registry.path ||
      source.traceability?.path !== I0_SOURCE.traceability.path ||
      JSON.stringify(source.ids) !== JSON.stringify(I0_SOURCE.ids)) {
    fail('UNTRUSTED_SOURCE', 'I0 accepts only the pinned normative revision');
  }
  const registry = expectObject(parsePinned(registryBytes, source.registry, source), 'registry');
  const traceability = expectObject(parsePinned(traceabilityBytes, source.traceability, source), 'traceability');
  // JSON.parse alone silently overwrites duplicate object keys; fail closed on both files.
  rawJsonTokenSpan(registryBytes, '');
  rawJsonTokenSpan(traceabilityBytes, '');
  if (registry.schema !== 'mts-requirement-registry/v0.3' ||
      registry.mtsVersion !== 'v0.15' ||
      registry.status !== 'accepted' || registry.accepted !== true ||
      traceability.schema !== 'mts-traceability/v0.3' ||
      traceability.mtsVersion !== 'v0.15' ||
      traceability.status !== 'accepted' || traceability.accepted !== true ||
      traceability.releaseState !== 'ACCEPTED' ||
      traceability.authorDecision?.state !== 'ACCEPTED' ||
      traceability.authorDecision?.decision !== 'ACCEPT_MTS_V0_15' ||
      typeof traceability.authorDecision?.decisionEvidence !== 'string' ||
      !traceability.authorDecision.decisionEvidence) {
    fail('AUTHORITY_MISMATCH', 'accepted v0.15 registry, traceability and decision required');
  }
  if (registry.currentAccepted?.requirements !== source.registry.path ||
      traceability.currentAccepted?.requirements !== source.registry.path ||
      registry.currentAccepted?.traceability !== source.traceability.path ||
      traceability.currentAccepted?.traceability !== source.traceability.path ||
      traceability.requirementsRegistry !== source.registry.path) {
    fail('AUTHORITY_MISMATCH', 'accepted source references');
  }
  if (!Array.isArray(registry.requirements)) fail('INVALID_FIELD', 'registry requirements array');
  const traces = expectObject(traceability.requirements, 'traceability requirements map');
  const byId = new Map();
  for (const [index, value] of registry.requirements.entries()) {
    const item = expectObject(value, 'registry requirement ' + index);
    if (typeof item.id !== 'string' || !item.id) fail('INVALID_FIELD', 'requirement ID');
    if (byId.has(item.id)) fail('DUPLICATE_ID', item.id);
    byId.set(item.id, {item, index});
  }
  // Fail-closed even for unselected IDs: a partial match is not a complete registry.
  for (const id of byId.keys()) if (!Object.hasOwn(traces, id)) fail('MISSING_TRACE', id);
  for (const id of Object.keys(traces)) if (!byId.has(id)) fail('ORPHAN_TRACE', id);

  const ids = uniqueStrings(source.ids, 'selection');
  const forward = {};
  const reverseMap = new Map();
  const addReverse = (kind, target, requirementId) => {
    const key = kind + '\0' + target;
    if (!reverseMap.has(key)) reverseMap.set(key, new Set());
    reverseMap.get(key).add(requirementId);
  };
  const entries = [];
  for (const id of ids) {
    const located = byId.get(id);
    if (!located || !Object.hasOwn(traces, id)) fail('MISSING_ID', id);
    const {item, index} = located;
    const trace = expectObject(traces[id], 'trace ' + id);
    if (item.state !== trace.state) fail('STATE_MISMATCH', id);
    if (typeof item.summary !== 'string' || !item.summary ||
        typeof item.state !== 'string' || !item.state ||
        typeof item.ownerIssue !== 'string' || !/^#[0-9]+$/.test(item.ownerIssue) ||
        Number(item.ownerIssue.slice(1)) !== trace.ownerIssue) {
      fail('INVALID_FIELD', 'requirement identity / owner ' + id);
    }
    const dependsOn = exactStrings(item.dependsOn, trace.dependsOn, id + ' dependsOn');
    const requiredExecutableGates = exactStrings(
      item.evidence?.requiredExecutableGates, trace.requiredExecutableGates, id + ' gates');
    const evidenceRefs = uniqueStrings(trace.evidenceRefs, id + ' evidenceRefs');
    const pointers = {
      requirement: '/requirements/' + index,
      id: '/requirements/' + index + '/id',
      normativeText: '/requirements/' + index + '/summary',
      state: '/requirements/' + index + '/state',
      ownerIssue: '/requirements/' + index + '/ownerIssue',
      dependsOn: '/requirements/' + index + '/dependsOn',
      requiredExecutableGates: '/requirements/' + index + '/evidence/requiredExecutableGates',
      traceability: '/requirements/' + pointerPart(id),
      traceState: '/requirements/' + pointerPart(id) + '/state',
      traceEvidenceRefs: '/requirements/' + pointerPart(id) + '/evidenceRefs'
    };
    const entry = {
      id,
      source: {
        repository: source.repository, commit: source.commit,
        path: source.registry.path, sourceSha256: sha256(registryBytes),
        requirementTextSha256: sha256(Buffer.from(item.summary, 'utf8')),
        pointers,
        normativeTextRawJsonToken: rawJsonTokenSpan(registryBytes, pointers.normativeText)
      },
      normativeText: item.summary,
      requirementState: item.state,
      releaseStatus: registry.status,
      authorDecision: {
        state: traceability.authorDecision.state,
        evidence: traceability.authorDecision.decisionEvidence
      },
      ownerIssue: item.ownerIssue,
      traceabilityOwnerIssue: trace.ownerIssue,
      dependsOn,
      requiredExecutableGates,
      evidenceRefs,
      traceabilitySource: {
        path: source.traceability.path,
        sourceSha256: sha256(traceabilityBytes),
        pointer: pointers.traceability
      }
    };
    entries.push(entry);
    forward[id] = {dependsOn, requiredExecutableGates, evidenceRefs, ownerIssue: item.ownerIssue};
    for (const target of dependsOn) addReverse('dependsOn', target, id);
    for (const target of requiredExecutableGates) addReverse('requiredExecutableGates', target, id);
    for (const target of evidenceRefs) addReverse('evidenceRefs', target, id);
    addReverse('ownerIssue', item.ownerIssue, id);
  }
  const reverse = {};
  for (const key of ordered(reverseMap.keys())) {
    const zero = key.indexOf('\0');
    const kind = key.slice(0, zero), target = key.slice(zero + 1);
    if (!reverse[kind]) reverse[kind] = {};
    reverse[kind][target] = ordered(reverseMap.get(key));
  }
  const manifest = {
    inputs: [manifestEntry(source.registry, registryBytes, source),
             manifestEntry(source.traceability, traceabilityBytes, source)],
    semantics: 'raw normative sources; no inferred repo-guard predicate',
    completeness: {requested: ids.length, resolved: entries.length, missing: 0}
  };
  const body = {
    schema: 'mts-nl/i0-readonly-observation/v0',
    status: 'SOURCE_PROJECTION_ONLY_NO_SEMANTIC_ACCEPTANCE',
    sourceCommit: source.commit,
    dependencyManifest: manifest,
    requirements: entries,
    forward,
    // Reverse postings index only edges originating at the five selected IDs.
    // Missing entries are not evidence that no other registry requirement depends on a target.
    reverseScope: {
      sourceRequirements: 'SELECTED_ONLY',
      selectedSourceCount: ids.length,
      registryRequirementCount: byId.size,
      unindexedSourceCount: byId.size - ids.length,
      completeAcrossRegistry: false,
      emptyOrMissingEntryMeans: 'UNKNOWN_OUTSIDE_SELECTION'
    },
    reverse
  };
  // Validate bytes against immutable Git blob identities before publishing any report.
  // Structural diagnostics above can fail more specifically, but no changed source can pass.
  for (const [descriptor, bytes] of [[source.registry, registryBytes], [source.traceability, traceabilityBytes]]) {
    if (gitBlobSha1(bytes) !== descriptor.gitBlobSha1) {
      fail('SOURCE_DIGEST_MISMATCH', descriptor.path + ' does not match pinned Git blob');
    }
  }
  return {...body, projectionSha256: sha256(Buffer.from(JSON.stringify(body), 'utf8'))};
}

export function assessI0Freshness(dependencyManifest, observed) {
  if (!Array.isArray(dependencyManifest?.inputs) || dependencyManifest.inputs.length !== 2 ||
      !observed || typeof observed !== 'object') {
    return {status: 'UNKNOWN', changed: [], unavailable: ['manifest']};
  }
  const expected = [I0_SOURCE.registry, I0_SOURCE.traceability];
  if (expected.some((pin, i) => dependencyManifest.inputs[i]?.path !== pin.path ||
      dependencyManifest.inputs[i]?.gitBlobSha1 !== pin.gitBlobSha1 ||
      dependencyManifest.inputs[i]?.commit !== I0_SOURCE.commit ||
      dependencyManifest.inputs[i]?.repository !== I0_SOURCE.repository ||
      !/^[a-f0-9]{64}$/.test(dependencyManifest.inputs[i]?.sha256 ?? ''))) {
    return {status: 'UNKNOWN', changed: [], unavailable: ['manifest']};
  }
  const changed = [], unavailable = [];
  for (const input of dependencyManifest.inputs) {
    const bytes = observed[input.path];
    if (!Buffer.isBuffer(bytes)) {unavailable.push(input.path); continue;}
    if (sha256(bytes) !== input.sha256 || gitBlobSha1(bytes) !== input.gitBlobSha1) changed.push(input.path);
  }
  return {status: unavailable.length ? 'UNKNOWN' : changed.length ? 'STALE' : 'CURRENT',
    changed: ordered(changed), unavailable: ordered(unavailable)};
}

// Candidate fields are never an input to buildI0Projection; authority cannot
// be promoted by candidate metadata, including a forged author-decision string.
export function checkI0Candidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) fail('INVALID_CANDIDATE');
  if (String(candidate.status ?? '').toUpperCase() === 'ACCEPTED' ||
      String(candidate.authorityState ?? '').toUpperCase() === 'ACCEPTED' ||
      candidate.accepted === true || candidate.authorDecision !== undefined) {
    return {status: 'REJECTED', reason: 'CANDIDATE_CANNOT_SELF_AUTHORIZE'};
  }
  return {status: 'NON_AUTHORITATIVE', reason: 'CANDIDATE_OBSERVATION_ONLY'};
}
