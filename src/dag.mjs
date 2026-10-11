import assert from "node:assert/strict";
import { createHash } from "node:crypto";
// This is only a structural DAG/compression micro-oracle; NOT an NL parser.
const hash=x=>createHash("sha256").update(x,"utf8").digest("hex");
export const leaf=symbol=>({symbol});
export const pair=(left,right)=>({left,right});
export const codePoints=s=>[...s];
export function makeTree(symbols,shape="balanced") {
 if(symbols.length<=1) return leaf(symbols[0]??"");
 const k=shape==="left"?symbols.length-1:shape==="right"?1:Math.floor(symbols.length/2);
 return pair(makeTree(symbols.slice(0,k),shape),makeTree(symbols.slice(k),shape));
}
export function encodeShared(tree) {
 const atoms=new Map(),links=new Map();
 function visit(t) {
  if(Object.hasOwn(t,"symbol")) {
   const id="a:"+hash(JSON.stringify(t.symbol));
   atoms.set(id,t.symbol);return id;
  }
  const from_id=visit(t.left),to_id=visit(t.right);
  const id="p:"+hash(JSON.stringify([from_id,to_id]));
  if(links.has(id)) assert.deepEqual(links.get(id),{from_id,to_id});
  else links.set(id,{from_id,to_id});
  return id;
 }
 return {root:visit(tree),atoms,links};
}
export function decodeShared(g) {
 const active=new Set();
 function walk(id) {
  if(g.atoms.has(id))return g.atoms.get(id);
  const r=g.links.get(id);
  if(!r)throw new Error("Unresolved pair "+id);
  if(active.has(id))throw new Error("Cycle");
  active.add(id);
  const s=walk(r.from_id)+walk(r.to_id);
  active.delete(id);return s;
 }
 return walk(g.root);
}
export function enumerateTrees(symbols,limit=9) {
 if(symbols.length>limit)throw new RangeError("exhaustive bound");
 if(!symbols.length)return [leaf("")];
 const memo=new Map();
 function all(a,b) {
  const key=a+":"+b;
  if(memo.has(key))return memo.get(key);
  if(b-a===1)return [leaf(symbols[a])];
  const out=[];
  for(let i=a+1;i<b;i++)for(const l of all(a,i))for(const r of all(i,b))
   out.push(pair(l,r));
  memo.set(key,out);return out;
 }
 return all(0,symbols.length);
}
export function minimumUniquePairs(s,limit=9) {
 const trees=enumerateTrees(codePoints(s),limit);
 const sizes=trees.map(t=>{const g=encodeShared(t);assert.equal(decodeShared(g),s);return g.links.size;});
 return {minimum:Math.min(...sizes),alternatives:trees.length};
}
