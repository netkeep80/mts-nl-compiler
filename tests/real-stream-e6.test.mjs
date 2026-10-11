import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {analyzeRealStream} from "../src/real-stream-e6.mjs";
const manifest=JSON.parse(readFileSync(new URL("../corpus/real-sources-e0.json",import.meta.url),"utf8"));
const ids=["en-carroll-alice","ru-tolstoy-two-wars","en-mdn-js-grammar"];
const blob=b=>createHash("sha1").update(Buffer.from("blob "+b.length+"\0")).update(b).digest("hex");
async function getPinned(meta){
 const relative=meta.path.replace(/^\.sources\/[^/]+\//,"");
 if(relative===meta.path)throw Error("invalid corpus relative path");
 const url="https://raw.githubusercontent.com/"+meta.repo+"/"+
  meta.gitCommit+"/"+relative.split("/").map(encodeURIComponent).join("/");
 let resp;
 for(let attempt=0;attempt<2;attempt++){
  try{
   resp=await fetch(url,{signal:AbortSignal.timeout(30000)});
   if(!resp.ok)throw Error("HTTP "+resp.status);
   break;
  }catch(e){
   if(attempt===1)throw Error("Cannot fetch pinned "+meta.id+": "+e.message);
  }
 }
 const b=Buffer.from(await resp.arrayBuffer());
 if(b.length!==meta.expectedBytes||blob(b)!==meta.blobSha1)
  throw Error("Git blob SHA1/size drift "+meta.id);
 return b;
}
test("E6 local scalar stream and complete current/retained source-Link costs",()=>{
 const input=Buffer.from("ab".repeat(70)+"cd".repeat(50)+"мама".repeat(30)+"🚀".repeat(12));
 const r=analyzeRealStream(input,{
  id:"local",bootstrap:64,starts:[0,16,32],watchLength:16,stride:32
 });
 assert.equal(r.status,"E6_REAL_SOURCE_INCREMENTAL_INDEX_PASS");
 assert.equal(r.newAdjacentPositionsInspected,r.codepoints-r.bootstrap);
 assert.ok(r.selectedDuplets>0);
 assert.ok(r.retainedDuplets>=r.selectedDuplets);
 assert.ok(r.fullScanOracleChecks>=3);
});
test("E6 full real book + two full articles pinned by exact Git blob",{
 timeout:240000
},async()=>{
 const records=[];
 for(const id of ids){
  const meta=manifest.sources.find(x=>x.id===id);
  assert.ok(meta,"missing pinned original "+id);
  const raw=await getPinned(meta);
  const r=analyzeRealStream(raw,{id:meta.id});
  assert.equal(r.inputBytes,meta.expectedBytes);
  assert.equal(r.newAdjacentPositionsInspected,r.codepoints-r.bootstrap);
  assert.ok(r.fullScanOracleChecks>0);
  assert.ok(r.retainedDuplets>=r.selectedDuplets);
  records.push({...r,kind:meta.kind,language:meta.language});
  console.log("E6_REAL_DOCUMENT "+JSON.stringify({
   upstream:{id,commit:meta.gitCommit,gitBlob:meta.blobSha1},
   metrics:r
  }));
 }
 assert.equal(records.length,3);
 assert.ok(records.some(x=>x.kind==="book"));
 assert.ok(records.some(x=>x.language==="ru"));
 assert.ok(records.some(x=>x.kind==="technical-article"));
 console.log("E6_REAL_CORPUS_SUMMARY "+JSON.stringify({
  sources:records.length,sourceBytes:records.reduce((a,x)=>a+x.inputBytes,0),
  codepoints:records.reduce((a,x)=>a+x.codepoints,0),
  appendedCodepoints:records.reduce((a,x)=>a+x.appended,0),
  newAdjacentPositionsInspected:records.reduce((a,x)=>a+x.newAdjacentPositionsInspected,0),
  leaderChanges:records.reduce((a,x)=>a+x.leaderChanges,0),
  oldRootsChanged:records.reduce((a,x)=>a+x.oldRootsChanged,0),
  lateOldRootsChanged:records.reduce((a,x)=>a+x.lateOldRootsChanged,0),
  sumPerDocumentSelectedDuplets:records.reduce((a,x)=>a+x.selectedDuplets,0),
  sumPerDocumentRetainedDuplets:records.reduce((a,x)=>a+x.retainedDuplets,0),
  limitation:"sum of independent per-document graphs; no corpus-wide Link dedup"
 }));
});
test("E6 rejects invalid bytes/length/range without silent fallback",()=>{
 assert.throws(()=>analyzeRealStream(Buffer.from([0xff]),{id:"bad"}),/invalid UTF-8/);
 assert.throws(()=>analyzeRealStream(Buffer.from("small"),{id:"small"}),/shorter/);
 assert.throws(()=>analyzeRealStream(Buffer.from("abcdefghijklmnop"),{
  id:"bad",bootstrap:8,starts:[0,10],watchLength:5
 }),/invalid watch span/);
});
