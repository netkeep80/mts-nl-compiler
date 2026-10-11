// E0 real-text benchmark. Existing P0 Unicode DAG, not an NL semantic compiler.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {codePoints,makeTree,encodeShared,decodeShared} from "./dag.mjs";
import {validateClosure,counterMismatches} from "./store.mjs";
import {migrateLegacyLinks,decodeNumericSource} from "./numeric-legacy-bridge-v1.mjs";

const sha=x=>createHash("sha256").update(x).digest("hex");
const ms=t=>Number(process.hrtime.bigint()-t)/1e6;
const decoder=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true});
const encoder=new TextEncoder();

export function compileTextExact(raw,{id="untitled",maxCodePoints=350000}={}) {
 assert.ok(Buffer.isBuffer(raw),"raw must be exact source bytes");
 const source=decoder.decode(raw);
 assert.ok(Buffer.from(encoder.encode(source)).equals(raw),"UTF-8 bytes changed on decode/encode");
 const points=codePoints(source);
 if(points.length>maxCodePoints)throw new Error("RESOURCE_LIMIT source codepoints "+points.length);
 const start=process.hrtime.bigint();
 const graph=encodeShared(makeTree(points,"balanced"));
 const compiledMs=ms(start);
 const readStart=process.hrtime.bigint();
 const result=decodeShared(graph);
 const decodeMs=ms(readStart);
 assert.equal(result,source,"DAG is not a lossless rendering of raw source");
 assert.ok(Buffer.from(encoder.encode(result)).equals(raw),"restored bytes differ from raw input");
 const atomRows=[...graph.atoms].map(([link_id,string])=>({
   link_id,from_id:null,to_id:null,string,weight:null
 }));
 const pairRows=[...graph.links].map(([link_id,r])=>({
   link_id,from_id:r.from_id,to_id:r.to_id,string:null,weight:null
 }));
 const nodeJsonBytes=Buffer.byteLength(JSON.stringify({root:graph.root,atoms:atomRows,pairs:pairRows}),"utf8");
 return {graph,rows:[...atomRows,...pairRows],source,
  metrics:{id,status:"EXACT_STRUCTURAL_ROUNDTRIP_PASS",
   inputSha256:sha(raw),inputBytes:raw.length,codePoints:points.length,
   rootLink:graph.root,distinctAtoms:graph.atoms.size,distinctPairs:graph.links.size,
   expandedPairOccurrences:Math.max(0,points.length-1),
   canonicalJsonBytes:nodeJsonBytes,gzipInputBytes:gzipSync(raw,{level:6}).length,
   compileMs:+compiledMs.toFixed(2),decodeMs:+decodeMs.toFixed(2),
   peakObservedRssBytes:process.memoryUsage().rss}};
}

export function unionCompiledGraphs(compiled) {
 const registry=new Map();
 for(const c of compiled)for(const row of c.rows){
  const prior=registry.get(row.link_id);
  if(prior)assert.deepEqual(prior,row,"hash-consing ID collision");
  else registry.set(row.link_id,row);
 }
 return [...registry.values()].sort((a,b)=>a.link_id<b.link_id?-1:a.link_id>b.link_id?1:0);
}

export function sqliteReplay(db,rows,compiled) {
 const timer=process.hrtime.bigint();
 // Existing textual IDs belong to the historical E0 structural oracle;
 // the physical database receives ONLY AUTOINCREMENT signed 64-bit Link IDs.
 const migrated=migrateLegacyLinks(db,rows);
 validateClosure(db);
 assert.deepEqual(counterMismatches(db),[]);
 const totals=db.prepare("SELECT COUNT(*) total, SUM(from_uses) from_positions, SUM(to_uses) to_positions FROM links").get();
 const pairCount=rows.filter(r=>r.from_id!==null).length;
 assert.equal(totals.total,rows.length);
 assert.equal(totals.from_positions??0,pairCount);
 assert.equal(totals.to_positions??0,pairCount);
 const restoredAtoms=new Map(),restoredPairs=new Map();
 for(const r of migrated.restored){
  assert.equal(r.weight,null);
  if(r.from_id===null)restoredAtoms.set(r.link_id,r.string);
  else restoredPairs.set(r.link_id,{from_id:r.from_id,to_id:r.to_id});
 }
 for(const c of compiled){
  const legacyOracle=decodeShared({root:c.graph.root,atoms:restoredAtoms,links:restoredPairs});
  assert.equal(legacyOracle,c.source,c.metrics.id);
  const numericRoot=migrated.idMap.get(c.graph.root);
  assert.equal(typeof numericRoot,'bigint');
  const numericOracle=decodeNumericSource(db,numericRoot,{maxCodePoints:Math.max(1,[...c.source].length)});
  assert.equal(numericOracle,c.source,c.metrics.id+' numeric SQLite replay');
  assert.equal(sha(Buffer.from(numericOracle,'utf8')),c.metrics.inputSha256);
 }
 return {status:"SQLITE_ONE_TABLE_EXACT_REPLAY_PASS",
  rows:rows.length,atomRows:restoredAtoms.size,pairRows:restoredPairs.size,
  totalFromUses:totals.from_positions??0,totalToUses:totals.to_positions??0,
  sqliteLoadIndexAndReplayMs:+ms(timer).toFixed(2),
  sqliteLogicalPages:db.prepare("PRAGMA page_count").get().page_count,
  sqlitePageSize:db.prepare("PRAGMA page_size").get().page_size,
  sqliteLogicalBytes:db.prepare("PRAGMA page_count").get().page_count*db.prepare("PRAGMA page_size").get().page_size,
  peakObservedRssBytes:process.memoryUsage().rss,
  physicalIdType:"signed-int64-autoincrement"};
}
