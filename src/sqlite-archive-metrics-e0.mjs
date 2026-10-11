// One-table E0 transient distribution benchmark; does not publish external full texts.
// Computes delivery sizes from actual SQLite bytes (not from page count/JSON).
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {gzipSync,zstdCompressSync,zstdDecompressSync} from "node:zlib";
const sha=b=>createHash("sha256").update(b).digest("hex");
const quoted=s=>"'"+s.replaceAll("'","''")+"'";

export function measureTransientSqliteArchive(db,{expectedRows}={}) {
 assert.ok(Number.isSafeInteger(expectedRows)&&expectedRows>=0,"invalid expectedRows");
 const dir=mkdtempSync(join(tmpdir(),"mnc-e0-archive-"));
 const sqlitePath=join(dir,"knowledge.sqlite"),unpacked=join(dir,"recovered.sqlite");
 let reader;
 try{
  db.exec("VACUUM INTO "+quoted(sqlitePath));
  const raw=readFileSync(sqlitePath);
  const gzip=gzipSync(raw,{level:6});
  const zstd=zstdCompressSync(raw);
  const restored=zstdDecompressSync(zstd);
  assert.ok(restored.equals(raw),"SQLite Zstandard roundtrip failed");
  writeFileSync(unpacked,restored,{flag:"wx"});
  reader=new DatabaseSync(unpacked,{readOnly:true});
  assert.equal(reader.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  assert.equal(reader.prepare("SELECT COUNT(*) AS total FROM links").get().total,expectedRows);
  assert.throws(()=>reader.exec("UPDATE links SET weight=weight"),/read.only|readonly/i);
  return {status:"E0_SQLITE_ZSTD_COLD_REPLAY_PASS",graphRows:expectedRows,
   sqliteVacuumBytes:raw.length,sqliteSha256:sha(raw),
   gzipArchiveBytes:gzip.length,zstdArchiveBytes:zstd.length,
   zstdSha256:sha(zstd),restoredSha256:sha(restored),reopenedReadOnly:true,
   scientificLimit:"transient physical snapshot; not native Γ or cross-toolchain deterministic build"};
 } finally {
  if(reader)reader.close();
  rmSync(dir,{recursive:true,force:true});
 }
}
