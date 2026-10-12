import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('W17 archive contains only compressed W15 Link DAG and manifest; restores Unicode without SQLite', t => {
  const script = fileURLToPath(new URL('../scripts/w17_link_archive.py', import.meta.url));
  const p=spawnSync('python3',[script,'--self-test'],{encoding:'utf8',timeout:30_000,maxBuffer:1024*1024});
  if(p.error?.code==='ENOENT') {t.skip('python3 required for research archive selftest'); return;}
  assert.equal(p.error,undefined,p.error?.message);
  assert.equal(p.status,0,p.stderr);
  assert.match(p.stdout,/W17_ARCHIVED_ASETI_SELF_TEST_PASS/);
});