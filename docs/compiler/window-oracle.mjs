// W22: exhaustive, deterministic, strictly LOCAL binary-grouping oracle.
// Enumerates Catalan(n-1) trees over an EXACT contiguous Unicode scalar window.
// It does NOT optimize whole-source grammar, transfer to unseen data or
// assume whitespace/word/morpheme boundaries. Numeric IDs are NOT persistent.
import {scalarsOf} from './engine.mjs';

const fail=msg=>{throw new Error('WINDOW_ORACLE: '+msg);};
const catalan=[1,1,2,5,14,42,132,429];
const formatSymbol=s=>JSON.stringify(s);
const formatTree=tree=>typeof tree==='string'?formatSymbol(tree):
 '('+formatTree(tree[0])+' ⟼ '+formatTree(tree[1])+')';
function tally(tree){
 const seen=new Set(),frequency=new Map();
 function walk(t){
  if(typeof t==='string')return 'a:'+JSON.stringify(t);
  const left=walk(t[0]),right=walk(t[1]),key='p:'+JSON.stringify([left,right]);
  seen.add(key);frequency.set(key,(frequency.get(key)??0)+1);
  return key;
 }
 walk(tree);
 return {uniquePairs:seen.size};
}
function canonicalTrees(chars){
 const memo=new Map();
 function all(start,end){
  const key=start+':'+end;
  if(memo.has(key))return memo.get(key);
  if(end-start===1)return [chars[start]];
  const result=[];
  for(let split=start+1;split<end;split++){
   for(const left of all(start,split))
    for(const right of all(split,end))
     result.push([left,right]);
  }
  memo.set(key,result);return result;
 }
 return all(0,chars.length);
}
function baselineTree(chars,mode){
 if(chars.length===1)return chars[0];
 if(mode==='left'){
  let tree=chars[0];
  for(let i=1;i<chars.length;i++)tree=[tree,chars[i]];
  return tree;
 }
 const balanced=seq=>{
  if(seq.length===1)return seq[0];
  const mid=Math.floor(seq.length/2);
  return [balanced(seq.slice(0,mid)),balanced(seq.slice(mid))];
 };
 return balanced(chars);
}
const describe=(tree,ordinal,baseline)=>{
 const uniquePairs=tally(tree).uniquePairs;
 return {
  ordinal,uniquePairs,
  repeatedPairOccurrences:Math.max(0,baseline.length-1-uniquePairs),
  expression:formatTree(tree)
 };
};
export function inspectLocalWindow(source,{width=8,offset=null,topN=5}={}){
 const codepoints=scalarsOf(source);
 if(!Number.isInteger(width)||width<2||width>8)fail('width must be 2..8');
 if(!Number.isInteger(topN)||topN<1||topN>20)fail('topN must be 1..20');
 if(codepoints.length<width)fail('input shorter than selected window');
 if(offset===null)offset=codepoints.length-width; // sliding suffix-front default
 if(!Number.isInteger(offset)||offset<0||offset+width>codepoints.length)
  fail('window offset outside input');
 const symbols=codepoints.slice(offset,offset+width);
 const candidates=canonicalTrees(symbols);
 const expected=catalan[width-1];
 if(candidates.length!==expected)fail('Catalan enumeration incomplete');
 const ranked=candidates.map((tree,i)=>describe(tree,i,symbols))
  .sort((a,b)=>a.uniquePairs-b.uniquePairs||a.ordinal-b.ordinal);
 const balanced=describe(baselineTree(symbols,'balanced'),null,symbols);
 const left=describe(baselineTree(symbols,'left'),null,symbols);
 const optimal=ranked[0];
 const uniqueOptima=ranked.filter(x=>x.uniquePairs===optimal.uniquePairs).length;
 return {
  schema:'mts-nl/local-catalan-oracle/v1',status:'EXHAUSTIVE_LOCAL_WINDOW',
  sourceScalars:codepoints.length,offset,width,
  rightFront:offset+width,windowText:symbols.join(''),treeCount:candidates.length,
  uniqueOptima,minimumUniquePairs:optimal.uniquePairs,
  balanced:{...balanced,deltaPairs:balanced.uniquePairs-optimal.uniquePairs},
  left:{...left,deltaPairs:left.uniquePairs-optimal.uniquePairs},
  candidates:ranked.slice(0,topN).map(x=>({
   ...x,deltaVsBalanced:balanced.uniquePairs-x.uniquePairs,
   deltaVsLeft:left.uniquePairs-x.uniquePairs
  })),
  limits:{
   objective:'minimum UNIQUE internal pair structures inside selected isolated window',
   physicalLinkIds:false,contextReusedPairs:false,
   globalOptimality:false,probabilityModel:false,tokenization:false,
   sourceTraining:'in-sample structural enumeration; not an independent heldout test'
  }
 };
}
