// Frequency of observed source occurrences. No hashed Link IDs or inferred weights.
import {NumericCorpusLoader} from './numeric-corpus-loader-v1.mjs';
import {formatLinkId} from './numeric-link-store-v1.mjs';
const error=x=>{throw Error('TOP100: '+x);};
function rankTop(entries,n=100){
 if(!Number.isSafeInteger(n)||n<1||n>100)error('invalid top rank');
 const heap=[];
 const worse=(a,b)=>a.count<b.count||
  (a.count===b.count&&a.id>b.id);
 const swap=(i,j)=>{const t=heap[i];heap[i]=heap[j];heap[j]=t;};
 const up=()=>{for(let i=heap.length-1;i>0;){const p=(i-1)>>1;
  if(!worse(heap[i],heap[p]))break;swap(i,p);i=p;}};
 const down=()=>{for(let i=0;;){const a=i*2+1,b=a+1;let m=i;
  if(a<heap.length&&worse(heap[a],heap[m]))m=a;
  if(b<heap.length&&worse(heap[b],heap[m]))m=b;
  if(m===i)break;swap(i,m);i=m;}};
 for(const x of entries){
  if(heap.length<n){heap.push(x);up();}
  else if(worse(heap[0],x)){heap[0]=x;down();}
 }
 heap.sort((a,b)=>b.count-a.count||(a.id<b.id?-1:a.id>b.id?1:0));
 return heap.map((x,i)=>({...x,rank:i+1}));
}
export class CountedNumericCorpusLoader extends NumericCorpusLoader{
 constructor(db,o={}){super(db,o);this.pairEvents=0;this.pairCounts=new Map();this.docNumber=0;this.poisoned=false;}
 _pair(a,b,c){
  const id=super._pair(a,b,c);this.pairEvents++;
  const v=this.pairCounts.get(id);
  if(v){v.count++;if(v.last!==this.docNumber){v.last=this.docNumber;v.documents++;}}
  else this.pairCounts.set(id,{count:1,documents:1,last:this.docNumber});
  return id;
 }
 appendBook(bytes,options={}){
  if(this.poisoned)error('failed corpus: fresh database required');
  this.docNumber++;
  try{return super.appendBook(bytes,options);}
  catch(e){this.poisoned=true;throw e;}
 }
 topLinks(n=100){
  if(this.poisoned||n<1||n>100)error('invalid/incomplete corpus');
  const q=this.db.prepare('SELECT from_id,to_id,string FROM links WHERE link_id=?');
  q.setReadBigInts(true);
  const memo=new Map(),active=new Set();
  const walk=id=>{
   if(memo.has(id))return memo.get(id);
   if(active.has(id))error('source cycle');
   active.add(id);
   const r=q.get(id);if(!r)error('missing numeric Link');
   let v;
   if(r.from_id===null){
    const cp=[...r.string];v={length:cp.length,head:cp.slice(0,64).join(''),tail:cp.slice(-64).join('')};
   }else{
    const a=walk(r.from_id),b=walk(r.to_id);
    v={length:a.length+b.length,head:[...(a.head+b.head)].slice(0,64).join(''),
     tail:[...(a.tail+b.tail)].slice(-64).join('')};
   }
   memo.set(id,v);active.delete(id);return v;
  };
  const candidates=rankTop((function*(counts){
   for(const [id,v] of counts)if(v.count>1)
    yield {id:formatLinkId(id),count:v.count,documents:v.documents};
  })(this.pairCounts),n);
  return {schema:'mts-nl/observed-links-top100/v1',books:this.docNumber,
   denominatorPairEvents:this.pairEvents,notSemanticProbability:true,
   top:candidates.map(x=>{
    const r=q.get(BigInt(x.id)),p=walk(BigInt(x.id));
    if(!r||r.from_id===null)error('pair expected');
    return {...x,fromId:formatLinkId(r.from_id),toId:formatLinkId(r.to_id),
     expandedCodepoints:p.length,preview:p.length<=64?p.head:p.head+' … '+p.tail,
     empiricalRate:+(x.count/this.pairEvents).toPrecision(8)};
   })};
 }
}
export function topObservedWords(documents,n=100){
 const maps=[new Map(),new Map(),new Map()],positions=[0,0,0],max=5000000;
 let totalUnique=0,doc=0;
 const add=(i,key)=>{
  positions[i]++;
  const prev=maps[i].get(key);
  if(prev){prev.count++;if(prev.last!==doc){prev.last=doc;prev.documents++;}}
  else{if(totalUnique++>=max)error('RESOURCE_LIMIT distinct word ngrams');
   maps[i].set(key,{count:1,documents:1,last:doc});}
 };
 for(const item of documents){
  if(typeof item.source!=='string'||typeof item.id!=='string')error('invalid text');
  doc++;const prev=[];
  for(const match of item.source.toLowerCase().matchAll(/[\p{L}\p{M}\p{N}]+|[.!?…]+/gu)){
   const w=match[0];
   if(/^[.!?…]+$/u.test(w)){prev.length=0;continue;}
   add(0,w);
   if(prev.length)add(1,prev.at(-1)+' '+w);
   if(prev.length>1)add(2,prev.at(-2)+' '+prev.at(-1)+' '+w);
   prev.push(w);if(prev.length>2)prev.shift();
  }
 }
 return {schema:'mts-nl/observed-word-phrase-top100/v1',books:doc,
  note:'Lowercased Unicode word positions, sentence punctuation resets phrases; observation frequencies are not Link weights.',
  classes:['word','two-words','three-words'].map((name,i)=>({
   name,positions:positions[i],distinct:maps[i].size,
   top:rankTop((function*(map){for(const [id,v] of map)
    yield {id,count:v.count,documents:v.documents};})(maps[i]),n)
    .map(x=>({rank:x.rank,text:x.id,count:x.count,documents:x.documents,
     empiricalRate:+(x.count/positions[i]).toPrecision(8)}))
  }))};
}
export function top100Markdown(links,words){
 const esc=s=>String(s).replaceAll('|','\\|').replaceAll('\n','\\\\n').replaceAll('\r','\\\\r');
 const out=['# TOP 100 observed Link and word/phrase frequencies','',
  'Link ID is SQLite AUTOINCREMENT; count = observed expanded occurrences, not structural degree or learned probability.','',
  '| Rank | Link | From / To | Occurrences | Books | Length | Preview |',
  '|---:|---:|---|---:|---:|---:|---|'];
 for(const x of links.top)out.push('| '+x.rank+' | '+x.id+' | '+x.fromId+' / '+x.toId+' | '+
  x.count+' | '+x.documents+' | '+x.expandedCodepoints+' | '+esc(x.preview)+' |');
 for(const group of words.classes){
  out.push('','## '+group.name+' (observed, not inferred)','',
   '| Rank | Text | Occurrences | Books | Empirical relative frequency |',
   '|---:|---|---:|---:|---:|');
  for(const x of group.top)out.push('| '+x.rank+' | '+esc(x.text)+' | '+x.count+
   ' | '+x.documents+' | '+x.empiricalRate+' |');
 }
 return out.join('\n')+'\n';
}
