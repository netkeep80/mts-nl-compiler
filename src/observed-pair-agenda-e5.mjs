// E5 experimental observed-pair agenda. A versioned priority index over
// external Unicode scalar occurrences; it is NOT native Γ, FORMAL or weights.
// One new char adds exactly ONE adjacent observed pair, without rescanning
// the past source. Changed top-1 rule invalidates subscribed old views.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {buildContentStableRoot} from "./content-stable-grouping-e3.mjs";

const sha=s=>createHash("sha256").update(s).digest("hex");
const fail=s=>{throw Error("E5 observed-pair agenda: "+s);};
const validText=s=>typeof s==="string"&&Buffer.from(s,"utf8").toString("utf8")===s;
const scalar=s=>validText(s)&&[...s].length===1;
const pairKey=(a,b)=>JSON.stringify([a,b]);
function higher(a,b){
 return a.count>b.count||(a.count===b.count&&
  (a.a<b.a||(a.a===b.a&&a.b<b.b)));
}
class PairHeap {
 constructor(){this.items=[];this.index=new Map();this.comparisons=0;}
 swap(i,j){
  const a=this.items;
  [a[i],a[j]]=[a[j],a[i]];
  this.index.set(a[i].key,i);this.index.set(a[j].key,j);
 }
 better(a,b){this.comparisons++;return higher(a,b);}
 increment(a,b){
  const key=pairKey(a,b),idx=this.index.get(key);
  if(idx===undefined){
   const node={key,a,b,count:1};const pos=this.items.length;
   this.items.push(node);this.index.set(key,pos);this.up(pos);
  } else {this.items[idx].count++;this.up(idx);}
 }
 up(start){
  for(let i=start;i>0;){
   const p=Math.floor((i-1)/2);
   if(!this.better(this.items[i],this.items[p]))break;
   this.swap(i,p);i=p;
  }
 }
 best(min=2){
  const x=this.items[0];
  return x&&x.count>=min?{a:x.a,b:x.b,count:x.count}:null;
 }
 snapshot(){
  return [...this.items].sort((a,b)=>b.count-a.count||
   (a.a<b.a?-1:a.a>b.a?1:a.b<b.b?-1:a.b>b.b?1:0))
   .map(x=>({a:x.a,b:x.b,count:x.count}));
 }
}
export function fullScanPairLeader(source,{minOccurrences=2}={}){
 if(!validText(source))fail("bad source");
 const s=[...source],counts=new Map();
 for(let i=1;i<s.length;i++){
  const key=pairKey(s[i-1],s[i]),found=counts.get(key);
  if(found)found.count++;
  else counts.set(key,{a:s[i-1],b:s[i],count:1});
 }
 let top=null;
 for(const item of counts.values())if(item.count>=minOccurrences&&
  (top===null||higher(item,top)))top=item;
 return top&&{a:top.a,b:top.b,count:top.count};
}
export class ObservedPairAgenda {
 constructor(initialSource="",{minOccurrences=2}={}){
  if(!validText(initialSource)||!Number.isSafeInteger(minOccurrences)||
     minOccurrences<2)fail("invalid source/minOccurrences");
  this.symbols=[...initialSource];
  this.minOccurrences=minOccurrences;
  this.pairs=new PairHeap();
  this.eventIds=new Map();
  this.subscribers=new Map();
  this.watches=new Map();
  this.pending=new Set();
  this.rows=new Map();
  this.work={
   initialAdjacentInspections:0,appendAdjacentInspections:0,
   watcherInvalidations:0,probeCodepointsReevaluated:0,
   processedWatchers:0,externalAppends:0
  };
  this.hash=createHash("sha256").update(initialSource);
  for(let i=1;i<this.symbols.length;i++){
   this.pairs.increment(this.symbols[i-1],this.symbols[i]);
   this.work.initialAdjacentInspections++;
  }
  this.generation=0;
 }
 get leader(){return this.pairs.best(this.minOccurrences);}
 get sourceSha256(){return this.hash.copy().digest("hex");}
 pairCounts(){return this.pairs.snapshot();}
 putAtom(s){
  const id="a:"+sha(JSON.stringify(s));
  if(!this.rows.has(id))this.rows.set(id,{link_id:id,
   from_id:null,to_id:null,string:s,weight:null});
  return id;
 }
 putPair(a,b){
  const id="p:"+sha(JSON.stringify([a,b]));
  if(!this.rows.has(id))this.rows.set(id,{link_id:id,
   from_id:a,to_id:b,string:null,weight:null});
  return id;
 }
 selectedRuleLink(){
  const s=this.leader;
  return s?this.putPair(this.putAtom(s.a),this.putAtom(s.b)):null;
 }
 materialize(content){
  const best=this.leader, chars=[...content],tokens=[];
  for(let i=0;i<chars.length;i++){
   if(best&&i+1<chars.length&&
      chars[i]===best.a&&chars[i+1]===best.b){
    tokens.push(this.putPair(this.putAtom(best.a),this.putAtom(best.b)));
    i++;
   }else tokens.push(this.putAtom(chars[i]));
  }
  return buildContentStableRoot(tokens,
   (a,b)=>this.putPair(a,b),()=>this.putAtom("")).root;
 }
 decode(root){
  const visiting=new Set();
  const walk=id=>{
   const r=this.rows.get(id);if(!r)fail("unknown Link");
   if(r.from_id===null)return r.string;
   if(visiting.has(id))fail("cyclic Link");
   visiting.add(id);
   const x=walk(r.from_id)+walk(r.to_id);
   visiting.delete(id);return x;
  };
  return walk(root);
 }
 trackRange(id,start,length){
  if(typeof id!=="string"||!id||this.watches.has(id)||
     !Number.isSafeInteger(start)||start<0||
     !Number.isSafeInteger(length)||length<1||
     start+length>this.symbols.length)fail("bad/duplicate watch");
  const codepoints=this.symbols.slice(start,start+length);
  const content=codepoints.join("");
  const keys=new Set();
  for(let i=1;i<codepoints.length;i++)
   keys.add(pairKey(codepoints[i-1],codepoints[i]));
  for(const key of keys){
   if(!this.subscribers.has(key))this.subscribers.set(key,new Set());
   this.subscribers.get(key).add(id);
  }
  const root=this.materialize(content);
  if(this.decode(root)!==content)fail("initial view failed exact decode");
  const watch={id,start,length,content,sha256:sha(content),
   interestedPairs:keys,root,versions:[{generation:this.generation,
    rule:this.leader,root}]};
  this.watches.set(id,watch);
  return {id,root,sha256:watch.sha256};
 }
 append(char,{eventId}={}){
  if(typeof eventId!=="string"||!eventId||!scalar(char))
   fail("single Unicode scalar and external event ID required");
  const oldEvent=this.eventIds.get(eventId);
  if(oldEvent!==undefined){
   if(oldEvent!==char)fail("contradictory replay of external event ID");
   return {status:"REPLAY_NOOP",generation:this.generation,
    selected:this.leader,invalidated:0};
  }
  const previous=this.leader,prevKey=previous&&pairKey(previous.a,previous.b);
  const left=this.symbols.at(-1);
  this.symbols.push(char);
  this.eventIds.set(eventId,char);
  this.hash.update(Buffer.from(char,"utf8"));
  this.work.externalAppends++;
  if(left!==undefined){
   this.pairs.increment(left,char);
   this.work.appendAdjacentInspections++;
  }
  this.generation++;
  const current=this.leader,nextKey=current&&pairKey(current.a,current.b);
  const changed=prevKey!==nextKey;
  if(changed){
   const invalidate=new Set([
    ...(this.subscribers.get(prevKey)??[]),
    ...(this.subscribers.get(nextKey)??[])
   ]);
   for(const id of invalidate)this.pending.add(id);
   this.work.watcherInvalidations+=invalidate.size;
  }
  return {status:"OBSERVATION_APPLIED",generation:this.generation,
   previous,current,selectedChanged:changed,invalidated:this.pending.size,
   inspectedNewAdjacentPositions:left===undefined?0:1,
   sourceLength:this.symbols.length};
 }
 processPending({maxWatchers=Infinity}={}){
  if(!(maxWatchers===Infinity||Number.isSafeInteger(maxWatchers)&&maxWatchers>=0))
   fail("bad watcher budget");
  const modified=[];
  let processed=0;
  while(this.pending.size&&processed<maxWatchers){
   const id=this.pending.values().next().value;
   this.pending.delete(id);
   const watch=this.watches.get(id);
   const observed=this.symbols.slice(watch.start,watch.start+watch.length).join("");
   if(observed!==watch.content||sha(observed)!==watch.sha256)
    fail("original observation altered before replay");
   const oldRoot=watch.root,newRoot=this.materialize(watch.content);
   if(this.decode(newRoot)!==watch.content)fail("invalid rematerialized Link");
   watch.root=newRoot;
   watch.versions.push({generation:this.generation,rule:this.leader,root:newRoot});
   this.work.probeCodepointsReevaluated+=watch.length;
   this.work.processedWatchers++;
   modified.push({id,oldRoot,newRoot,changed:oldRoot!==newRoot,
    distanceFromFront:this.symbols.length-watch.start-watch.length});
   processed++;
  }
  return {status:this.pending.size?"RESOURCE_LIMIT":"QUIESCENT",
   processed,remaining:this.pending.size,modified};
 }
 reachableCost({retained=false}={}){
  const stack=[];
  for(const w of this.watches.values())
   if(retained){
    for(const v of w.versions)stack.push(v.root);
    for(const v of w.versions)if(v.rule)
     stack.push(this.putPair(this.putAtom(v.rule.a),this.putAtom(v.rule.b)));
   }else stack.push(w.root);
  if(!retained){
   const rule=this.selectedRuleLink();if(rule)stack.push(rule);
  }
  const seen=new Set(),pairs=new Set();
  while(stack.length){
   const id=stack.pop();if(seen.has(id))continue;
   const r=this.rows.get(id);if(!r)fail("bad reachable Link");
   seen.add(id);
   if(r.from_id!==null){
    pairs.add(id);stack.push(r.from_id,r.to_id);
   }
  }
  return {uniqueLinks:seen.size,uniqueDuplets:pairs.size,
   scope:"WATCHED_VIEWS_AND_SELECTED_RULE_ONLY__NOT_FULL_SOURCE_GRAPH"};
 }
 snapshot(){
  return {generation:this.generation,leader:this.leader,
   externalAppends:this.work.externalAppends,sourceLength:this.symbols.length,
   sourceSha256:this.sourceSha256,distinctObservedPairs:this.pairs.items.length,
   heapComparisons:this.pairs.comparisons,pending:this.pending.size,
   work:{...this.work}};
 }
}
