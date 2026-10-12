import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

for(const [title,script] of [
 ['reversible physical Link bitstream','w14_wire_oracle.py'],
 ['blind-vs-word oracle segmentation controls','w14_word_oracle.py']]){
 test('W14 '+title, t=>{
  const file=fileURLToPath(new URL('../scripts/'+script,import.meta.url));
  const p=spawnSync('python3',[file,'--self-test'],{
   encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
  if(p.error?.code==='ENOENT'){t.skip('Python not installed, optional independent oracle');return;}
  assert.equal(p.error,undefined,p.error?.message);
  assert.equal(p.status,0,p.stderr);
  assert.match(p.stdout,/W14_.*_SELF_TEST_PASS/);
 });
}