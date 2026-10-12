// W9/M1.0-M1.1 standalone research codec. No SQLite, Link IDs, language hints,
// word boundaries, normalization, trained semantic classes, or hidden codebook.
const error=s=>{throw new Error('M1_CODEC: '+s);};
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const MAGIC=Buffer.from('M1L0','ascii');
const MAX_DOCS=1000,MAX_SCALARS=2_000_000,MAX_RULES=2048;
const isScalar=x=>Number.isSafeInteger(x)&&x>=0&&x<=0x10ffff&&!(x>=0xd800&&x<=0xdfff);
const unsigned=x=>Number.isSafeInteger(x)&&x>=0;
function sizeU(n){if(!unsigned(n))error('noncanonical integer');let k=1;while(n>=128){k++;n=Math.floor(n/128);}return k;}
function writeU(out,n){if(!unsigned(n))error('invalid varuint');while(n>=128){out.push(n%128+128);n=Math.floor(n/128);}out.push(n);}
function readU(state){
 let n=0,scale=1,length=0;
 while(true){if(state.i>=state.b.length)error('truncated varuint');
  const b=state.b[state.i++];length++;
  if(length>8)error('varuint overflow');
  n+=(b&127)*scale;if(!Number.isSafeInteger(n))error('unsafe varuint');
  if(b<128){if(sizeU(n)!==length)error('noncanonical varuint');return n;}
  scale*=128;
 }
}
function validInput(documents){
 if(!Array.isArray(documents)||!documents.length||documents.length>MAX_DOCS)error('document count');
 const used=new Set();let total=0;
 return documents.map(d=>{
  if(!d||typeof d.id!=='string'||!d.id||used.has(d.id)||!Buffer.isBuffer(d.bytes))error('document metadata');
  used.add(d.id);
  const text=decoder.decode(d.bytes);
  if(!Buffer.from(text,'utf8').equals(d.bytes))error('source not byte-exact UTF-8');
  const cps=[...text].map(c=>c.codePointAt(0));total+=cps.length;
  if(total>MAX_SCALARS)error('scalar budget');
  return {id:d.id,bytes:d.bytes,cps};
 });
}
function initialState(documents){
 const atoms=[],index=new Map(),parses=[];
 for(const d of documents){
  const parse=[];
  for(const cp of d.cps){
   if(!index.has(cp)){index.set(cp,atoms.length);atoms.push(cp);}
   parse.push(index.get(cp));
  }
  parses.push(parse);
 }
 return {atoms,rules:[],parses,sourceByteLengths:documents.map(d=>d.bytes.length)};
}
function validateState(s){
 if(!s||!Array.isArray(s.atoms)||!Array.isArray(s.rules)||!Array.isArray(s.parses)||
 !Array.isArray(s.sourceByteLengths)||s.parses.length!==s.sourceByteLengths.length||
 s.parses.length>MAX_DOCS||s.rules.length>MAX_RULES)error('invalid state');
 const seen=new Set();
 for(const cp of s.atoms){if(!isScalar(cp)||seen.has(cp))error('bad/duplicate scalar');seen.add(cp);}
 let total=s.atoms.length;
 for(const rule of s.rules){
  if(!Array.isArray(rule)||rule.length!==2||rule.some(x=>!unsigned(x)||x>=total))error('forward/invalid binary rule');
  total++;
 }
 for(let i=0;i<s.parses.length;i++){
  if(!unsigned(s.sourceByteLengths[i]))error('source byte length');
  if(!Array.isArray(s.parses[i])||s.parses[i].some(x=>
    typeof x==='number'?!unsigned(x)||x>=total:
    !x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).join()!=='escape'||!isScalar(x.escape)))error('invalid parse reference');
 }
}
/** A concrete byte-level transmission format, not a Shannon proxy. Header:
 * MAGIC, #atoms, scalar values, #binary rules, child IDs, #documents,
 * each (source byte count, #root tokens, token IDs). Token ID=A+K
 * is a literal escape, followed by Unicode scalar ULEB128. All ints ULEB128.
 * Physical SQLite IDs are NEVER used. No ignored free metadata fields. */
export function encodeM1State(s){
 validateState(s);
 const o=[...MAGIC];writeU(o,s.atoms.length);
 for(const cp of s.atoms)writeU(o,cp);
 writeU(o,s.rules.length);
 for(const [a,b] of s.rules){writeU(o,a);writeU(o,b);}
 writeU(o,s.parses.length);
 for(let i=0;i<s.parses.length;i++){
  writeU(o,s.sourceByteLengths[i]);writeU(o,s.parses[i].length);
  for(const id of s.parses[i]){
   if(typeof id==='number')writeU(o,id);
   else{writeU(o,s.atoms.length+s.rules.length);writeU(o,id.escape);}
  }
 }
 return Buffer.from(o);
}
export function decodeM1Bytes(bytes,{maxOutputBytes=64_000_000,maxExpandedScalars=MAX_SCALARS}={}){
 if(!Buffer.isBuffer(bytes)||!unsigned(maxOutputBytes)||!unsigned(maxExpandedScalars))error('decode arguments');
 if(bytes.length<4||!bytes.subarray(0,4).equals(MAGIC))error('bad magic');
 const st={b:bytes,i:4},a=readU(st);
 if(a>0x110000)error('atom budget');
 const expansions=[],expBytes=[],expScalars=[],seen=new Set();let storedScalars=0;
 for(let i=0;i<a;i++){
  const cp=readU(st);if(!isScalar(cp)||seen.has(cp))error('invalid/duplicate atom');
  seen.add(cp);expansions.push(String.fromCodePoint(cp));
  expScalars.push(1);expBytes.push(cp<=0x7f?1:cp<=0x7ff?2:cp<=0xffff?3:4);
 }
 const k=readU(st);if(k>MAX_RULES)error('rule budget');
 const rules=[];
 for(let i=0;i<k;i++){
  const x=readU(st),y=readU(st);
  if(x>=a+i||y>=a+i)error('bad rule DAG');
  const count=expScalars[x]+expScalars[y],nbytes=expBytes[x]+expBytes[y];
  storedScalars+=count;
  if(count>maxExpandedScalars||nbytes>maxOutputBytes||storedScalars>maxExpandedScalars*8)error('expanded rule limit');
  expansions.push(expansions[x]+expansions[y]);
  expScalars.push(count);expBytes.push(nbytes);rules.push([x,y]);
 }
 const count=readU(st);if(count>MAX_DOCS)error('document budget');
 const documents=[],parses=[],byteLengths=[];let total=0;
 for(let i=0;i<count;i++){
  const expectedBytes=readU(st),n=readU(st);
  if(expectedBytes>maxOutputBytes||n>maxExpandedScalars)error('document budget');
  const tokens=[],parts=[];let byteCount=0,scalarCount=0;
  for(let j=0;j<n;j++){
   const x=readU(st);if(x>expansions.length)error('bad parse DAG');
   if(x===expansions.length){
    const cp=readU(st);if(!isScalar(cp))error('invalid escaped scalar');
    tokens.push({escape:cp});parts.push(String.fromCodePoint(cp));scalarCount++;
    byteCount+=cp<=0x7f?1:cp<=0x7ff?2:cp<=0xffff?3:4;
   }else{tokens.push(x);parts.push(expansions[x]);scalarCount+=expScalars[x];byteCount+=expBytes[x];}
   if(scalarCount>maxExpandedScalars||byteCount>maxOutputBytes)error('output budget');
  }
  const result=Buffer.from(parts.join(''),'utf8');
  if(result.length!==expectedBytes)error('source byte count differs from replay');
  total+=result.length;if(total>maxOutputBytes)error('total output budget');
  documents.push(result);parses.push(tokens);byteLengths.push(expectedBytes);
 }
 if(st.i!==bytes.length)error('trailing data');
 return {documents,state:{atoms:[...seen],rules,parses,sourceByteLengths:byteLengths}};
}
function countPairs(s){
 const map=new Map();
 for(const tokens of s.parses){
  const local=new Map();
  for(let i=0;i+1<tokens.length;i++){
   const key=tokens[i]+','+tokens[i+1];
   let r=local.get(key);
   if(!r){r={a:tokens[i],b:tokens[i+1],count:0,end:-1};local.set(key,r);}
   if(i>=r.end){r.count++;r.end=i+2;}
  }
  for(const [key,r] of local){
   if(!map.has(key))map.set(key,{a:r.a,b:r.b,count:0});
   map.get(key).count+=r.count;
  }
 }
 return [...map.values()].filter(x=>x.count>=2).sort((x,y)=>
  y.count-x.count||x.a-y.a||x.b-y.b);
}
function merge(s,a,b){
 const id=s.atoms.length+s.rules.length;
 const parses=s.parses.map(tokens=>{
  const out=[];for(let i=0;i<tokens.length;i++){
   if(i+1<tokens.length&&tokens[i]===a&&tokens[i+1]===b){out.push(id);i++;}
   else out.push(tokens[i]);
  }return out;
 });
 return {...s,rules:[...s.rules,[a,b]],parses};
}
function dropLastRule(s){
 if(!s.rules.length)return null;
 const last=s.atoms.length+s.rules.length-1;
 const [a,b]=s.rules[s.rules.length-1];
 return {...s,rules:s.rules.slice(0,-1),parses:s.parses.map(tokens=>tokens.flatMap(x=>x===last?[a,b]:[x]))};
}
/** A fixed-grammar optimal segmentation for ULEB token-reference cost.
 * Includes atom fallback. This is exact for frozen rule table and frozen
 * token byte costs; it is not an unrestricted minimum-grammar solver. */
function reparse(s,documents){
 const terms=s.atoms.map(cp=>String.fromCodePoint(cp));
 for(const [a,b] of s.rules)terms.push(terms[a]+terms[b]);
 const cpTerms=terms.map(t=>[...t].map(c=>c.codePointAt(0)));
 const byFirst=new Map();
 for(let id=0;id<terms.length;id++){
  const cps=cpTerms[id];if(!cps.length)continue;
  if(!byFirst.has(cps[0]))byFirst.set(cps[0],[]);
  byFirst.get(cps[0]).push({id,cps,cost:sizeU(id)});
 }
 const parses=documents.map(doc=>{
  const x=doc.cps,n=x.length,dp=new Array(n+1).fill(Infinity),choice=new Array(n);
  dp[n]=0;
  for(let i=n-1;i>=0;i--){
   for(const cand of byFirst.get(x[i])??[]){
    if(cand.cps.length>n-i)continue;
    let match=true;
    for(let j=0;j<cand.cps.length;j++)if(x[i+j]!==cand.cps[j]){match=false;break;}
    if(!match)continue;
    const cost=cand.cost+dp[i+cand.cps.length];
    if(cost<dp[i]||cost===dp[i]&&(
     !choice[i]||cand.cps.length>choice[i].length||
     cand.cps.length===choice[i].length&&cand.id<choice[i].id)){
     dp[i]=cost;choice[i]={id:cand.id,length:cand.cps.length};
    }
   }
   const fallback={id:{escape:x[i]},length:1,cost:sizeU(terms.length)+sizeU(x[i])};
   if(!choice[i]||fallback.cost+dp[i+1]<dp[i]){
    dp[i]=fallback.cost+dp[i+1];choice[i]=fallback;
   }
  }
  const result=[];for(let i=0;i<n;){result.push(choice[i].id);i+=choice[i].length;}
  return result;
 });
 return {...s,parses};
}
function checkExact(s,original){
 const bytes=encodeM1State(s),replayed=decodeM1Bytes(bytes).documents;
 if(replayed.length!==original.length||replayed.some((x,i)=>!x.equals(original[i].bytes)))error('internal replay mismatch');
 return bytes;
}
/** Deterministic bounded training, no heldout input or labels accepted.
 * A0: most frequent adjacent pair, A1: full transmitted-byte minimum.
 * Optional exact frozen-code reparse and last-rule split probes.
 * A2/A3 (contexts/classes/slots) are NOT implemented in this milestone. */
export function trainM1(documents,{mode='A1',maxRules=64,topCandidates=24,improveParses=true}={}){
 if(!['A0','A1'].includes(mode)||!Number.isSafeInteger(maxRules)||maxRules<0||maxRules>MAX_RULES||
 !Number.isSafeInteger(topCandidates)||topCandidates<1||topCandidates>256||typeof improveParses!=='boolean')error('training options');
 const original=validInput(documents);let state=initialState(original),wire=checkExact(state,original);
 const beforeBits=8*wire.length,history=[];
 for(let epoch=0;epoch<maxRules;epoch++){
  const candidates=countPairs(state).slice(0,topCandidates);
  if(!candidates.length)break;
  let best=null;
  for(const c of candidates){
   const trial=merge(state,c.a,c.b),candidateWire=encodeM1State(trial);
   const delta=8*(candidateWire.length-wire.length);
   if(mode==='A0'){best={c,trial,wire:candidateWire,delta};break;}
   if(delta<0&&(!best||delta<best.delta||delta===best.delta&&(
    c.a<best.c.a||c.a===best.c.a&&c.b<best.c.b)))
    best={c,trial,wire:candidateWire,delta};
  }
  if(!best)break;
  state=best.trial;wire=best.wire;
  history.push({operation:'merge',pair:[best.c.a,best.c.b],
   nonoverlapOccurrences:best.c.count,deltaBits:best.delta,actualTotalBits:wire.length*8});
 }
 if(improveParses){
  // A0 stays pure frequency-only, avoiding mixing algorithms in the ablation.
  if(mode==='A1'){
   let changed=true;
   while(changed){
    changed=false;
    const candidate=reparse(state,original),nextWire=encodeM1State(candidate);
    if(nextWire.length<wire.length){
     history.push({operation:'frozen-grammar-reparse',deltaBits:8*(nextWire.length-wire.length)});
     state=candidate;wire=nextWire;changed=true;
    }
    const drop=dropLastRule(state);
    if(drop){const dropWire=encodeM1State(drop);
     if(dropWire.length<wire.length){history.push({operation:'split-last',deltaBits:8*(dropWire.length-wire.length)});
      state=drop;wire=dropWire;changed=true;}
    }
   }
  }
 }
 checkExact(state,original);
 const modelBits=8*encodeM1State({...state,parses:[],sourceByteLengths:[]}).length;
 return {schema:'mts-nl/m1-reversible-mdl/v0',mode,state,wire,modelBits,
  dataBits:wire.length*8-modelBits,
  initialBits:beforeBits,totalBits:wire.length*8,modelAndDataBytes:wire.length,
  rules:state.rules.length,trainingDocuments:original.length,
  originalBytes:original.reduce((n,d)=>n+d.bytes.length,0),history,
  exactReplay:'PASS',boundaryKnowledge:'NONE',
  implemented:['A0 frequency baseline','A1 exact ULEB bit-cost grammar'],
  notImplemented:['A2 predictive contexts','A3 classes and slots','SQLite Link materialization']};
}
/** Independently encode heldout with a frozen grammar; DOES NOT mutate it.
 * Encoding of the original, learned alphabet and grammar are only train-based.
 * Unknown scalars use paid literal escape references; the dictionary never mutates.
 */
export function scoreM1Frozen(model,heldout){
 if(!model?.state)error('missing trained model');
 const docs=validInput(heldout);const s=model.state;
 const unknown=new Set(docs.flatMap(d=>d.cps).filter(cp=>!s.atoms.includes(cp)));
 const state=reparse({...s,parses:[],sourceByteLengths:[]},docs);
 const score=encodeM1State({...state,sourceByteLengths:docs.map(d=>d.bytes.length)});
 const replay=decodeM1Bytes(score).documents;
 if(replay.some((x,i)=>!x.equals(docs[i].bytes)))error('heldout replay mismatch');
 const totalScalars=docs.reduce((n,d)=>n+d.cps.length,0);
 return {status:'FROZEN_GRAMMAR_REPLAY_PASS',
  transmittedTotalBits:score.length*8,
  // Model is transmitted in this independent score frame. Isolate the
  // novel document token stream by subtracting a zero-doc model frame.
  frozenModelBits:encodeM1State({...state,parses:[],sourceByteLengths:[]}).length*8,
  heldoutDataBits:score.length*8-encodeM1State({...state,parses:[],sourceByteLengths:[]}).length*8,
  heldoutBitsPerScalar:totalScalars?(score.length*8-encodeM1State({...state,parses:[],sourceByteLengths:[]}).length*8)/totalScalars:null,
  heldoutScalars:totalScalars,
  heldoutDocuments:docs.length,escapedHeldoutDistinctScalars:unknown.size,
  noTrainingOnHeldout:true};
}