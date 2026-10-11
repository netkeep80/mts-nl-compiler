// E7 real-corpus integration: full exact-pinned article, no workflow changes
// and no redistribution of external copyrighted raw source.
import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {IncrementalSourceRoot} from "../src/incremental-source-root-e7.mjs";
import {compileTextExact,sqliteReplay} from "../src/real-corpus-e0.mjs";
const sha256=b=>createHash("sha256").update(b).digest("hex");
const gitBlob=b=>createHash("sha1").update(Buffer.from("blob "+b.length+"\0")).update(b).digest("hex");
const manifest=JSON.parse(readFileSync(new URL("../corpus/real-sources-e0.json",import.meta.url),"utf8"));

async function exactPinnedSource(meta){
 const relative=meta.path.replace(/^\.sources\/[^/]+\//,"");
 assert.notEqual(relative,meta.path);
 const url="https://raw.githubusercontent.com/"+meta.repo+"/"+meta.gitCommit+"/"+
  relative.split("/").map(encodeURIComponent).join("/");
 let response;
 for(let attempt=0;attempt<2;attempt++){
  try{
   response=await fetch(url,{signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error("HTTP "+response.status);
   break;
  }catch(err){
   if(attempt===1)throw Error("E7 pinned source fetch failed: "+err.message);
  }
 }
 const bytes=Buffer.from(await response.arrayBuffer());
 assert.equal(bytes.length,meta.expectedBytes,"external bytes drift");
 assert.equal(gitBlob(bytes),meta.blobSha1,"Git object SHA drift");
 return bytes;
}

test("E7 complete exact-pinned MDN article: selected Link root, SHA and SQLite vs E0",{
 timeout:240000
},async()=>{
 const meta=manifest.sources.find(x=>x.id==="en-mdn-js-grammar");
 assert.ok(meta);
 const raw=await exactPinnedSource(meta);
 const source=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw);
 assert.ok(Buffer.from(source,"utf8").equals(raw),"UTF-8 must be exact");
 const pointArray=[...source],incremental=new IncrementalSourceRoot({
  maxCodePoints:pointArray.length,maxRows:pointArray.length*10+1
 });
 let earlier=null;
 const begin=process.hrtime.bigint();
 for(let i=0;i<pointArray.length;i++){
  const result=incremental.append(pointArray[i],{eventId:meta.id+":"+i});
  assert.equal(result.status,"APPLIED");
  if(i===1023)earlier={root:result.root,bytes:Buffer.from(pointArray.slice(0,i+1).join(""))};
 }
 const appendMs=+Number(process.hrtime.bigint()-begin).toFixed(0)/1000000;
 assert.equal(incremental.snapshot().sourceCodePoints,pointArray.length);
 assert.equal(incremental.snapshot().sourceSha256,sha256(raw));
 assert.equal(incremental.snapshot().sourceBytes,raw.length);
 assert.ok(Buffer.from(incremental.decode(),"utf8").equals(raw));
 assert.equal(incremental.decode(earlier.root),earlier.bytes.toString("utf8"));
 const selected=incremental.selectedRows();
 const physical=incremental.snapshot().totalRetainedRows;
 assert.ok(physical>=selected.length,"historical roots may increase retained graph");
 const selectedPairs=selected.filter(x=>x.from_id!==null).length;
 const e0=compileTextExact(raw,{id:meta.id});
 assert.equal(e0.source,incremental.decode());
 assert.equal(e0.metrics.inputSha256,incremental.sourceSha256);
 assert.equal(e0.metrics.codePoints,pointArray.length);
 const db=new DatabaseSync(":memory:");
 let dbReplay;
 try{
  db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
  dbReplay=sqliteReplay(db,selected,[{
   graph:{root:incremental.root},source,
   metrics:{id:meta.id,inputSha256:sha256(raw)}
  }]);
 }finally{db.close();}
 assert.equal(dbReplay.status,"SQLITE_ONE_TABLE_EXACT_REPLAY_PASS");
 assert.equal(dbReplay.pairRows,selectedPairs);
 assert.ok(incremental.snapshot().work.maxNewLinksPerAppend<=
  2*Math.ceil(Math.log2(pointArray.length+1))+2);
 const result={
  status:"E7_FULL_PINNED_REAL_SOURCE_REPLAY_PASS",
  sourceId:meta.id,upstreamCommit:meta.gitCommit,gitBlobSha1:meta.blobSha1,
  sourceBytes:raw.length,sourceCodePoints:pointArray.length,
  sourceSha256:sha256(raw),selectedRoot:incremental.root,
  selectedLinkRows:selected.length,selectedUniqueDuplets:selectedPairs,
  historicallyRetainedRows:physical,
  referenceE0BalancedRows:e0.rows.length,
  referenceE0BalancedDuplets:e0.graph.links.size,
  maxNewLinksPerAppend:incremental.snapshot().work.maxNewLinksPerAppend,
  appendMs,
  limitation:"E7 binary-carry root and E0 balanced root have different allowed topologies; no native Γ or semantic equivalence claim"
 };
 console.log("E7_REAL_CORPUS_COMPARISON "+JSON.stringify(result));
});
