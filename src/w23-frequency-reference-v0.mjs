// W23-B reference oracle for frequency-driven adjacent pair replacement.
// Algorithmic tokens are ABSTRACT handles only; they are never SQLite Link IDs.
// Physical persistent Link cost belongs to W23-D and must be verified separately.

const fail=message=>{throw new Error('W23_FREQ_REF: '+message);};
const UPSTREAM_SHA='6a6a69fc3ce42b0bd3e421c17c810ec2f37cb12b';
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const validText=text=>typeof text==='string'&&
 Buffer.from(text,'utf8').toString('utf8')===text&&
 ![...text].some(ch=>{const cp=ch.codePointAt(0);return cp>=0xD800&&cp<=0xDFFF;});
const pairIdKey=(left,right)=>left+','+right;
const canonicalPairKey=(left,right)=>JSON.stringify([left.canonical,right.canonical]);

export const linksPlatformAuditPin=Object.freeze({
 repository:'linksplatform/Data.Doublets.Sequences',
 commit:UPSTREAM_SHA,
 csharp:'csharp/Platform.Data.Doublets.Sequences/Converters/CompressingConverter.cs',
 cpp:'cpp/Platform.Data.Doublets.Sequences/Converters/CompressingConverter.h'
});

// Exact logical predicate from pinned C# UpdateMaxDoublet, represented with the
// C# precedence made explicit: && binds more tightly than ||.
export function linksPlatformCSharpUpdateMaxPredicate({
 frequency,maxFrequency,minFrequency=1,source,target,bestSource=0,bestTarget=0
}){
 for(const value of [frequency,maxFrequency,minFrequency,source,target,bestSource,bestTarget])
  if(!Number.isSafeInteger(value)||value<0)fail('non-negative safe integers required');
 return frequency>minFrequency&&maxFrequency>frequency||
  maxFrequency===frequency&&source+target>bestSource+bestTarget;
}

export function simulatePinnedCSharpFreshSelection(candidates,{minFrequency=1}={}){
 if(!Array.isArray(candidates)||!Number.isSafeInteger(minFrequency)||minFrequency<0)
  fail('invalid comparator simulation input');
 let best={source:0,target:0,frequency:0};
 for(const c of candidates){
  if(!c||![c.source,c.target,c.frequency].every(x=>Number.isSafeInteger(x)&&x>=0))
   fail('invalid comparator candidate');
  if(linksPlatformCSharpUpdateMaxPredicate({
   frequency:c.frequency,maxFrequency:best.frequency,minFrequency,
   source:c.source,target:c.target,bestSource:best.source,bestTarget:best.target
  }))best={...c};
 }
 return best.frequency>0?best:null;
}

export function compressFrequencyReference(documents,{
 minOccurrences=2,maxRounds=256,maxExpansionScalars=256
}={}){
 if(!Array.isArray(documents)||!Number.isSafeInteger(minOccurrences)||minOccurrences<2||
  !Number.isSafeInteger(maxRounds)||maxRounds<0||maxRounds>4096||
  !Number.isSafeInteger(maxExpansionScalars)||maxExpansionScalars<2||maxExpansionScalars>4096)
  fail('invalid parameters');
 const ids=new Set();
 for(const d of documents){
  if(!d||typeof d.id!=='string'||!d.id||ids.has(d.id)||!validText(d.text))
   fail('invalid or duplicate Unicode document');
  ids.add(d.id);
 }
 let nextToken=1;
 const atoms=new Map(),terms=new Map(),pairs=new Map();
 const atom=scalar=>{
  let token=atoms.get(scalar);
  if(token!==undefined)return token;
  token=nextToken++;
  const canonical='A:'+JSON.stringify(scalar);
  atoms.set(scalar,token);
  terms.set(token,Object.freeze({token,kind:'atom',scalar,canonical,expanded:scalar,length:1}));
  return token;
 };
 const pair=(leftToken,rightToken)=>{
  const left=terms.get(leftToken),right=terms.get(rightToken);
  if(!left||!right)fail('unknown pair pole');
  const identity=pairIdKey(leftToken,rightToken);
  let token=pairs.get(identity);
  if(token!==undefined)return {token,created:false};
  token=nextToken++;
  const term=Object.freeze({token,kind:'pair',left:leftToken,right:rightToken,
   canonical:'P:'+canonicalPairKey(left,right),expanded:left.expanded+right.expanded,
   length:left.length+right.length});
  terms.set(token,term);pairs.set(identity,token);
  return {token,created:true};
 };
 let sequences=documents.map(d=>[...d.text].map(atom));
 const rules=[];
 let fullScanAdjacentInspections=0,rankedCandidatesExamined=0;
 for(let round=0;round<maxRounds;round++){
  const counts=new Map();
  for(const seq of sequences)for(let i=0;i+1<seq.length;i++){
   fullScanAdjacentInspections++;
   const leftToken=seq[i],rightToken=seq[i+1];
   const left=terms.get(leftToken),right=terms.get(rightToken);
   if(left.length+right.length>maxExpansionScalars)continue;
   const identity=pairIdKey(leftToken,rightToken),found=counts.get(identity);
   if(found)found.frequency++;
   else counts.set(identity,{identity,leftToken,rightToken,frequency:1,
    canonical:canonicalPairKey(left,right),expanded:left.expanded+right.expanded,
    length:left.length+right.length});
  }
  const ranked=[...counts.values()].filter(x=>x.frequency>=minOccurrences)
   .sort((a,b)=>b.frequency-a.frequency||cmp(a.canonical,b.canonical));
  let chosen=null,replacements=0,nextSequences=null;
  for(const candidate of ranked){
   rankedCandidatesExamined++;
   const rewritten=[];let used=0;
   const existingToken=pairs.get(candidate.identity);
   const replacementToken=existingToken??nextToken; // dry-run handle only
   for(const seq of sequences){
    const out=[];
    for(let i=0;i<seq.length;i++){
     if(i+1<seq.length&&seq[i]===candidate.leftToken&&seq[i+1]===candidate.rightToken){
      out.push(replacementToken);i++;used++;
     }else out.push(seq[i]);
    }
    rewritten.push(out);
   }
   if(used>=minOccurrences){chosen=candidate;replacements=used;nextSequences=rewritten;break;}
  }
  if(!chosen)break;
  const plannedReplacement=pairs.get(chosen.identity)??nextToken;
  const made=pair(chosen.leftToken,chosen.rightToken);
  if(made.token!==plannedReplacement)fail('dry-run replacement token disagrees with pair reuse');
  // The dry-run used either the already existing token or exactly nextToken before creation.
  sequences=nextSequences;
  rules.push(Object.freeze({round:round+1,token:made.token,createdAbstractPair:made.created,
   leftToken:chosen.leftToken,rightToken:chosen.rightToken,
   canonical:chosen.canonical,expanded:chosen.expanded,length:chosen.length,
   adjacentFrequency:chosen.frequency,nonOverlappingReplacements:replacements}));
 }
 const decodeToken=token=>{
  const term=terms.get(token);if(!term)fail('unknown token during replay');return term.expanded;
 };
 const replay=sequences.map(seq=>seq.map(decodeToken).join(''));
 for(let i=0;i<documents.length;i++)if(replay[i]!==documents[i].text)fail('exact replay mismatch');
 return Object.freeze({
  schema:'mts-nl/w23-frequency-reference/v0',status:'EXACT_UNICODE_REPLAY_PASS',
  upstreamPin:linksPlatformAuditPin,
  semantics:'full-rescan reference oracle; abstract tokens are not physical Link IDs',
  parameters:{minOccurrences,maxRounds,maxExpansionScalars},
  documents:documents.map((d,i)=>({id:d.id,unicodeScalars:[...d.text].length,
   utf8Bytes:Buffer.byteLength(d.text),finalTokens:sequences[i].length})),
  rules,ruleCount:rules.length,abstractAtoms:atoms.size,abstractPairs:pairs.size,
  fullScanAdjacentInspections,rankedCandidatesExamined,
  finalSequences:sequences.map(seq=>seq.slice()),replay
 });
}
