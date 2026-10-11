import { createHash } from "node:crypto";
import { evaluateRewrite, decodeSequence } from "./compression-implication-v0.mjs";

const digest = text => createHash("sha256").update(text,"utf8").digest("hex");

export function abstractTokens(g,root,variableIds,maxNodes=10000) {
 const variables=new Set(variableIds),tokens=[],stack=new Set();
 function walk(id) {
  if(tokens.length >= maxNodes) throw new Error("Abstract oracle budget");
  if(variables.has(id)){tokens.push(JSON.stringify(["VAR",id]));return;}
  const n=g.get(id);
  if(n.from_id===null){tokens.push(JSON.stringify(["TEXT",n.string]));return;}
  if(stack.has(id))throw new Error("Cyclic abstract template");
  stack.add(id);
  walk(n.from_id);walk(n.to_id);
  stack.delete(id);
 }
 walk(root);
 return tokens;
}

export function proveSequenceRewrite(g,lhs,rhs,variables) {
 const left=abstractTokens(g,lhs,variables);
 const right=abstractTokens(g,rhs,variables);
 return {valid:JSON.stringify(left)===JSON.stringify(right),
   lhsTokens:left,rhsTokens:right,
   criterion:"equal variable/literal token words in the free monoid"};
}

export function extractSingleImageRewrite(g,ruleId,nil) {
 const rule=g.get(ruleId),body=g.get(rule.to_id);
 if(rule.from_id===null||body.from_id===null)throw new Error("Malformed rule");
 function read(root) {
  const items=[],seen=new Set();
  while(root!==nil) {
   if(seen.has(root))throw new Error("Cyclic rule list");
   seen.add(root);
   const n=g.get(root);
   if(n.from_id===null)throw new Error("Invalid rule list");
   items.push(n.from_id);root=n.to_id;
   if(items.length>1000)throw new Error("Rule list budget");
  }
  return items;
 }
 const lhs=read(body.from_id),rhs=read(body.to_id),vars=read(rule.from_id);
 if(lhs.length!==1||rhs.length!==1)throw new Error("Expected 1-to-1 rewrite");
 return {lhs:lhs[0],rhs:rhs[0],variables:vars};
}

export function retainedSnapshot(g,rootSelectors) {
 const roots=Object.fromEntries(Object.entries(rootSelectors).sort((a,b)=>
   a[0]<b[0]?-1:a[0]>b[0]?1:0));
 const ids=new Set();
 function visit(id) {
  if(ids.has(id))return;
  const n=g.get(id);
  ids.add(id);
  if(n.from_id!==null){visit(n.from_id);visit(n.to_id);}
 }
 for(const id of Object.values(roots))visit(id);
 const from=new Map(),to=new Map();
 for(const id of ids){
  const n=g.get(id);
  if(n.from_id!==null){
   from.set(n.from_id,(from.get(n.from_id)??0)+1);
   to.set(n.to_id,(to.get(n.to_id)??0)+1);
  }
 }
 const links=[...ids].sort().map(id=>{
  const n=g.get(id);
  return {link_id:id,from_id:n.from_id,to_id:n.to_id,string:n.string,
   weight:n.weight,from_uses:from.get(id)??0,to_uses:to.get(id)??0};
 });
 const payload=JSON.stringify({roots,links});
 return {roots,links,retainedLinks:links.length,
  retainedPairs:links.filter(n=>n.from_id!==null).length,
  retainedAtoms:links.filter(n=>n.from_id===null).length,
  serializedBytes:Buffer.byteLength(payload,"utf8"),
  sha256:digest(payload),ids,
  closure:links.every(n=>n.from_id===null||
    (ids.has(n.from_id)&&ids.has(n.to_id)))};
}

// Counterfactual root selection, not destructive GC or an accepted authority
// mechanism. The new context is a distinct Link atom, not a second database.
export function auditRootSwitch(g,{ruleMembership,oldMembership,oldContext,
 oldRoot,candidateRoot,proofRoot=null,newContextId="context:v2",
 newMembershipId="membership:context:v2"}) {
 const before=retainedSnapshot(g,{theory:ruleMembership,input:oldMembership});
 const original=decodeSequence(g,oldRoot);
 const proposed=decodeSequence(g,candidateRoot);
 const byteEqual=Buffer.from(original,"utf8").equals(Buffer.from(proposed,"utf8"));
 if(!byteEqual)return {status:"REJECTED_NON_EQUIVALENT",byteEqual,original,
   proposed,before};
 if(g.nodes.has(newContextId)||g.nodes.has(newMembershipId))
  throw new Error("Versioned context already exists");
 g.atom(newContextId,newContextId);
 g.pair(newMembershipId,newContextId,candidateRoot);
 const versioned=retainedSnapshot(g,{theory:ruleMembership,input:newMembershipId});
 const proofRetained=proofRoot===null?null:retainedSnapshot(g,{
  theory:ruleMembership,input:newMembershipId,proof:proofRoot});
 const oldExternallyPinned=retainedSnapshot(g,{
  theory:ruleMembership,input:newMembershipId,legacyInput:oldMembership,
  ...(proofRoot===null?{}:{proof:proofRoot})
 });
 return {status:"COUNTERFACTUAL_ONLY",byteEqual,before,versioned,
  proofRetained,oldExternallyPinned,
  oldRootReachableWithoutProof:versioned.ids.has(oldRoot),
  oldRootReachableWithProof:proofRetained?.ids.has(oldRoot)??false,
  oldMembershipReachableWithProof:proofRetained?.ids.has(oldMembership)??false,
  oldAndNewContextSeparated:
   g.linksFrom(oldContext).some(n=>n.link_id===oldMembership)&&
   g.linksFrom(newContextId).some(n=>n.link_id===newMembershipId)};
}

export function runRetentionExperiment(fixture) {
 const {g,root,rule}=fixture;
 const template=extractSingleImageRewrite(g,rule,"nil");
 const symbolic=proveSequenceRewrite(g,template.lhs,template.rhs,template.variables);
 if(!symbolic.valid)throw new Error("Unproven rewrite template");
 const executable=evaluateRewrite(g,root);
 if(!executable.complete||executable.candidates.length!==1)
  throw new Error("Expected one complete candidate");
 const proposal=executable.candidates[0];
 if(!proposal.exactBytes)throw new Error("Non-equivalent candidate");
 const switchResult=auditRootSwitch(g,{ruleMembership:"membership:rule",
  oldMembership:"membership:input",oldContext:"context",oldRoot:root,
  candidateRoot:proposal.root,proofRoot:proposal.provenance});
 return {symbolic,executable,switchResult,materializedPhysicalLinks:g.nodes.size};
}

export function replaySnapshotInSqlite(db,snapshot,loadRows,counterMismatches) {
 const raw=snapshot.links.map(l=>({link_id:l.link_id,from_id:l.from_id,
  to_id:l.to_id,string:l.string,weight:l.weight}));
 const mapping=loadRows(db,raw).idMap;
 if(counterMismatches(db).length)throw new Error("Counter mismatch");
 const query=db.prepare(
  "SELECT link_id,from_id,to_id,string,weight,from_uses,to_uses FROM links ORDER BY link_id"
 );query.setReadBigInts(true);
 const got=query.all();
 if(got.length!==snapshot.links.length)throw new Error("Lost rows on replay");
 const phys=new Map(got.map(row=>[row.link_id,row]));
 for(const expected of snapshot.links){
  const physical=phys.get(mapping.get(expected.link_id));
  if(!physical)throw new Error("Lost physical ID "+expected.link_id);
  if(physical.from_id!==(expected.from_id===null?null:mapping.get(expected.from_id))||
    physical.to_id!==(expected.to_id===null?null:mapping.get(expected.to_id))||
    physical.string!==expected.string||physical.weight!==expected.weight||
    physical.from_uses!==BigInt(expected.from_uses)||
    physical.to_uses!==BigInt(expected.to_uses))
    throw new Error("Rebuilt structural counters/aliases differ: "+expected.link_id);
 }
 return got.length;
}
