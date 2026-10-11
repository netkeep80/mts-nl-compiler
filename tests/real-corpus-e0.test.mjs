import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {compileTextExact,unionCompiledGraphs,sqliteReplay}
 from "../src/real-corpus-e0.mjs";
test("E0 compiler exact UTF-8 with Cyrillic, formulae, CRLF and grapheme distinctions",()=>{
 const texts=["мама\r\nмама","χ²→Σ∈R","ё е\u0308","a\0b","🧪→🚀",""];
 const compiled=texts.map((s,i)=>compileTextExact(Buffer.from(s),{id:"case-"+i}));
 for(let i=0;i<texts.length;i++){
  assert.equal(compiled[i].source,texts[i]);
  assert.equal(compiled[i].metrics.inputBytes,Buffer.byteLength(texts[i]));
  assert.equal(compiled[i].metrics.status,"EXACT_STRUCTURAL_ROUNDTRIP_PASS");
 }
 assert.notEqual(compiled[2].graph.root,compiled[1].graph.root);
 const union=unionCompiledGraphs(compiled);
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
  assert.equal(sqliteReplay(db,union,compiled).status,"SQLITE_ONE_TABLE_EXACT_REPLAY_PASS");
 }finally{db.close();}
});
test("E0 corpus limit and invalid UTF-8 fail closed",()=>{
 assert.throws(()=>compileTextExact(Buffer.from("abcdef"),{maxCodePoints:2}),/RESOURCE_LIMIT/);
 assert.throws(()=>compileTextExact(Buffer.from([0xc3,0x28])),/encoded|valid|UTF-8/i);
});
test("E0 pinned metadata covers books and nonfiction articles with attribution",()=>{
 const m=JSON.parse(readFileSync(new URL("../corpus/real-sources-e0.json",import.meta.url),"utf8"));
 assert.equal(m.sources.length,6);
 assert.ok(m.sources.some(s=>s.kind==="book"&&s.language==="ru"));
 assert.ok(m.sources.some(s=>s.kind==="technical-article"));
 assert.ok(m.sources.some(s=>s.kind==="essay-article"));
 for(const x of m.sources){
  assert.match(x.gitCommit,/^[0-9a-f]{40}$/);
  assert.match(x.blobSha1,/^[0-9a-f]{40}$/);
  assert.ok(x.license&&x.attribution.startsWith("https://"));
  assert.ok(x.expectedBytes>0);
 }
});
