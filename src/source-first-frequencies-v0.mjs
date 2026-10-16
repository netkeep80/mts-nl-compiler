// W11 research-only: count ORIGINAL overlapping Unicode windows before choosing Link topology.
// No word, space, script, punctuation, or lexical segmentation is used to learn.
const error = message => {throw Error('SOURCE_FIRST_W11: '+message);};
const decode = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export function exactScalars(bytes){
 if(!Buffer.isBuffer(bytes))error('Buffer required');
 const s=decode.decode(bytes);
 if(!Buffer.from(s,'utf8').equals(bytes))error('noncanonical UTF-8');
 return [...s];
}
export function collectSourceWindows(documents,{minWidth=2,maxWidth=6,maxDistinct=1600000,maxScalarsPerDocument=16384}={}){
 if(!Array.isArray(documents)||!documents.length||minWidth<2||maxWidth<minWidth||maxWidth>16||maxDistinct<1)error('invalid args');
 const frequency=new Map(),documentFrequency=new Map(),seenIDs=new Set(),samples=[];
 let scalarsTotal=0,windows=0;
 for(const d of documents){
  if(!d||typeof d.id!=='string'||!d.id||seenIDs.has(d.id)||!Buffer.isBuffer(d.bytes))error('invalid/duplicate document');
  seenIDs.add(d.id);
  const cps=exactScalars(d.bytes).slice(0,maxScalarsPerDocument);
  samples.push({id:d.id,scalars:cps});scalarsTotal+=cps.length;
  const seenHere=new Set();
  for(let start=0;start<cps.length;start++){
   let s='';
   for(let j=0;j<maxWidth&&start+j<cps.length;j++){
    s+=cps[start+j];
    if(j+1<minWidth)continue;
    windows++;
    if(!frequency.has(s)&&frequency.size>=maxDistinct)error('RESOURCE_LIMIT distinct windows');
    frequency.set(s,(frequency.get(s)??0)+1);seenHere.add(s);
   }
  }
  for(const s of seenHere)documentFrequency.set(s,(documentFrequency.get(s)??0)+1);
 }
 return {schema:'mts-nl/source-first-histogram/v0',documents:samples,
  frequency,documentFrequency,sourceScalars:scalarsTotal,observedSlidingWindows:windows,minWidth,maxWidth};
}
// Candidate membership is proposed solely by exact overlapping counts and codepoint length.
// Position overlap is resolved only during actual parsing, so these gains are PROXIES.
export function proposeSourceUnits(hist,{maxCandidates=256,minOccurrences=4,minDocumentFrequency=1}={}){
 if(!hist||!(hist.frequency instanceof Map)||!Number.isSafeInteger(maxCandidates)||maxCandidates<1)error('invalid histogram/budget');
 const top=[];
 for(const [text,count] of hist.frequency){
  if(count<minOccurrences||(hist.documentFrequency.get(text)??0)<minDocumentFrequency)continue;
  const length=[...text].length;
  top.push({text,length,count,documents:hist.documentFrequency.get(text),
   upperBound:count*(length-1)});
 }
 top.sort((a,b)=>b.upperBound-a.upperBound||b.count-a.count||
  b.length-a.length||(a.text<b.text?-1:a.text>b.text?1:0));
 return top.slice(0,maxCandidates);
}
function makeTrie(units){
 const root={children:new Map(),item:null};
 for(const unit of units){
  let at=root;
  for(const cp of [...unit.text]){
   if(!at.children.has(cp))at.children.set(cp,{children:new Map(),item:null});
   at=at.children.get(cp);
  }
  at.item=unit;
 }
 return root;
}
export function segmentSource(scalars,units){
 if(!Array.isArray(scalars))error('invalid source symbols');
 const trie=makeTrie(units),dp=new Array(scalars.length+1);
 dp[scalars.length]={score:0,length:0};
 for(let i=scalars.length-1;i>=0;i--){
  let best={score:dp[i+1].score,length:1};
  let at=trie;
  for(let j=i;j<scalars.length&&j<i+16;j++){
   at=at.children.get(scalars[j]);if(!at)break;
   if(!at.item)continue;
   const end=j+1;
   // Reward for reducing parse token count; tie means shorter source-unit.
   // Frequency is already encoded into the frozen membership of the trie.
   const score=end-i-1+dp[end].score;
   if(score>best.score||(score===best.score&&end-i>best.length))
    best={score,length:end-i};
  }
  dp[i]=best;
 }
 const result=[];
 for(let i=0;i<scalars.length;){
  const n=dp[i].length;result.push(scalars.slice(i,i+n).join(''));i+=n;
 }
 if(result.join('')!==scalars.join(''))error('segmentation failed exact replay');
 return result;
}
export class InMemoryLinkGraph{
 constructor(){this.ids=new Map();this.nodes=[];this.roots=[];}
 atom(text){
  if([...text].length!==1&&text!=='')error('non scalar source atom');
  const key='A'+JSON.stringify(text);
  if(this.ids.has(key))return this.ids.get(key);
  const id=this.nodes.length;this.nodes.push({text,left:null,right:null});this.ids.set(key,id);return id;
 }
 pair(left,right){
  const key='P'+left+':'+right;
  if(this.ids.has(key))return this.ids.get(key);
  const id=this.nodes.length;this.nodes.push({left,right,text:null});this.ids.set(key,id);return id;
 }
 balanced(ids,a=0,b=ids.length){
  if(a===b)return this.atom('');
  if(b-a===1)return ids[a];
  const mid=a+Math.floor((b-a)/2);
  return this.pair(this.balanced(ids,a,mid),this.balanced(ids,mid,b));
 }
 textUnit(text){return this.balanced([...text].map(c=>this.atom(c)));}
 add(source,{units=null}={}){
  const scalars=typeof source==='string'?[...source]:source;
  const spans=units?segmentSource(scalars,units):scalars;
  const ids=spans.map(x=>this.textUnit(x));
  const root=this.balanced(ids);this.roots.push(root);
  return {root,expandedScalars:scalars.length,unitCount:spans.length};
 }
 expand(root,{maxScalars=500000}={}){
  const stack=[root],result=[];
  let n=0;
  while(stack.length){
   const id=stack.pop(),node=this.nodes[id];
   if(!node)error('missing node');
   if(node.left===null){n+=[...node.text].length;if(n>maxScalars)error('replay budget');result.push(node.text);}
   else{stack.push(node.right,node.left);}
  }
  return result.join('');
 }
 get physicalLinks(){return this.nodes.length;}
 get reachableLinks(){
  const seen=new Set(),stack=[...this.roots];
  while(stack.length){const x=stack.pop();if(seen.has(x))continue;seen.add(x);
   const n=this.nodes[x];if(n.left!==null)stack.push(n.left,n.right);}
  return seen.size;
 }
}
export function compareSourceFirst(documents,{maxScalarsPerDocument=8192,maxCandidates=256,minOccurrences=4,maxWidth=6,wordOracle=false}={}){
 if(!Array.isArray(documents)||documents.length<5)error('corpus too small');
 const d=documents.map(x=>({id:x.id,bytes:x.bytes}));
 const train=d.filter((_,i)=>i%5!==4),heldout=d.filter((_,i)=>i%5===4);
 const trainHist=collectSourceWindows(train,{maxScalarsPerDocument,maxWidth});
 const candidates=proposeSourceUnits(trainHist,{maxCandidates,minOccurrences});
 const graphs={balanced:new InMemoryLinkGraph(),sourceFirst:new InMemoryLinkGraph()};
 const partition={train:[],heldout:[]};
 const samples=[];
 for(let i=0;i<d.length;i++){
  const text=exactScalars(d[i].bytes).slice(0,maxScalarsPerDocument).join('');
  const mode=i%5===4?'heldout':'train';
  partition[mode].push(d[i].id);samples.push(text);
  for(const [name,graph] of Object.entries(graphs)){
   const r=graph.add(text,{units:name==='sourceFirst'?candidates:null});
   if(graph.expand(r.root)!==text)error('lossless roundtrip mismatch');
  }
 }
 const totalScalars=samples.reduce((n,s)=>n+[...s].length,0);
 return {schema:'mts-nl/source-first-ab/v0',status:'EXACT_REPLAY_PASS',
  trainDocuments:train.length,heldoutDocuments:heldout.length,
  parameters:{maxScalarsPerDocument,maxWidth,maxCandidates,minOccurrences},
  sourceScalars:totalScalars,sourceSlidingWindows:trainHist.observedSlidingWindows,
  frozenCandidateCount:candidates.length,
  topCandidates:candidates.slice(0,20).map(x=>({...x})),
  results:Object.fromEntries(Object.entries(graphs).map(([name,g])=>[name,{physicalLinks:g.physicalLinks,rootReachableLinks:g.reachableLinks}])),
  comparison:{deltaPhysicalLinks:graphs.sourceFirst.physicalLinks-graphs.balanced.physicalLinks,
   deltaReachableLinks:graphs.sourceFirst.reachableLinks-graphs.balanced.reachableLinks},
  split:partition,
  warning:'Research-only physical Link row proxy: in-memory exact structural interning, not SQLite/VACUUM/MDL; both grammars are evaluated on all 60 sources using same frozen training candidates.'};
}

// Source-first hierarchical training: the first frequency pass is on *every*
// original scalar adjacency, not existing balanced-tree nodes. Subsequent
// passes count adjacent grammar units and re-evaluate after every replacement.
export function trainSourceFirstPairGrammar(documents,{maxScalarsPerDocument=8192,maxRules=128,minOccurrences=3}={}){
 if(!Array.isArray(documents)||!documents.length||maxRules<0||maxRules>512||minOccurrences<2)error('bad grammar budget');
 const atoms=new Map(),term=new Map();let next=0;
 const terminal=x=>{
  if(!atoms.has(x)){atoms.set(x,next);term.set(next,{text:x,length:1});next++;}
  return atoms.get(x);
 };
 const sources=[];
 for(const d of documents){
  const cp=exactScalars(d.bytes).slice(0,maxScalarsPerDocument);
  sources.push(cp.map(terminal));
 }
 const rules=[];
 let firstPassObservedPairs=0;
 for(let pass=0;pass<maxRules;pass++){
  const counts=new Map();
  for(const s of sources)for(let i=0;i+1<s.length;i++){
   if(pass===0)firstPassObservedPairs++;
   const key=s[i]+':'+s[i+1];
   let val=counts.get(key);
   if(val)val.frequency++;
   else counts.set(key,{left:s[i],right:s[i+1],frequency:1,key});
  }
  const candidates=[...counts.values()].filter(x=>x.frequency>=minOccurrences)
    .sort((a,b)=>b.frequency-a.frequency||
      (a.key<b.key?-1:a.key>b.key?1:0));
  let accepted=false;
  for(const c of candidates){
   const updated=[],frequencies=[];let total=0;
   for(const seq of sources){
    const out=[];let n=0;
    for(let i=0;i<seq.length;i++){
     if(i+1<seq.length&&seq[i]===c.left&&seq[i+1]===c.right){out.push(next);i++;n++;}
     else out.push(seq[i]);
    }
    updated.push(out);frequencies.push(n);total+=n;
   }
   if(total<minOccurrences)continue;
   const text=term.get(c.left).text+term.get(c.right).text;
   rules.push({token:next,left:c.left,right:c.right,text,
      length:term.get(c.left).length+term.get(c.right).length,
      rawCurrentAdjacentFrequency:c.frequency,disjointReplacements:total});
   term.set(next,{left:c.left,right:c.right,text,length:term.get(c.left).length+term.get(c.right).length});
   next++;sources.splice(0,sources.length,...updated);
   accepted=true;break;
  }
  if(!accepted)break;
 }
 return {atoms,terms:term,rules,firstPassObservedPairs,trainingDocuments:documents.length};
}
export function materializeFrozenPairGrammar(documents,grammar,{maxScalarsPerDocument=8192}={}){
 const graph=new InMemoryLinkGraph(),memo=new Map(),counts=[];
 const word=id=>{
  if(memo.has(id))return memo.get(id);
  const t=grammar.terms.get(id);if(!t)error('invalid local grammar unit');
  const physical=t.left===undefined?graph.atom(t.text):graph.pair(word(t.left),word(t.right));
  memo.set(id,physical);return physical;
 };
 const outputs=[];
 for(const d of documents){
  const cps=exactScalars(d.bytes).slice(0,maxScalarsPerDocument);
  let seq=cps.map(s=>grammar.atoms.get(s)??null);
  const outExtra=[];
  for(let i=0;i<seq.length;i++)if(seq[i]===null){
   const id=-1-i;outExtra.push({id,text:cps[i]});seq[i]=id;
  }
  for(const rule of grammar.rules){
   const out=[];
   for(let i=0;i<seq.length;i++){
    if(i+1<seq.length&&seq[i]===rule.left&&seq[i+1]===rule.right){out.push(rule.token);i++;}
    else out.push(seq[i]);
   }
   seq=out;
  }
  const extras=new Map(outExtra.map(x=>[x.id,x.text]));
  const ids=seq.map(i=>i<0?graph.atom(extras.get(i)):word(i));
  const root=graph.balanced(ids);graph.roots.push(root);
  const original=cps.join('');
  if(graph.expand(root)!==original)error('frozen grammar lossy');
  outputs.push({id:d.id,sourceScalars:cps.length,units:seq.length});
 }
 return {graph,outputs};
}

// A learner is free to hypothesize boundaries AFTER *any* Unicode scalar,
// selected on train-only physical Link reduction: no hard-coded ' ', punctuation,
// Cyrillic, language dictionary, or word/token concept exists in this trainer.
export function trainSingleScalarAnchors(documents,{maxScalarsPerDocument=8192,maxProbe=24,minOccurrences=16}={}){
 const bySymbol=new Map(),neighbors=new Map(),docArrays=[];
 const add=(table,key)=>table.set(key,(table.get(key)??0)+1);
 for(const d of documents){
  const cps=exactScalars(d.bytes).slice(0,maxScalarsPerDocument);docArrays.push(cps);
  for(let i=0;i<cps.length;i++){
   const ch=cps[i];add(bySymbol,ch);
   if(!neighbors.has(ch))neighbors.set(ch,{left:new Map(),right:new Map()});
   const n=neighbors.get(ch);
   if(i>0)add(n.left,cps[i-1]);if(i+1<cps.length)add(n.right,cps[i+1]);
  }
 }
 const entropy=m=>{let total=0,h=0;for(const x of m.values())total+=x;
  for(const x of m.values()){let p=x/total;h-=p*Math.log2(p);}return h;};
 const proposals=[...bySymbol].filter(([s,f])=>f>=minOccurrences).map(([scalar,frequency])=>{
  const {left,right}=neighbors.get(scalar);
  return {scalar,frequency,leftEntropy:entropy(left),rightEntropy:entropy(right),
   predictorScore:Math.log2(1+frequency)*Math.min(entropy(left),entropy(right))};
 }).sort((a,b)=>b.predictorScore-a.predictorScore||a.scalar.localeCompare(b.scalar)).slice(0,maxProbe);
 const evaluate=anchor=>{
  const g=new InMemoryLinkGraph();
  for(const chars of docArrays){
   const units=[];let from=0;
   for(let i=0;i<chars.length;i++)if(chars[i]===anchor){
    units.push(g.textUnit(chars.slice(from,i+1).join('')));from=i+1;
   }
   if(from<chars.length)units.push(g.textUnit(chars.slice(from).join('')));
   const root=g.balanced(units);g.roots.push(root);
   if(g.expand(root)!==chars.join(''))error('anchor exact replay failure');
  }
  return {physicalLinks:g.physicalLinks,rootReachableLinks:g.reachableLinks};
 };
 const baseline=evaluate(null);
 // null is guaranteed not to occur as Unicode scalar but this code path uses
 // single-chunk root, not the original balanced-char reference topology.
 const baselines=new InMemoryLinkGraph();
 for(const c of docArrays)baselines.add(c);
 const balanced={physicalLinks:baselines.physicalLinks,rootReachableLinks:baselines.reachableLinks};
 const scored=proposals.map(x=>({...x,...evaluate(x.scalar)}));
 scored.sort((a,b)=>a.physicalLinks-b.physicalLinks||a.scalar.localeCompare(b.scalar));
 const best=scored.length&&scored[0].physicalLinks<balanced.physicalLinks?scored[0]:null;
 return {selectedScalar:best?.scalar??null,
  ranked:scored,baseline:balanced,singleChunkBaseline:baseline,
  trainingCorpusScalars:docArrays.reduce((s,c)=>s+c.length,0)};
}
export function materializeScalarAnchor(documents,anchor,{maxScalarsPerDocument=8192}={}){
 const g=new InMemoryLinkGraph();let raw=0;
 for(const d of documents){
  const chars=exactScalars(d.bytes).slice(0,maxScalarsPerDocument);
  const chunks=[];let from=0;
  if(anchor!==null){
   for(let i=0;i<chars.length;i++)if(chars[i]===anchor){chunks.push(chars.slice(from,i+1).join(''));from=i+1;}
  }
  if(from<chars.length)chunks.push(chars.slice(from).join(''));
  const units=chunks.map(s=>g.textUnit(s));
  const root=g.balanced(units);g.roots.push(root);
  if(g.expand(root)!==chars.join(''))error('anchor materialization not lossless');
  raw+=chars.length;
 }
 return {graph:g,sourceScalars:raw};
}