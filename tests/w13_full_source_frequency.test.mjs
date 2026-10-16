import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// W13 is a research-only Python-stdlib independent oracle, not a new
// runtime or SQLite/schema requirement for the Node compiler.
test('W13 source-first frequency oracle: Unicode, physical SQLite and cold replay',t=>{
 const script=fileURLToPath(new URL('../scripts/w13_full_source_frequency.py',import.meta.url));
 const p=spawnSync('python3',[script,'--self-test'],{encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
 if(p.error?.code==='ENOENT'){t.skip('python3 not installed: optional independent research oracle');return;}
 assert.equal(p.error,undefined,p.error?.message);
 assert.equal(p.status,0,p.stderr);
 assert.match(p.stdout,/W13_SELF_TEST_PASS/);
});