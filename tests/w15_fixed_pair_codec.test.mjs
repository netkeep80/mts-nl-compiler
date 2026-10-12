import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Research-only independent Python reference; no normative Node runtime dependency.
test('W15 fixed pair alignment, bitpacking, canonical padding and Unicode cold replay', t => {
  const script=fileURLToPath(new URL('../scripts/w15_fixed_pair_codec.py',import.meta.url));
  const run=spawnSync('python3',[script,'--self-test'],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  if(run.error?.code==='ENOENT') {t.skip('optional python3 not installed'); return;}
  assert.equal(run.error,undefined,run.error?.message);
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/W15_SELF_TEST_PASS/);
  assert.match(run.stdout,/W15_ALIGN_STRUCT uint24_array=6\/align1 uint32_pair=8\/align4/);
});