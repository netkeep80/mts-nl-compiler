// E2: deterministic corpus-wide adjacent-pair grammar oracle.
// Pure structural baseline (BPE/Re-Pair-like); NOT native FORMAL/Γ/MP.
// Input occurrences come only from original source strings. Rewrites create
// alternate DAG representations but NEVER new independent observations.
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";
import {encodePackedGraph,decodePackedGraph} from "./packed-dag-e1.mjs";
import {atomProfile,pairProfile,topAdjacentCandidates,topExpandedDupletLinks}
 from "./pair-frequency-e2.mjs";
import {buildContentStableRoot} from "./content-stable-grouping-e3.mjs";
const hash=s=>createHash("sha256").update(s).digest("hex");
const fail=s=>{throw Error("E2 observed-pair oracle: "+s);};
const compare=(a,b)=>a<b?-1:a>b?1:0;
function checkedDoc(d){
 if(!d||typeof d.id!=="string"||!d.id||typeof d.source!=="string"||
   typeof d.inputSha256!=="string"||!/^[0-9a-f]{64}$/.test(d.inputSha256))
  fail("invalid source document");
 if(hash(Buffer.from(d.source,"utf8"))!==d.inputSha256)fail("source hash mismatch");
}
export function learnObservedPairGrammar(documents,{
 maxRounds=128,minOccurrences=2,diagnosticTopN=0,diagnosticCheckpoints=[],
 rootGrouping="balanced"
}={}){
 if(!Array.isArray(documents)||documents.length===0||documents.length>1000)
  fail("invalid external documents");
 if(!Number.isSafeInteger(maxRounds)||maxRounds<0||maxRounds>5000||
    !Number.isSafeInteger(minOccurrences)||minOccurrences<2)
  fail("invalid grammar budget");
 if(!Number.isSafeInteger(diagnosticTopN)||diagnosticTopN<0||diagnosticTopN>50||
    !Array.isArray(diagnosticCheckpoints)||
    diagnosticCheckpoints.some(x=>!Number.isSafeInteger(x)||x<0||x>maxRounds))
  fail("invalid diagnostic arguments");
 if(!["balanced","content-stable"].includes(rootGrouping))fail("invalid rootGrouping");
 const checkpointSet=new Set(diagnosticCheckpoints);
 const diagnostics=[];
 const docs=[...documents].sort((a,b)=>compare(a.id,b.id));
 const ids=new Set();for(const d of docs){checkedDoc(d);if(ids.has(d.id))fail("duplicate doc ID");ids.add(d.id);}
 const alphabet=[...new Set(docs.flatMap(d=>[...d.source]))].sort(compare);
 const symbolIndex=new Map(alphabet.map((s,i)=>[s,i]));
 const profiles=alphabet.map(atomProfile);
 let sequences=docs.map(d=>[...d.source].map(s=>symbolIndex.get(s)));
 const definitions=new Map();
 const seenPair=new Map(),metrics=[];
 let next=alphabet.length;
 for(let round=0;round<maxRounds;round++){
  const counts=new Map();
  for(const items of sequences){
   for(let i=0;i+1<items.length;i++){
    const a=items[i],b=items[i+1],k=a+","+b;
    const p=counts.get(k);
    if(p)p.count++;
    else counts.set(k,{a,b,count:1});
   }
  }
  if(diagnosticTopN&&checkpointSet.has(round))
   diagnostics.push(topAdjacentCandidates({sequences,counts,profiles,docs,round,topN:diagnosticTopN}));
  let best=null;
  for(const candidate of counts.values()){
   if(candidate.count<minOccurrences)continue;
   if(best===null||candidate.count>best.count||
     (candidate.count===best.count&&(candidate.a<best.a||
      (candidate.a===best.a&&candidate.b<best.b))))best=candidate;
  }
  if(!best)break;
  const key=best.a+","+best.b;
  let symbol=seenPair.get(key);
  if(symbol===undefined){
   symbol=next++;definitions.set(symbol,[best.a,best.b]);seenPair.set(key,symbol);
   profiles[symbol]=pairProfile(profiles[best.a],profiles[best.b]);
  }
  let count=0;
  sequences=sequences.map(items=>{
   const out=[];
   for(let i=0;i<items.length;i++){
    if(i+1<items.length&&items[i]===best.a&&items[i+1]===best.b){
     out.push(symbol);count++;i++;
    }else out.push(items[i]);
   }
   return out;
  });
  if(count<1)fail("selected pair was not observed");
  metrics.push({round:round+1,a:best.a,b:best.b,
   countedOverlaps:best.count,actualNonOverlappingReplacements:count});
 }
 // Capture state after the last requested round (including a 0-round run).
 if(diagnosticTopN&&checkpointSet.has(metrics.length)&&
    !diagnostics.some(x=>x.round===metrics.length)){
  const counts=new Map();
  for(const items of sequences)for(let i=0;i+1<items.length;i++){
   const a=items[i],b=items[i+1],k=a+","+b,p=counts.get(k);
   if(p)p.count++;else counts.set(k,{a,b,count:1});
  }
  diagnostics.push(topAdjacentCandidates({sequences,counts,profiles,docs,
   round:metrics.length,topN:diagnosticTopN}));
 }
 // Convert learned substitutions to ordinary *binary* Link DAG records.
 // This is not an additional subject ontology; all definitions are pairs.
 const byToken=new Map(),rows=new Map();
 function putAtom(text){
  const id="a:"+hash(JSON.stringify(text));
  if(!rows.has(id))rows.set(id,{link_id:id,from_id:null,to_id:null,string:text,weight:null});
  return id;
 }
 function putPair(a,b){
  const id="p:"+hash(JSON.stringify([a,b]));
  if(!rows.has(id))rows.set(id,{link_id:id,from_id:a,to_id:b,string:null,weight:null});
  return id;
 }
 for(let i=0;i<alphabet.length;i++)byToken.set(i,putAtom(alphabet[i]));
 for(const [id,[a,b]] of definitions){
  const left=byToken.get(a),right=byToken.get(b);
  if(left===undefined||right===undefined)fail("bad learned grammar ordering");
  byToken.set(id,putPair(left,right));
 }
 function tree(items,a,b){
  if(b===a) return putAtom("");
  if(b-a===1)return byToken.get(items[a]);
  const cut=a+Math.floor((b-a)/2);
  return putPair(tree(items,a,cut),tree(items,cut,b));
 }
 const groupingStats=[];
 const roots=sequences.map((items,i)=>{
  let rootLink;
  if(rootGrouping==="balanced")rootLink=tree(items,0,items.length);
  else{
   const result=buildContentStableRoot(items.map(id=>{
    const link=byToken.get(id);
    if(link===undefined)fail("selected token missing native Link identity");
    return link;
   }),putPair,()=>putAtom(""));
   rootLink=result.root;
   groupingStats.push({document:docs[i].id,layers:result.layers,
    anchors:result.anchors,fallbackPairs:result.fallbackPairs});
  }
  return {id:docs[i].id,inputSha256:docs[i].inputSha256,rootLink};
 });
 const collected=[...rows.values()];
 const packet=encodePackedGraph(collected,roots);
 const decoded=decodePackedGraph(packet);
 if(decoded.documents.length!==docs.length)fail("decoded doc count mismatch");
 for(let i=0;i<docs.length;i++)
  if(decoded.documents[i].id!==docs[i].id||
     !decoded.documents[i].bytes.equals(Buffer.from(docs[i].source,"utf8")))
   fail("exact real source replay mismatch "+docs[i].id);
 if(!encodePackedGraph(decoded.rows,decoded.documents).equals(packet))
  fail("noncanonical binary grammar replay");
 const originalObservedCodepoints=docs.reduce((n,d)=>n+[...d.source].length,0);
 const remainingPositions=sequences.reduce((n,s)=>n+s.length,0);
 return {
  binaryBytes:packet.length,
  binaryGzipBytes:gzipSync(packet,{level:6}).length,
  graphRows:decoded.rows.length,
  graphPairRows:decoded.rows.filter(r=>r.from_id!==null).length,
  rootGrouping,groupingStats,
  initialCodepoints:originalObservedCodepoints,
  remainingPositions,substitutionRounds:metrics.length,
  uniqueLearnedRules:definitions.size,roundDetails:metrics,
  documents:roots,
  diagnostics:diagnosticTopN?{
   adjacentAtCheckpoints:diagnostics,
   topStructuralLinks:topExpandedDupletLinks(decoded.rows,roots,diagnosticTopN),
   topLongLinks:[5,10,20].map(minimumCodepoints=>
    topExpandedDupletLinks(decoded.rows,roots,diagnosticTopN,{minimumCodepoints}))
  }:null,
  status:"E2_GREEDY_PAIR_GRAMMAR_EXACT_ROUNDTRIP_PASS",
  explanation:"Observed adjacent-symbol grammar oracle; not native Gamma or probabilistic MP"
 };
}
