// W17B0 research alternative: ZIP(Brotli6(W15F1), manifest) with NO external
// decompressor, Python, SQLite, or source texts. NOT the accepted W17 XZ format.
import {brotliCompressSync,constants} from 'node:zlib';
import {createHash} from 'node:crypto';
import {FrozenLinkAseti} from './w17-native-link-runtime-v0.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const fail=s=>{throw new Error('W17_BROTLI_EXPERIMENT: '+s);};
const budget=100_000_000;
function crc32(data){
 let crc=0xffffffff;
 for(const byte of data){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 return (crc^0xffffffff)>>>0;
}
function zipStored(entries){
 const local=[],central=[];let offset=0;
 for(const [name,value] of entries){
  const label=Buffer.from(name,'ascii'),crc=crc32(value);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);
  h.writeUInt32LE(crc,14);h.writeUInt32LE(value.length,18);h.writeUInt32LE(value.length,22);h.writeUInt16LE(label.length,26);
  local.push(h,label,value);
  const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50,0);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);
  dir.writeUInt32LE(crc,16);dir.writeUInt32LE(value.length,20);dir.writeUInt32LE(value.length,24);
  dir.writeUInt16LE(label.length,28);dir.writeUInt32LE(offset,42);
  central.push(dir,label);offset+=h.length+label.length+value.length;
 }
 const c=Buffer.concat(central),last=Buffer.alloc(22);last.writeUInt32LE(0x06054b50,0);
 last.writeUInt16LE(entries.length,8);last.writeUInt16LE(entries.length,10);
 last.writeUInt32LE(c.length,12);last.writeUInt32LE(offset,16);
 return Buffer.concat([...local,c,last]);
}
/** Build an OPTIONAL research-only portable package. Exact trusted source hashes
 * must be passed by the caller for provenance; a self-report is not authority. */
export function packBrotliExperiment(wire,{sourceDocuments=null,archiveBudgetBytes=budget,runtimeReserveBytes=10_000_000}={}){
 if(!Buffer.isBuffer(wire)||wire.length>64_000_000||!Number.isSafeInteger(archiveBudgetBytes)||archiveBudgetBytes>budget||archiveBudgetBytes<=runtimeReserveBytes)fail('wire/archive budget');
 const graph=FrozenLinkAseti.fromWire(wire);
 if(sourceDocuments!==null&&(!Array.isArray(sourceDocuments)||sourceDocuments.length!==graph.documentCount))fail('source witness count mismatch');
 const docs=[];
 for(let i=0;i<graph.documentCount;i++){
  const data=graph.documents[i],hash=graph.digest(i),source=sourceDocuments?.[i];
  if(source && (hash!==source.sha256||data.bytes!==source.bytes||data.scalars!==source.scalars))fail('source witness SHA/length mismatch '+i);
  docs.push({index:i,id:source?.id??`document-${i}`,bytes:data.bytes,scalars:data.scalars,sha256:hash});
 }
 const payload=brotliCompressSync(wire,{params:{
  [constants.BROTLI_PARAM_QUALITY]:6,[constants.BROTLI_PARAM_LGWIN]:22}});
 const manifest={schema:'mts-nl/archived-link-aseti/brotli-experiment/v0',payload:'links.w15f1.br',
  archiveCodec:'brotli-6',serialization:'W15F1-progressive',payloadBytes:payload.length,
  payloadSha256:sha(payload),wireBytes:wire.length,wireSha256:sha(wire),
  nodeCount:graph.nodeCount,documentCount:graph.documentCount,
  documents:docs,sourceBytes:docs.reduce((sum,d)=>sum+d.bytes,0),
  distribution:'RESEARCH_ONLY_UNTIL_PER_WORK_LICENSE_CLEARANCE',releaseApproved:false,
  warning:'Experimental Node-native transport; NOT the canonical W17 XZ release format.'};
 const manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n','utf8');
 const archive=zipStored([['manifest.json',manifestBytes],['links.w15f1.br',payload]]);
 if(archive.length+runtimeReserveBytes>archiveBudgetBytes)fail('archive + reserved runtime exceeds budget');
 return {archive,manifest,sha256:sha(archive),bytes:archive.length};
}