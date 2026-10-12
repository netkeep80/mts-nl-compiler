// W4: deterministic, bounded, language-blind recursive pair substitution.
// Only exact Unicode scalar equality; no tokenization by words, spaces or scripts.
// Dictionary integers are LOCAL grammar labels, never persistent Link IDs.
import {NumericCorpusLoader} from './numeric-corpus-loader-v1.mjs';
import {formatLinkId} from './numeric-link-store-v1.mjs';

const bad=s=>{throw Error('UNIVERSAL_REPAIR: '+s);};
const exactDecoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const clock=()=>process.hrtime.bigint(),ms=t=>+(Number(clock()-t)/1e6).toFixed(3);
const pairKey=(a,b)=>a+','+b;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function exactText(bytes){
 if(!Buffer.isBuffer(bytes))bad('Buffer required');
 const text=exactDecoder.decode(bytes);
 if(!Buffer.from(text,'utf8').equals(bytes))bad('input UTF-8 not exact');
 return text;
}
export function trainUniversalRepair(documents,{
 maxCodepointsPerBook=16384,maxRules=96,
 maxRuleCodepoints=64,minOccurrences=3
}={}){
 if(!Array.isArray(documents)||!documents.length||
  !Number.isSafeInteger(maxCodepointsPerBook)||maxCodepointsPerBook<2||
  !Number.isSafeInteger(maxRules)||maxRules<1||maxRules>512||
  !Number.isSafeInteger(maxRuleCodepoints)||maxRuleCodepoints<2||maxRuleCodepoints>256||
  !Number.isSafeInteger(minOccurrences)||minOccurrences<2)
  bad('invalid training parameters');
 const t=clock();
 const ids=new Set(),symbols=new Map(),terms=new Map(),rules=[],sources=[];
 let next=1,totalSampled=0;
 const terminal=ch=>{
  if(symbols.has(ch))return symbols.get(ch);
  const token=next++;
  symbols.set(ch,token);terms.set(token,{text:ch,length:1});return token;
 };
 for(const doc of documents){
  if(!doc||typeof doc.id!=='string'||!doc.id||ids.has(doc.id)||!Buffer.isBuffer(doc.bytes))
   bad('invalid or duplicate training source');
  ids.add(doc.id);
  const scalars=[...exactText(doc.bytes)].slice(0,maxCodepointsPerBook);
  totalSampled+=scalars.length;
  sources.push(scalars.map(terminal));
 }
 let selectedOccurrences=0,totalCountingMs=0,totalReplaceMs=0;
 for(let iteration=0;iteration<maxRules;iteration++){
  const ct=clock(),counts=new Map();
  for(const seq of sources)for(let i=0;i+1<seq.length;i++){
   const left=seq[i],right=seq[i+1];
   const length=terms.get(left).length+terms.get(right).length;
   if(length>maxRuleCodepoints)continue;
   const key=pairKey(left,right),r=counts.get(key);
   if(r)r.frequency++;
   else counts.set(key,{left,right,frequency:1,key,length});
  }
  totalCountingMs+=Number(clock()-ct)/1e6;
  const ranked=[...counts.values()].filter(x=>x.frequency>=minOccurrences)
   .sort((a,b)=>b.frequency-a.frequency||cmp(a.key,b.key));
  let chosen,rewritten;
  const rt=clock();
  // Counts before replacement overlap; confirm the actual disjoint
  // replacements instead of treating overlapping substrings as evidence.
  for(const candidate of ranked){
   const nextSources=[];let replacements=0;
   for(const source of sources){
    const nextSequence=[];
    for(let i=0;i<source.length;i++){
     if(i+1<source.length&&source[i]===candidate.left&&
        source[i+1]===candidate.right){
      nextSequence.push(next);i++;replacements++;
     }else nextSequence.push(source[i]);
    }
    nextSources.push(nextSequence);
   }
   if(replacements>=minOccurrences){
    chosen={...candidate,disjointReplacements:replacements};
    rewritten=nextSources;break;
   }
  }
  totalReplaceMs+=Number(clock()-rt)/1e6;
  if(!chosen)break;
  const text=terms.get(chosen.left).text+terms.get(chosen.right).text;
  const rule={token:next,left:chosen.left,right:chosen.right,
   text,length:chosen.length,
   trainingDisjointReplacements:chosen.disjointReplacements,
   trainingOverlappingPairObservations:chosen.frequency};
  rules.push(rule);
  terms.set(next,{text,length:chosen.length,left:chosen.left,right:chosen.right});
  next++;
  selectedOccurrences+=chosen.disjointReplacements;
  sources.splice(0,sources.length,...rewritten);
 }
 return {
  schema:'mts-nl/universal-repair-grammar/v0',
  method:'bounded global adjacent-pair substitutions with nonoverlap confirmation',
  parameters:{maxCodepointsPerBook,maxRules,maxRuleCodepoints,minOccurrences},
  trainingDocuments:documents.length,trainingSampledCodepoints:totalSampled,
  terminalSymbols:symbols.size,ruleCount:rules.length,
  trainingDisjointReplacements:selectedOccurrences,
  elapsedMs:ms(t),pairCountingMs:+totalCountingMs.toFixed(3),
  nonoverlapSelectionMs:+totalReplaceMs.toFixed(3),
  symbols,terms,rules
 };
}
export function summarizeRepairGrammar(grammar,{topN=40}={}){
 if(!grammar||!Array.isArray(grammar.rules)||!Number.isInteger(topN)||
   topN<1||topN>1000)bad('invalid grammar summary');
 return {schema:grammar.schema,method:grammar.method,
  parameters:grammar.parameters,trainingDocuments:grammar.trainingDocuments,
  trainingSampledCodepoints:grammar.trainingSampledCodepoints,
  terminalSymbols:grammar.terminalSymbols,ruleCount:grammar.ruleCount,
  trainingDisjointReplacements:grammar.trainingDisjointReplacements,
  elapsedMs:grammar.elapsedMs,pairCountingMs:grammar.pairCountingMs,
  nonoverlapSelectionMs:grammar.nonoverlapSelectionMs,
  topRules:[...grammar.rules]
   .sort((a,b)=>b.trainingDisjointReplacements-a.trainingDisjointReplacements||
      cmp(a.token,b.token))
   .slice(0,topN).map(x=>({localGrammarToken:x.token,
    expandedCodepoints:x.length,trainingOccurrences:x.trainingDisjointReplacements,
    preview:[...x.text].slice(0,48).join('')}))};
}
export class UniversalRepairNumericLoader extends NumericCorpusLoader{
 constructor(db,grammar,options={}){
  super(db,options);
  if(!grammar||!(grammar.terms instanceof Map)||!(grammar.symbols instanceof Map)||
   !Array.isArray(grammar.rules))bad('validated grammar required');
  this.grammar=grammar;this.poisoned=false;this.lastEvidence=null;
  // Exact raw scalar trie, with no semantic boundary predicate.
  const root={children:new Map(),token:null};
  for(const rule of grammar.rules){
   if(rule.length<2)continue;
   let node=root;
   for(const symbol of [...rule.text]){
    if(!node.children.has(symbol))
     node.children.set(symbol,{children:new Map(),token:null});
    node=node.children.get(symbol);
   }
   if(node.token===null||rule.trainingDisjointReplacements>
      grammar.rules.find(r=>r.token===node.token).trainingDisjointReplacements)
    node.token=rule.token;
  }
  this.trie=root;this.selected=new Map();this.documentOrdinal=0;
 }
 appendBook(bytes,{id='universal-source',maxCodePoints=1000000}={}){
  if(this.poisoned)bad('previous document failed; new database required');
  if(!Buffer.isBuffer(bytes)||typeof id!=='string'||!id||
   this.db.isTransaction||!Number.isSafeInteger(maxCodePoints)||maxCodePoints<0)
   bad('invalid document, budget or transaction');
  const idDocument=++this.documentOrdinal;
  const start=clock();
  const scalars=[...exactText(bytes)];
  if(scalars.length>maxCodePoints)bad('RESOURCE_LIMIT codepoints');
  const c={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
  const memo=new Map(),selectedDocument=new Map(),units=[];
  let covered=0,selectedOccurrences=0,rootId;
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const make=token=>{
    if(memo.has(token))return memo.get(token);
    const term=this.grammar.terms.get(token);
    if(!term)bad('unresolved learned token');
    const id=term.left===undefined?this._atom(term.text,c):
     this._pair(make(term.left),make(term.right),c);
    memo.set(token,id);return id;
   };
   for(let i=0;i<scalars.length;){
    let node=this.trie,j=i,best=null,bestEnd=i;
    while(j<scalars.length){
     node=node.children.get(scalars[j]);if(!node)break;
     j++;if(node.token!==null){best=node.token;bestEnd=j;}
    }
    if(best===null){
     units.push(this._atom(scalars[i],c));i++;
    }else{
     const id=make(best);
     units.push(id);
     const length=bestEnd-i;covered+=length;selectedOccurrences++;
     const count=selectedDocument.get(best)??0;
     selectedDocument.set(best,count+1);
     const prev=this.selected.get(best);
     if(prev){prev.count++;if(prev.lastDocument!==idDocument){
       prev.documents++;prev.lastDocument=idDocument;}}
     else this.selected.set(best,{count:1,documents:1,lastDocument:idDocument,
       linkId:formatLinkId(id)});
     i=bestEnd;
    }
   }
   const build=(a,b)=>{
    if(a===b)return this._atom('',c);
    if(a+1===b)return units[a];
    const m=a+Math.floor((b-a)/2);
    return this._pair(build(a,m),build(m,b),c);
   };
   rootId=build(0,units.length);
   const constructionMs=ms(start),commitStart=clock();
   this.db.exec('COMMIT');
   const commitMs=ms(commitStart);
   const inserted=c.insertedAtoms+c.insertedPairs;
   this.lastEvidence={selectedDocument,selectedOccurrences,
    coveredCodepoints:covered,rootLinkId:formatLinkId(rootId)};
   return {id,rootLinkId:formatLinkId(rootId),sourceBytes:bytes.length,
    codepoints:scalars.length,selectedLearnedOccurrences:selectedOccurrences,
    selectedCoveredCodepoints:covered,
    coverage:scalars.length?+(covered/scalars.length).toFixed(6):0,
    uniqueSelectedLearnedTokens:selectedDocument.size,
    ...c,insertedLinks:inserted,
    constructionMs,commitMs,loadTotalMs:ms(start),
    linksPerSecond:+(inserted/Math.max(.001,constructionMs)*1000).toFixed(1),
    hashDerivedLinkIds:0,identity:'sqlite-integer-autoincrement'};
  }catch(e){this.db.exec('ROLLBACK');this.loadCaches();this.lastEvidence=null;
   this.poisoned=true;throw e;}
 }
}
