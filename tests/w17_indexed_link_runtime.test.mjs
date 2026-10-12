import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('W17R1: indexed, lazily searchable Link aseti with no SQLite', t=>{
 const script=fileURLToPath(new URL('../scripts/w17_indexed_link_runtime.py',import.meta.url));
 const p=spawnSync('python3',[script,'--self-test'],{encoding:'utf8',timeout:30000,maxBuffer:2**20});
 if(p.error?.code==='ENOENT') {t.skip('Python3 unavailable for optional research Link runtime');return;}
 assert.equal(p.error,undefined,p.error?.message);
 assert.equal(p.status,0,p.stderr);
 assert.match(p.stdout,/W17_INDEXED_ASETI_SELF_TEST_PASS/);
});