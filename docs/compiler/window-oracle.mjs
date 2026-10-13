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
 if(typeof source!=='string'||source.length>4096)fail('input exceeds 2048 Unicode scalar budget');
 const codepoints=scalarsOf(source);
 if(codepoints.length>2048)fail('input exceeds 2048 Unicode scalar budget');
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


// W22-B: exact WHOLE-INPUT structural counterfactual, bounded to 128 scalars.
// The outside balanced binary trees and their attachment order are kept fixed.
// This is not optimization of the durable SQLite graph or independent corpus.
function countContextPairs(prefixTree,windowTree,suffixTree,exactSource){
 const atoms=new Map(),pairs=new Map(),nodes=[null],parts={
  prefix:new Set(),window:new Set(),suffix:new Set()
 };
 const atom=s=>{
  if(!atoms.has(s)){const id=nodes.length;atoms.set(s,id);nodes.push({symbol:s});}
  return atoms.get(s);
 };
 const visit=(tree,part)=>{
  if(typeof tree==='string')return atom(tree);
  const from=visit(tree[0],part),to=visit(tree[1],part),key=from+','+to;
  let id=pairs.get(key);
  if(id===undefined){id=nodes.length;pairs.set(key,id);nodes.push({from,to});}
  if(part)parts[part].add(id);
  return id;
 };
 let root=visit(windowTree,'window');
 if(prefixTree!==null){
  const left=visit(prefixTree,'prefix'),key=left+','+root;
  let id=pairs.get(key);
  if(id===undefined){id=nodes.length;pairs.set(key,id);nodes.push({from:left,to:root});}
  root=id;
 }
 if(suffixTree!==null){
  const right=visit(suffixTree,'suffix'),key=root+','+right;
  let id=pairs.get(key);
  if(id===undefined){id=nodes.length;pairs.set(key,id);nodes.push({from:root,to:right});}
  root=id;
 }
 // Decode from the numbered Link DAG, not from the original tree.
 const output=[],stack=[root];
 while(stack.length){
  const t=nodes[stack.pop()];
  if(Object.hasOwn(t,'symbol'))output.push(t.symbol);
  else{stack.push(t.to);stack.push(t.from);}
 }
 if(output.join('')!==exactSource)fail('contextual candidate cold replay differs from source');
 let sharedWithOutside=0;
 for(const id of parts.window)if(parts.prefix.has(id)||parts.suffix.has(id))sharedWithOutside++;
 return {uniqueWholePairs:pairs.size,sharedWithOutside,
  reusedWholePairOccurrences:Math.max(0,output.length-1-pairs.size)};
}
export function inspectContextualWindow(source,{width=8,offset=null,topN=5}={}){
 // Cap total text to control 429 × whole-source reconstruction cost.
 if(typeof source!=='string'||source.length>256)fail('context source exceeds 128 Unicode scalars');
 const chars=scalarsOf(source);
 if(chars.length>128)fail('context source exceeds 128 Unicode scalars');
 const local=inspectLocalWindow(source,{width,offset,topN});
 const start=local.offset,end=start+width;
 const leftChars=chars.slice(0,start),rightChars=chars.slice(end);
 const prefix=leftChars.length?baselineTree(leftChars,'balanced'):null;
 const suffix=rightChars.length?baselineTree(rightChars,'balanced'):null;
 const candidates=canonicalTrees(chars.slice(start,end));
 const ranked=candidates.map((tree,ordinal)=>{
  const localPairs=tally(tree).uniquePairs;
  const whole=countContextPairs(prefix,tree,suffix,source);
  return {ordinal,localPairs,...whole,expression:formatTree(tree)};
 }).sort((a,b)=>a.uniqueWholePairs-b.uniqueWholePairs||
  a.localPairs-b.localPairs||a.ordinal-b.ordinal);
 const globalBest=ranked[0];
 const minLocal=local.minimumUniquePairs;
 const localWinners=ranked.filter(x=>x.localPairs===minLocal);
 const bestContextAmongLocal=localWinners[0]; // context-sorted
 const balanced=countContextPairs(prefix,baselineTree(chars.slice(start,end),'balanced'),suffix,source);
 const left=countContextPairs(prefix,baselineTree(chars.slice(start,end),'left'),suffix,source);
 return {
  schema:'mts-nl/contextual-window-oracle/v1',status:'EXHAUSTIVE_FIXED_CONTEXT',
  width,offset:start,sourceScalars:chars.length,windowText:local.windowText,
  treeCount:ranked.length,minimumLocalPairs:minLocal,
  minimumWholePairs:globalBest.uniqueWholePairs,
  bestContextCostAmongLocalOptima:bestContextAmongLocal.uniqueWholePairs,
  avoidableByConsideringContext:bestContextAmongLocal.uniqueWholePairs-globalBest.uniqueWholePairs,
  balanced:{...balanced,deltaWholePairs:balanced.uniqueWholePairs-globalBest.uniqueWholePairs},
  left:{...left,deltaWholePairs:left.uniqueWholePairs-globalBest.uniqueWholePairs},
  globalOptimumTies:ranked.filter(x=>x.uniqueWholePairs===globalBest.uniqueWholePairs).length,
  bestCandidates:ranked.slice(0,topN),
  limits:{
   fullSourceColdReplay:true,
   outsideGrouping:'balanced outside window, fixed left-associative attachment (prefix⟼window)⟼suffix',
   maxSourceScalars:128,
   corpusGlobalOptimality:false,
   physicalSQLiteCost:false,
   metric:'unique internal pair Links in newly rebuilt whole-input DAG'
  }
 };
}


// W22-C: pure tree-construction adapter shared by browser and numeric SQLite
// experiment; never label these JS arrays as physical Link objects.
export function contextualCandidateTrees(source,{width=4,offset=0}={}){
 if(typeof source!=='string'||source.length>256)
  fail('context source exceeds 128 Unicode scalars');
 const chars=scalarsOf(source);
 if(chars.length>128)fail('context source exceeds 128 Unicode scalars');
 if(!Number.isInteger(width)||width<2||width>8)fail('width must be 2..8');
 if(!Number.isInteger(offset)||offset<0||offset+width>chars.length)
  fail('window offset outside input');
 const prefix=offset?baselineTree(chars.slice(0,offset),'balanced'):null;
 const suffix=offset+width<chars.length?
  baselineTree(chars.slice(offset+width),'balanced'):null;
 return canonicalTrees(chars.slice(offset,offset+width)).map((window,ordinal)=>{
  let tree=window;
  if(prefix!==null)tree=[prefix,tree];
  if(suffix!==null)tree=[tree,suffix];
  return {ordinal,window,whole:tree,windowPairs:tally(window).uniquePairs};
 });
}
