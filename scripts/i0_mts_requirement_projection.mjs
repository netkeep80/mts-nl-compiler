// Read-only I0 CLI. Uses a pinned Git commit and blob hashes, never a moving branch.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {I0_SOURCE, buildI0Projection, assessI0Freshness} from '../src/i0-mts-requirement-projection.mjs';

const specs = [I0_SOURCE.registry, I0_SOURCE.traceability];

export async function fetchI0Inputs(fetcher = globalThis.fetch) {
  const result = {};
  for (const spec of specs) {
    const url = 'https://raw.githubusercontent.com/' + I0_SOURCE.repository + '/' +
      I0_SOURCE.commit + '/' + spec.path;
    let response;
    try { response = await fetcher(url, {signal: AbortSignal.timeout(20000)}); }
    catch (error) { throw new Error('I0_SOURCE_UNAVAILABLE: ' + spec.path + ': ' + error.message); }
    if (!response?.ok) throw new Error('I0_SOURCE_UNAVAILABLE: ' + spec.path + ' HTTP ' + response?.status);
    result[spec.path] = Buffer.from(await response.arrayBuffer());
  }
  return result;
}

export function loadI0Local(directory) {
  const root = resolve(directory);
  let revision;
  try {
    revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  } catch (error) {
    throw new Error('I0_SOURCE_UNAVAILABLE: no exact Git checkout at ' + root);
  }
  if (revision !== I0_SOURCE.commit) {
    throw new Error('I0_UNTRUSTED_SOURCE: checkout is not pinned ' + I0_SOURCE.commit);
  }
  return Object.fromEntries(specs.map(spec => [spec.path, readFileSync(join(root, spec.path))]));
}

export function projectI0Inputs(inputs) {
  const projection = buildI0Projection({
    registryBytes: inputs[I0_SOURCE.registry.path],
    traceabilityBytes: inputs[I0_SOURCE.traceability.path]
  });
  const freshness = assessI0Freshness(projection.dependencyManifest, inputs);
  if (freshness.status !== 'CURRENT') throw new Error('I0_UNVERIFIED_INPUTS: ' + freshness.status);
  return projection;
}

async function main() {
  const args = process.argv.slice(2);
  const inputs = args.length === 2 && args[0] === '--anum-dir'
    ? loadI0Local(args[1])
    : args.length === 0 || (args.length === 1 && args[0] === '--github')
      ? await fetchI0Inputs()
      : (() => { throw new Error('usage: node scripts/i0_mts_requirement_projection.mjs [--github | --anum-dir PATH]'); })();
  process.stdout.write(JSON.stringify(projectI0Inputs(inputs), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(JSON.stringify({
      schema: 'mts-nl/i0-readonly-observation-error/v0',
      status: /SOURCE_UNAVAILABLE/.test(error.message) ? 'UNKNOWN' : 'ERROR',
      reason: error.message
    }));
    process.exitCode = 1;
  });
}
