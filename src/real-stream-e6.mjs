// E6 — measured stream of exact pinned external books/articles.
// Index/old-view agenda incremental; complete source-root construction BATCH.
// Not native Γ and not a globally accepted FORMAL semantic ANet.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {ObservedPairAgenda,fullScanPairLeader} from "./observed-pair-agenda-e5.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
const fail=x=>{throw Error("E6 real source: "+x);};
const elapsed=t=>Math.round(Number(process.hrtime.bigint()-t)/1e6);
function cost(rows,roots){
 const seen=new Set(),pairs=new Set(),todo=roots.filter(Boolean);
 while(todo.length){
  const id=todo.pop();
  if(seen.has(id))continue;
  const r=rows.get(id);if(!r)fail("dangling Link "+id);
  seen.add(id);
  if(r.from_id!==null){pairs.add(id);todo.push(r.from_id,r.to_id);}
 }
 return {uniqueLinks:seen.size,uniqueDuplets:pairs.size,dupletIds:pairs};
}
const rule=(a,r)=>r?a.putPair(a.putAtom(r.a),a.putAtom(r.b)):null;
function roots(a,whole,initial,retained){
 const out=[whole,rule(a,a.leader)];
 if(retained)out.push(initial);
 for(const w of a.watches.values()){
  if(retained)for(const v of w.versions){
   out.push(v.root,rule(a,v.rule));
  }
  else out.push(w.root);
 }
 return out;
}
export function analyzeRealStream(raw,{
 id,bootstrap=384,starts=[0,128,256],watchLength=64,stride=8192,
 maxWatchers=32,includeLinkIds=false
}={}){
 if(!Buffer.isBuffer(raw)||typeof id!=="string"||!id||
  !Number.isSafeInteger(bootstrap)||bootstrap<8||
  !Array.isArray(starts)||starts.length===0||
  !Number.isSafeInteger(watchLength)||watchLength<2||
  !Number.isSafeInteger(stride)||stride<1||
  !Number.isSafeInteger(maxWatchers)||maxWatchers<starts.length||
  typeof includeLinkIds!=="boolean")
  fail("invalid options");
 let source;
 try{source=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw);}
 catch{fail("invalid UTF-8");}
 if(!Buffer.from(source,"utf8").equals(raw))fail("UTF-8 roundtrip mismatch");
 const chars=[...source],n=chars.length;
 if(n<=bootstrap)fail("source shorter than bootstrap");
 const a=new ObservedPairAgenda(chars.slice(0,bootstrap).join(""));
 const prefixRoot=a.materialize(chars.slice(0,bootstrap).join(""));
 for(const [i,start] of starts.entries()){
  if(!Number.isSafeInteger(start)||start<0||start+watchLength>bootstrap)
   fail("invalid watch span");
  a.trackRange("old:"+i,start,watchLength);
 }
 const initialLeader=a.leader;
 let leaderChanges=0,affected=0,changedRoots=0,late=0,processed=0;
 let checkCount=0,referenceInspections=0;
 const samples=[],lateRevisionWitnesses=[];
 const tick=process.hrtime.bigint();
 for(let i=bootstrap;i<n;i++){
  const event=a.append(chars[i],{eventId:id+":"+i});
  assert.equal(event.inspectedNewAdjacentPositions,1);
  if(event.selectedChanged){
   // Independently validate EACH natural rule transition, not only scheduled
   // checkpoints. Essential for attributing a far-past root revision to one
   // actually observed new Unicode scalar.
   assert.deepEqual(a.leader,fullScanPairLeader(chars.slice(0,i+1).join("")));
   checkCount++;referenceInspections+=i;
   leaderChanges++;
   affected+=event.invalidated;
   if(samples.length<8)samples.push({position:i,from:event.previous,
    to:event.current,affected:event.invalidated});
  }
  if(event.invalidated){
   let response=a.processPending({maxWatchers});
   while(true){
    processed+=response.processed;
    for(const change of response.modified){
     if(!change.changed)continue;
     changedRoots++;
     if(change.distanceFromFront>10000){
      late++;
      const w=a.watches.get(change.id);
      if(a.decode(change.oldRoot)!==w.content||
         a.decode(change.newRoot)!==w.content)fail("late root lost immutable observation");
      lateRevisionWitnesses.push({
       externalOccurrenceId:id+":"+i,atCodepoint:i,
       watchId:change.id,distanceFromFront:change.distanceFromFront,
       originalWatchSha256:w.sha256,oldRoot:change.oldRoot,newRoot:change.newRoot,
       oldRootDuplets:cost(a.rows,[change.oldRoot]).uniqueDuplets,
       newRootDuplets:cost(a.rows,[change.newRoot]).uniqueDuplets,
       selectedRuleBefore:event.previous,selectedRuleAfter:event.current
      });
     }
    }
    if(response.status==="QUIESCENT")break;
    if(response.status!=="RESOURCE_LIMIT")fail("unknown queue status");
    response=a.processPending({maxWatchers});
    if(!response.processed)fail("stuck queue");
   }
  }
  if((i+1)%stride===0||i===n-1){
   assert.deepEqual(a.leader,fullScanPairLeader(chars.slice(0,i+1).join("")));
   checkCount++;referenceInspections+=i;
  }
 }
 const streamMs=elapsed(tick);
 const state=a.snapshot();
 if(state.pending!==0||state.work.externalAppends!==n-bootstrap||
   state.work.appendAdjacentInspections!==n-bootstrap||
   a.sourceSha256!==sha(raw))fail("stream index/SHA mismatch");
 const batchStart=process.hrtime.bigint();
 const whole=a.materialize(source);
 const restored=a.decode(whole);
 if(!Buffer.from(restored,"utf8").equals(raw)||sha(Buffer.from(restored))!==sha(raw))
  fail("full source Link-root is not byte exact");
 const sourceRootBatchMs=elapsed(batchStart);
 const selected=cost(a.rows,roots(a,whole,prefixRoot,false));
 const retained=cost(a.rows,roots(a,whole,prefixRoot,true));
 if(retained.uniqueDuplets<selected.uniqueDuplets)fail("retention inconsistent");
 return {
  id,status:"E6_REAL_SOURCE_INCREMENTAL_INDEX_PASS",
  inputBytes:raw.length,inputSha256:sha(raw),codepoints:n,bootstrap,
  initialLeader,finalLeader:a.leader,appended:n-bootstrap,
  newAdjacentPositionsInspected:state.work.appendAdjacentInspections,
  initialAdjacentPositionsInspected:state.work.initialAdjacentInspections,
  fullScanOracleChecks:checkCount,fullScanReferenceInspections:referenceInspections,
  leaderChanges,watchInvalidations:affected,processedOldWatches:processed,
  oldRootsChanged:changedRoots,lateOldRootsChanged:late,
  revisitedOldCodepoints:state.work.probeCodepointsReevaluated,
  watchedViews:a.watches.size,streamMs,sourceRootBatchMs,
  selectedDuplets: selected.uniqueDuplets,
  retainedDuplets: retained.uniqueDuplets,
  selectedLinks:selected.uniqueLinks,retainedLinks:retained.uniqueLinks,
  selectedFullSourceRoot:whole,transitionExamples:samples,
  lateRevisionWitnesses,
  selectedDupletIds:includeLinkIds?[...selected.dupletIds]:undefined,
  retainedDupletIds:includeLinkIds?[...retained.dupletIds]:undefined,
  costScope:"source root + watched old views + selected pair; retained adds old source prefix and historical roots/rules",
  doesNotProve:"full-source DAG incremental update, native Γ, semantic inference, global MDL"
 };
}
