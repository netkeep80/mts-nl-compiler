import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {gzipSync} from "node:zlib";
import {measureTransientSqliteArchive} from "../src/sqlite-archive-metrics-e0.mjs";
import {encodePackedGraph,decodePackedGraph} from "../src/packed-dag-e1.mjs";
import {learnObservedPairGrammar} from "../src/observed-pair-grammar-e2.mjs";
import {compileTextExact,unionCompiledGraphs,sqliteReplay}
 from "../src/real-corpus-e0.mjs";
import {NumericCorpusLoader,coldNumericCorpusReplay} from "../src/numeric-corpus-loader-v1.mjs";
const reportSha=x=>createHash("sha256").update(x).digest("hex");
const manifest=JSON.parse(readFileSync(new URL("../corpus/real-sources-e0.json",import.meta.url),"utf8"));
if(manifest.sources.length<5)throw Error("minimum five genuine external sources");
const all=[],docs=[];
for(const meta of manifest.sources){
 const bytes=readFileSync(resolve(meta.path));
 if(bytes.length!==meta.expectedBytes)throw Error("Source byte size drift "+meta.id);
 const {metrics,...c}=compileTextExact(bytes,{id:meta.id});
 // Pin exact object content via full Git SHA1 blob identity, rather than
 // branch mutable text or title alone.
 const gitBlobHeader=Buffer.from("blob "+bytes.length+"\0","utf8");
 const sha1=createHash("sha1").update(gitBlobHeader).update(bytes).digest("hex");
 if(sha1!==meta.blobSha1)throw Error("Git blob changed "+meta.id);
 docs.push({...metrics,kind:meta.kind,language:meta.language,title:meta.title,
  sourceRepo:meta.repo,sourceCommit:meta.gitCommit,sourceBlobSha1:sha1,
  attribution:meta.attribution,license:meta.license});
 all.push({...c,metrics});
 console.log("E0_DOC "+JSON.stringify(docs.at(-1)));
}
const union=unionCompiledGraphs(all);

// Independent direct source-to-SQLite numeric loader: no structural hash IDs,
// no legacy a:/p: aliases. Per-book performance is collected on exact pinned bytes.
const directDb=new DatabaseSync(":memory:");
let numericImport;
try{
 const schemaBegin=process.hrtime.bigint();
 directDb.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
 const schemaAndIndexesMs=Number(process.hrtime.bigint()-schemaBegin)/1e6;
 const constructorBegin=process.hrtime.bigint();
 const loader=new NumericCorpusLoader(directDb);
 const cacheStartupMs=Number(process.hrtime.bigint()-constructorBegin)/1e6;
 const loaded=[],perBook=[];
 const wallBegin=process.hrtime.bigint();
 for(const meta of manifest.sources){
  const bytes=readFileSync(resolve(meta.path));
  const compiled=all.find(x=>x.metrics.id===meta.id);
  if(!compiled||!bytes.equals(Buffer.from(compiled.source,"utf8")))
   throw Error("Different input to direct numeric benchmark "+meta.id);
  const row=loader.appendBook(bytes,{id:meta.id,maxCodePoints:350000});
  loaded.push({id:meta.id,rootLinkId:row.rootLinkId,bytes});
  perBook.push(row);
  console.log("E0_NUMERIC_IMPORT_DOC "+JSON.stringify(row));
 }
 const insertionWallMs=Number(process.hrtime.bigint()-wallBegin)/1e6;
 const final=loader.finalize();
 if(Number(final.links)!==union.length)
  throw Error("Direct numeric Link count differs from E0 structural oracle");
 const cold=coldNumericCorpusReplay(directDb,loaded);
 if(cold.status!=="EXACT_NUMERIC_SQLITE_REPLAY_PASS"||
    cold.documents.length!==loaded.length)
  throw Error("Hashless numeric SQLite cold verification failed");
 const imported=perBook.reduce((n,d)=>n+d.insertedLinks,0);
 const totalInput=perBook.reduce((n,d)=>n+d.sourceBytes,0);
 const measuredInsertMs=perBook.reduce((n,d)=>n+d.compileAndSqlInsertMs+d.commitMs,0);
 const summary={
  schema:"mts-nl/numeric-corpus-import/v1",
  status:"HASHLESS_NUMERIC_SQLITE_EXACT_REPLAY_PASS",
  limits:"Benchmarks are per-run wall-clock observations, not cross-machine normalized claims",
  toolchain:{node:process.version,sqlite:directDb.prepare("SELECT sqlite_version() v").get().v,
   platform:process.platform,arch:process.arch,ci:!!process.env.CI,
   transaction:"BEGIN IMMEDIATE / COMMIT per document",
   poleIndexes:"indexed throughout load",
   reuse:"explicit exact atoms/pairs maps; nonunique Link physical schema"},
  sources:perBook.length,sourceBytes:totalInput,
  insertedLinks:imported,expectedStructuralLinks:union.length,
  reusedAtoms:perBook.reduce((n,d)=>n+d.reusedAtoms,0),
  reusedPairs:perBook.reduce((n,d)=>n+d.reusedPairs,0),
  schemaAndIndexesMs:+schemaAndIndexesMs.toFixed(3),
  cacheStartupMs:+cacheStartupMs.toFixed(3),
  documentInsertionWallMs:+insertionWallMs.toFixed(3),
  sumCompileAndSqlInsertMs:+perBook.reduce((n,d)=>n+d.compileAndSqlInsertMs,0).toFixed(3),
  sumCommitMs:+perBook.reduce((n,d)=>n+d.commitMs,0).toFixed(3),
  aggregateInsertedLinksPerSecond:+(imported/Math.max(.001,measuredInsertMs)*1000).toFixed(1),
  aggregateSourceMiBPerSecond:+(totalInput/1048576/Math.max(.001,insertionWallMs)*1000).toFixed(3),
  ...final,
  sqliteVacuumBytes:cold.sqliteVacuumBytes,
  vacuumMs:cold.vacuumMs,coldReadOnlyReplayMs:cold.coldReadOnlyReplayMs,
  coldStatus:cold.status,coldResidentLinks:cold.residentLinkRows,
  perBook
 };
 numericImport=summary;
 console.log("E0_NUMERIC_IMPORT_SUMMARY "+JSON.stringify(summary));
}finally{directDb.close();}

const sourceRefs=all.map(x=>({
 id:x.metrics.id,rootLink:x.metrics.rootLink,inputSha256:x.metrics.inputSha256
}));
const packedStart=process.hrtime.bigint();
const packedBytes=encodePackedGraph(union,sourceRefs);
const packedEncodeMs=Number(process.hrtime.bigint()-packedStart)/1e6;
const decoded=decodePackedGraph(packedBytes);
const packedRoundtrip=encodePackedGraph(decoded.rows,decoded.documents);
if(!packedRoundtrip.equals(packedBytes))throw Error("packed byte determinism FAIL");
if(decoded.documents.length!==all.length)throw Error("packed document count mismatch");
for(const item of decoded.documents){
 const original=all.find(x=>x.metrics.id===item.id);
 if(!original||!item.bytes.equals(Buffer.from(original.source,"utf8")))
  throw Error("packed exact document recovery FAIL: "+item.id);
}
if(decoded.rows.length!==union.length)throw Error("packed graph row count mismatch");
const packedE1={
 status:"E1_COMPACT_BINARY_GRAPH_EXACT_ROUNDTRIP_PASS",
 binaryBytes:packedBytes.length,
 binaryGzipBytes:gzipSync(packedBytes,{level:6}).length,
 encodeMs:+packedEncodeMs.toFixed(2),
 graphRows:decoded.rows.length,
 documentCount:decoded.documents.length,
 includesAllDictionaryAndRoots:true,
 semantics:"acyclic unique-pole E0 graph; no general MTS transport parity"
};
console.log("E1_COMPACT "+JSON.stringify(packedE1));

const e2start=process.hrtime.bigint();
const learned=learnObservedPairGrammar(all.map(x=>({
 id:x.metrics.id,source:x.source,inputSha256:x.metrics.inputSha256
})),{maxRounds:128,minOccurrences:2});
const e2={status:learned.status,binaryBytes:learned.binaryBytes,
 gzipBytes:learned.binaryGzipBytes,graphRows:learned.graphRows,
 graphPairs:learned.graphPairRows,rounds:learned.substitutionRounds,
 learnedRules:learned.uniqueLearnedRules,
 sourceCodepoints:learned.initialCodepoints,
 remainingPositions:learned.remainingPositions,
 totalRuntimeMs:+(Number(process.hrtime.bigint()-e2start)/1e6).toFixed(2),
 limitations:["BPE/Re-Pair style greedy structural oracle, NOT native FORMAL/Γ",
 "Trained and tested on the same six texts; no heldout generalization claim",
 "All binary bytes include dictionary/roles-free grammar and document roots/hashes",
 "Selection uses true observed positions, not from_uses or generated proof counts"]};
console.log("E2_GRAMMAR "+JSON.stringify(e2));

const e2Sweep=[];
let e2TopDuplets=null;
const observations=all.map(x=>({
 id:x.metrics.id,source:x.source,inputSha256:x.metrics.inputSha256
}));
for(const requestedRounds of [0,32,256,512]) {
 const begin=process.hrtime.bigint();
 const trial=learnObservedPairGrammar(observations,{
  maxRounds:requestedRounds,minOccurrences:2,
  diagnosticTopN:requestedRounds===512?Number(process.env.E2_TOP_N??20):0,
  diagnosticCheckpoints:requestedRounds===512?[0,32,128,256,512]:[]
 });
 e2Sweep.push({
  requestedRounds,actualRounds:trial.substitutionRounds,
  uniqueLinks:trial.graphRows,uniqueDuplets:trial.graphPairRows,
  observedCodepoints:trial.initialCodepoints,
  remainingPositions:trial.remainingPositions,
  grammarRules:trial.uniqueLearnedRules,
  binaryBytes:trial.binaryBytes,
  runtimeMs:Math.round(Number(process.hrtime.bigint()-begin)/1e6)
 });
 if(trial.diagnostics){
  for(const snapshot of trial.diagnostics.adjacentAtCheckpoints)
   console.log("E2_TOP_ADJACENT "+JSON.stringify(snapshot));
  console.log("E2_TOP_STRUCTURAL "+JSON.stringify(trial.diagnostics.topStructuralLinks));
  for(const item of trial.diagnostics.topLongLinks)
   console.log("E2_TOP_LONG "+JSON.stringify(item));
  e2TopDuplets=trial.diagnostics;
 }
}
e2Sweep.push({
 requestedRounds:128,actualRounds:learned.substitutionRounds,
 uniqueLinks:learned.graphRows,uniqueDuplets:learned.graphPairRows,
 observedCodepoints:learned.initialCodepoints,
 remainingPositions:learned.remainingPositions,
 grammarRules:learned.uniqueLearnedRules,
 binaryBytes:learned.binaryBytes,
 runtimeMs:e2.totalRuntimeMs
});
e2Sweep.sort((a,b)=>a.requestedRounds-b.requestedRounds);
const baseline0=e2Sweep.find(x=>x.requestedRounds===0);
if(baseline0.uniqueDuplets!==packedE1.graphRows-175)
 throw new Error("round 0 must match E1 unique duplet baseline");
console.log("E2_SWEEP "+JSON.stringify(e2Sweep));

const groupingStart=process.hrtime.bigint();
const stable=learnObservedPairGrammar(observations,{
 maxRounds:512,minOccurrences:2,rootGrouping:"content-stable",
 diagnosticTopN:Number(process.env.E2_TOP_N??20)
});
const balanced512=e2Sweep.find(x=>x.requestedRounds===512);
if(!balanced512||stable.substitutionRounds!==balanced512.actualRounds||
   stable.uniqueLearnedRules!==balanced512.grammarRules||
   stable.remainingPositions!==balanced512.remainingPositions)
 throw Error("grouping A/B did not hold training constant");
const e3Comparison={
 scope:"SAME_SOURCE_SAME_512_LEARNED_RULES_DIFFERENT_ROOT_GROUPING",
 balanced:{rootGrouping:"balanced",uniqueLinks:balanced512.uniqueLinks,
  uniqueDuplets:balanced512.uniqueDuplets},
 contentStable:{rootGrouping:"content-stable",uniqueLinks:stable.graphRows,
  uniqueDuplets:stable.graphPairRows},
 deltaUniqueDuplets:stable.graphPairRows-balanced512.uniqueDuplets,
 deltaPercent:+((stable.graphPairRows-balanced512.uniqueDuplets)/
  balanced512.uniqueDuplets*100).toFixed(3),
 unchangedObservedCodepoints:stable.initialCodepoints,
 unchangedFinalTokenPositions:stable.remainingPositions,
 learnedRules:stable.uniqueLearnedRules,
 contentAnchors:stable.groupingStats.reduce((a,x)=>a+x.anchors,0),
 timeMs:+(Number(process.hrtime.bigint()-groupingStart)/1e6).toFixed(2),
 longRepeatedLinks:stable.diagnostics.topLongLinks,
 scientificLimit:"Experimental local-minimum anchors + greedy gap grouping; not accepted Γ"
};
console.log("E3_GROUPING_COMPARISON "+JSON.stringify({
 ...e3Comparison,longRepeatedLinks:e3Comparison.longRepeatedLinks.map(x=>({
  minimumCodepoints:x.minimumCodepoints,top:x.top.slice(0,10)}))
}));


const db=new DatabaseSync(":memory:");
try{
 db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
 const sqlite=sqliteReplay(db,union,all);
 const sqliteArchive=measureTransientSqliteArchive(db,{expectedRows:union.length});
 console.log("E0_SQLITE_ARCHIVE "+JSON.stringify(sqliteArchive));
 const report={schema:"mts-nl/real-corpus-benchmark-e0/v1",status:"EXACT_STRUCTURAL_ENCODING_ONLY",
  manifestSha256:reportSha(readFileSync(new URL("../corpus/real-sources-e0.json",import.meta.url))),
  observedSources:docs.length,
  totalInputBytes:docs.reduce((s,d)=>s+d.inputBytes,0),
  totalCodePoints:docs.reduce((s,d)=>s+d.codePoints,0),
  sumPerDocumentGzipBytes:docs.reduce((sum,d)=>sum+d.gzipInputBytes,0),
  sumPerDocumentGraphJsonBytes:docs.reduce((sum,d)=>sum+d.canonicalJsonBytes,0),
  graphUniqueRows:union.length,graphUniquePairs:sqlite.pairRows,
  sqlite,sqliteArchive,numericImport,packedE1,e2,e2Sweep,e2TopDuplets,e3Comparison,documents:docs,
  scientificLimitations:[
   "Only P0 balanced Unicode DAG, not grammatical or semantic FORMAL compilation",
   "Legacy structural E0 hash-consing is an independent research oracle, not SQL Link identity",
   "Numeric import metrics are same-run wall-clock samples; compare under controlled settings",
   "Full graph JSON includes long SHA256 link identities; no claim of byte compression",
   "Source files checked out at exact Git commit and blob SHA1, no training/LLM",
   "Weights and physical usage counters do not represent observation probabilities",
   "Source texts never committed or shipped in benchmark output"
  ]};
 mkdirSync("reports",{recursive:true});
 writeFileSync("reports/real-corpus-E0.json",JSON.stringify(report,null,2)+"\n");
 console.log("E0_CORPUS_SUMMARY "+JSON.stringify({
  files:report.observedSources,sourceBytes:report.totalInputBytes,
  codePoints:report.totalCodePoints,uniqueLinks:report.graphUniqueRows,
  uniquePairs:report.graphUniquePairs,
  perDocumentGzipBytes:report.sumPerDocumentGzipBytes,
  perDocumentGraphJsonBytes:report.sumPerDocumentGraphJsonBytes,
  sqliteReplay:report.sqlite.status,sqliteMs:report.sqlite.sqliteLoadIndexAndReplayMs,
  sqliteLogicalBytes:report.sqlite.sqliteLogicalBytes,
  sqliteVacuumBytes:sqliteArchive.sqliteVacuumBytes,
  sqliteZstdArchiveBytes:sqliteArchive.zstdArchiveBytes,
  compactBinaryBytes:packedE1.binaryBytes,compactBinaryGzipBytes:packedE1.binaryGzipBytes,
  learnedGrammarBytes:e2.binaryBytes,learnedGrammarGzipBytes:e2.gzipBytes,
  numericImportStatus:numericImport.status,
  numericImportLinks:numericImport.insertedLinks,
  numericImportLinksPerSecond:numericImport.aggregateInsertedLinksPerSecond,
  status:report.status
 }));
} finally {db.close();}
