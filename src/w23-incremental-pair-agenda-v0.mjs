// W23-C incremental agenda over CURRENT token adjacencies after replacements.
// This is intentionally distinct from E5, which indexes source observations at append.
import {compressFrequencyReference} from './w23-frequency-reference-v0.mjs';

const fail=message=>{throw new Error('W23_INC_AGENDA: '+message);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const pairIdKey=(left,right)=>left+','+right;
const canonicalPairKey=(left,right)=>JSON.stringify([left.canonical,right.canonical]);
const validText=text=>typeof text==='string'&&Buffer.from(text,'utf8').toString('utf8')===text&&
 ![...text].some(ch=>{const cp=ch.codePointAt(0);return cp>=0xD800&&cp<=0xDFFF;});
const elapsedMs=start=>+(Number(process.hrtime.bigint()-start)/1e6).toFixed(3);

class IndexedCandidateHeap{
 constructor(){this.items=[];this.index=new Map();this.comparisons=0;this.inserts=0;
  this.updates=0;this.removals=0;this.pops=0;this.reinserts=0;}
 better(a,b){
  this.comparisons++;
  return a.frequency>b.frequency||a.frequency===b.frequency&&
   (a.canonical<b.canonical||a.canonical===b.canonical&&a.identity<b.identity);
 }
 swap(i,j){const a=this.items;[a[i],a[j]]=[a[j],a[i]];
  this.index.set(a[i].identity,i);this.index.set(a[j].identity,j);}
 up(start){let i=start;for(;i>0;){const p=Math.floor((i-1)/2);
   if(!this.better(this.items[i],this.items[p]))break;this.swap(i,p);i=p;}return i;}
 down(start){let i=start;for(;;){let best=i,l=i*2+1,r=l+1;
   if(l<this.items.length&&this.better(this.items[l],this.items[best]))best=l;
   if(r<this.items.length&&this.better(this.items[r],this.items[best]))best=r;
   if(best===i)break;this.swap(i,best);i=best;}return i;}
 insert(entry,{reinsert=false}={}){
  if(this.index.has(entry.identity))fail('duplicate heap identity');
  const i=this.items.length;this.items.push(entry);this.index.set(entry.identity,i);
  if(reinsert)this.reinserts++;else this.inserts++;this.up(i);
 }
 remove(identity,{metric=true}={}){
  const i=this.index.get(identity);if(i===undefined)return null;
  const removed=this.items[i],last=this.items.pop();this.index.delete(identity);
  if(i<this.items.length){this.items[i]=last;this.index.set(last.identity,i);
   const at=this.up(i);this.down(at);}
  if(metric)this.removals++;return removed;
 }
 set(bucket){
  const frequency=bucket.occurrences.size,existing=this.index.get(bucket.identity);
  if(!bucket.eligible||frequency===0){if(existing!==undefined)this.remove(bucket.identity);return;}
  const entry={identity:bucket.identity,frequency,canonical:bucket.canonical};
  if(existing===undefined){this.insert(entry);return;}
  this.items[existing]=entry;this.updates++;
  const at=this.up(existing);this.down(at);
 }
 peek(){return this.items[0]??null;}
 pop(){const top=this.peek();if(!top)return null;this.pops++;return this.remove(top.identity,{metric:false});}
}

export class IncrementalPairReplacementAgenda{
 constructor(documents,{minOccurrences=2,maxExpansionScalars=256,includeTrace=false}={}){
  if(!Array.isArray(documents)||!Number.isSafeInteger(minOccurrences)||minOccurrences<2||
   !Number.isSafeInteger(maxExpansionScalars)||maxExpansionScalars<2||maxExpansionScalars>4096||
   typeof includeTrace!=='boolean')fail('invalid parameters');
  this.documents=documents;this.minOccurrences=minOccurrences;
  this.maxExpansionScalars=maxExpansionScalars;this.includeTrace=includeTrace;
  this.nextToken=1;this.nextNode=1;
  this.atoms=new Map();this.terms=new Map();this.pairs=new Map();
  this.nodes=new Map();this.docStates=[];this.buckets=new Map();this.heap=new IndexedCandidateHeap();
  this.rules=[];this.trace=[];
  this.work={initialAdjacentInspections:0,indexAdditions:0,indexRemovals:0,
   touchedAdjacencyPositions:0,candidateOccurrenceInspections:0,candidatesExamined:0,
   replacementOccurrences:0,exactReplayChecks:0};
  const ids=new Set();
  for(const [docIndex,d] of documents.entries()){
   if(!d||typeof d.id!=='string'||!d.id||ids.has(d.id)||!validText(d.text))
    fail('invalid or duplicate Unicode document');
   ids.add(d.id);
   const state={id:d.id,text:d.text,index:docIndex,head:null,tail:null};
   let previous=null;
   for(const [order,scalar] of [...d.text].entries()){
    const node={id:this.nextNode++,docIndex,order,token:this.atom(scalar),prev:previous,
     next:null,alive:true,edgeKey:null};
    this.nodes.set(node.id,node);
    if(previous)previous.next=node;else state.head=node;
    previous=node;
   }
   state.tail=previous;this.docStates.push(state);
  }
  for(const state of this.docStates)for(let n=state.head;n&&n.next;n=n.next){
   this.work.initialAdjacentInspections++;this.addEdge(n,{schedule:false,countOperation:false});
  }
  for(const bucket of this.buckets.values())this.schedule(bucket);
  this.sampledPeakHeapUsedBytes=process.memoryUsage().heapUsed;
 }
 atom(scalar){
  let token=this.atoms.get(scalar);if(token!==undefined)return token;
  token=this.nextToken++;const canonical='A:'+JSON.stringify(scalar);
  this.atoms.set(scalar,token);
  this.terms.set(token,Object.freeze({token,kind:'atom',scalar,canonical,expanded:scalar,length:1}));
  return token;
 }
 pair(leftToken,rightToken){
  const left=this.terms.get(leftToken),right=this.terms.get(rightToken);
  if(!left||!right)fail('unknown pair pole');
  const identity=pairIdKey(leftToken,rightToken);let token=this.pairs.get(identity);
  if(token!==undefined)return {token,created:false};
  token=this.nextToken++;
  const term=Object.freeze({token,kind:'pair',left:leftToken,right:rightToken,
   canonical:'P:'+canonicalPairKey(left,right),expanded:left.expanded+right.expanded,
   length:left.length+right.length});
  this.terms.set(token,term);this.pairs.set(identity,token);return {token,created:true};
 }
 bucketFor(leftToken,rightToken){
  const identity=pairIdKey(leftToken,rightToken);let bucket=this.buckets.get(identity);
  if(bucket)return bucket;
  const left=this.terms.get(leftToken),right=this.terms.get(rightToken);
  if(!left||!right)fail('edge has unknown token');
  bucket={identity,leftToken,rightToken,canonical:canonicalPairKey(left,right),
   expanded:left.expanded+right.expanded,length:left.length+right.length,
   eligible:left.length+right.length<=this.maxExpansionScalars,
   occurrences:new Set(),version:0};
  this.buckets.set(identity,bucket);return bucket;
 }
 schedule(bucket){
  bucket.version++;this.heap.set(bucket);
 }
 addEdge(left,{schedule=true,countOperation=true,touched=null}={}){
  if(!left?.alive||!left.next?.alive)fail('cannot add absent adjacency');
  if(left.edgeKey!==null)fail('adjacency already indexed');
  const bucket=this.bucketFor(left.token,left.next.token);
  if(bucket.occurrences.has(left.id))fail('duplicate occurrence');
  bucket.occurrences.add(left.id);left.edgeKey=bucket.identity;
  if(countOperation)this.work.indexAdditions++;
  if(touched)touched.add(left.docIndex+':'+left.order);
  if(schedule)this.schedule(bucket);
 }
 removeEdge(left,{touched=null}={}){
  if(!left?.alive||left.edgeKey===null)fail('cannot remove unindexed adjacency');
  const bucket=this.buckets.get(left.edgeKey);
  if(!bucket||!bucket.occurrences.delete(left.id))fail('reverse adjacency index mismatch');
  left.edgeKey=null;this.work.indexRemovals++;
  if(touched)touched.add(left.docIndex+':'+left.order);
  this.schedule(bucket);
 }
 frequencySnapshot(){
  return [...this.buckets.values()].filter(b=>b.eligible&&b.occurrences.size>0)
   .map(b=>({leftToken:b.leftToken,rightToken:b.rightToken,frequency:b.occurrences.size,
    canonical:b.canonical,length:b.length,expanded:b.expanded}))
   .sort((a,b)=>cmp(a.canonical,b.canonical));
 }
 sequences(){
  return this.docStates.map(state=>{const out=[];for(let n=state.head;n;n=n.next){
   if(!n.alive)fail('dead node reachable from document head');out.push(n.token);
  }return out;});
 }
 nonOverlapping(bucket){
  const occurrences=[...bucket.occurrences].map(id=>this.nodes.get(id)).sort((a,b)=>
   a.docIndex-b.docIndex||a.order-b.order);
  const selected=[];let lastRightId=null,lastDoc=-1;
  for(const left of occurrences){
   this.work.candidateOccurrenceInspections++;
   if(!left?.alive||left.edgeKey!==bucket.identity||!left.next?.alive||
      left.token!==bucket.leftToken||left.next.token!==bucket.rightToken)
    fail('stale occurrence survived reverse index');
   if(left.docIndex!==lastDoc){lastDoc=left.docIndex;lastRightId=null;}
   if(left.id===lastRightId)continue;
   selected.push({left,right:left.next});lastRightId=left.next.id;
  }
  return selected;
 }
 choose(){
  const rejected=[];let chosen=null,selected=null;
  for(;;){
   const entry=this.heap.pop();if(!entry)break;
   const bucket=this.buckets.get(entry.identity);
   if(!bucket||entry.frequency!==bucket.occurrences.size)fail('indexed heap/count mismatch');
   if(entry.frequency<this.minOccurrences){rejected.push(entry);break;}
   this.work.candidatesExamined++;
   const possible=this.nonOverlapping(bucket);
   if(possible.length>=this.minOccurrences){chosen=bucket;selected=possible;break;}
   rejected.push(entry);
  }
  for(const entry of rejected)this.heap.insert(entry,{reinsert:true});
  return chosen?{bucket:chosen,selected}:null;
 }
 replaceOne(left,right,replacementToken,touched){
  if(!left.alive||!right.alive||left.next!==right||right.prev!==left)
   fail('replacement occurrence topology changed');
  const previous=left.prev,next=right.next;
  if(previous)this.removeEdge(previous,{touched});
  this.removeEdge(left,{touched});
  if(next)this.removeEdge(right,{touched});
  left.token=replacementToken;left.next=next;
  if(next)next.prev=left;else this.docStates[left.docIndex].tail=left;
  right.alive=false;right.prev=null;right.next=null;right.edgeKey=null;
  if(previous)this.addEdge(previous,{touched});
  if(next)this.addEdge(left,{touched});
  this.work.replacementOccurrences++;
 }
 decodeSequences(){return this.sequences().map(seq=>seq.map(token=>{
  const term=this.terms.get(token);if(!term)fail('unknown token during replay');return term.expanded;
 }).join(''));}
 assertExactReplay(){
  const replay=this.decodeSequences();this.work.exactReplayChecks++;
  for(let i=0;i<this.documents.length;i++)if(replay[i]!==this.documents[i].text)
   fail('exact Unicode replay mismatch');return replay;
 }
 step(round){
  const beforeSequences=this.includeTrace?this.sequences():null;
  const pairFrequencies=this.includeTrace?this.frequencySnapshot():null;
  const choice=this.choose();
  if(!choice){
   if(this.includeTrace)this.trace.push({round,beforeSequences,pairFrequencies,chosen:null,
    afterSequences:beforeSequences.map(x=>x.slice()),touchedAdjacencies:0,indexOperations:0});
   this.assertExactReplay();return null;
  }
  const {bucket,selected}=choice,beforeFrequency=bucket.occurrences.size;
  const made=this.pair(bucket.leftToken,bucket.rightToken),touched=new Set();
  const additionsBefore=this.work.indexAdditions,removalsBefore=this.work.indexRemovals;
  for(const {left,right} of selected)this.replaceOne(left,right,made.token,touched);
  this.work.touchedAdjacencyPositions+=touched.size;
  const exactRule=Object.freeze({round,token:made.token,createdAbstractPair:made.created,
   leftToken:bucket.leftToken,rightToken:bucket.rightToken,canonical:bucket.canonical,
   expanded:bucket.expanded,length:bucket.length,adjacentFrequency:beforeFrequency,
   nonOverlappingReplacements:selected.length});
  this.rules.push(exactRule);this.assertExactReplay();
  let item={round,touchedAdjacencies:touched.size,
   indexOperations:this.work.indexAdditions-additionsBefore+this.work.indexRemovals-removalsBefore};
  if(this.includeTrace){
   const afterSequences=this.sequences();item={...item,beforeSequences,pairFrequencies,
    chosen:{leftToken:bucket.leftToken,rightToken:bucket.rightToken,frequency:beforeFrequency,
     canonical:bucket.canonical,length:bucket.length,expanded:bucket.expanded,
     nonOverlappingReplacements:selected.length},replacementToken:made.token,
    createdAbstractPair:made.created,afterSequences};this.trace.push(item);
  }
  this.sampledPeakHeapUsedBytes=Math.max(this.sampledPeakHeapUsedBytes,process.memoryUsage().heapUsed);
  return item;
 }
 run(maxRounds=256){
  if(!Number.isSafeInteger(maxRounds)||maxRounds<0||maxRounds>4096)fail('invalid maxRounds');
  const started=process.hrtime.bigint();
  let round=0;for(;round<maxRounds;round++)if(this.step(round+1)===null)break;
  const replay=this.assertExactReplay(),finalSequences=this.sequences();
  return Object.freeze({schema:'mts-nl/w23-incremental-pair-agenda/v0',
   status:'EXACT_UNICODE_REPLAY_PASS',semantics:'current-token adjacency after pair replacement; not E5 append observations',
   parameters:{minOccurrences:this.minOccurrences,maxRounds,maxExpansionScalars:this.maxExpansionScalars},
   documents:this.documents.map((d,i)=>({id:d.id,unicodeScalars:[...d.text].length,
    utf8Bytes:Buffer.byteLength(d.text),finalTokens:finalSequences[i].length})),
   rules:this.rules.slice(),ruleCount:this.rules.length,abstractAtoms:this.atoms.size,
   abstractPairs:this.pairs.size,finalSequences,replay,...(this.includeTrace?{trace:this.trace.slice()}:null),
   work:{...this.work,heapInserts:this.heap.inserts,heapUpdates:this.heap.updates,
    heapRemovals:this.heap.removals,heapPops:this.heap.pops,heapReinserts:this.heap.reinserts,
    heapComparisons:this.heap.comparisons,heapStaleEntries:0},elapsedMs:elapsedMs(started),
   sampledPeakHeapUsedBytes:this.sampledPeakHeapUsedBytes});
 }
}

export function compressFrequencyIncremental(documents,options={}){
 const {maxRounds=256,...agendaOptions}=options;
 return new IncrementalPairReplacementAgenda(documents,agendaOptions).run(maxRounds);
}

function comparableTraceStep(step){return {
 round:step.round,sequences:step.sequences??step.beforeSequences,
 pairFrequencies:step.pairFrequencies,chosen:step.chosen,
 replacementToken:step.replacementToken??null,createdAbstractPair:step.createdAbstractPair??null,
 afterSequences:step.afterSequences
};}

export function verifyIncrementalAgainstReference(documents,options={}){
 const reference=compressFrequencyReference(documents,{...options,includeTrace:true});
 const incremental=compressFrequencyIncremental(documents,{...options,includeTrace:true});
 const mismatch=(label,a,b)=>{
  if(JSON.stringify(a)!==JSON.stringify(b))fail('oracle mismatch '+label+'\nreference='+JSON.stringify(a)+'\nincremental='+JSON.stringify(b));
 };
 mismatch('rules',reference.rules,incremental.rules);
 mismatch('finalSequences',reference.finalSequences,incremental.finalSequences);
 mismatch('replay',reference.replay,incremental.replay);
 mismatch('trace length',reference.trace.length,incremental.trace.length);
 for(let i=0;i<reference.trace.length;i++)mismatch('trace['+i+']',
  comparableTraceStep(reference.trace[i]),comparableTraceStep(incremental.trace[i]));
 return {status:'W23_C_DIFFERENTIAL_PASS',reference,incremental};
}

export function benchmarkW23C(documents,options={}){
 const heap0=process.memoryUsage().heapUsed,t0=process.hrtime.bigint();
 const reference=compressFrequencyReference(documents,{...options,includeTrace:false});
 const referenceElapsedMs=elapsedMs(t0),heap1=process.memoryUsage().heapUsed;
 const t1=process.hrtime.bigint(),incremental=compressFrequencyIncremental(documents,{...options,includeTrace:false});
 const incrementalElapsedMs=elapsedMs(t1),heap2=process.memoryUsage().heapUsed;
 const localWork=incremental.work.initialAdjacentInspections+incremental.work.touchedAdjacencyPositions;
 return {schema:'mts-nl/w23c-benchmark/v0',status:'MATCHED_ALGORITHMIC_WORKLOAD',
  documents:documents.length,sourceScalars:documents.reduce((n,d)=>n+[...d.text].length,0),
  rules:incremental.ruleCount,
  reference:{fullScanAdjacentInspections:reference.fullScanAdjacentInspections,
   rankedCandidatesExamined:reference.rankedCandidatesExamined,elapsedMs:referenceElapsedMs,
   observedHeapDeltaBytes:heap1-heap0},
  incremental:{initialAdjacentInspections:incremental.work.initialAdjacentInspections,
   touchedAdjacencyPositions:incremental.work.touchedAdjacencyPositions,
   localAdjacencyWorkProxy:localWork,indexAdditions:incremental.work.indexAdditions,
   indexRemovals:incremental.work.indexRemovals,heapInserts:incremental.work.heapInserts,
   heapUpdates:incremental.work.heapUpdates,heapRemovals:incremental.work.heapRemovals,
   heapPops:incremental.work.heapPops,heapStaleEntries:incremental.work.heapStaleEntries,
   candidateOccurrenceInspections:incremental.work.candidateOccurrenceInspections,
   elapsedMs:incrementalElapsedMs,observedHeapDeltaBytes:heap2-heap1,
   sampledPeakHeapUsedBytes:incremental.sampledPeakHeapUsedBytes},
  adjacencyWorkRatio:reference.fullScanAdjacentInspections?
   +(localWork/reference.fullScanAdjacentInspections).toFixed(6):null,
  timingIsEnvironmentDependent:true,memoryIsSampledNodeHeapNotAllocationAccounting:true};
}