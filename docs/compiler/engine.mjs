// W21: browser-safe, session-local, exact Unicode Link-DAG playground.
// Adapted from W4's adjacent-pair, non-overlap Re-Pair principle, NOT SQLite W4.
// Numeric IDs are local creation ordinals; never persistent physical MTS Link IDs.
// No word splitting, semantics, probabilities, or train/heldout claims.
const fail=message=>{throw new Error('WEB_LINK: '+message);};
export function scalarsOf(text){
 if(typeof text!=='string')fail('Unicode string required');
 const arr=[...text];
 if(arr.some(ch=>{const cp=ch.codePointAt(0);return cp>=0xD800&&cp<=0xDFFF;}))
  fail('unpaired UTF-16 surrogate');
 return arr;
}
const compare=(a,b)=>a<b?-1:a>b?1:0;
const textPreview=(text,max=72)=>{
 const chars=[...text];return chars.length>max?chars.slice(0,max).join('')+'…':text;
};
class BrowserLinkGraph{
 constructor(){this.nodes=[null];this.atoms=new Map();this.pairs=new Map();}
 atom(char){
  let id=this.atoms.get(char);if(id!==undefined)return id;
  id=this.nodes.length;
  this.nodes.push(Object.freeze({id,kind:'atom',symbol:char,length:1,preview:char}));
  this.atoms.set(char,id);return id;
 }
 pair(from,to){
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<1||
   from>=this.nodes.length||to>=this.nodes.length)fail('invalid numeric poles');
  const key=from+','+to;let id=this.pairs.get(key);
  if(id!==undefined)return id;
  const a=this.nodes[from],b=this.nodes[to];
  id=this.nodes.length;
  // A previously truncated left prefix must never acquire characters from the right.
  const preview=a.length>72?a.preview:textPreview(a.preview+b.preview);
  this.nodes.push(Object.freeze({id,kind:'pair',from,to,length:a.length+b.length,preview}));
  this.pairs.set(key,id);return id;
 }
 decode(root){
  if(root===null)return '';
  if(!this.nodes[root])fail('unknown root');
  let out='',seen=0;const stack=[root];
  while(stack.length){
   const node=this.nodes[stack.pop()];
   if(node.kind==='atom'){out+=node.symbol;seen++;if(seen>4096)fail('replay exceeded bound');}
   else{stack.push(node.to);stack.push(node.from);}
  }
  return out;
 }
 stats(root,expectedLength){
  const uses=Array(this.nodes.length).fill(0);
  if(root!==null)uses[root]=1;
  for(let i=this.nodes.length-1;i>0;i--){
   const node=this.nodes[i];
   if(node.kind==='pair'&&uses[i]){uses[node.from]+=uses[i];uses[node.to]+=uses[i];}
  }
  const reached=this.nodes.slice(1).filter(n=>uses[n.id]>0);
  const pairs=reached.filter(x=>x.kind==='pair');
  const atoms=reached.filter(x=>x.kind==='atom');
  const pairOccurrences=pairs.reduce((a,n)=>a+uses[n.id],0);
  const atomOccurrences=atoms.reduce((a,n)=>a+uses[n.id],0);
  if(atomOccurrences!==expectedLength||pairOccurrences!==Math.max(0,expectedLength-1))
   fail('expanded occurrence graph invariant');
  return Object.freeze({
   root,uniqueAtoms:atoms.length,uniquePairs:pairs.length,uniqueLinks:reached.length,
   pairOccurrences,atomOccurrences,reusedPairOccurrences:pairOccurrences-pairs.length,
   reuseRate:pairOccurrences?(pairOccurrences-pairs.length)/pairOccurrences:0,
   uses,topPairs:pairs.map(n=>({...n,uses:uses[n.id]}))
    .sort((a,b)=>b.uses-a.uses||a.id-b.id)
  });
 }
}
function group(graph,units,mode){
 if(!units.length)return null;
 if(mode==='left'){let root=units[0];for(let i=1;i<units.length;i++)root=graph.pair(root,units[i]);return root;}
 const rec=(start,end)=>{
  if(end-start===1)return units[start];
  const half=start+Math.floor((end-start)/2);
  return graph.pair(rec(start,half),rec(half,end));
 };
 return rec(0,units.length);
}
// Same core idea as src/universal-repair-numeric-v0.mjs: count adjacent
// current tokens; confirm NON-OVERLAPPING substitutions; recurse.
// The browser learns from ONE user input, not the W4 independent book corpus.
export function learnLocalPairs(symbols,{maxRules=48,minOccurrences=2,maxRuleCodepoints=64}={}){
 if(!Number.isInteger(maxRules)||maxRules<0||maxRules>128||
  !Number.isInteger(minOccurrences)||minOccurrences<2||minOccurrences>100||
  !Number.isInteger(maxRuleCodepoints)||maxRuleCodepoints<2||maxRuleCodepoints>256)
  fail('invalid research limits');
 let next=1;
 const terminal=new Map(),terms=new Map(),rules=[];
 const terminalToken=ch=>{
  if(terminal.has(ch))return terminal.get(ch);
  const id=next++;terminal.set(ch,id);
  terms.set(id,Object.freeze({token:id,text:ch,length:1}));
  return id;
 };
 let seq=symbols.map(terminalToken);
 for(let iter=0;iter<maxRules;iter++){
  const counts=new Map();
  for(let i=0;i+1<seq.length;i++){
   const a=seq[i],b=seq[i+1];
   const length=terms.get(a).length+terms.get(b).length;
   if(length>maxRuleCodepoints)continue;
   const key=a+','+b,c=counts.get(key);
   if(c)c.frequency++;
   else counts.set(key,{left:a,right:b,length,frequency:1,key});
  }
  const ranked=[...counts.values()].filter(x=>x.frequency>=minOccurrences)
   .sort((a,b)=>b.frequency-a.frequency||compare(a.key,b.key));
  let chosen=null,newSequence=null,replacementCount=0;
  for(const c of ranked){
   const out=[];let used=0;
   for(let i=0;i<seq.length;i++){
    if(i+1<seq.length&&seq[i]===c.left&&seq[i+1]===c.right){
     out.push(next);i++;used++;
    }else out.push(seq[i]);
   }
   if(used>=minOccurrences){chosen=c;newSequence=out;replacementCount=used;break;}
  }
  if(!chosen)break;
  const text=terms.get(chosen.left).text+terms.get(chosen.right).text;
  const rule=Object.freeze({
   token:next,left:chosen.left,right:chosen.right,text,
   length:chosen.length,observedAdjacent:chosen.frequency,
   disjointReplacements:replacementCount
  });
  rules.push(rule);terms.set(next,rule);next++;seq=newSequence;
 }
 return {terminal,terms,rules,sequence:seq};
}
export function compileText(text,{mode='repair',maxCodepoints=2048,
 maxRules=48,minOccurrences=2,maxRuleCodepoints=64}={}){
 if(!['balanced','left','repair'].includes(mode))fail('invalid grouping mode');
 if(!Number.isInteger(maxCodepoints)||maxCodepoints<1||maxCodepoints>4096)
  fail('invalid scalar resource cap');
 const chars=scalarsOf(text);
 if(chars.length>maxCodepoints)fail('limit exceeded: '+maxCodepoints+' Unicode scalars');
 const graph=new BrowserLinkGraph();
 let learned={rules:[],sequence:[],terms:new Map()};
 let units=[];
 if(mode==='repair'&&chars.length){
  learned=learnLocalPairs(chars,{maxRules,minOccurrences,maxRuleCodepoints});
  const memo=new Map();
  const materialize=token=>{
   if(memo.has(token))return memo.get(token);
   const t=learned.terms.get(token);
   if(!t)fail('unresolved grammar token');
   const id=t.left===undefined?graph.atom(t.text):graph.pair(materialize(t.left),materialize(t.right));
   memo.set(token,id);return id;
  };
  units=learned.sequence.map(materialize);
 }else units=chars.map(ch=>graph.atom(ch));
 const root=group(graph,units,mode==='left'?'left':'balanced');
 const replay=graph.decode(root);
 if(replay!==text)fail('lossless roundtrip mismatch');
 const stats=graph.stats(root,chars.length);
 return {
  schema:'mts-nl/browser-link-experiment/v1',status:chars.length?'EXACT_REPLAY_PASS':'EMPTY_INPUT',
  mode,source:text,scalars:chars.length,utf8Bytes:new TextEncoder().encode(text).length,
  trainingMode:mode==='repair'?'IN_SAMPLE_SINGLE_TEXT_ONLY':'NO_TRAINING',
  learnedRules:learned.rules,finalUnits:units.length,
  nodes:graph.nodes.slice(1),root,metrics:{
   uniqueAtoms:stats.uniqueAtoms,uniquePairs:stats.uniquePairs,uniqueLinks:stats.uniqueLinks,
   expandedAtomOccurrences:stats.atomOccurrences,expandedPairOccurrences:stats.pairOccurrences,
   reusedPairOccurrences:stats.reusedPairOccurrences,reuseRate:stats.reuseRate,
   learnedRules:learned.rules.length
  },
  topPairs:stats.topPairs,
  localLinkIdWarning:'Numbers are session-local DAG ordinals, not SQLite AUTOINCREMENT persistent physical Link identities',
  scientificWarning:'Structure and exact Unicode replay only; in-sample pair discovery is not semantics, probability, or independent compression benchmark'
 };
}
export function compareModes(text,options={}){
 const modes=['balanced','left','repair'];
 const comparisons=modes.map(mode=>{
  const r=compileText(text,{...options,mode});
  return {mode,status:r.status,uniquePairs:r.metrics.uniquePairs,
   uniqueAtoms:r.metrics.uniqueAtoms,uniqueLinks:r.metrics.uniqueLinks,
   reusedPairOccurrences:r.metrics.reusedPairOccurrences,
   expandedPairOccurrences:r.metrics.expandedPairOccurrences,
   learnedRules:r.metrics.learnedRules,finalUnits:r.finalUnits};
 });
 return Object.freeze(comparisons);
}
