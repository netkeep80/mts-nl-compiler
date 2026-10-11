// E3 experimental content-dependent binary grouping of existing Link tokens.
// Locally selected pair anchors use intrinsic child Link identities, never
// absolute text positions. Gaps are paired from their own anchor boundaries.
// Not a proven locally-consistent grammar or accepted Γ scheduler.
const fail=s=>{throw Error("E3 content grouping: "+s);};
const fp=id=>{
 if(typeof id!=="string"||!/^[ap]:[0-9a-f]{64}$/.test(id))
  fail("noncanonical Link ID");
 // Content-addressed IDs: taking two disjoint 32-bit portions mixes identity.
 return ((Number.parseInt(id.slice(2,10),16) ^
   Number.parseInt(id.slice(18,26),16))>>>0);
};
const rank=(a,b)=>{
 let x=(Math.imul(a^0x9e3779b9,0x85ebca6b)^b)>>>0;
 x=Math.imul(x^(x>>>16),0xc2b2ae35)>>>0;
 return (x^(x>>>13))>>>0;
};
export function buildContentStableRoot(items,putPair,putEmpty) {
 if(!Array.isArray(items)||typeof putPair!=="function"||
    typeof putEmpty!=="function")fail("invalid input");
 if(items.length===0)return {root:putEmpty(),layers:0,anchors:0,
  fallbackPairs:0};
 let current=items.map(id=>({id,hash:fp(id)}));
 let layers=0,anchors=0,fallbackPairs=0;
 while(current.length>1) {
  if(++layers>64)fail("nonconvergent grouping");
  const n=current.length,p=new Uint32Array(n-1);
  for(let i=0;i<n-1;i++)p[i]=rank(current[i].hash,current[i+1].hash);
  const selected=[];
  for(let i=0;i<n-1;i++){
   const lowerLeft=i===0||p[i]<p[i-1];
   const notGreaterRight=i===n-2||p[i]<=p[i+1];
   if(lowerLeft&&notGreaterRight)selected.push(i);
  }
  // Selected minima are disjoint by construction (strict left, <= right).
  function emitPair(a,b,out){
   const id=putPair(a.id,b.id);
   out.push({id,hash:fp(id)});
  }
  const next=[];
  function gap(a,b){
   for(let i=a;i<b;i+=2){
    if(i+1<b){emitPair(current[i],current[i+1],next);fallbackPairs++;}
    else next.push(current[i]);
   }
  }
  let start=0;
  for(const index of selected){
   if(index<start)fail("overlapping anchors");
   gap(start,index);
   emitPair(current[index],current[index+1],next);
   anchors++;start=index+2;
  }
  gap(start,n);
  if(next.length>=current.length)fail("grouping failed to reduce token count");
  current=next;
 }
 return {root:current[0].id,layers,anchors,fallbackPairs};
}
