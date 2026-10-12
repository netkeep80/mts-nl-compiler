#!/usr/bin/env node
// Research CLI for the actual Node-native immutable Link runtime.
// xz command is an EXPLICIT temporary transport adapter on Linux; no SQLite.
import {spawnSync} from 'node:child_process';
import {FrozenLinkAseti} from '../src/w17-native-link-runtime-v0.mjs';

const allowed=new Set(['--archive','--document','--slice','--find','--verify-all','--list']);
const input=process.argv.slice(2),opts=new Map();
for(let i=0;i<input.length;i++){
 const k=input[i];if(!allowed.has(k)||opts.has(k))throw Error('unsupported/duplicate option: '+k);
 if(k==='--verify-all'||k==='--list')opts.set(k,true);
 else{if(i+1>=input.length)throw Error('missing value '+k);opts.set(k,input[++i]);}
}
if(!opts.has('--archive'))throw Error('--archive is required');
const document=opts.has('--document')?Number(opts.get('--document')):0;
if(!Number.isSafeInteger(document)||document<0)throw Error('invalid document');
const graph=FrozenLinkAseti.fromArchive(opts.get('--archive'),{
 decompressXZ:(compressed,maxBytes)=>{
  const r=spawnSync('xz',['--format=xz','--decompress','--stdout'],{input:compressed,maxBuffer:maxBytes+65536,timeout:60_000});
  if(r.error?.code==='ENOENT')throw Error('research transport requires xz binary; portable XZ backend not integrated');
  if(r.status!==0)throw Error('XZ transport failed');
  return r.stdout;
 },verifyDocuments:opts.has('--verify-all')});
const out={status:'W17_NODE_READ_ONLY',nodes:graph.nodeCount,documents:graph.documentCount,
 wireSha256:graph.wireSha256,sqliteRequired:false,externalXZTransport:true};
if(opts.has('--list'))out.list=graph.documents.map((d,i)=>({index:i,id:d.id,bytes:d.bytes,scalars:d.scalars}));
if(opts.has('--slice')){
 const m=/^(\d+):(\d+)$/.exec(opts.get('--slice'));if(!m)throw Error('expected scalar range START:END');
 out.slice=graph.slice(document,Number(m[1]),Number(m[2]));
}
if(opts.has('--find'))out.matches=graph.find(document,opts.get('--find'));
console.log(JSON.stringify(out,null,2));