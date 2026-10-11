import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {gzipSync} from "node:zlib";
import {encodePackedGraph,decodePackedGraph} from "../src/packed-dag-e1.mjs";
import {learnObservedPairGrammar} from "../src/observed-pair-grammar-e2.mjs";
import {compileTextExact,unionCompiledGraphs,sqliteReplay}
 from "../src/real-corpus-e0.mjs";
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

const db=new DatabaseSync(":memory:");
try{
 db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
 const sqlite=sqliteReplay(db,union,all);
 const report={schema:"mts-nl/real-corpus-benchmark-e0/v1",status:"EXACT_STRUCTURAL_ENCODING_ONLY",
  manifestSha256:reportSha(readFileSync(new URL("../corpus/real-sources-e0.json",import.meta.url))),
  observedSources:docs.length,
  totalInputBytes:docs.reduce((s,d)=>s+d.inputBytes,0),
  totalCodePoints:docs.reduce((s,d)=>s+d.codePoints,0),
  sumPerDocumentGzipBytes:docs.reduce((sum,d)=>sum+d.gzipInputBytes,0),
  sumPerDocumentGraphJsonBytes:docs.reduce((sum,d)=>sum+d.canonicalJsonBytes,0),
  graphUniqueRows:union.length,graphUniquePairs:sqlite.pairRows,
  sqlite,packedE1,e2,e2Sweep,e2TopDuplets,documents:docs,
  scientificLimitations:[
   "Only P0 balanced Unicode DAG, not grammatical or semantic FORMAL compilation",
   "Hash-consing minimizes repeated identical chosen subtrees, not global MDL",
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
  compactBinaryBytes:packedE1.binaryBytes,compactBinaryGzipBytes:packedE1.binaryGzipBytes,
  learnedGrammarBytes:e2.binaryBytes,learnedGrammarGzipBytes:e2.gzipBytes,
  status:report.status
 }));
} finally {db.close();}
