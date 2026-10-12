// W19 B1: a deliberately restricted synthetic substring-slot oracle.
// No word tokenizer, morphology tags, probability weight, Γ or semantic verdict.
// Each training document is a complete observed surface; document boundaries are GIVEN.
// Never interpret an unseen cross-product as semantically valid.
const bad=s=>{throw new Error('W19_B1: '+s);};
export function exactScalars(s){
  if(typeof s!=='string')bad('expected Unicode string');
  const a=[...s];
  if(a.some(c=>{const n=c.codePointAt(0);return n>=0xD800&&n<=0xDFFF;}))bad('unpaired UTF-16 surrogate');
  return a;
}
const keyOf=s=>JSON.stringify(s);
export class SlotLinkDAG{
  constructor(){this.nodes=[];this.atoms=new Map();this.pairs=new Map();}
  atom(c){
    let n=this.atoms.get(c);if(n!==undefined)return n;
    n=this.nodes.length;this.nodes.push(Object.freeze({atom:c}));this.atoms.set(c,n);return n;
  }
  pair(l,r){
    const k=l+':'+r;let n=this.pairs.get(k);if(n!==undefined)return n;
    n=this.nodes.length;this.nodes.push(Object.freeze({from:l,to:r}));this.pairs.set(k,n);return n;
  }
  encode(s){
    const a=exactScalars(s);
    if(!a.length)bad('empty segment');
    const recur=(x,y)=>y-x===1?this.atom(a[x]):this.pair(recur(x,x+Math.floor((y-x)/2)),recur(x+Math.floor((y-x)/2),y));
    return recur(0,a.length);
  }
  decode(id){
    if(!Number.isSafeInteger(id)||id<0||id>=this.nodes.length)bad('invalid Link ID');
    const stack=[id],out=[];
    while(stack.length){
      const v=this.nodes[stack.pop()];
      if(Object.hasOwn(v,'atom'))out.push(v.atom);
      else{stack.push(v.to);stack.push(v.from);}
    }
    return out.join('');
  }
  get stats(){return {atoms:this.atoms.size,pairs:this.pairs.size,nodes:this.nodes.length};}
}
export function trainProductiveSlots(forms,{minDegree=2,maxSurfaceScalars=64}={}){
  if(!Array.isArray(forms)||forms.length<2||!Number.isInteger(minDegree)||minDegree<2
    ||!Number.isInteger(maxSurfaceScalars)||maxSurfaceScalars<3||maxSurfaceScalars>1024)bad('invalid training budget');
  const items=forms.map(s=>{
    const a=exactScalars(s);
    if(a.length<2||a.length>maxSurfaceScalars)bad('invalid observed surface length');
    return a;
  });
  let best=null;
  const limit=Math.max(...items.map(x=>x.length));
  for(let split=1;split<limit;split++){
    const entries=items.filter(a=>a.length>split).map(a=>({prefix:a.slice(0,split).join(''),suffix:a.slice(split).join('')}));
    const left=new Map(),right=new Map();
    for(const e of entries){
      if(!left.has(e.prefix))left.set(e.prefix,new Set());
      if(!right.has(e.suffix))right.set(e.suffix,new Set());
      left.get(e.prefix).add(e.suffix);right.get(e.suffix).add(e.prefix);
    }
    const supported=entries.filter(e=>left.get(e.prefix).size>=minDegree&&right.get(e.suffix).size>=minDegree);
    const l=new Set(supported.map(e=>e.prefix)),r=new Set(supported.map(e=>e.suffix));
    // Every trial split has exactly the same scan budget.  No lexical knowledge.
    if(l.size<2||r.size<2||supported.length<4)continue;
    const candidate={split,supported,score:supported.length,prefixTypes:l.size,suffixTypes:r.size};
    if(best===null||candidate.score>best.score
      ||candidate.score===best.score&&candidate.split<best.split)best=candidate;
  }
  if(!best)return Object.freeze({status:'UNKNOWN_NO_PRODUCTIVE_SLOT',trainingDocuments:forms.length,
    propose:()=>[],graph:null,split:null,trainingSet:new Set(forms)});
  const graph=new SlotLinkDAG(),prefixCount=new Map(),suffixCount=new Map(),observed=new Set();
  for(const e of best.supported){
    prefixCount.set(e.prefix,(prefixCount.get(e.prefix)??0)+1);
    suffixCount.set(e.suffix,(suffixCount.get(e.suffix)??0)+1);
    observed.add(keyOf([e.prefix,e.suffix]));
    const root=graph.pair(graph.encode(e.prefix),graph.encode(e.suffix));
    if(graph.decode(root)!==e.prefix+e.suffix)bad('source replay mismatch');
  }
  const prefixes=[...prefixCount.keys()].sort(),suffixes=[...suffixCount.keys()].sort();
  const trainingRoots=graph.stats;
  function score(prefix,suffix){
    if(!prefixCount.has(prefix)||!suffixCount.has(suffix))return null;
    // Uncalibrated product of empirical component frequencies; no semantic probability.
    return prefixCount.get(prefix)*suffixCount.get(suffix);
  }
  function inspect(surface){
    const a=exactScalars(surface);
    if(a.length<=best.split)return {status:'OUTSIDE_MODEL',score:null,seen:false};
    const p=a.slice(0,best.split).join(''),s=a.slice(best.split).join('');
    const value=score(p,s);
    return {status:value===null?'OUTSIDE_MODEL':'STRUCTURAL_CANDIDATE',
      score:value,seen:observed.has(keyOf([p,s])),prefix:p,suffix:s};
  }
  function propose(){
    const out=[];
    for(const p of prefixes)for(const s of suffixes){
      if(observed.has(keyOf([p,s])))continue;
      out.push({surface:p+s,prefix:p,suffix:s,score:score(p,s),status:'UNSEEN_STRUCTURAL_CANDIDATE'});
    }
    out.sort((a,b)=>b.score-a.score||a.surface.localeCompare(b.surface,'und'));
    return out;
  }
  return Object.freeze({status:'PRODUCTIVE_STRUCTURAL_HYPOTHESIS',trainingDocuments:forms.length,
    supportedEvents:best.supported.length,split:best.split,score:best.score,
    prefixTypes:prefixes.length,suffixTypes:suffixes.length,
    trainingRoots,graph,prefixes,suffixes,inspect,propose,
    trainingSet:new Set(forms)});
}
export function trainCharBaseline(forms,{order=2,alpha=0.5}={}){
  if(!Array.isArray(forms)||!forms.length||!Number.isInteger(order)||order<0||order>8
     ||!(alpha>0)||!Number.isFinite(alpha))bad('invalid n-gram baseline');
  const rows=Array.from({length:order+1},()=>new Map());
  const alphabet=new Set();
  const items=forms.map(s=>exactScalars(s));
  for(const a of items)for(const c of a)alphabet.add(c);
  for(const a of items)for(let i=0;i<a.length;i++)
    for(let k=0;k<=Math.min(order,i);k++){
      const ctx=keyOf(a.slice(i-k,i));let row=rows[k].get(ctx);
      if(!row){row={total:0,counts:new Map()};rows[k].set(ctx,row);}
      row.total++;row.counts.set(a[i],(row.counts.get(a[i])??0)+1);
    }
  return Object.freeze({order,vocabularySize:alphabet.size,score(surface){
    const a=exactScalars(surface);let bits=0;
    for(let i=0;i<a.length;i++){
      if(!alphabet.has(a[i]))return null;
      for(let k=Math.min(order,i);k>=0;k--){
        const row=rows[k].get(keyOf(a.slice(i-k,i)));
        if(!row)continue;
        bits+=Math.log2(((row.counts.get(a[i])??0)+alpha)/(row.total+alpha*alphabet.size));
        break;
      }
    }
    return bits; // unnormalized whole-form log-score, SAME-LENGTH probes only
  }});
}
