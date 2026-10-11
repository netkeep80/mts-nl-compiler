// Research #68: exact byte-preserving word/phrase-aligned physical Link graph.
// No SHA Link identity, no normalization of source bytes, no alternate node type.
import {NumericCorpusLoader} from './numeric-corpus-loader-v1.mjs';
import {formatLinkId} from './numeric-link-store-v1.mjs';

const fail=s=>{throw Error('WORD_ALIGNED_NUMERIC: '+s);};
const tick=()=>process.hrtime.bigint();
const ms=t=>+(Number(tick()-t)/1e6).toFixed(3);
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const isWord=/^[\p{L}\p{M}\p{N}]+$/u;
// Full-coverage alternation: no normalizing separators, BOM, accents, or punctuation.
const rawSegments=/[\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+/gu;

export function exactWordSegments(source){
 if(typeof source!=='string')fail('source must be text');
 const segments=[...source.matchAll(rawSegments)].map(x=>({
  text:x[0],kind:isWord.test(x[0])?'word':'separator'
 }));
 if(segments.map(x=>x.text).join('')!==source)fail('lossy Unicode segmentation');
 return segments;
}
export class WordAlignedNumericLoader extends NumericCorpusLoader {
 constructor(db,options={}){super(db,options);this.lastEvidence=null;}
 appendBook(bytes,{id='word-source',maxCodePoints=1000000}={}){
  if(!Buffer.isBuffer(bytes)||typeof id!=='string'||!id||
   !Number.isSafeInteger(maxCodePoints)||maxCodePoints<0||this.db.isTransaction)
   fail('invalid book/budget/transaction');
  const started=tick();
  const source=utf8.decode(bytes);
  if(!Buffer.from(source,'utf8').equals(bytes))fail('invalid/altered UTF-8 source');
  const cp=[...source];
  if(cp.length>maxCodePoints)fail('RESOURCE_LIMIT source');
  const t=tick(),segments=exactWordSegments(source);
  const tokenizeMs=ms(t);
  const counts={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
  const wordRoots=[],phraseRoots=[],wordStrings=[];
  let phraseNodeOccurrences=0,root;
  const buildChars=(symbols,a,b)=>{
   if(b===a)return this._atom('',counts);
   if(b===a+1)return this._atom(symbols[a],counts);
   const mid=a+Math.floor((b-a)/2);
   return this._pair(buildChars(symbols,a,mid),buildChars(symbols,mid,b),counts);
  };
  this.db.exec('BEGIN IMMEDIATE');
  try{
   // First form a whole-word physical Link (ordinary binary tree), then
   // consume its exact trailing separator as another physical Link.
   const units=[];
   for(let i=0;i<segments.length;i++){
    const current=segments[i],scalars=[...current.text];
    const link=buildChars(scalars,0,scalars.length);
    if(current.kind==='word'){
     wordRoots.push(link);wordStrings.push(current.text);
     if(i+1<segments.length&&segments[i+1].kind==='separator'){
      const separator=[...segments[++i].text];
      const sep=buildChars(separator,0,separator.length);
      units.push({id:this._pair(link,sep,counts),words:1});
     }else units.push({id:link,words:1});
    }else units.push({id:link,words:0});
   }
   const merge=(a,b)=>{
    if(a===b)return {id:this._atom('',counts),words:0};
    if(a+1===b)return units[a];
    const mid=a+Math.floor((b-a)/2);
    const l=merge(a,mid),r=merge(mid,b);
    const parent=this._pair(l.id,r.id,counts),words=l.words+r.words;
    if(words>=2){phraseNodeOccurrences++;phraseRoots.push(parent);}
    return {id:parent,words};
   };
   root=merge(0,units.length).id;
   const compileAndSqlInsertMs=ms(t);
   const ct=tick();
   this.db.exec('COMMIT');
   const commitMs=ms(ct);
   const insertedLinks=counts.insertedAtoms+counts.insertedPairs;
   this.lastEvidence={
    wordRoots,phraseRoots,words:wordStrings,
    units:units.length,sourceCodepoints:cp.length,rootLinkId:formatLinkId(root)
   };
   return {id,rootLinkId:formatLinkId(root),sourceBytes:bytes.length,
    codepoints:cp.length,tokenization:'exact-word-and-separator',
    wordTokens:wordRoots.length,separatorTokens:segments.length-wordRoots.length,
    selectedPhraseNodeOccurrences:phraseNodeOccurrences,
    selectedPhraseUniqueLinks:new Set(phraseRoots).size,
    ...counts,insertedLinks,sourceAliasesCreated:0,
    tokenizeMs,compileAndSqlInsertMs,commitMs,
    loadTotalMs:ms(started),
    linksPerSecond:+(insertedLinks/Math.max(.001,compileAndSqlInsertMs+commitMs)*1000).toFixed(1),
    physicalIdentity:'sqlite-autoincrement-bigint'};
  }catch(e){this.db.exec('ROLLBACK');this.loadCaches();this.lastEvidence=null;throw e;}
 }
}
