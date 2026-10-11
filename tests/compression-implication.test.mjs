import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {LinkGraph} from "../experiments/inference-v0.mjs";
import {loadRows,counterMismatches} from "../src/store.mjs";
import {makeRewriteFixture,decodeSequence,representationCost,evaluateRewrite}
 from "../experiments/compression-implication-v0.mjs";

test("same Γ fires a Link-stored compression implication with fresh bindings",()=>{
 const {g,root,rule,source}=makeRewriteFixture();
 assert.equal(source,"мама");
 assert.equal(decodeSequence(g,root),"мама");
 const report=evaluateRewrite(g,root);
 assert.equal(report.status,"QUIESCENT");
 assert.equal(report.complete,true);
 assert.equal(report.candidates.length,1);
 const p=report.candidates[0];
 assert.equal(p.rule,rule);
 assert.deepEqual(p.bindings,[["var:X","atom:X"],["var:Y","atom:Y"]]);
 assert.deepEqual(p.premises,[root]);
 assert.equal(p.exactBytes,true);
 assert.equal(p.decoded,"мама");
 assert.equal(report.sourceCost.uniquePairs,3);
 assert.equal(p.representationCost.uniquePairs,2);
 assert.equal(p.fewerUniquePairs,true);
 assert.equal(p.accepted,false);
 assert.ok(report.physicalAfter>report.physicalBefore); // old graph AND witness remain
 const proofHead=g.get(g.get(p.provenance).from_id);
 assert.equal(proofHead.from_id,rule);
 assert.equal(proofHead.to_id,"context");
});

test("rule applies to unseen substrings and mixed Unicode without a new host branch",()=>{
 for(const [left,right] of [["a","b"],["RE","ST"],["x","²"],["ℝ","→"],
     ["не ","обязательно"],["а","a"],["🧪","ε"],["е","\u0308"]]) {
  const f=makeRewriteFixture({left,right});
  const result=evaluateRewrite(f.g,f.root);
  assert.equal(result.candidates.length,1,JSON.stringify([left,right]));
  assert.equal(result.candidates[0].exactBytes,true);
  assert.equal(result.candidates[0].decoded,left+right+left+right);
  assert.equal(result.candidates[0].representationCost.uniquePairs,2);
 }
});

test("repeated variable constraints prohibit spurious rewrite",()=>{
 const f=makeRewriteFixture({left:"м",right:"а",last:"б"});
 const report=evaluateRewrite(f.g,f.root);
 assert.equal(report.status,"NO_MATCH");
 assert.equal(report.candidates.length,0);
 assert.equal(report.input,"мамб");
});

test("unselected implication and unselected text are inert",()=>{
 for(const opts of [{selected:false},{contextSelected:false}]) {
  const f=makeRewriteFixture(opts);
  const report=evaluateRewrite(f.g,f.root);
  assert.equal(report.status,"NO_MATCH");
  assert.equal(report.candidates.length,0);
 }
});

test("new representation is not automatically a net database compression",()=>{
 const f=makeRewriteFixture();
 const before=evaluateRewrite(f.g,f.root);
 assert.ok(before.physicalAfter>before.physicalBefore);
 assert.ok(before.candidates[0].fewerUniquePairs);
 assert.ok(before.candidates[0].representationCost.serializedBytes>0);
 // Old root remains in context, and proof still points back to its premise.
 assert.equal(f.g.linksFrom("context")[0].to_id,f.root);
 assert.notEqual(f.root,before.candidates[0].root);
});

test("single-table serialization and fresh-load replay preserve selected rule",()=>{
 const f=makeRewriteFixture({left:"RE",right:"ST"});
 const sourceRows=[...f.g.nodes.values()].map(r=>({...r}));
 const db=new DatabaseSync(":memory:");
 try {
  db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
  loadRows(db,sourceRows);
  assert.deepEqual(counterMismatches(db),[]);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'").get().c,1);
  const rows=db.prepare("SELECT link_id,from_id,to_id,string,weight FROM links ORDER BY link_id").all()
    .map(r=>({...r}));
  assert.equal(rows.length,sourceRows.length);
  const newGraph=new LinkGraph(rows);
  const replay=evaluateRewrite(newGraph,f.root);
  assert.equal(replay.status,"QUIESCENT");
  assert.equal(replay.candidates.length,1);
  assert.equal(replay.candidates[0].exactBytes,true);
  assert.equal(replay.candidates[0].decoded,"RESTREST");
 } finally {db.close();}
});

test("resource-exhausted execution is not declared as a complete rewrite",()=>{
 const f=makeRewriteFixture();
 const r=evaluateRewrite(f.g,f.root,{maxFirings:0});
 assert.equal(r.status,"RESOURCE_LIMIT");
 assert.equal(r.complete,false);
 assert.equal(r.candidates.length,0);
});

test("decoder explicitly rejects cycles rather than inventing text",()=>{
 const f=makeRewriteFixture();
 f.g.pair("cyclic","atom:X","atom:Y");
 f.g.get("cyclic").to_id="cyclic";
 assert.throws(()=>decodeSequence(f.g,"cyclic"),/Cyclic sequence/);
});

test("same structural rewrite may have no demonstrated full-cost gain",()=>{
 const f=makeRewriteFixture();
 const initial=representationCost(f.g,f.root);
 const r=evaluateRewrite(f.g,f.root);
 assert.equal(initial.uniquePairs,3);
 assert.equal(r.candidates[0].representationCost.uniquePairs,2);
 // All original data and the rule/proof still exist in physical database.
 assert.ok(r.physicalAfter > r.physicalBefore);
 // No safe garbage collection or global MDL optimizer is implemented here.
 assert.equal(r.candidates[0].accepted,false);
});


test("finite exhaustive fragment combinations preserve the exact byte sequence",()=>{
 const alphabet=["м","a","+"];
 const blocks=[...alphabet];
 for(const a of alphabet) for(const b of alphabet) blocks.push(a+b);
 let checked=0;
 for(const left of blocks) for(const right of blocks) {
  const f=makeRewriteFixture({left,right});
  const r=evaluateRewrite(f.g,f.root);
  assert.equal(r.status,"QUIESCENT",JSON.stringify([left,right]));
  assert.equal(r.candidates.length,1,JSON.stringify([left,right]));
  assert.equal(r.candidates[0].decoded,left+right+left+right);
  assert.equal(r.candidates[0].exactBytes,true);
  assert.equal(r.candidates[0].representationCost.uniquePairs,2);
  checked++;
 }
 assert.equal(checked,144);
});

test("repeated inference and persisted proof do not become new training facts",()=>{
 const f=makeRewriteFixture({left:"не ",right:"обязательно"});
 const first=evaluateRewrite(f.g,f.root);
 const physical=f.g.nodes.size;
 const second=evaluateRewrite(f.g,f.root);
 assert.equal(first.proofs,1);
 assert.equal(second.proofs,1);
 assert.equal(second.candidates.length,1);
 assert.equal(f.g.nodes.size,physical);
 assert.equal(f.g.linksFrom("context").length,1);

 // Restore the full post-inference graph through the ONLY SQLite subject table.
 const db=new DatabaseSync(":memory:");
 try {
  db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
  loadRows(db,[...f.g.nodes.values()].map(n=>({...n})));
  const rows=db.prepare("SELECT link_id,from_id,to_id,string,weight FROM links ORDER BY link_id")
    .all().map(r=>({...r}));
  const restored=new LinkGraph(rows);
  const replay=evaluateRewrite(restored,f.root);
  assert.equal(replay.proofs,1);
  assert.equal(restored.linksFrom("context").length,1);
  assert.equal(replay.candidates[0].exactBytes,true);
 } finally { db.close(); }
});
