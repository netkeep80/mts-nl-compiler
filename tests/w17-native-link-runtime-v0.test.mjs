import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,truncateSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {FrozenLinkAseti} from '../src/w17-native-link-runtime-v0.mjs';
import {packBrotliExperiment} from '../src/w17-brotli-experiment-v0.mjs';

const appendU=(out,n)=>{while(n>=128){out.push((n&127)|128);n=Math.floor(n/128);}out.push(n);};
function buildTestW15(){
 const atoms=[...'ма🚀 '].map(c=>c.codePointAt(0)),pairs=[[0,1],[4,4],[5,3],[6,2]];
 const out=[...Buffer.from('W15F1\0'),3];appendU(out,atoms.length);for(const cp of atoms)appendU(out,cp);
 appendU(out,pairs.length);appendU(out,2);
 function bits(fields){let v=0,n=0;for(const [x,w] of fields){for(let j=w-1;j>=0;j--){v=(v<<1)|((x>>>j)&1);n++;if(n===8){out.push(v);v=n=0;}}}if(n)out.push(v<<(8-n));}
 bits(pairs.flatMap(([a,b],i)=>{const w=Math.max(1,Math.ceil(Math.log2(atoms.length+i)));return [[a,w],[b,w]];}));
 bits([[5,3],[7,3]]);
 for(const len of [[8,4],[13,6]])for(const n of len)appendU(out,n);
 return Buffer.from(out);
}
test('W17N0 Node-native W15 progressive Link graph exact Unicode + search with no Python/SQL',()=>{
 const plain=buildTestW15();const g=FrozenLinkAseti.fromWire(plain);
 assert.equal(g.nodeCount,8);assert.equal(g.atomCount,4);
 assert.equal(g.slice(0),'мама');assert.equal(g.slice(1),'мама 🚀');
 assert.equal(g.slice(1,1,4),'ама');assert.equal(g.slice(1,4,6),' 🚀');
 assert.deepEqual(g.find(1,'ма'),[0,2]);assert.deepEqual(g.find(1,'а 🚀'),[3]);
 assert.deepEqual(g.link(4),{index:4,kind:'pair',from:0,to:1,scalars:2});
 assert.throws(()=>g.slice(0,0,10),/range/);
 assert.throws(()=>g.find(0,''),/search/);
 assert.throws(()=>g.link(-1),/unknown/);
 assert.throws(()=>FrozenLinkAseti.fromWire(plain.subarray(0,-1)),/truncated/);
 assert.throws(()=>FrozenLinkAseti.fromWire(Buffer.from('sqlite')),/canonical W15/);
 const noncanonical=Buffer.from(plain);noncanonical[0]^=1;
 assert.throws(()=>FrozenLinkAseti.fromWire(noncanonical),/canonical W15/);
});
test('W17N0 Node archive adapter rejects missing XZ capability (never silently opens SQLite)',()=>{
 assert.throws(()=>FrozenLinkAseti.fromArchive(Buffer.from('not zip')),/XZ decompressor capability required/);
});

function packStored(members){
  // Standards-conformant ZIP with exactly two STORE entries; generated only
  // in synthetic test and never used as a production installer writer.
  const chunks=[],central=[];let cursor=0;
  const crc32=data=>{let crc=0xffffffff;for(const v of data){crc^=v;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
  for(const [name,payload] of members){
    const utf=Buffer.from(name);const crc=crc32(payload);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(payload.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(utf.length,26);
    chunks.push(local,utf,payload);
    const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50,0);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);
    dir.writeUInt32LE(crc,16);dir.writeUInt32LE(payload.length,20);dir.writeUInt32LE(payload.length,24);
    dir.writeUInt16LE(utf.length,28);dir.writeUInt32LE(cursor,42);central.push(dir,utf);
    cursor+=local.length+utf.length+payload.length;
  }
  const directory=Buffer.concat(central),tail=Buffer.alloc(22);
  tail.writeUInt32LE(0x06054b50,0);tail.writeUInt16LE(members.length,8);tail.writeUInt16LE(members.length,10);
  tail.writeUInt32LE(directory.length,12);tail.writeUInt32LE(cursor,16);
  return Buffer.concat([...chunks,directory,tail]);
}
test('W17N0 transport-independent XZ injection: exact immutable roots, SHA and Unicode',()=>{
 // This tests the Node archive contract without relying on an OS xz executable.
 // Decompression is explicitly injected; this is NOT a test of the XZ codec.
 const plain=buildTestW15(),payload=Buffer.from('synthetic compressed bytes');
 const sha=b=>createHash('sha256').update(b).digest('hex');
 const books=['мама','мама 🚀'];
 const manifest={schema:'mts-nl/archived-link-aseti/v1',serialization:'W15F1-progressive',payload:'links.w15f1.xz',
  payloadBytes:payload.length,payloadSha256:sha(payload),wireBytes:plain.length,wireSha256:sha(plain),
  nodeCount:8,documentCount:2,documents:books.map((str,index)=>({
   index,id:'fixture-'+index,bytes:Buffer.byteLength(str),scalars:[...str].length,sha256:sha(Buffer.from(str))
  }))};
 const archive=packStored([['manifest.json',Buffer.from(JSON.stringify(manifest))],['links.w15f1.xz',payload]]);
 let calls=0;
 const decompressXZ=(received,maxBytes)=>{
  calls++;assert.deepEqual(received,payload);assert.equal(maxBytes,plain.length);return plain;
 };
 const graph=FrozenLinkAseti.fromArchive(archive,{decompressXZ,expectedArchiveSHA256:sha(archive)});
 assert.equal(calls,1);assert.deepEqual(graph.roots,[5,7]);
 assert.equal(graph.verifyDocumentDigests().verified,2);
 assert.equal(graph.slice(1,3,6),'а 🚀');assert.deepEqual(graph.find(1,'а 🚀'),[3]);
 assert.throws(()=>FrozenLinkAseti.fromArchive(archive,{decompressXZ:()=>Buffer.from('corrupt')}),/decompressed stream SHA/);
});

test('W17N0 portable ZIP enforces CRC, local sizes, and bounded archive file IO',()=>{
 const wire=buildTestW15(),{archive}=packBrotliExperiment(wire);
 const tampered=Buffer.from(archive);
 tampered[30+Buffer.byteLength('manifest.json')+5]^=1;
 assert.throws(()=>FrozenLinkAseti.fromBrotliExperiment(tampered),/ZIP CRC mismatch/);
 const tamperedCentral=Buffer.from(archive),dirOffset=archive.readUInt32LE(archive.length-6);
 tamperedCentral[dirOffset+16]^=1;
 assert.throws(()=>FrozenLinkAseti.fromBrotliExperiment(tamperedCentral),/ZIP CRC mismatch/);
 const tamperedLocal=Buffer.from(archive);tamperedLocal[18]^=1;
 assert.throws(()=>FrozenLinkAseti.fromBrotliExperiment(tamperedLocal),/ZIP member bounds/);
 const dir=mkdtempSync(join(tmpdir(),'w17-archive-bounds-'));
 try{
  const path=join(dir,'oversized archived aseti.zip');
  writeFileSync(path,Buffer.alloc(0));truncateSync(path,100_000_001);
  assert.throws(()=>FrozenLinkAseti.fromBrotliExperiment(path),/archive byte budget/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('W17N0 real ZIP/XZ adapter: exact source SHA, member exclusion, strict tamper refusal',t=>{
  const plain=buildTestW15();
  const zipped=spawnSync('xz',['-6','--format=xz','--compress','--stdout'],{input:plain,maxBuffer:1e6});
  if(zipped.error?.code==='ENOENT'){t.skip('optional OS xz for transport integration fixture');return;}
  assert.equal(zipped.status,0,zipped.stderr?.toString());
  const sha=b=>createHash('sha256').update(b).digest('hex');
  const documents=['мама','мама 🚀'];
  const manifest={schema:'mts-nl/archived-link-aseti/v1',serialization:'W15F1-progressive',payload:'links.w15f1.xz',
    payloadBytes:zipped.stdout.length,payloadSha256:sha(zipped.stdout),wireBytes:plain.length,wireSha256:sha(plain),
    nodeCount:8,documentCount:2,documents:documents.map((s,i)=>({index:i,id:'book'+i,scalars:[...s].length,
      bytes:Buffer.byteLength(s),sha256:sha(Buffer.from(s))}))};
  const members=[['manifest.json',Buffer.from(JSON.stringify(manifest))],['links.w15f1.xz',zipped.stdout]];
  const archive=packStored(members);
  const decompressXZ=(data,limit)=>{
    const r=spawnSync('xz',['--format=xz','--decompress','--stdout'],{input:data,maxBuffer:limit+100});
    if(r.status!==0)throw Error('xz failure');
    return r.stdout;
  };
  const graph=FrozenLinkAseti.fromArchive(archive,{decompressXZ,expectedArchiveSHA256:sha(archive)});
  assert.equal(graph.verifyDocumentDigests().verified,2);
  assert.equal(graph.slice(1,2,6),'ма 🚀');
  assert.deepEqual(graph.find(1,'мама'),[0]);
  assert.throws(()=>FrozenLinkAseti.fromArchive(archive,{decompressXZ,expectedArchiveSHA256:'0'.repeat(64)}),/external pin/);
  const forged={...manifest,documents:manifest.documents.map(d=>({...d,sha256:'0'.repeat(64)}))};
  assert.throws(()=>FrozenLinkAseti.fromArchive(packStored([
    ['manifest.json',Buffer.from(JSON.stringify(forged))],members[1]
  ]),{decompressXZ}),/document SHA/);
  assert.throws(()=>FrozenLinkAseti.fromArchive(packStored([
    members[0],['unapproved.sqlite',zipped.stdout]
  ]),{decompressXZ}),/ZIP member type/);
  assert.throws(()=>FrozenLinkAseti.fromArchive(packStored([
    members[0],['links.w15f1.xz',Buffer.from('tamper')]
  ]),{decompressXZ}),/compressed payload SHA/);

});

test('W17B0 all-Node Brotli research archive exact, deterministic, bounded, no XZ/SQLite',()=>{
 const wire=buildTestW15();
 const first=packBrotliExperiment(wire),second=packBrotliExperiment(wire);
 assert.equal(first.sha256,second.sha256);
 assert.deepEqual(first.archive,second.archive);
 const graph=FrozenLinkAseti.fromBrotliExperiment(first.archive,{expectedArchiveSHA256:first.sha256});
 assert.equal(graph.nodeCount,8);assert.equal(graph.verifyDocumentDigests().verified,2);
 const dir=mkdtempSync(join(tmpdir(),'w17-node-cli-'));
 try{
  const path=join(dir,'архив W17 with spaces.zip');writeFileSync(path,first.archive);
  const r=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/w17_native_query.mjs',import.meta.url)),
   '--archive',path,'--brotli-experimental','--verify-all','--document','1','--slice','3:6'],
   {encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stderr);
  const out=JSON.parse(r.stdout);
  assert.equal(out.slice,'а 🚀');assert.equal(out.externalXZTransport,false);
  assert.equal(out.sqliteRequired,false);
 }finally{rmSync(dir,{recursive:true,force:true});}

 assert.equal(graph.slice(1),'мама 🚀');assert.deepEqual(graph.find(1,'а 🚀'),[3]);
 assert.throws(()=>packBrotliExperiment(wire,{sourceDocuments:[{id:'a'}]}),/witness count/);
 assert.throws(()=>packBrotliExperiment(wire,{sourceDocuments:[
  {sha256:'bad',bytes:8,scalars:4},{sha256:'bad',bytes:13,scalars:6}
 ]}),/source witness SHA/);
 assert.throws(()=>FrozenLinkAseti.fromArchive(first.archive,{decompressXZ:x=>x}),/ZIP member type/);
 assert.throws(()=>FrozenLinkAseti.fromBrotliExperiment(first.archive,{expectedArchiveSHA256:'a'.repeat(64)}),/external pin/);
 const modified=Buffer.from(first.archive);modified[58]^=1;
 assert.throws(()=>FrozenLinkAseti.fromBrotliExperiment(modified),/invalid|checksum|manifest|ZIP|wire|Brotli/);
});