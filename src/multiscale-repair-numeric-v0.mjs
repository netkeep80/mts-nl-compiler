// W5: simultaneous multi-scale pair induction, no linguistic boundaries.
// Bounded grammar labels are transient integers, NEVER persistent SQLite IDs.
const bad=s=>{throw Error('MULTISCALE_REPAIR: '+s);};
const read=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const now=()=>process.hrtime.bigint(),millis=t=>+(Number(now()-t)/1e6).toFixed(3);
const key=(a,b)=>a+','+b;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
export function trainMultiscaleRepair(documents,{
 maxCodepointsPerBook=16384,maxLevels=10,
 maxRulesPerLevel=256,maxRuleCodepoints=128,minOccurrences=3
}={}){
 if(!Array.isArray(documents)||!documents.length||
 !Number.isSafeInteger(maxCodepointsPerBook)||maxCodepointsPerBook<2||
 !Number.isSafeInteger(maxLevels)||maxLevels<1||maxLevels>32||
 !Number.isSafeInteger(maxRulesPerLevel)||maxRulesPerLevel<1||maxRulesPerLevel>1024||
 !Number.isSafeInteger(maxRuleCodepoints)||maxRuleCodepoints<2||maxRuleCodepoints>512||
 !Number.isSafeInteger(minOccurrences)||minOccurrences<2)bad('invalid training bounds');
 const started=now(),symbols=new Map(),terms=new Map(),rules=[],sources=[];
 let next=1,total=0;
 const ids=new Set();
 const symbol=c=>{
  if(symbols.has(c))return symbols.get(c);
  const token=next++;symbols.set(c,token);terms.set(token,{text:c,length:1});return token;
 };
 for(const d of documents){
  if(!d||typeof d.id!=='string'||!d.id||ids.has(d.id)||!Buffer.isBuffer(d.bytes))
   bad('invalid/duplicate document');
  ids.add(d.id);
  const source=read.decode(d.bytes);
  if(!Buffer.from(source,'utf8').equals(d.bytes))bad('source not exact UTF-8');
  const atoms=[...source].slice(0,maxCodepointsPerBook);
  total+=atoms.length;sources.push(atoms.map(symbol));
 }
 let countingMs=0,selectionMs=0,nonoverlapTotal=0;
 const levels=[];
 for(let level=0;level<maxLevels;level++){
  const startCount=now(),counts=new Map();
  for(const source of sources)for(let i=0;i+1<source.length;i++){
   const left=source[i],right=source[i+1];
   const length=terms.get(left).length+terms.get(right).length;
   if(length>maxRuleCodepoints)continue;
   const k=key(left,right),v=counts.get(k);
   if(v)v.frequency++;
   else counts.set(k,{left,right,key:k,frequency:1,length});
  }
  countingMs+=Number(now()-startCount)/1e6;
  // Reward the number of disjoint source positions potentially saved,
  // rather than frequency alone. Still a heuristic, not global MDL.
  const eligible=[...counts.values()].filter(x=>x.frequency>=minOccurrences)
   .sort((a,b)=>{
    const ga=(a.frequency-1)*(a.length-1),gb=(b.frequency-1)*(b.length-1);
    return gb-ga||b.frequency-a.frequency||cmp(a.key,b.key);
   }).slice(0,maxRulesPerLevel);
  if(!eligible.length)break;
  const startSelect=now(),candidates=new Map(),byToken=new Map();
  for(const choice of eligible){
   const token=next++;
   candidates.set(choice.key,token);
   byToken.set(token,choice);
  }
  const drafted=[],uses=new Map();
  for(const source of sources){
   const chosen=[];
   for(let i=0;i<source.length;i++){
    let token;
    if(i+1<source.length)
     token=candidates.get(key(source[i],source[i+1]));
    if(token!==undefined){
     chosen.push(token);uses.set(token,(uses.get(token)??0)+1);i++;
    }else chosen.push(source[i]);
   }
   drafted.push(chosen);
  }
  const accepted=new Map();
  for(const [token,choice] of byToken){
   const realized=uses.get(token)??0;
   if(realized<minOccurrences)continue;
   const text=terms.get(choice.left).text+terms.get(choice.right).text;
   const rule={token,left:choice.left,right:choice.right,
    text,length:choice.length,
    trainingDisjointReplacements:realized,
    trainingOverlappingPairObservations:choice.frequency,level};
   accepted.set(token,rule);rules.push(rule);
   terms.set(token,{text,length:choice.length,left:choice.left,right:choice.right});
   nonoverlapTotal+=realized;
  }
  if(!accepted.size)break;
  const rewritten=drafted.map(sequence=>{
   const out=[];
   for(const t of sequence){
    if(!byToken.has(t)||accepted.has(t))out.push(t);
    else{const choice=byToken.get(t);out.push(choice.left,choice.right);}
   }
   return out;
  });
  sources.splice(0,sources.length,...rewritten);
  selectionMs+=Number(now()-startSelect)/1e6;
  levels.push({level,acceptedRules:accepted.size,
   disjointReplacements:[...accepted.values()].reduce((n,x)=>n+x.trainingDisjointReplacements,0),
   maxExpandedLength:Math.max(...[...accepted.values()].map(x=>x.length))});
 }
 return {schema:'mts-nl/multiscale-universal-grammar/v0',
  method:'bounded parallel adjacent-pair levels with realized non-overlap and structural-gain priority',
  parameters:{maxCodepointsPerBook,maxLevels,maxRulesPerLevel,
   maxRuleCodepoints,minOccurrences},
  trainingDocuments:documents.length,trainingSampledCodepoints:total,
  terminalSymbols:symbols.size,ruleCount:rules.length,levels,
  trainingDisjointReplacements:nonoverlapTotal,
  elapsedMs:millis(started),pairCountingMs:+countingMs.toFixed(3),
  nonoverlapSelectionMs:+selectionMs.toFixed(3),
  symbols,terms,rules};
}
