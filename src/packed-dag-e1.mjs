// E1: deterministic, lossless binary serialization of P0's selected DAG.
// This is a *restricted acyclic, canonical-by-poles* transport, NOT a full
// native MTS Link graph: arbitrary parallel identities/cycles/weights require
// a different identity-preserving schema. No probabilistic/semantic claims.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
const MAGIC=Buffer.from("ANETDAG1","ascii"),decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
const sha=x=>createHash("sha256").update(x).digest("hex");
const fail=s=>{throw Error("E1 packed DAG: "+s);};
const isHash=s=>typeof s==="string"&&/^[0-9a-f]{64}$/.test(s);
function putUint(chunks,n){
 if(!Number.isSafeInteger(n)||n<0)fail("invalid unsigned integer");
 const bytes=[];
 do{let b=n%128;n=Math.floor(n/128);bytes.push(n?b|128:b);}while(n);
 chunks.push(Buffer.from(bytes));
}
function putText(chunks,s){
 if(typeof s!=="string")fail("expected UTF-8 text");
 const b=Buffer.from(s,"utf8");
 if(decoder.decode(b)!==s)fail("invalid Unicode scalar text");
 putUint(chunks,b.length);chunks.push(b);
}
function reader(input){
 if(!Buffer.isBuffer(input))fail("expected Buffer");
 let offset=0;
 function bytes(count){
  if(!Number.isSafeInteger(count)||count<0||count>input.length-offset)
   fail("truncated payload");
  const out=input.subarray(offset,offset+count);offset+=count;return out;
 }
 function uint(){
  let n=0n,bytesRead=0,last;
  while(true){
   if(bytesRead>=10)fail("oversized varint");
   last=bytes(1)[0];bytesRead++;
   n|=BigInt(last&127)<<BigInt(7*(bytesRead-1));
   if(!(last&128))break;
  }
  if(bytesRead>1&&last===0)fail("noncanonical varint");
  if(n>BigInt(Number.MAX_SAFE_INTEGER))fail("integer overflow");
  return Number(n);
 }
 function text(maxBytes=1048576){
  const n=uint();if(n>maxBytes)fail("text resource limit");
  const b=bytes(n);let s;
  try{s=decoder.decode(b);}catch{fail("invalid UTF-8");}
  if(!Buffer.from(s,"utf8").equals(b))fail("noncanonical UTF-8");
  return s;
 }
 return {uint,text,bytes,get offset(){return offset;},
  get done(){return offset===input.length;}};
}
function validateRows(rows){
 if(!Array.isArray(rows))fail("rows must be array");
 const byId=new Map();
 for(const row of rows){
  if(typeof row?.link_id!=="string"||byId.has(row.link_id))fail("duplicate/invalid ID");
  if(row.weight!==null)fail("weight not represented in restricted E1");
  if(row.from_id===null) {
   if(row.to_id!==null||typeof row.string!=="string")fail("invalid atom");
   if(row.link_id!=="a:"+sha(JSON.stringify(row.string)))fail("noncanonical atom ID");
   putText([],row.string); // strict scalar roundtrip
  } else{
   if(typeof row.from_id!=="string"||typeof row.to_id!=="string"||row.string!==null)
    fail("invalid pair");
   if(row.link_id!=="p:"+sha(JSON.stringify([row.from_id,row.to_id])))
    fail("noncanonical pair ID");
  }
  byId.set(row.link_id,row);
 }
 for(const row of rows)
  if(row.from_id!==null&&(!byId.has(row.from_id)||!byId.has(row.to_id)))
   fail("unresolved endpoint");
 return byId;
}
export function encodePackedGraph(rows,documents){
 const byId=validateRows(rows);
 if(!Array.isArray(documents)||documents.length<1||documents.length>1000)
  fail("invalid document list");
 const seenDoc=new Set();
 const docs=[...documents].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 for(const d of docs){
  if(typeof d.id!=="string"||!d.id||seenDoc.has(d.id)||!isHash(d.inputSha256)||
     !byId.has(d.rootLink))fail("invalid document");
  seenDoc.add(d.id);
 }
 const state=new Map(),ordered=[];
 for(const d of docs){
  const stack=[[d.rootLink,false]];
  while(stack.length){
   const [id,done]=stack.pop(),row=byId.get(id);
   if(!row)fail("unresolved root/child");
   const stage=state.get(id)??0;
   if(done){if(stage===1){state.set(id,2);ordered.push(id);}continue;}
   if(stage===2)continue;
   if(stage===1)fail("cycle in selected E1 DAG");
   state.set(id,1);
   stack.push([id,true]);
   if(row.from_id!==null){
    // Add right first, then left: stable left-first traversal
    stack.push([row.to_id,false],[row.from_id,false]);
   }
  }
 }
 if(ordered.length!==rows.length)fail("orphan/unselected rows in input graph");
 const chunks=[MAGIC],numbers=new Map();
 putUint(chunks,ordered.length);
 for(const id of ordered){
  const row=byId.get(id),position=numbers.size+1;
  if(row.from_id===null){
   chunks.push(Buffer.from([0]));putText(chunks,row.string);
  }else{
   const l=numbers.get(row.from_id),r=numbers.get(row.to_id);
   if(!l||!r||l>=position||r>=position)fail("non-topological selected pair");
   chunks.push(Buffer.from([1]));putUint(chunks,l);putUint(chunks,r);
  }
  numbers.set(id,position);
 }
 putUint(chunks,docs.length);
 for(const d of docs){
  putText(chunks,d.id);putUint(chunks,numbers.get(d.rootLink));
  chunks.push(Buffer.from(d.inputSha256,"hex"));
 }
 return Buffer.concat(chunks);
}
export function decodePackedGraph(input,{maxNodes=1000000,maxAtomBytes=4194304,maxDocuments=1000,
  maxDecodedDocumentBytes=64000000}={}){
 const rd=reader(input);
 if(!rd.bytes(MAGIC.length).equals(MAGIC))fail("bad magic/version");
 const count=rd.uint();
 if(count>maxNodes)fail("RESOURCE_LIMIT node count");
 const nodes=[null],ids=[null],rows=[],found=new Set();
 for(let i=1;i<=count;i++){
  const tag=rd.bytes(1)[0];let id,row;
  if(tag===0){
   const str=rd.text(maxAtomBytes);
   id="a:"+sha(JSON.stringify(str));
   row={link_id:id,from_id:null,to_id:null,string:str,weight:null};
   nodes.push({string:str});
  }else if(tag===1){
   const left=rd.uint(),right=rd.uint();
   if(left<1||right<1||left>=i||right>=i)fail("forward/invalid pair reference");
   id="p:"+sha(JSON.stringify([ids[left],ids[right]]));
   row={link_id:id,from_id:ids[left],to_id:ids[right],string:null,weight:null};
   nodes.push({left,right});
  }else fail("unknown record type");
  if(found.has(id))fail("duplicate structure in canonical DAG");
  found.add(id);ids.push(id);rows.push(row);
 }
 const docCount=rd.uint();
 if(docCount>maxDocuments)fail("RESOURCE_LIMIT document count");
 const documents=[],docNames=new Set();
 for(let i=0;i<docCount;i++){
  const id=rd.text();
  if(!id||docNames.has(id))fail("duplicate document ID");
  docNames.add(id);
  const root=rd.uint();
  if(root<1||root>count)fail("missing document root");
  const digest=rd.bytes(32).toString("hex");
  const chunks=[],stack=[root];let countBytes=0,visited=0;
  while(stack.length){
   if(++visited>maxNodes*16+maxDecodedDocumentBytes)fail("RESOURCE_LIMIT expansion");
   const next=nodes[stack.pop()];
   if(next.string!==undefined){
    const buf=Buffer.from(next.string,"utf8");countBytes+=buf.length;
    if(countBytes>maxDecodedDocumentBytes)fail("RESOURCE_LIMIT expanded bytes");
    chunks.push(buf);
   }else stack.push(next.right,next.left);
  }
  const raw=Buffer.concat(chunks);
  if(sha(raw)!==digest)fail("document content SHA mismatch");
  documents.push({id,rootLink:ids[root],inputSha256:digest,bytes:raw});
 }
 if(!rd.done)fail("trailing bytes");
 // Invertibility: reconstructed rows have exact canonical P0 Link identities.
 return {rows,documents};
}
