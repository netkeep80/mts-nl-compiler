// W17N0: research-only Node link reader, independent of SQLite and Python.
// W15F1 progressive grammar/roots are always read-only; XZ transport is injected.
// Source docs, rules, weights, and logical inferences are NOT manufactured here.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const MAGIC=Buffer.from('W15F1\0','binary');
const MAX_WIRE=64_000_000,MAX_LINKS=10_000_000,MAX_SCALARS=100_000_000;
const fail=s=>{throw new Error('W17_NODE_ARCHIVE: '+s);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const isSafe=n=>Number.isSafeInteger(n)&&n>=0;
function readU(buf,state){
 let n=0,scale=1,bytes=0,last=0;
 do{
  if(state.pos>=buf.length||bytes>=10)fail('truncated/oversized varuint');
  last=buf[state.pos++];bytes++;
  n+=(last&127)*scale;
  if(!Number.isSafeInteger(n))fail('varuint exceeds JS safe integer');
  scale*=128;
 }while(last&128);
 if(bytes>1&&last===0)fail('noncanonical varuint');
 return n;
}
class Bits{
 constructor(data,pos){this.data=data;this.start=pos;this.bit=0;}
 read(width){
  if(!Number.isInteger(width)||width<1||width>32)fail('bad bit width');
  let n=0,remaining=width;
  while(remaining){
   const byte=this.start+(this.bit>>>3);
   if(byte>=this.data.length)fail('truncated packed index');
   const remainingByte=8-(this.bit&7),take=Math.min(remainingByte,remaining);
   const mask=(1<<take)-1;
   n=n*2**take+((this.data[byte]>>>(remainingByte-take))&mask);
   this.bit+=take;remaining-=take;
  }
  return n;
 }
 finish(){
  const extra=this.bit&7;
  if(extra){
   const index=this.start+(this.bit>>>3);
   if(index>=this.data.length || (this.data[index]&((1<<(8-extra))-1)))fail('nonzero bit padding');
  }
  return this.start+Math.ceil(this.bit/8);
 }
}
function uint32(x){if(!isSafe(x)||x>0xffffffff)fail('index/budget does not fit Uint32');return x;}
export class FrozenLinkAseti {
 #atoms;#left;#right;#sizes;#byteSizes;#roots;#lengths;#docs;
 constructor(wire,{maxLinks=MAX_LINKS}={}){
  if(!Buffer.isBuffer(wire))fail('Buffer W15F1 required');
  if(wire.length>MAX_WIRE||!wire.subarray(0,MAGIC.length).equals(MAGIC)||wire[MAGIC.length]!==3)
   fail('canonical W15F1 progressive required');
  const state={pos:MAGIC.length+1};
  const a=readU(wire,state);
  if(a>0x110001)fail('too many atoms');
  const atomValues=new Uint32Array(a),seen=new Set();
  for(let i=0;i<a;i++){
   const cp=readU(wire,state);
   if(cp>0x110000||cp>=0xd800&&cp<=0xdfff||seen.has(cp))fail('invalid/duplicate Unicode atom');
   seen.add(cp);atomValues[i]=cp;
  }
  const k=readU(wire,state),n=a+k,d=readU(wire,state);
  if(!n||n>maxLinks||n>MAX_LINKS||!d||d>1000)fail('invalid Link/document budget');
  const left=new Uint32Array(k),right=new Uint32Array(k);
  const scalarSizes=new Uint32Array(n),byteSizes=new Uint32Array(n);
  for(let i=0;i<a;i++){
   const cp=atomValues[i];scalarSizes[i]=cp===0x110000?0:1;
   byteSizes[i]=cp===0x110000?0:cp<128?1:cp<2048?2:cp<65536?3:4;
  }
  let r=new Bits(wire,state.pos);
  for(let i=0;i<k;i++){
   const width=Math.max(1,Math.ceil(Math.log2(Math.max(1,a+i))));
   const u=r.read(width),v=r.read(width);
   if(u>=a+i||v>=a+i)fail('forward Link pole');
   left[i]=u;right[i]=v;
   const scalars=scalarSizes[u]+scalarSizes[v],bytes=byteSizes[u]+byteSizes[v];
   if(scalars>MAX_SCALARS||bytes>MAX_SCALARS*4)fail('subtree expansion budget');
   scalarSizes[a+i]=uint32(scalars);byteSizes[a+i]=uint32(bytes);
  }
  state.pos=r.finish();r=new Bits(wire,state.pos);
  const rootBits=Math.max(1,Math.ceil(Math.log2(Math.max(1,n))));
  const roots=new Uint32Array(d);
  for(let i=0;i<d;i++)roots[i]=r.read(rootBits);
  state.pos=r.finish();
  const lengths=[];
  for(let i=0;i<d;i++){
   const bytes=readU(wire,state),scalars=readU(wire,state),id=roots[i];
   if(id>=n||scalarSizes[id]!==scalars||byteSizes[id]!==bytes)fail('root length/pole mismatch');
   lengths.push(Object.freeze({bytes,scalars}));
  }
  if(state.pos!==wire.length)fail('trailing bytes');
  this.#atoms=atomValues;this.#left=left;this.#right=right;this.#sizes=scalarSizes;
  this.#byteSizes=byteSizes;this.#roots=roots;this.#lengths=Object.freeze(lengths);
  this.#docs=null;
  this.nodeCount=n;this.pairCount=k;this.atomCount=a;this.documentCount=d;
  this.wireSha256=sha(wire);
  Object.freeze(this);
 }
 static fromWire(wire,options){return new FrozenLinkAseti(wire,options);}
 /** Archive is ZIP_STORED(manifest.json, XZ(W15F1)). Decompression is deliberately
  * a required explicit host capability until a portable XZ decoder is bundled.
  * The caller may additionally supply the independently pinned whole ZIP SHA. */
 static fromArchive(archive,{decompressXZ,expectedArchiveSHA256,verifyDocuments=true}={}){
  if(typeof decompressXZ!=='function')fail('XZ decompressor capability required, no hidden OS/SQLite/Python fallback');
  const buf=Buffer.isBuffer(archive)?archive:readFileSync(archive);
  if(expectedArchiveSHA256&&sha(buf)!==expectedArchiveSHA256)fail('archive digest differs from external pin');
  const members=readZipStored(buf);
  const manifestBytes=members.get('manifest.json');
  if(manifestBytes.length>2_000_000)fail('oversized document manifest');
  const meta=JSON.parse(manifestBytes.toString('utf8'));
  if(meta.schema!=='mts-nl/archived-link-aseti/v1'||meta.serialization!=='W15F1-progressive'||meta.payload!=='links.w15f1.xz')fail('archive identity');
  if(!isSafe(meta.wireBytes)||meta.wireBytes>MAX_WIRE||meta.wireBytes===0)fail('wire size budget');
  const compressed=members.get('links.w15f1.xz');
  if(compressed.length!==meta.payloadBytes||sha(compressed)!==meta.payloadSha256)fail('compressed payload SHA/size mismatch');
  const wire=decompressXZ(compressed,meta.wireBytes);
  if(!Buffer.isBuffer(wire)||wire.length!==meta.wireBytes||sha(wire)!==meta.wireSha256)fail('decompressed stream SHA/size mismatch');
  const graph=new FrozenLinkAseti(wire);
  if(meta.nodeCount!==graph.nodeCount||meta.documentCount!==graph.documentCount||!Array.isArray(meta.documents)||meta.documents.length!==graph.documentCount)fail('manifest count mismatch');
  const docs=meta.documents.map((doc,i)=>{
   if(!doc||doc.bytes!==graph.#lengths[i].bytes||doc.scalars!==graph.#lengths[i].scalars||typeof doc.sha256!=='string'||!/^[a-f0-9]{64}$/.test(doc.sha256))fail('manifest document metadata');
   return Object.freeze({...doc});
  });
  graph.#docs=Object.freeze(docs);
  if(verifyDocuments)graph.verifyDocumentDigests();
  return graph;
 }
 get documents(){return this.#docs??this.#lengths;}
 get roots(){return [...this.#roots];}
 link(id){
  if(!Number.isInteger(id)||id<0||id>=this.nodeCount)throw new RangeError('unknown Link');
  if(id<this.atomCount){const cp=this.#atoms[id];return {index:id,kind:'atom',scalar:cp,text:cp===0x110000?'':String.fromCodePoint(cp),scalars:this.#sizes[id]};}
  const i=id-this.atomCount;return {index:id,kind:'pair',from:this.#left[i],to:this.#right[i],scalars:this.#sizes[id]};
 }
 *scalars(doc,start=0,stop){
  if(!Number.isInteger(doc)||doc<0||doc>=this.documentCount)throw new RangeError('unknown document');
  const n=this.#lengths[doc].scalars;stop??=n;
  if(!Number.isInteger(start)||!Number.isInteger(stop)||start<0||stop<start||stop>n)throw new RangeError('scalar range');
  const stack=[[this.#roots[doc],0]];
  while(stack.length){
   const [id,offset]=stack.pop();
   if(offset>=stop||offset+this.#sizes[id]<=start)continue;
   if(id<this.atomCount){if(this.#sizes[id])yield String.fromCodePoint(this.#atoms[id]);}
   else{const k=id-this.atomCount,u=this.#left[k],v=this.#right[k];stack.push([v,offset+this.#sizes[u]]);stack.push([u,offset]);}
  }
 }
 slice(doc,start=0,stop){return [...this.scalars(doc,start,stop)].join('');}
 find(doc,pattern,{maxHits=100}={}){
  if(typeof pattern!=='string'||![...pattern].length||[...pattern].length>4096||!Number.isInteger(maxHits)||maxHits<1||maxHits>10000)fail('search pattern/hit budget');
  const cp=[...pattern],pi=new Array(cp.length).fill(0);let j=0;
  for(let i=1;i<cp.length;i++){
   while(j&&cp[i]!==cp[j])j=pi[j-1];
   if(cp[i]===cp[j])j++;
   pi[i]=j;
  }
  const hits=[];let offset=0;j=0;
  for(const char of this.scalars(doc)){
   while(j&&char!==cp[j])j=pi[j-1];
   if(char===cp[j])j++;
   if(j===cp.length){hits.push(offset-cp.length+1);if(hits.length>=maxHits)break;j=pi[j-1];}
   offset++;
  }
  return hits;
 }
 digest(doc){
  const h=createHash('sha256');let batch=[],byteLength=0;
  for(const char of this.scalars(doc)){
   batch.push(char);if(batch.length>=4096){const b=Buffer.from(batch.join(''),'utf8');h.update(b);byteLength+=b.length;batch=[];}
  }
  if(batch.length){const b=Buffer.from(batch.join(''),'utf8');h.update(b);byteLength+=b.length;}
  if(byteLength!==this.#lengths[doc].bytes)fail('root UTF8 length mismatch during replay');
  return h.digest('hex');
 }
 verifyDocumentDigests(){
  if(!this.#docs)fail('not loaded from W17 archive with source hashes');
  for(let i=0;i<this.documentCount;i++)if(this.digest(i)!==this.#docs[i].sha256)fail('document SHA mismatch at '+i);
  return {verified:this.documentCount,wireSha256:this.wireSha256};
 }
}
function readZipStored(data){
 if(!Buffer.isBuffer(data)||data.length<22)fail('invalid ZIP');
 let eocd=-1;const min=Math.max(0,data.length-65557);
 for(let i=data.length-22;i>=min;i--)if(data.readUInt32LE(i)===0x06054b50&&i+22+data.readUInt16LE(i+20)===data.length){eocd=i;break;}
 if(eocd<0||data.readUInt16LE(eocd+4)!==0||data.readUInt16LE(eocd+6)!==0)fail('ZIP end records/disks');
 const count=data.readUInt16LE(eocd+10),total=data.readUInt16LE(eocd+8);
 if(count!==2||total!==2)fail('exactly two members required');
 let offset=data.readUInt32LE(eocd+16);const size=data.readUInt32LE(eocd+12);
 if(offset+size!==eocd)fail('ZIP central directory range');
 const result=new Map();
 for(let i=0;i<count;i++){
  if(offset+46>eocd||data.readUInt32LE(offset)!==0x02014b50)fail('ZIP central record');
  const flags=data.readUInt16LE(offset+8),method=data.readUInt16LE(offset+10),length=data.readUInt32LE(offset+24),packed=data.readUInt32LE(offset+20);
  const nameLength=data.readUInt16LE(offset+28),extra=data.readUInt16LE(offset+30),comment=data.readUInt16LE(offset+32),local=data.readUInt32LE(offset+42);
  const name=data.subarray(offset+46,offset+46+nameLength).toString('utf8');
  if(flags!==0||method!==0||length!==packed||result.has(name)||!['manifest.json','links.w15f1.xz'].includes(name)||nameLength>256||length>MAX_WIRE*2||extra||comment)fail('ZIP member type/size/name');
  if(local+30>data.length||data.readUInt32LE(local)!==0x04034b50||data.readUInt16LE(local+6)!==0||data.readUInt16LE(local+8)!==0)fail('ZIP local header');
  const n=data.readUInt16LE(local+26),ex=data.readUInt16LE(local+28);
  if(data.subarray(local+30,local+30+n).toString('utf8')!==name||ex!==0)fail('ZIP local member mismatch');
  const start=local+30+n,stop=start+length;
  if(stop>data.length||stop>data.readUInt32LE(eocd+16)||length!==data.readUInt32LE(local+22))fail('ZIP member bounds');
  result.set(name,data.subarray(start,stop));
  offset+=46+nameLength+extra+comment;
 }
 if(offset!==eocd||!result.has('manifest.json')||!result.has('links.w15f1.xz'))fail('ZIP member integrity');
 return result;
}