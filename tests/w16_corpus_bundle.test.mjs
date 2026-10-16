import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('W16 deterministically packages SQLite roots under 100MB and blocks unsourced rights', t => {
  const src=fileURLToPath(new URL('../scripts/w16_corpus_bundle.py',import.meta.url));
  const result=spawnSync('python3',[src,'--self-test'],{
    encoding:'utf8',timeout:20000,maxBuffer:2**20
  });
  if(result.error?.code==='ENOENT'){t.skip('python3 not available');return;}
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/W16_BUNDLE_SELF_TEST_PASS/);
});