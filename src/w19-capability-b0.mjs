// W19/B0: research baseline only. Observations are source positions, never Link pole degrees.
// A Link is used exclusively as a reversible key for an ordered Unicode-scalar context.
// Predictive equality to the ordinary n-gram table is the null hypothesis, not a success claim.
import {createHash} from 'node:crypto';

const fail=(reason)=>{throw new Error('W19_B0: '+reason);};
export function scalars(input){
  if(typeof input!=='string')fail('text must be a Unicode string');
  const chars=[...input];
  if(chars.some(c=>{const cp=c.codePointAt(0);return cp>=0xd800&&cp<=0xdfff;}))fail('unpaired UTF-16 surrogate');
  return chars;
}
const scalarOrder=(a,b)=>a.codePointAt(0)-b.codePointAt(0);
export function corpusDigest(documents){
  const h=createHash('sha256');
  for(const value of documents){
    scalars(value);
    const bytes=Buffer.from(value,'utf8');
    const length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(bytes.length));
    h.update(length);h.update(bytes);
  }
  return h.digest('hex');
}
export class ContextLinkGraph{
  constructor(shape='left'){
    if(!['left','balanced'].includes(shape))fail('invalid Link grouping');
    this.shape=shape;this.nodes=[];this.atoms=new Map();this.pairs=new Map();
  }
  atom(c,create=true){
    if(this.atoms.has(c))return this.atoms.get(c);
    if(!create)return null;
    const id=this.nodes.length;this.atoms.set(c,id);
    this.nodes.push(Object.freeze({kind:'atom',scalar:c}));return id;
  }
  pair(l,r,create=true){
    if(l===null||r===null)return null;
    const key=l+','+r;
    if(this.pairs.has(key))return this.pairs.get(key);
    if(!create)return null;
    const id=this.nodes.length;this.pairs.set(key,id);
    this.nodes.push(Object.freeze({kind:'pair',from:l,to:r}));return id;
  }
  encode(chars,{create=true}={}){
    if(!chars.length)return -1;
    const build=(lo,hi)=>{
      if(hi-lo===1)return this.atom(chars[lo],create);
      const cut=this.shape==='left'?hi-1:lo+Math.floor((hi-lo)/2);
      return this.pair(build(lo,cut),build(cut,hi),create);
    };
    return build(0,chars.length);
  }
  decode(id){
    if(id===-1)return '';
    if(!Number.isSafeInteger(id)||id<0||id>=this.nodes.length)fail('bad Link key');
    const stack=[id],out=[];
    while(stack.length){
      const node=this.nodes[stack.pop()];
      if(node.kind==='atom')out.push(node.scalar);
      else{stack.push(node.to);stack.push(node.from);}
    }
    return out.join('');
  }
  get stats(){return {nodes:this.nodes.length,atoms:this.atoms.size,pairs:this.pairs.size};}
}
export function trainContextPredictor(documents,{order=2,alpha=0.5,representation='raw'}={}){
  if(!Array.isArray(documents)||!documents.length||documents.some(s=>typeof s!=='string'))fail('nonempty training documents required');
  if(!Number.isInteger(order)||order<0||order>8)fail('context order budget [0,8]');
  if(typeof alpha!=='number'||!Number.isFinite(alpha)||alpha<=0)fail('strict positive smoothing required');
  if(!['raw','link-left','link-balanced'].includes(representation))fail('unknown representation');
  const graph=representation==='raw'?null:new ContextLinkGraph(representation==='link-left'?'left':'balanced');
  const tables=Array.from({length:order+1},()=>new Map());
  const seen=new Set(),training=documents.map(s=>scalars(s));
  for(const arr of training)for(const c of arr)seen.add(c);
  if(!seen.size)fail('empty training alphabet');
  const vocabulary=[...seen].sort(scalarOrder),V=vocabulary.length;
  const key=(ctx,create)=>graph?graph.encode(ctx,{create}):JSON.stringify(ctx);
  let observationEvents=0;
  for(const arr of training){
    observationEvents+=arr.length;
    for(let i=0;i<arr.length;i++){
      for(let k=0;k<=Math.min(order,i);k++){
        const context=arr.slice(i-k,i),bucket=tables[k],identity=key(context,true);
        let row=bucket.get(identity);
        if(!row){row={events:0,counts:new Map()};bucket.set(identity,row);}
        row.events++;row.counts.set(arr[i],(row.counts.get(arr[i])??0)+1);
      }
    }
  }
  function predict(context){
    const chars=scalars(context);
    for(let k=Math.min(order,chars.length);k>=0;k--){
      const ctx=chars.slice(chars.length-k);
      const row=tables[k].get(key(ctx,false));
      if(!row)continue;
      const denominator=row.events+alpha*V;
      const distribution=vocabulary.map(scalar=>({scalar,probability:((row.counts.get(scalar)??0)+alpha)/denominator}));
      distribution.sort((a,b)=>b.probability-a.probability||scalarOrder(a.scalar,b.scalar));
      return {contextLength:k,observedEvents:row.events,distribution};
    }
    fail('unigram row missing');
  }
  function evaluate(documentsToScore,{topK=3}={}){
    if(!Array.isArray(documentsToScore)||!Number.isInteger(topK)||topK<1||topK>V)fail('evaluation documents/topK');
    let events=0,scored=0,top1Hits=0,topKHits=0,totalBits=0,backoffs=0;
    for(const text of documentsToScore){
      const arr=scalars(text);
      for(let i=0;i<arr.length;i++){
        events++;
        if(!seen.has(arr[i]))continue; // honest abstention, not an OOV probability
        const prediction=predict(arr.slice(Math.max(0,i-order),i).join(''));
        if(prediction.contextLength<Math.min(order,i))backoffs++;
        const ranked=prediction.distribution;
        const target=ranked.find(e=>e.scalar===arr[i]);
        totalBits-=Math.log2(target.probability);
        scored++;if(ranked[0].scalar===arr[i])top1Hits++;
        if(ranked.slice(0,topK).some(e=>e.scalar===arr[i]))topKHits++;
      }
    }
    return {events,scored,abstained:events-scored,coverage:events?scored/events:0,
      bitsPerScoredScalar:scored?totalBits/scored:null,totalLogLossBits:totalBits,
      top1Accuracy:scored?top1Hits/scored:null,topKAccuracy:scored?topKHits/scored:null,
      topK,backoffEvents:backoffs};
  }
  function comparePairs(pairs){
    if(!Array.isArray(pairs))fail('pairs array required');
    return pairs.map(p=>{
      if(!p||typeof p.id!=='string'||typeof p.reference!=='string'||typeof p.alternative!=='string')fail('paired fixture');
      const reference=evaluate([p.reference]),alternative=evaluate([p.alternative]);
      const comparable=reference.coverage===1&&alternative.coverage===1&&reference.scored>0&&alternative.scored>0;
      return {id:p.id,goldKind:p.goldKind??'UNREVIEWED',status:comparable?'STATISTICAL_ONLY':'ABSTAIN_OOV',
        reference,alternative,deltaBitsPerScalar:comparable?
          alternative.bitsPerScoredScalar-reference.bitsPerScoredScalar:null};
    });
  }
  return Object.freeze({order,alpha,representation,trainingDigest:corpusDigest(documents),
    trainingDocuments:documents.length,observationEvents,vocabulary:Object.freeze(vocabulary),
    graph,predict,evaluate,comparePairs});
}
