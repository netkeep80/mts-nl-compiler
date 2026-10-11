// #30 research: observations are external; generated proof links are not.
const fail=s=>{throw Error("Evidence oracle: "+s);};
const valid=s=>typeof s==="string"&&s.length>0;
export function externalObservationLedger(events) {
 if(!Array.isArray(events))fail("array required");
 const byId=new Map();let ignoredGenerated=0;
 for(const e of events) {
  if(!e||typeof e!=="object"||Array.isArray(e))fail("bad event");
  if(!valid(e.id)||!valid(e.context)||!valid(e.observation))fail("invalid event fields");
  if(e.kind!=="external"&&e.kind!=="generated")fail("invalid provenance");
  if(e.kind==="generated"){ignoredGenerated++;continue;}
  const old=byId.get(e.id);
  const current={id:e.id,context:e.context,observation:e.observation};
  if(old&&JSON.stringify(old)!==JSON.stringify(current))fail("conflicting observation ID");
  if(!old)byId.set(e.id,current);
 }
 return {observations:[...byId.values()].sort((a,b)=>
   a.id<b.id?-1:a.id>b.id?1:0),count:byId.size,ignoredGenerated};
}
export function candidateEvidenceScore(events,{context,observation,smoothing=1}) {
 if(!valid(context)||!valid(observation))fail("invalid candidate");
 if(typeof smoothing!=="number"||!Number.isFinite(smoothing)||smoothing<=0)
  fail("invalid smoothing");
 const {observations,count}=externalObservationLedger(events);
 const n=observations.filter(e=>e.context===context&&e.observation===observation).length;
 return {independentCount:n,externalTotal:count,
  score:n/(n+smoothing),kind:"UNCALIBRATED_RANK_NOT_PROBABILITY"};
}
