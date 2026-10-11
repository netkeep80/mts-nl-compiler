import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { LinkGraph } from "../experiments/inference-v0.mjs";
import { loadRows,counterMismatches } from "../src/store.mjs";
import { makeRewriteFixture } from "../experiments/compression-implication-v0.mjs";
import { proveSequenceRewrite,extractSingleImageRewrite,retainedSnapshot,
  auditRootSwitch,runRetentionExperiment,replaySnapshotInSqlite
} from "../experiments/retention-oracle-v0.mjs";

test("independent free-monoid oracle validates valid rewrites, rejects permutations",()=>{
 const f=makeRewriteFixture();
 const p=extractSingleImageRewrite(f.g,f.rule,"nil");
 const o=proveSequenceRewrite(f.g,p.lhs,p.rhs,p.variables);
 assert.equal(o.valid,true);
 assert.deepEqual(o.lhsTokens,o.rhsTokens);
 const reverse=f.g.makeDerived("var:Y","var:X");
 assert.equal(proveSequenceRewrite(f.g,p.lhs,reverse,p.variables).valid,false);
 const missing=f.g.makeDerived("var:X","var:Y");
 assert.equal(proveSequenceRewrite(f.g,p.lhs,missing,p.variables).valid,false);
});

test("versioned context offers a new root without activating both versions",()=>{
 const f=makeRewriteFixture();
 const r=runRetentionExperiment(f);
 const {before,versioned,proofRetained,oldExternallyPinned}=r.switchResult;
 assert.equal(r.switchResult.status,"COUNTERFACTUAL_ONLY");
 assert.equal(r.switchResult.byteEqual,true);
 assert.equal(r.switchResult.oldAndNewContextSeparated,true);
 assert.equal(f.g.linksFrom("context").length,1);
 assert.equal(f.g.linksFrom("context:v2").length,1);
 assert.equal(f.g.linksFrom("context")[0].to_id,f.root);
 assert.equal(f.g.linksFrom("context:v2")[0].to_id,r.executable.candidates[0].root);
 assert.equal(r.switchResult.oldRootReachableWithoutProof,false);
 assert.equal(r.switchResult.oldRootReachableWithProof,true);
 assert.equal(r.switchResult.oldMembershipReachableWithProof,false);
 assert.equal(before.retainedPairs-versioned.retainedPairs,1);
 assert.ok(proofRetained.retainedPairs>before.retainedPairs);
 assert.ok(oldExternallyPinned.retainedLinks>=proofRetained.retainedLinks);
 assert.equal(before.closure,true);
 assert.equal(versioned.closure,true);
 assert.equal(proofRetained.closure,true);
});

test("retaining a proof prevents collecting its original premise",()=>{
 const f=makeRewriteFixture({left:"RE",right:"ST"});
 const r=runRetentionExperiment(f);
 const {proofRetained,versioned}=r.switchResult;
 assert.equal(proofRetained.ids.has(f.root),true);
 assert.equal(versioned.ids.has(f.root),false);
 assert.equal(proofRetained.ids.has("membership:input"),false);
 assert.equal(versioned.ids.has("membership:context:v2"),true);
 assert.ok(proofRetained.serializedBytes>r.switchResult.before.serializedBytes);
});

test("all projected profiles roundtrip through exactly one physical SQLite table",()=>{
 const f=makeRewriteFixture({left:"не ",right:"обязательно"});
 const r=runRetentionExperiment(f);
 for(const label of ["before","versioned","proofRetained","oldExternallyPinned"]) {
  const snapshot=r.switchResult[label];
  const db=new DatabaseSync(":memory:");
  try {
   db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
   assert.equal(replaySnapshotInSqlite(db,snapshot,loadRows,counterMismatches),
     snapshot.retainedLinks,label);
   assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n,1);
   assert.equal(snapshot.closure,true);
  } finally {db.close();}
 }
});

test("byte-inequivalent replacement rejected before selecting a new context",()=>{
 const f=makeRewriteFixture();
 const invalid=f.g.makeDerived("atom:X","atom:X");
 const oldCount=f.g.nodes.size;
 const r=auditRootSwitch(f.g,{ruleMembership:"membership:rule",
  oldMembership:"membership:input",oldContext:"context",oldRoot:f.root,
  candidateRoot:invalid,proofRoot:null});
 assert.equal(r.status,"REJECTED_NON_EQUIVALENT");
 assert.equal(r.byteEqual,false);
 assert.equal(f.g.nodes.size,oldCount);
 assert.equal(f.g.nodes.has("context:v2"),false);
});

test("snapshots are stable against reversed input row ordering",()=>{
 const f=makeRewriteFixture({left:"a",right:"+"});
 const r=runRetentionExperiment(f);
 const snapshot=r.switchResult.proofRetained;
 const second=new LinkGraph([...f.g.nodes.values()].reverse().map(x=>({...x})));
 const rebuilt=retainedSnapshot(second,snapshot.roots);
 assert.equal(rebuilt.sha256,snapshot.sha256);
 assert.equal(rebuilt.serializedBytes,snapshot.serializedBytes);
 assert.equal(f.g.nodes.has(f.root),true);
});

test("independent rule identity and retention profile hold for unseen fragments",()=>{
 const parts=["а","м","x","²","→","API","РФ"," "];
 let tested=0;
 for(const left of parts)for(const right of parts) {
  const f=makeRewriteFixture({left,right});
  const r=runRetentionExperiment(f);
  assert.equal(r.symbolic.valid,true);
  assert.equal(r.executable.candidates[0].exactBytes,true);
  assert.equal(r.switchResult.before.retainedPairs-
    r.switchResult.versioned.retainedPairs,1);
  assert.equal(r.switchResult.oldRootReachableWithProof,true);
  tested++;
 }
 assert.equal(tested,64);
});

test("bad root selector never yields a valid compression snapshot",()=>{
 const f=makeRewriteFixture();
 assert.throws(()=>retainedSnapshot(f.g,{input:"missing:id"}),/Unknown Link/);
});
