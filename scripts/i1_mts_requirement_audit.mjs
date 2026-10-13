// Read-only I1 CLI: reuse I0 exact checkpoint validation, then traverse ALL 48.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {I0_SOURCE} from '../src/i0-mts-requirement-projection.mjs';
import {fetchI0Inputs, loadI0Local, projectI0Inputs} from './i0_mts_requirement_projection.mjs';
import {auditI1Registry} from '../src/i1-mts-requirement-audit.mjs';

const treeUrl = 'https://api.github.com/repos/' + I0_SOURCE.repository +
  '/git/trees/' + I0_SOURCE.commit + '?recursive=1';

export async function readPinnedTree(fetcher = globalThis.fetch) {
  let response;
  try {response = await fetcher(treeUrl, {signal: AbortSignal.timeout(20000)});}
  catch (error) {throw new Error('I1_SOURCE_UNAVAILABLE: git tree: ' + error.message);}
  if (!response?.ok) throw new Error('I1_SOURCE_UNAVAILABLE: git tree HTTP ' + response?.status);
  const result = await response.json();
  if (result.truncated || !Array.isArray(result.tree) || result.sha === undefined)
    throw new Error('I1_INCOMPLETE_TREE: refusing existence claims');
  return result.tree.filter(x => x.type === 'blob').map(x => x.path);
}

export function auditI1Inputs(inputs, paths) {
  // Throws for any untrusted/changed normative bytes before any green report.
  const i0 = projectI0Inputs(inputs);
  const registry = JSON.parse(inputs[I0_SOURCE.registry.path].toString('utf8'));
  const traceability = JSON.parse(inputs[I0_SOURCE.traceability.path].toString('utf8'));
  return {
    ...auditI1Registry(registry, traceability, {trackedPaths: paths}),
    inputs: i0.dependencyManifest,
    observedScope: 'ALL_48_REGISTRY_REQUIREMENTS',
    i0Scope: i0.reverseScope,
    artifactTree: {sourceCommit: I0_SOURCE.commit, fileCount: paths?.length ?? null},
    comparison: {
      nodeBaseline: 'EXECUTED',
      repoGuardRelationKernel: 'NOT_EXECUTED',
      reason: 'RepoGuard relation sources model requirement-to-repository-file artifact declarations; MTS dependsOn has requirement-to-requirement targets. No equivalent-authority kernel input or trusted transition is configured.'
    }
  };
}

async function main() {
  const argv = process.argv.slice(2);
  let inputs, paths;
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--github')) {
    [inputs, paths] = await Promise.all([fetchI0Inputs(), readPinnedTree()]);
  } else if (argv.length === 2 && argv[0] === '--anum-dir') {
    inputs = loadI0Local(argv[1]);
    paths = execFileSync('git', ['-C', resolve(argv[1]), 'ls-tree', '-r', '--name-only', I0_SOURCE.commit], {encoding: 'utf8'}).trim().split('\n');
  } else throw new Error('usage: node scripts/i1_mts_requirement_audit.mjs [--github | --anum-dir PATH]');
  const report = auditI1Inputs(inputs, paths);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status !== 'STRUCTURAL_GREEN') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {console.error(JSON.stringify({schema: 'mts-nl/i1-error/v0',
    status: /SOURCE_UNAVAILABLE/.test(error.message) ? 'UNKNOWN' : 'ERROR', reason: error.message}));
    process.exitCode = 1;});
