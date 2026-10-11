import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {compileTextExact,unionCompiledGraphs,sqliteReplay} from "../src/real-corpus-e0.mjs";
import {measureTransientSqliteArchive} from "../src/sqlite-archive-metrics-e0.mjs";

test("SQLite snapshot zstd delivery size, read-only cold replay and repeatability (#45/#46)",()=>{
 const docs=["мама мама","∀x→x","A\\r\\n🧪"]
  .map((v,i)=>compileTextExact(Buffer.from(v),{id:"doc-"+i}));
 const rows=unionCompiledGraphs(docs);
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
  sqliteReplay(db,rows,docs);
  const first=measureTransientSqliteArchive(db,{expectedRows:rows.length});
  const second=measureTransientSqliteArchive(db,{expectedRows:rows.length});
  assert.equal(first.status,"E0_SQLITE_ZSTD_COLD_REPLAY_PASS");
  assert.equal(first.sqliteSha256,first.restoredSha256);
  assert.equal(first.sqliteSha256,second.sqliteSha256);
  assert.equal(first.zstdSha256,second.zstdSha256);
  assert.ok(first.zstdArchiveBytes>0&&first.zstdArchiveBytes<first.sqliteVacuumBytes);
  assert.ok(first.gzipArchiveBytes>0);
  assert.throws(()=>measureTransientSqliteArchive(db,{expectedRows:rows.length+1}));
 }finally{db.close();}
});
