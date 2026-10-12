import assert from 'node:assert/strict';
import {test} from 'node:test';
import {encodeM1State,decodeM1Bytes,trainM1,scoreM1Frozen}
 from '../src/m1-reversible-mdl-v0.mjs';
const d=(id,text)=>({id,bytes:Buffer.from(text,'utf8')});

test('M1 real transmitted byte stream independently recovers exact Unicode, BOM, CRLF and empty documents',()=>{
 const corpus=[d('bom','\ufeff\r\nе\u0308 🚀\r\n\r\n\ufeff'),d('empty',''),
  d('one','я'),d('nospace','лесалесусадасаду')];
 const a=trainM1(corpus,{maxRules:18});
 const decoded=decodeM1Bytes(Buffer.from(a.wire));
 assert.equal(a.exactReplay,'PASS');
 assert.equal(decoded.documents.length,corpus.length);
 for(let i=0;i<corpus.length;i++)assert.deepEqual(decoded.documents[i],corpus[i].bytes);
 assert.deepEqual(encodeM1State(decoded.state),a.wire,'canonical re-encode');
 assert.equal(a.totalBits,a.wire.length*8);
 assert.equal(a.boundaryKnowledge,'NONE');
 assert.equal(a.notImplemented.includes('A3 classes and slots'),true);
});

test('M1 A1 only commits merges which reduce real transmitted bits; A0 need not',()=>{
 const x=[d('tiny','aaaa')];
 const a0=trainM1(x,{mode:'A0',maxRules:3});
 const a1=trainM1(x,{mode:'A1',maxRules:3});
 assert.equal(a0.totalBits,a0.initialBits,'frequency-only accepts a cost-neutral rule');
 assert.equal(a0.rules,1);
 assert.equal(a1.totalBits,a1.initialBits,'full MDL rejects non-paying pair');
 assert.equal(a1.rules,0);
 assert.ok(a1.history.every(x=>x.deltaBits<0));
 const long=[d('repeat','🚀абвз'.repeat(64)),d('suffix','абвз🚀'.repeat(32))];
 const trained=trainM1(long,{mode:'A1',maxRules:32});
 assert.ok(trained.totalBits<trained.initialBits);
 assert.ok(trained.rules>0);
 assert.ok(trained.history.every(h=>h.deltaBits<0));
 assert.deepEqual(decodeM1Bytes(trained.wire).documents.map(x=>x.toString('utf8')),
  long.map(x=>x.bytes.toString('utf8')));
});

test('M1 never accepts overlap as a second independent occurrence',()=>{
 const triple=trainM1([d('one','aaa')],{mode:'A0',maxRules:4});
 assert.equal(triple.rules,0);
 const quadruple=trainM1([d('two','aaaa')],{mode:'A0',maxRules:1});
 assert.equal(quadruple.rules,1);
 assert.equal(quadruple.history[0].nonoverlapOccurrences,2);
});

test('M1 explicit decoder rejects invalid IDs, noncanonical integers, truncation and corrupted lengths',()=>{
 const s={atoms:[65],rules:[[0,0]],parses:[[1]],sourceByteLengths:[2]};
 const bin=encodeM1State(s);
 assert.equal(decodeM1Bytes(bin).documents[0].toString(),'AA');
 assert.throws(()=>decodeM1Bytes(Buffer.from('xxxxx')),/bad magic/);
 assert.throws(()=>decodeM1Bytes(bin.subarray(0,-1)),/truncated varuint/);
 assert.throws(()=>decodeM1Bytes(Buffer.concat([bin,Buffer.from([0])])),/trailing data/);
 assert.throws(()=>decodeM1Bytes(Buffer.from([77,49,76,48,0x80,0])),/noncanonical varuint/);
 assert.throws(()=>encodeM1State({...s,rules:[[1,0]]}),/forward/);
 assert.throws(()=>encodeM1State({...s,atoms:[65,65]}),/duplicate/);
 assert.throws(()=>encodeM1State({...s,atoms:[0xd800]}),/bad/);
 assert.throws(()=>decodeM1Bytes(bin,{maxOutputBytes:1}),/budget|limit/);
 const tampered=Buffer.from(bin);tampered[tampered.length-3]=3;
 assert.throws(()=>decodeM1Bytes(tampered),/count|parse|truncated|output/);
});

test('M1 source admission rejects invalid UTF-8 and duplicate documents without publication',()=>{
 assert.throws(()=>trainM1([{id:'a',bytes:Buffer.from([0xff])}]),/encoded|UTF|utf/i);
 assert.throws(()=>trainM1([d('x','abc'),d('x','def')]),/metadata/);
 assert.throws(()=>trainM1([]),/document count/);
 assert.throws(()=>trainM1([d('x','a')],{maxRules:-1}),/options/);
});

test('M1 frozen heldout uses only training grammar and does not learn test combinations',()=>{
 const train=[d('train','леса|лесу|сада|саду|'.repeat(20))];
 const m=trainM1(train,{mode:'A1',maxRules:24});
 const original=Buffer.from(m.wire),snapshot=JSON.stringify(m.state);
 const h=scoreM1Frozen(m,[d('heldout','садулеса|')]);
 assert.equal(h.status,'FROZEN_GRAMMAR_REPLAY_PASS');
 assert.equal(h.noTrainingOnHeldout,true);
 assert.ok(h.heldoutBitsPerScalar>0);
 assert.equal(h.transmittedTotalBits,h.frozenModelBits+h.heldoutDataBits);
 assert.deepEqual(m.wire,original);
 assert.equal(JSON.stringify(m.state),snapshot);
 const unknown=scoreM1Frozen(m,[d('outside-alphabet','零🚀')]);
 assert.equal(unknown.status,'FROZEN_GRAMMAR_REPLAY_PASS');
 assert.equal(unknown.escapedHeldoutDistinctScalars,2);
});

test('M1 no-space factorized synthetic generator is evaluated with blind learner',()=>{
 const roots=['xak','zem','pil','ruf','gon','tes','naq','vor'];
 const suffixes=['a','o','i','u'];
 const train=[],hold=[];
 for(let i=0;i<roots.length;i++)for(let j=0;j<suffixes.length;j++){
  // A true generator is known to this test ONLY. Learner takes raw bytes.
  const form=roots[i]+suffixes[j];
  if((i+2*j)%7===0)hold.push(form);else train.push(form);
 }
 const corpus=[d('train',train.join('').repeat(28))],model=trainM1(corpus,{mode:'A1',maxRules:48});
 assert.equal(model.exactReplay,'PASS');
 assert.ok(model.rules>0);
 const testString=hold.join('');
 const score=scoreM1Frozen(model,[d('unseen-combinations',testString)]);
 assert.equal(score.status,'FROZEN_GRAMMAR_REPLAY_PASS');
 assert.ok(score.heldoutBitsPerScalar>0);
 // A1 has no slot/class model. Do not claim this test proves morpheme recovery.
 assert.ok(model.notImplemented.includes('A3 classes and slots'));
});

test('M1 five-seed blinded morphology-like A0/A1 protocol reports actual bits without claiming morphemes',()=>{
 const roots=['xak','zem','pil','ruf','gon','tes','naq','vor'],suffixes=['a','o','i','u'];
 const runs=[];
 for(let seed=1;seed<=5;seed++){
  let rng=seed;
  const rand=()=>{rng=(Math.imul(1664525,rng)+1013904223)>>>0;return rng/4294967296;};
  const exposed=[],withheld=[];
  for(let i=0;i<roots.length;i++)for(let j=0;j<suffixes.length;j++){
   const form=roots[i]+suffixes[j];
   if((i+2*j+seed)%7===0)withheld.push(form);else exposed.push(form);
  }
  const train=[];
  for(let k=0;k<560;k++)train.push(exposed[Math.floor(rand()*exposed.length)]);
  const documents=[d('train',train.join(''))],hidden=[d('blind',withheld.join('').repeat(5))];
  const a0=trainM1(documents,{mode:'A0',maxRules:35});
  const a1=trainM1(documents,{mode:'A1',maxRules:35});
  const h0=scoreM1Frozen(a0,hidden),h1=scoreM1Frozen(a1,hidden);
  assert.ok(a1.totalBits<=a0.totalBits,'this registered five-seed corpus is no worse by exact train bits');
  assert.equal(a1.modelBits+a1.dataBits,a1.totalBits);
  assert.equal(a1.exactReplay,'PASS');
  assert.equal(h0.status,'FROZEN_GRAMMAR_REPLAY_PASS');
  assert.equal(h1.status,'FROZEN_GRAMMAR_REPLAY_PASS');
  runs.push({seed,initialBits:a1.initialBits,trainA0Bits:a0.totalBits,
   trainA1Bits:a1.totalBits,heldoutBpsA0:h0.heldoutBitsPerScalar,
   heldoutBpsA1:h1.heldoutBitsPerScalar});
 }
 console.log('M1_FIVE_SEED_A0_A1',JSON.stringify(runs));
});