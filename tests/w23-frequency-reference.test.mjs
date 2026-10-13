import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {compressFrequencyReference,linksPlatformCSharpUpdateMaxPredicate,
 simulatePinnedCSharpFreshSelection,linksPlatformAuditPin}
 from '../src/w23-frequency-reference-v0.mjs';

const doc=(id,text)=>({id,text});

test('pinned C# comparator cannot select an ordinary positive first maximum after ResetMaxDoublet',()=>{
 assert.equal(linksPlatformAuditPin.commit,'6a6a69fc3ce42b0bd3e421c17c810ec2f37cb12b');
 assert.equal(linksPlatformCSharpUpdateMaxPredicate({
  frequency:2,maxFrequency:0,minFrequency:1,source:7,target:9,bestSource:0,bestTarget:0
 }),false);
 assert.equal(simulatePinnedCSharpFreshSelection([
  {source:7,target:9,frequency:2},{source:2,target:3,frequency:5}
 ]),null);
});

test('GitHub Actions executes a minimal real C# counterexample when dotnet SDK is present',t=>{
 const version=spawnSync('dotnet',['--version'],{encoding:'utf8'});
 if(version.status!==0){
  if(process.env.GITHUB_ACTIONS==='true')assert.fail('GitHub runner must execute the real C# comparator reproducer');
  t.skip('dotnet SDK not installed in this local environment');return;
 }
 const major=Number.parseInt(version.stdout.trim().split('.')[0],10);
 assert.ok(Number.isInteger(major)&&major>=8,'supported dotnet SDK expected');
 const dir=mkdtempSync(join(tmpdir(),'w23-csharp-'));
 try{
  writeFileSync(join(dir,'repro.csproj'),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net${major}.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>`);
  writeFileSync(join(dir,'Program.cs'),String.raw`
ulong frequency=2, maxFrequency=0, minFrequencyToCompress=1;
ulong source=7, target=9, bestSource=0, bestTarget=0;
bool selected = frequency > minFrequencyToCompress && (maxFrequency > frequency) ||
 (maxFrequency == frequency && (source + target > bestSource + bestTarget));
Console.WriteLine(selected ? "SELECTED" : "NOT_SELECTED");
`);
  const run=spawnSync('dotnet',['run','--project',join(dir,'repro.csproj'),'--configuration','Release','--nologo'],
   {encoding:'utf8',timeout:120000});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/NOT_SELECTED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('reference compressor ranks by frequency, confirms non-overlap, and exactly replays mandatory Unicode controls',()=>{
 const combining='e\u0301';
 const controls=[
  '', 'мама','аааа','аааааааа','абабаб','абаабабб',
  'мама мыла раму, мама снова мыла раму.',
  'the link repeats; the link repeats; the link repeats.',
  `🙂🙂 ${combining} ${combining} 👩‍💻👩‍💻`,
  'a\tb\r\na\tb\r\n',
  'abcdefghi'
 ];
 for(const [i,text] of controls.entries()){
  const out=compressFrequencyReference([doc('c'+i,text)],{minOccurrences:2,maxRounds:64});
  assert.equal(out.status,'EXACT_UNICODE_REPLAY_PASS');
  assert.equal(out.replay[0],text);
 }
 const mama=compressFrequencyReference([doc('m','мама')],{minOccurrences:2,maxRounds:8});
 assert.equal(mama.rules[0]?.expanded,'ма');
 assert.equal(mama.rules[0]?.adjacentFrequency,2);
 assert.equal(mama.rules[0]?.nonOverlappingReplacements,2);
 const aaa=compressFrequencyReference([doc('a','ааа')],{minOccurrences:2,maxRounds:8});
 assert.equal(aaa.ruleCount,0,'two overlapping observations are only one disjoint replacement');
 const aaaa=compressFrequencyReference([doc('a','аааа')],{minOccurrences:2,maxRounds:8});
 assert.equal(aaaa.rules[0].expanded,'аа');
 assert.equal(aaaa.rules[0].adjacentFrequency,3);
 assert.equal(aaaa.rules[0].nonOverlappingReplacements,2);
});

test('reference tie-break depends on structural content, not local allocation order',()=>{
 const a=compressFrequencyReference([doc('x','абвгабдг')],{maxRounds:1,minOccurrences:2});
 const b=compressFrequencyReference([doc('noise','я'),doc('x','абвгабдг')],{maxRounds:1,minOccurrences:2});
 assert.equal(a.rules[0].expanded,b.rules[0].expanded);
 assert.equal(a.rules[0].canonical,b.rules[0].canonical);
});

test('multi-document counts are global observations but replay remains per document',()=>{
 const docs=[doc('r1','абаб'),doc('r2','zzабzzаб'),doc('r3','🙂аб🙂аб')];
 const out=compressFrequencyReference(docs,{minOccurrences:2,maxRounds:16});
 assert.deepEqual(out.replay,docs.map(x=>x.text));
 assert.ok(out.rules.some(r=>r.expanded==='аб'&&r.adjacentFrequency>=5));
 assert.ok(out.fullScanAdjacentInspections>0);
});

test('deterministic pseudo-random and no-repeat controls do not corrupt source',()=>{
 let state=0x12345678;const alphabet=[...'абвгдеж🙂XYZ'];let text='';
 for(let i=0;i<128;i++){state=(1664525*state+1013904223)>>>0;text+=alphabet[state%alphabet.length];}
 const random=compressFrequencyReference([doc('random',text)],{maxRounds:64,minOccurrences:2});
 assert.equal(random.replay[0],text);
 const unique='абвгдежзийкл';
 const noRepeat=compressFrequencyReference([doc('unique',unique)],{maxRounds:64,minOccurrences:2});
 assert.equal(noRepeat.ruleCount,0);
 assert.equal(noRepeat.replay[0],unique);
});
