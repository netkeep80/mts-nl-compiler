// W12 research: multiple blind, source-frequency-first segmentation techniques.
// Frozen train-only boundary selection, no Unicode category / word / whitespace hints.
import {exactScalars,InMemoryLinkGraph} from './source-first-frequencies-v0.mjs';
const fail=s=>{throw Error('SOURCE_FIRST_METHOD_GRID: '+s);};
const count=(map,k)=>map.set(k,(map.get(k)??0)+1);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function sourceContextProposals(documents,{maxScalarsPerDocument=8192,minFrequency=16,maxProposals=12}={}){
 if(!Array.isArray(documents)||!documents.length||!Number.isSafeInteger(maxProposals)||maxProposals<1||maxProposals>100||minFrequency<1)fail('bad documents/proposals');
 const freq=new Map(),neighbors=new Map();
 let observations=0;
 for(const d of documents){
  if(!d||typeof d.id!=='string'||!Buffer.isBuffer(d.bytes))fail('bad source');
  const cp=exactScalars(d.bytes).slice(0,maxScalarsPerDocument);
  observations+=cp.length;
  for(let i=0;i<cp.length;i++){
   const ch=cp[i];count(freq,ch);
   if(!neighbors.has(ch))neighbors.set(ch,{left:new Map(),right:new Map()});
   const e=neighbors.get(ch);
   if(i>0)count(e.left,cp[i-1]);
   if(i+1<cp.length)count(e.right,cp[i+1]);
  }
 }
 const entropy=m=>{let n=0;for(const v of m.values())n+=v;
  let h=0;for(const v of m.values()){const p=v/n;h-=p*Math.log2(p);}return h;};
 const candidates=[...freq].filter(([,f])=>f>=minFrequency).map(([scalar,frequency])=>{
  const {left,right}=neighbors.get(scalar);
  const leftEntropy=entropy(left),rightEntropy=entropy(right);
  return {scalar,frequency,leftEntropy,rightEntropy,
   predictorScore:Math.log2(1+frequency)*Math.min(leftEntropy,rightEntropy)};
 });
 candidates.sort((a,b)=>b.predictorScore-a.predictorScore||cmp(a.scalar,b.scalar));
 return {observations,proposed:candidates.slice(0,maxProposals),frequencyRank:[...candidates].sort((a,b)=>b.frequency-a.frequency||cmp(a.scalar,b.scalar)).slice(0,maxProposals)};
}
export function splitByBoundaries(source,boundaries=[]){
 if(!Array.isArray(boundaries))fail('bad boundaries');
 const cps=Array.isArray(source)?source:[...source];
 const before=new Set(boundaries.filter(x=>x.side==='before').map(x=>x.scalar));
 const after=new Set(boundaries.filter(x=>x.side==='after').map(x=>x.scalar));
 const chunks=[];let start=0;
 for(let i=0;i<cps.length;i++){
  if(i>start&&before.has(cps[i])){chunks.push(cps.slice(start,i).join(''));start=i;}
  if(after.has(cps[i])){chunks.push(cps.slice(start,i+1).join(''));start=i+1;}
 }
 if(start<cps.length)chunks.push(cps.slice(start).join(''));
 if(cps.length===0)chunks.push('');
 if(chunks.join('')!==cps.join(''))fail('lossy split');
 return chunks;
}
export function materializeMethods(documents,boundaries,{maxScalarsPerDocument=8192,verifyReplay=true}={}){
 const graph=new InMemoryLinkGraph();let sourceScalars=0,unitCount=0;
 const perDocument=[];
 for(const d of documents){
  const cp=exactScalars(d.bytes).slice(0,maxScalarsPerDocument),source=cp.join('');
  const units=splitByBoundaries(cp,boundaries);unitCount+=units.length;sourceScalars+=cp.length;
  const nodes=units.map(x=>graph.textUnit(x));
  const root=graph.balanced(nodes);graph.roots.push(root);
  if(verifyReplay&&graph.expand(root,{maxScalars:maxScalarsPerDocument+1})!==source)fail('replay mismatch '+d.id);
  perDocument.push({id:d.id,sourceScalars:cp.length,units:units.length,
   newlyAllocatedLinks:graph.physicalLinks-(perDocument.at(-1)?.cumulativeLinks??0),cumulativeLinks:graph.physicalLinks});
 }
 return {graph,sourceScalars,unitCount,perDocument,physicalLinks:graph.physicalLinks,rootReachableLinks:graph.reachableLinks};
}
const key=x=>JSON.stringify([x.scalar,x.side]);
export function learnBoundaryMethods(train,{maxScalarsPerDocument=8192,maxProposals=12,maxRounds=3,minFrequency=16}={}){
 if(!Number.isSafeInteger(maxRounds)||maxRounds<1||maxRounds>6)fail('invalid rounds');
 const ctx=sourceContextProposals(train,{maxScalarsPerDocument,maxProposals,minFrequency});
 const unique=[...new Map(ctx.proposed.map(x=>[x.scalar,x])).values()];
 const proposed=unique.flatMap(x=>['after','before'].map(side=>({scalar:x.scalar,side,frequency:x.frequency,score:x.predictorScore})));
 const cache=new Map();
 const scorer=boundaries=>{
  const signature=boundaries.map(key).sort().join('|');
  if(!cache.has(signature))cache.set(signature,materializeMethods(train,boundaries,{maxScalarsPerDocument,verifyReplay:false}).physicalLinks);
  return cache.get(signature);
 };
 const balanced=scorer([]);
 const singles=proposed.map(x=>({...x,trainLinks:scorer([x])}));
 singles.sort((a,b)=>a.trainLinks-b.trainLinks||cmp(key(a),key(b)));
 const singleAfter=singles.find(x=>x.side==='after')??null;
 const singleBefore=singles.find(x=>x.side==='before')??null;
 const bestAfter=singleAfter?.trainLinks<balanced?[{scalar:singleAfter.scalar,side:'after'}]:[];
 const bestBefore=singleBefore?.trainLinks<balanced?[{scalar:singleBefore.scalar,side:'before'}]:[];
 const greedy=(allowed)=>{
  const chosen=[];const trace=[{round:0,trainLinks:balanced}];let baseline=balanced;
  for(let i=0;i<maxRounds;i++){
   const available=singles.filter(x=>allowed.includes(x.side)&&!chosen.some(z=>key(z)===key(x)));
   const scores=available.map(x=>({...x,trainLinks:scorer([...chosen,x])}));
   scores.sort((a,b)=>a.trainLinks-b.trainLinks||cmp(key(a),key(b)));
   if(!scores.length||scores[0].trainLinks>=baseline)break;
   const best=scores[0];chosen.push({scalar:best.scalar,side:best.side});baseline=best.trainLinks;
   trace.push({round:i+1,scalar:best.scalar,side:best.side,trainLinks:baseline});
  }
  return {boundaries:chosen,trace,trainLinks:baseline};
 };
 const bestSingle=singles[0]?.trainLinks<balanced?[{scalar:singles[0].scalar,side:singles[0].side}]:[];
 const entropyFirst=ctx.proposed[0]?[{scalar:ctx.proposed[0].scalar,side:'after'}]:[];
 const frequencyFirst=ctx.frequencyRank[0]?[{scalar:ctx.frequencyRank[0].scalar,side:'after'}]:[];
 return {schema:'mts-nl/W12-blind-boundary-grid/v0',maxScalarsPerDocument,
  balancedTrainLinks:balanced,sourceStatistics:ctx,
  singleRanks:singles.map(x=>({...x})),
  plans:{balanced:[],entropyOnly:entropyFirst,frequencyOnly:frequencyFirst,
   bestAfter,bestBefore,bestSingle,
   greedyAfter:greedy(['after']),greedyBidirectional:greedy(['after','before'])}};
}
export function compareMethodGrid(documents,{maxScalarsPerDocument=8192,maxProposals=12,maxRounds=3,minFrequency=16}={}){
 if(!Array.isArray(documents)||documents.length<5)fail('small corpus');
 const ids=new Set();for(const d of documents){if(ids.has(d.id))fail('duplicate document');ids.add(d.id);}
 const train=documents.filter((_,i)=>i%5!==4),heldout=documents.filter((_,i)=>i%5===4);
 const learned=learnBoundaryMethods(train,{maxScalarsPerDocument,maxProposals,maxRounds,minFrequency});
 const rows=[];
 for(const [name,entry] of Object.entries(learned.plans)){
  const boundaries=Array.isArray(entry)?entry:entry.boundaries;
  const trained=materializeMethods(train,boundaries,{maxScalarsPerDocument});
  const total=materializeMethods([...train,...heldout],boundaries,{maxScalarsPerDocument});
  const perHeldout=heldout.map(x=>materializeMethods([x],boundaries,{maxScalarsPerDocument}).physicalLinks);
  rows.push({method:name,boundaries,trainPhysicalLinks:trained.physicalLinks,
   allPhysicalLinks:total.physicalLinks,heldoutMarginalLinks:total.physicalLinks-trained.physicalLinks,
   heldoutIsolatedLinks:perHeldout,sourceScalars:total.sourceScalars,uniqueRoots:total.graph.roots.length,
   trace:entry?.trace??null,
   exactReplay:true});
 }
 rows.sort((a,b)=>a.allPhysicalLinks-b.allPhysicalLinks||cmp(a.method,b.method));
 return {schema:'mts-nl/W12-source-first-method-grid/v0',status:'EXACT_REPLAY_ALL_PASS',
  corpus:{books:documents.length,train:train.length,heldout:heldout.length,
   maxScalarsPerDocument,sourceScalars:rows[0].sourceScalars},
  candidateScores:learned.singleRanks,rows};
}