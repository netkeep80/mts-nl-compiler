// #68 W3 research: physically selected observed two-word phrase Links.
// Counts are from independent source positions. NO SHA Link identity.
import {NumericCorpusLoader} from './numeric-corpus-loader-v1.mjs';
import {exactWordSegments} from './word-aligned-numeric-v0.mjs';
import {formatLinkId} from './numeric-link-store-v1.mjs';

const fail=s=>{throw Error('OBSERVED_PHRASE_NUMERIC: '+s);};
const textDecoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const pureGap=s=>/^[ \t]+$/u.test(s);
const key=(a,b)=>JSON.stringify([a.toLocaleLowerCase('ru'),b.toLocaleLowerCase('ru')]);
const now=()=>process.hrtime.bigint(),ms=t=>+(Number(now()-t)/1e6).toFixed(3);

export function trainObservedPhrasePairs(documents,{minOccurrences=2,maxCandidates=1000}={}){
 if(!Array.isArray(documents)||!documents.length||!Number.isSafeInteger(minOccurrences)||
  minOccurrences<2||!Number.isSafeInteger(maxCandidates)||maxCandidates<1||
  maxCandidates>10000)fail('invalid documents or vocabulary bounds');
 const counts=new Map(),ids=new Set();
 let totalObservedPositions=0,ordinal=0;
 for(const doc of documents){
  if(!doc||typeof doc.id!=='string'||!doc.id||typeof doc.source!=='string'||
   ids.has(doc.id))fail('invalid/duplicate corpus item');
  ids.add(doc.id);ordinal++;
  const seg=exactWordSegments(doc.source);
  for(let i=0;i+2<seg.length;i++){
   const a=seg[i],gap=seg[i+1],b=seg[i+2];
   if(a.kind!=='word'||gap.kind!=='separator'||!pureGap(gap.text)||b.kind!=='word')
    continue;
   totalObservedPositions++;
   const k=key(a.text,b.text),v=counts.get(k);
   if(v){v.count++;if(v.lastDocument!==ordinal){v.lastDocument=ordinal;v.documents++;}}
   else counts.set(k,{count:1,documents:1,lastDocument:ordinal});
  }
 }
 const ranked=[...counts.entries()].filter(([,v])=>v.count>=minOccurrences)
  .sort((a,b)=>b[1].count-a[1].count||(a[0]<b[0]?-1:a[0]>b[0]?1:0))
  .slice(0,maxCandidates);
 const lexicon=new Map(ranked.map(([k,v])=>[k,v.count]));
 return {schema:'mts-nl/observed-phrase-vocabulary/v0',
  sourceDocuments:documents.length,totalObservedPositions,distinctObservedPairs:counts.size,
  minimumOccurrences:minOccurrences,lexicon,
  candidateReport:ranked.map(([k,v],i)=>({rank:i+1,words:JSON.parse(k),
   observedOccurrences:v.count,documents:v.documents,
   empiricalRate:+(v.count/Math.max(1,totalObservedPositions)).toPrecision(8)}))};
}
export class ObservedPhraseNumericLoader extends NumericCorpusLoader{
 constructor(db,lexicon,opts={}){
  super(db,opts);
  if(!(lexicon instanceof Map))fail('explicit trained vocabulary Map required');
  this.lexicon=lexicon;
  this.lastEvidence=null;
 }
 appendBook(bytes,{id='phrase-document',maxCodePoints=1000000}={}){
  if(!Buffer.isBuffer(bytes)||typeof id!=='string'||!id||this.db.isTransaction||
    !Number.isSafeInteger(maxCodePoints)||maxCodePoints<0)fail('bad document');
  const started=now(),source=textDecoder.decode(bytes);
  if(!Buffer.from(source,'utf8').equals(bytes))fail('source bytes changed');
  const cp=[...source];
  if(cp.length>maxCodePoints)fail('RESOURCE_LIMIT codepoints');
  const seg=exactWordSegments(source);
  const c={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
  const wordIds=[],selectedPhraseIds=[];
  const build=(symbols,a,b)=>{
   if(a===b)return this._atom('',c);
   if(a+1===b)return this._atom(symbols[a],c);
   const mid=a+Math.floor((b-a)/2);
   return this._pair(build(symbols,a,mid),build(symbols,mid,b),c);
  };
  let root;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const units=[];
   for(let i=0;i<seg.length;i++){
    const chunk=seg[i],id=build([...chunk.text],0,[...chunk.text].length);
    if(chunk.kind==='word'){
     wordIds.push(id);
     if(i+1<seg.length&&seg[i+1].kind==='separator'){
      const separator=seg[++i].text;
      const scalars=[...separator];
      const sepId=build(scalars,0,scalars.length);
      units.push({id:this._pair(id,sepId,c),word:chunk.text,separator});
     }else units.push({id,word:chunk.text,separator:''});
    }else units.push({id,word:null,separator:''});
   }
   // Candidate windows overlap in the input; select by observed frequency
   // first, then earliest source position. Never count rejected windows as
   // selected structural Link observations.
   const eligible=[];
   for(let i=0;i+1<units.length;i++){
    const a=units[i],b=units[i+1];
    if(a.word===null||b.word===null||!pureGap(a.separator))continue;
    const count=this.lexicon.get(key(a.word,b.word));
    if(count!==undefined)eligible.push({position:i,count});
   }
   eligible.sort((a,b)=>b.count-a.count||a.position-b.position);
   const selected=new Set(),reserved=new Set();
   for(const x of eligible){
    if(reserved.has(x.position)||reserved.has(x.position+1))continue;
    selected.add(x.position);reserved.add(x.position);reserved.add(x.position+1);
   }
   const finalUnits=[];
   for(let i=0;i<units.length;i++){
    if(selected.has(i)){
     const id=this._pair(units[i].id,units[i+1].id,c);
     selectedPhraseIds.push(id);finalUnits.push(id);i++;
    }else finalUnits.push(units[i].id);
   }
   const merge=(a,b)=>{
    if(a===b)return this._atom('',c);
    if(a+1===b)return finalUnits[a];
    const mid=a+Math.floor((b-a)/2);
    return this._pair(merge(a,mid),merge(mid,b),c);
   };
   root=merge(0,finalUnits.length);
   const constructionMs=ms(started),ct=now();
   this.db.exec('COMMIT');
   const commitMs=ms(ct);
   this.lastEvidence={rootLinkId:formatLinkId(root),wordIds,selectedPhraseIds,
    eligibleWindows:eligible.length,rejectedOverlaps:eligible.length-selected.size};
   return {id,rootLinkId:formatLinkId(root),sourceBytes:bytes.length,codepoints:cp.length,
    wordTokens:wordIds.length,eligiblePhraseWindows:eligible.length,
    selectedPhraseOccurrences:selected.size,distinctSelectedPhraseLinks:new Set(selectedPhraseIds).size,
    rejectedOverlappingWindows:eligible.length-selected.size,
    ...c,insertedLinks:c.insertedAtoms+c.insertedPairs,
    constructionMs,commitMs,totalMs:ms(started),
    hashDerivedLinkIds:0,physicalIdentity:'sqlite-integer-autoincrement'};
  }catch(e){this.db.exec('ROLLBACK');this.loadCaches();this.lastEvidence=null;throw e;}
 }
}
