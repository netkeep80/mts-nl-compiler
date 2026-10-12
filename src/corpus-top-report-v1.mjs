// Frequency of observed source occurrences. No hashed Link IDs or inferred weights.
import {NumericCorpusLoader} from './numeric-corpus-loader-v1.mjs';
import {formatLinkId} from './numeric-link-store-v1.mjs';
const error=x=>{throw Error('TOP100: '+x);};
// The glyphs below are only diagnostic display escaping, never learning hints.
// The delimited view makes leading and trailing whitespace observable.
export function visibleLinkText(text){
 const show=c=>c===' '?'␠':c==='\n'?'␊':c==='\r'?'␍':
  c==='\t'?'␉':c==='\u00a0'?'⍽':c==='\ufeff'?'⟨BOM⟩':
  c==='\u200b'?'⟨ZWSP⟩':c;
 return '⟦'+[...text].map(show).join('')+'⟧';
}
const escapedJson=s=>JSON.stringify(s);
const escapedMd=s=>String(s).replaceAll('|','\\|').replaceAll('\n','\\n').replaceAll('\r','\\r');
function rankTop(entries,n=1000,numericIds=false){
 if(!Number.isSafeInteger(n)||n<1||n>1000)error('invalid top rank');
 const compareId=(a,b)=>{
  if(numericIds){
   const x=BigInt(a),y=BigInt(b);
   return x<y?-1:x>y?1:0;
  }
  return a<b?-1:a>b?1:0;
 };
 const heap=[];
 const worse=(a,b)=>a.count<b.count||
  (a.count===b.count&&compareId(a.id,b.id)>0);
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
 heap.sort((a,b)=>b.count-a.count||compareId(a.id,b.id));
 return heap.map((x,i)=>({...x,rank:i+1}));
}
export class CountedNumericCorpusLoader extends NumericCorpusLoader{
 constructor(db,o={}){super(db,o);this.pairEvents=0;this.pairCounts=new Map();this.atomCounts=new Map();this.atomEvents=0;this.docNumber=0;this.poisoned=false;}
 _atom(text,c){
  const id=super._atom(text,c);
  if(text!=='')this.atomEvents += [...text].length;
  const v=this.atomCounts.get(id);
  if(v){if(v.text!==text)error('atom identity changed');v.count++;if(v.last!==this.docNumber){v.last=this.docNumber;v.documents++;}}
  else this.atomCounts.set(id,{text,count:1,documents:1,last:this.docNumber});
  return id;
 }
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
 topAtoms(n=1000){
  if(this.poisoned||!Number.isSafeInteger(n)||n<1||n>1000)error('invalid/incomplete corpus');
  const entries=[];
  for(const [id,v] of this.atomCounts)if(v.text!==''){
   if([...v.text].length!==1)error('non-scalar source atom');
   entries.push({id:formatLinkId(id),text:v.text,count:v.count,documents:v.documents});
  }
  const total=[...entries].reduce((z,e)=>z+e.count,0);
  if(total!==this.atomEvents)error('atom event conservation');
  return {schema:'mts-nl/observed-atom-frequency/v1',books:this.docNumber,
   denominatorAtomicOccurrences:total,
   top:rankTop(entries,n,true).map(x=>({...x,
    visible:visibleLinkText(x.text),escaped:escapedJson(x.text),
    empiricalRate:+(x.count/total).toPrecision(8)}))};
 }
 topLinks(n=1000){
  if(this.poisoned||n<1||n>1000)error('invalid/incomplete corpus');
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
  // Iterative real SQLite pole traversal: show *actual* grouping, including
  // sub-Link IDs. Source spelling cannot reveal this binary structure.
  const tree=(root,maxNodes=2048)=>{
   const out=[],stack=[{id:root,stage:0}],active=new Set();
   let count=0;
   while(stack.length){
    const x=stack.pop();
    if(x.stage===1){active.delete(x.id);out.push(')');continue;}
    if(x.stage===2){out.push(',');continue;}
    const r=q.get(x.id);
    if(!r)error('missing tree Link '+x.id);
    if(r.from_id===null){out.push(visibleLinkText(r.string).slice(1,-1));continue;}
    if(active.has(x.id))error('cyclic tree Link');
    if(++count>maxNodes)return {text:'⟨TREE_LIMIT_EXCEEDED⟩',truncated:true};
    active.add(x.id);
    out.push('#'+formatLinkId(x.id)+'(');
    stack.push({id:x.id,stage:1},{id:r.to_id,stage:0},
     {stage:2},{id:r.from_id,stage:0});
   }
   return {text:out.join(''),truncated:false};
  };
  const candidates=rankTop((function*(counts){
   for(const [id,v] of counts)if(v.count>1)
    yield {id:formatLinkId(id),count:v.count,documents:v.documents};
  })(this.pairCounts),n,true);
  return {schema:'mts-nl/observed-links-top1000/v2',books:this.docNumber,
   denominatorPairEvents:this.pairEvents,notSemanticProbability:true,
   top:candidates.map(x=>{
    const r=q.get(BigInt(x.id)),p=walk(BigInt(x.id));
    if(!r||r.from_id===null)error('pair expected');
    return {...x,fromId:formatLinkId(r.from_id),toId:formatLinkId(r.to_id),
     expandedCodepoints:p.length,preview:p.length<=64?p.head:p.head+' … '+p.tail,
     visiblePreview:visibleLinkText(p.length<=64?p.head:p.head+' … '+p.tail),
     escapedPreview:escapedJson(p.length<=64?p.head:p.head+' … '+p.tail),
     ...(()=>{const v=tree(BigInt(x.id));return {binaryTree:v.text,treeTruncated:v.truncated};})(),
     empiricalRate:+(x.count/this.pairEvents).toPrecision(8)};
   })};
 }
}
export function topObservedWords(documents,n=1000){
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
 return {schema:'mts-nl/observed-word-phrase-top1000/v2',books:doc,
  note:'Lowercased Unicode word positions, sentence punctuation resets phrases; observation frequencies are not Link weights.',
  notLinkWeights:true,
  classes:['word','two-words','three-words'].map((name,i)=>({
   name,positions:positions[i],distinct:maps[i].size,
   top:rankTop((function*(map){for(const [id,v] of map)
    yield {id,count:v.count,documents:v.documents};})(maps[i]),n)
    .map(x=>({rank:x.rank,text:x.id,count:x.count,documents:x.documents,
     empiricalRate:+(x.count/positions[i]).toPrecision(8)}))
  }))};
}
export function topRankedMarkdown(links,words,atoms=null){
 const out=['# TOP 1000 observed Link, atom and word/phrase frequencies','',
  'Link IDs are SQLite AUTOINCREMENT. Pair occurrences are **balanced-tree node events**, not all positional substrings.',
  'An atomic Link is a terminal carrying a source scalar (no poles); equal from/to IDs do NOT define an atom.',
  '⟦ and ⟧ mark the beginning and end of the **displayed fragment**, not the source line. '+
  '␠ = U+0020 space; ⍽ = U+00A0 NBSP; ␊ = LF; ␍ = CR; ␉ = TAB. '+
  'The JSON column is the unambiguous original content. No characters are normalized.',''];
 if(atoms){
  out.push('## Source atomic Link frequency','',
   'Every atomic occurrence is counted at source-leaf creation, including under reused parent Links. '+
   'This count should exactly match the independent source-scalar histogram.','',
   '| Rank | Atom Link ID | Visible atom | Exact JSON scalar | Occurrences | Books | Rate |',
   '|---:|---:|---|---|---:|---:|---:|');
  for(const x of atoms.top)out.push('| '+x.rank+' | '+x.id+' | '+escapedMd(x.visible)+
   ' | `'+escapedMd(x.escaped)+'` | '+x.count+' | '+x.documents+' | '+x.empiricalRate+' |');
  out.push('','Atom occurrences (denominator): '+atoms.denominatorAtomicOccurrences,'');
 }
 out.push('## Observed binary Link nodes','',
  'Pair ID is in the Link column; From/To are direct physical numeric pole IDs. '+
  'Binary tree syntax: `#ID(left,right)` shows every composed Link and its actual grouping; '+
  'leaves are escaped source scalars. This tree does not imply a learned word or syllable.','',
  '| Rank | Link ID | From / To | Node occurrences | Books | Scalars | Bounded text ⟦start…end⟧ | Exact JSON | Physical binary tree |',
  '|---:|---:|---|---:|---:|---:|---|---|---|');
 for(const x of links.top)out.push('| '+x.rank+' | '+x.id+' | '+x.fromId+' / '+x.toId+' | '+
  x.count+' | '+x.documents+' | '+x.expandedCodepoints+' | '+escapedMd(x.visiblePreview??visibleLinkText(x.preview))+
  ' | `'+escapedMd(x.escapedPreview??escapedJson(x.preview))+'` | `'+escapedMd(x.binaryTree??'')+'` |');
 for(const group of words.classes){
  out.push('','## '+group.name+' (observed, not inferred)','',
   '| Rank | Text | Occurrences | Books | Empirical relative frequency |',
   '|---:|---|---:|---:|---:|');
  for(const x of group.top)out.push('| '+x.rank+' | '+escapedMd(x.text)+' | '+x.count+
   ' | '+x.documents+' | '+x.empiricalRate+' |');
 }
 return out.join('\n')+'\n';
}
