// E2 diagnostic only. Frequency = positions in expanded source sequence,
// NEVER physical from_uses/to_uses or learned probability. Keep excerpts bounded.
const fail=s=>{throw Error("E2 frequency diagnostic: "+s);};
const maxPreview=32;
const head=s=>[...s].slice(0,maxPreview).join("");
const tail=s=>[...s].slice(-maxPreview).join("");
export const atomProfile=s=>({length:[...s].length,head:head(s),tail:tail(s),short:s});
export function pairProfile(a,b){
 const length=a.length+b.length;
 return {length,head:head(a.head+b.head),tail:tail(a.tail+b.tail),
  short:length<=64?a.short+b.short:null};
}
const preview=p=>p.short!==null?p.short:p.head+" … "+p.tail;
export function topAdjacentCandidates({sequences,counts,profiles,docs,round,topN}){
 if(!Number.isSafeInteger(topN)||topN<0||topN>50)fail("bad topN");
 const ranked=[...counts.values()].filter(x=>x.count>1).sort((a,b)=>
  b.count-a.count||a.a-b.a||a.b-b.b).slice(0,topN);
 return {round,unit:"adjacent-current-token-pair",top:ranked.map((p,position)=>{
  const distribution=[];let nonOverlapping=0;
  for(let i=0;i<sequences.length;i++){
   const arr=sequences[i];let occurrences=0,nonOverlap=0;
   for(let k=0;k+1<arr.length;k++)if(arr[k]===p.a&&arr[k+1]===p.b)occurrences++;
   for(let k=0;k+1<arr.length;k++)if(arr[k]===p.a&&arr[k+1]===p.b){nonOverlap++;k++;}
   nonOverlapping+=nonOverlap;
   if(occurrences)distribution.push({document:docs[i].id,occurrences,nonOverlapping:nonOverlap});
  }
  const profile=pairProfile(profiles[p.a],profiles[p.b]);
  return {rank:position+1,leftToken:p.a,rightToken:p.b,
   expandedCodepoints:profile.length,preview:preview(profile),
   adjacentOccurrences:p.count,nonOverlappingReplacements:nonOverlapping,
   overlappingDiscarded:p.count-nonOverlapping,byDocument:distribution};
 })};
}
// Unlike above, counts exact repeated occurrences of a physical selected Link
// in fully expanded final DAG: a hash-consed pair may occur many times even if
// stored ONCE. This explicitly differs from structural pole-incidence caches.
export function topExpandedDupletLinks(rows,documents,topN,{minimumCodepoints=2}={}){
 if(!Number.isSafeInteger(topN)||topN<0||topN>50)fail("bad topN");
 if(!Number.isSafeInteger(minimumCodepoints)||minimumCodepoints<2)
  fail("bad minimumCodepoints");
 const byId=new Map(),profiles=new Map();
 for(const r of rows){
  if(byId.has(r.link_id))fail("duplicate Link ID");
  byId.set(r.link_id,r);
  if(r.from_id===null)profiles.set(r.link_id,atomProfile(r.string));
  else{
   const a=profiles.get(r.from_id),b=profiles.get(r.to_id);
   if(!a||!b)fail("non-topological pair DAG");
   profiles.set(r.link_id,pairProfile(a,b));
  }
 }
 function accumulate(roots){
  const n=new Map();
  for(const root of roots)n.set(root,(n.get(root)??0)+1);
  for(let i=rows.length-1;i>=0;i--){
   const r=rows[i],count=n.get(r.link_id)??0;
   if(count&&r.from_id!==null){
    n.set(r.from_id,(n.get(r.from_id)??0)+count);
    n.set(r.to_id,(n.get(r.to_id)??0)+count);
   }
  }
  return n;
 }
 const tally=accumulate(documents.map(x=>x.rootLink));
 const top=rows.filter(r=>r.from_id!==null&&profiles.get(r.link_id).length>=minimumCodepoints&&(tally.get(r.link_id)??0)>1)
  .sort((a,b)=>(tally.get(b.link_id)??0)-(tally.get(a.link_id)??0)||
     (a.link_id<b.link_id?-1:a.link_id>b.link_id?1:0)).slice(0,topN);
 const distribution=documents.map(d=>({id:d.id,counts:accumulate([d.rootLink])}));
 return {unit:"expanded-occurrences-of-selected-unique-link",minimumCodepoints,top:top.map((r,i)=>({
  rank:i+1,linkId:r.link_id,fromId:r.from_id,toId:r.to_id,
  expandedOccurrences:tally.get(r.link_id),expandedCodepoints:profiles.get(r.link_id).length,
  preview:preview(profiles.get(r.link_id)),
  byDocument:distribution.flatMap(x=>(x.counts.get(r.link_id)??0)>0?
   [{document:x.id,occurrences:x.counts.get(r.link_id)}]:[])
 }))};
}
