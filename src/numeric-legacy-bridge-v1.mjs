// N2 migration bridge only: old opaque textual labels are ephemeral input keys,
// NOT persistent Link identities, hashes or physical SQL values.
import assert from 'node:assert/strict';
import {importNumericGraph,readNumericLinks,formatLinkId} from './numeric-link-store-v1.mjs';
const fail=s=>{throw new Error('NUMERIC_LEGACY_MIGRATION: '+s);};
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const fields=['from_id','link_id','string','to_id','weight'];
const exactRow=r=>r!==null&&typeof r==='object'&&!Array.isArray(r)&&
 JSON.stringify(Object.keys(r).sort())===JSON.stringify(fields);
export function validateLegacyLinkRows(rows){
 if(!Array.isArray(rows))fail('source must be array');
 const ids=new Set();
 const out=[];
 for(const r of rows){
  if(!exactRow(r)||typeof r.link_id!=='string'||!r.link_id||ids.has(r.link_id))fail('bad/duplicate old ID or fields');
  ids.add(r.link_id);
  const atom=r.from_id===null&&r.to_id===null&&typeof r.string==='string';
  const pair=typeof r.from_id==='string'&&r.from_id&&typeof r.to_id==='string'&&r.to_id&&
   (r.string===null||typeof r.string==='string');
  if(!atom&&!pair||!(r.weight===null||(typeof r.weight==='number'&&Number.isFinite(r.weight)&&r.weight>=0&&r.weight<=1)))
   fail('bad legacy row poles/label/weight');
  out.push({...r});
 }
 for(const r of out)if(r.from_id!==null&&(!ids.has(r.from_id)||!ids.has(r.to_id)))
  fail('dangling legacy endpoint');
 return out.sort((a,b)=>cmp(a.link_id,b.link_id));
}
export function migrateLegacyLinks(db,rows){
 const source=validateLegacyLinkRows(rows);
 const aliases=source.map(r=>r.from_id===null?
  {key:r.link_id,string:r.string,weight:r.weight}:
  {key:r.link_id,from:r.from_id,to:r.to_id,string:r.string,weight:r.weight});
 const idMap=importNumericGraph(db,aliases);
 const identityBack=new Map([...idMap].map(([label,id])=>[id,label]));
 // Evaluate only newly allocated rows, never mistake pre-existing numeric IDs
 // for identities belonging to this import batch.
 const numeric=readNumericLinks(db).filter(r=>identityBack.has(r.link_id));
 const restored=numeric.map(r=>{
  const from=r.from_id===null?null:identityBack.get(r.from_id);
  const to=r.to_id===null?null:identityBack.get(r.to_id);
  if((r.from_id!==null&&from===undefined)||(r.to_id!==null&&to===undefined))
   fail('new graph unexpectedly refers outside staged ID mapping');
  return {link_id:identityBack.get(r.link_id),from_id:from,to_id:to,
   string:r.string,weight:r.weight};
 }).sort((a,b)=>cmp(a.link_id,b.link_id));
 assert.deepEqual(restored,source,'identity alias bijection/edges changed during migration');
 return {idMap,numericLinks:numeric.length,restored};
}
export function decodeNumericSource(db,root,{maxCodePoints=1000000}={}){
 if(typeof root!=='bigint'||!Number.isSafeInteger(maxCodePoints)||maxCodePoints<0)
  fail('invalid root or source budget');
 const rows=new Map(readNumericLinks(db).map(row=>[row.link_id,row]));
 const active=new Set(),memo=new Map();
 let decoded=0;
 const walk=id=>{
  if(memo.has(id))return memo.get(id);
  const r=rows.get(id);
  if(!r)fail('missing physical ID '+formatLinkId(id));
  if(active.has(id))fail('cyclic structural source');
  active.add(id);
  let result;
  if(r.from_id===null)result=r.string;
  else result=walk(r.from_id)+walk(r.to_id);
  active.delete(id);
  if([...result].length>maxCodePoints)fail('RESOURCE_LIMIT decoded source');
  memo.set(id,result);
  return result;
 };
 const result=walk(root);
 decoded=[...result].length;
 if(decoded>maxCodePoints)fail('RESOURCE_LIMIT decoded source');
 return result;
}
