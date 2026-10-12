// W12: compare multiple within-unit binary tree policies, retaining frozen source-first boundaries.
// No word, space, category, or linguistic hints in the learner.
import {exactScalars,InMemoryLinkGraph,collectSourceWindows} from './source-first-frequencies-v0.mjs';
import {splitByBoundaries} from './source-first-method-grid-v0.mjs';
const fail=s=>{throw Error('SOURCE_FIRST_TREE_SHAPES: '+s);};
const admissible=new Set(['balanced','leftComb','rightComb','prefix2','prefix3','prefix4','suffix2','suffix3','suffix4','frequencyGreedy','frequencyLog','frequencySquareRoot','frequencyQuadratic','frequencyCount','frequencyW4','frequencyW6']);
export function shapeSplitIndex(cp,start,end,shape,frequencies=new Map()){
 if(end-start<=1||!admissible.has(shape))fail('invalid composite span/shape');
 const n=end-start;
 let cut=start+Math.floor(n/2);
 if(shape==='leftComb')cut=end-1;
 if(shape==='rightComb')cut=start+1;
 if(shape.startsWith('prefix'))cut=Math.min(end-1,start+Number(shape.slice(-1)));
 if(shape.startsWith('suffix'))cut=Math.max(start+1,end-Number(shape.slice(-1)));
 if(shape.startsWith('frequency')){
  const width=shape==='frequencyW4'?4:shape==='frequencyW6'?6:8;
  const score=(a,b)=>{const len=b-a;if(len>width||len===1)return 0;
   const count=frequencies.get(cp.slice(a,b).join(''))??0;
   const f=shape==='frequencyCount'?count:Math.log2(1+count);
   const weight=shape==='frequencyLog'?1:shape==='frequencySquareRoot'?Math.sqrt(len):
    shape==='frequencyQuadratic'?len*len:len;
   return f*weight;
  };
  let best=-Infinity;
  for(let m=start+1;m<end;m++){
   const v=score(start,m)+score(m,end)-0.1*Math.abs((m-start)-(end-m));
   if(v>best){best=v;cut=m;}
  }
 }
 return cut;
}
function build(g,cp,start,end,shape,frequencies,cache){
 const text=cp.slice(start,end).join('');
 const cached=cache.get(text);if(cached!==undefined)return cached;
 const n=end-start;
 if(n===0)return g.atom('');
 if(n===1)return g.atom(cp[start]);
 const cut=shapeSplitIndex(cp,start,end,shape,frequencies);
 const id=g.pair(build(g,cp,start,cut,shape,frequencies,cache),build(g,cp,cut,end,shape,frequencies,cache));
 cache.set(text,id);return id;
}
export function buildShapedCorpus(documents,boundaries,shape,{maxScalarsPerDocument=8192,frequencies=new Map(),verifyReplay=true}={}){
 if(!admissible.has(shape))fail('invalid shape');
 const g=new InMemoryLinkGraph();const perDocument=[];let total=0;const shapeCache=new Map();
 for(const d of documents){
  const cp=exactScalars(d.bytes).slice(0,maxScalarsPerDocument),units=splitByBoundaries(cp,boundaries);
  const ids=units.map(text=>{
   const chars=[...text];return build(g,chars,0,chars.length,shape,frequencies,shapeCache);
  });
  const root=g.balanced(ids);g.roots.push(root);
  if(verifyReplay&&g.expand(root,{maxScalars:maxScalarsPerDocument+1})!==cp.join(''))fail('cold graph replay');
  perDocument.push({id:d.id,linksAdded:g.physicalLinks-(perDocument.at(-1)?.cumulative??0),cumulative:g.physicalLinks});
  total+=cp.length;
 }
 return {physicalLinks:g.physicalLinks,reachableLinks:g.reachableLinks,sourceScalars:total,perDocument,graph:g};
}
export function compareShapedGrid(documents,boundaries,{maxScalarsPerDocument=8192,shapes=[...admissible]}={}){
 const train=documents.filter((_,i)=>i%5!==4),heldout=documents.filter((_,i)=>i%5===4);
 const needDP=shapes.some(x=>x.startsWith('frequency'));
 const frequencies=needDP?collectSourceWindows(train,{minWidth:2,maxWidth:8,maxScalarsPerDocument}).frequency:new Map();
 const scored=[];
 for(const shape of shapes){
  const args={maxScalarsPerDocument,frequencies};
  const first=buildShapedCorpus(train,boundaries,shape,args);
  scored.push({shape,trainPhysicalLinks:first.physicalLinks});
 }
 scored.sort((a,b)=>a.trainPhysicalLinks-b.trainPhysicalLinks||a.shape.localeCompare(b.shape));
 const ranked=[];
 for(const x of scored){
  const args={maxScalarsPerDocument,frequencies};
  const g=buildShapedCorpus([...train,...heldout],boundaries,x.shape,args);
  const heldoutIsolated=heldout.map(d=>buildShapedCorpus([d],boundaries,x.shape,args).physicalLinks);
  ranked.push({...x,allPhysicalLinks:g.physicalLinks,heldoutMarginalLinks:g.physicalLinks-x.trainPhysicalLinks,
   heldoutIsolated,exactReplay:true});
 }
 return {schema:'mts-nl/W12-tree-shape-grid/v0',sourceScalars:ranked.length?documents.reduce((sum,d)=>sum+Math.min([...d.bytes.toString('utf8')].length,maxScalarsPerDocument),0):0,
  books:documents.length,trainBooks:train.length,heldoutBooks:heldout.length,
  boundaries,rankingByTrain:scored,rankingByTotal:[...ranked].sort((a,b)=>a.allPhysicalLinks-b.allPhysicalLinks||a.shape.localeCompare(b.shape))};
}