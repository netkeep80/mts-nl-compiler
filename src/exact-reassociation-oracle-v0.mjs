// W7: exact reachability-delta oracle over 4/5/6 existing numeric Link leaves.
// Research-only root-local rewrite: no word/space guidance, no semantic equality.
// Existing Link identity is SQLite-assigned; pair interning is explicit policy.
import {readNumericLinks,rebuildNumericCounters,verifyNumericLinks,parseLinkId,
  formatLinkId} from './numeric-link-store-v1.mjs';

const bad=s=>{throw Error('REASSOCIATION_ORACLE: '+s);};
const pairKey=(a,b)=>a+'|'+b;
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function shapes(n){
  const build=(from,to)=>{
    if(to-from===1)return [from];
    const result=[];
    for(let middle=from+1;middle<to;middle++)
      for(const left of build(from,middle))
        for(const right of build(middle,to))
          result.push([left,right]);
    return result;
  };
  return build(0,n);
}
const shapeMemo=new Map();
export function exactFrontierShapes(width){
  if(![4,5,6].includes(width))bad('unsupported window');
  if(!shapeMemo.has(width))shapeMemo.set(width,shapes(width));
  return shapeMemo.get(width);
}
function validateId(id,rows){
  const key=formatLinkId(parseLinkId(id));
  if(!rows.has(key))bad('missing physical Link '+key);
  return key;
}
function snapshot(db){
  if(!db||typeof db.prepare!=='function')bad('SQLite database required');
  const rows=new Map(),pairs=new Map();
  for(const row of readNumericLinks(db)){
    const id=formatLinkId(row.link_id);
    rows.set(id,row);
    if(row.from_id!==null&&row.string===null&&row.weight===null){
      const key=pairKey(formatLinkId(row.from_id),formatLinkId(row.to_id));
      // Explicit oldest-representative reuse, never UNIQUE(from_id,to_id).
      if(!pairs.has(key))pairs.set(key,id);
    }
  }
  return {rows,pairs};
}
function expand(id,rows,cache,active=new Set()){
  if(cache.has(id))return cache.get(id);
  if(active.has(id))bad('cycle');
  const row=rows.get(id);
  if(!row)bad('missing expansion Link '+id);
  active.add(id);
  let result;
  if(row.from_id===null){
    if(typeof row.string!=='string')bad('atom without a string');
    result=row.string;
  }else result=expand(formatLinkId(row.from_id),rows,cache,active)+
    expand(formatLinkId(row.to_id),rows,cache,active);
  active.delete(id);
  if([...result].length>4096)bad('expanded frontier resource limit');
  cache.set(id,result);
  return result;
}
function closure(roots,rows,virtual){
  const seen=new Set(),active=new Set(),stack=roots.map(id=>({id,exit:false}));
  while(stack.length){
    const x=stack.pop();
    if(x.exit){active.delete(x.id);continue;}
    if(active.has(x.id))bad('cyclic Link graph');
    if(seen.has(x.id))continue;
    const row=virtual.get(x.id)??rows.get(x.id);
    if(!row)bad('dangling Link '+x.id);
    seen.add(x.id);
    if(row.from_id!==null){
      active.add(x.id);
      stack.push({id:x.id,exit:true},
        {id:typeof row.to_id==='bigint'?formatLinkId(row.to_id):row.to_id,exit:false},
        {id:typeof row.from_id==='bigint'?formatLinkId(row.from_id):row.from_id,exit:false});
    }
  }
  return seen;
}
function difference(a,b){
  const out=[];
  for(const x of a)if(!b.has(x))out.push(x);
  return out;
}
function assess(tree,leaves,retained,oldReach,{rows,pairs}){
  const interns=new Map(pairs),virtual=new Map(),recipe=[];
  const make=node=>{
    if(typeof node==='number')return leaves[node];
    const left=make(node[0]),right=make(node[1]);
    const key=pairKey(left,right);
    if(interns.has(key))return interns.get(key);
    const id='v'+recipe.length;
    interns.set(key,id);
    virtual.set(id,{from_id:left,to_id:right});
    recipe.push({id,left,right});
    return id;
  };
  const root=make(tree);
  const newReach=closure([...retained,root],rows,virtual);
  const introduced=difference(newReach,oldReach);
  const retired=difference(oldReach,newReach);
  const introducedExisting=introduced.filter(x=>rows.has(x));
  return {
    root,recipe,
    introducedLinkCount:introduced.length,
    reactivatedExistingLinks:introducedExisting.length,
    retiredReachableLinks:retired.length,
    newPhysicalRows:recipe.length,
    reachableDelta:introduced.length-retired.length,
    reachableAfter:newReach.size,
    // Physical rows are append-only here; no claim of reclaimed SQLite rows.
    physicalRowDeltaWithoutGc:recipe.length
  };
}
/**
 * A frozen real SQLite snapshot is used to score every Catalan rebracketing.
 * oldRoot is one replaceable subtree; retainedRoots are externally pinned,
 * unaffected document roots. frontier is the ordered sequence of physical
 * Link IDs expanded exactly by oldRoot; no assumption they are scalar atoms.
 */
export function planExactReassociation(db,{
  oldRoot,frontier,retainedRoots=[]
}={}){
  if(!Array.isArray(frontier)||![4,5,6].includes(frontier.length)||
     !Array.isArray(retainedRoots))bad('frontier width 4/5/6 and retained roots required');
  const store=snapshot(db);
  const old=validateId(oldRoot,store.rows);
  const leaves=frontier.map(x=>validateId(x,store.rows));
  const retained=retainedRoots.map(x=>validateId(x,store.rows));
  const cache=new Map(),original=expand(old,store.rows,cache);
  const sequence=leaves.map(x=>expand(x,store.rows,cache)).join('');
  if(sequence!==original)bad('frontier changes exact source sequence');
  const oldReach=closure([...retained,old],store.rows,new Map());
  const candidates=[];
  for(const tree of exactFrontierShapes(leaves.length)){
    const result=assess(tree,leaves,retained,oldReach,store);
    candidates.push({
      treeIndex:candidates.length,
      ...result
    });
  }
  candidates.sort((a,b)=>a.reachableDelta-b.reachableDelta||
    a.newPhysicalRows-b.newPhysicalRows||a.treeIndex-b.treeIndex);
  const proposed=candidates[0];
  const improve=proposed.reachableDelta<0;
  return {
    schema:'mts-nl/exact-reassociation-plan/v0',
    width:leaves.length,oldRoot:old,
    evaluatedTrees:candidates.length,
    retainedRoots:retained.length,
    originalReachableCount:oldReach.size,
    oldExpandedScalars:[...original].length,
    proposed,improve,
    selected:improve?proposed:null,
    // Baseline is explicitly no rewrite, even if its topology is not among
    // candidates or some equivalent tree introduces a different physical ID.
    unchanged:{root:old,reachableDelta:0,newPhysicalRows:0},
    candidates
  };
}
/**
 * Transactionally MATERIALIZES improving nodes only; the returned new root
 * must be durably published by a separate authority. Root publication + GC
 * are NOT provided by this v0 API and must never be claimed atomic here.
 */
export function materializeImprovingReassociation(db,args){
  if(db.isTransaction)bad('outer transaction unsupported');
  db.exec('BEGIN IMMEDIATE');
  try{
    // Re-evaluate after acquiring the write lock: no stale precomputed plan.
    const plan=planExactReassociation(db,args);
    if(!plan.improve){
      db.exec('ROLLBACK');
      return {status:'NO_IMPROVEMENT',rootLinkId:plan.oldRoot,
        plan,insertedPhysicalRows:0,rootPublication:'EXTERNAL_NOT_ATOMIC'};
    }
    const mapping=new Map();
    const insert=db.prepare(
      'INSERT INTO links(from_id,to_id,string,weight) VALUES(?,?,NULL,NULL)');
    insert.setReadBigInts(true);
    for(const node of plan.selected.recipe){
      const resolve=x=>x.startsWith('v')?mapping.get(x):parseLinkId(x);
      const left=resolve(node.left),right=resolve(node.right);
      if(typeof left!=='bigint'||typeof right!=='bigint')bad('invalid virtual topological order');
      mapping.set(node.id,insert.run(left,right).lastInsertRowid);
    }
    const rootLinkId=plan.selected.root.startsWith('v')?
      formatLinkId(mapping.get(plan.selected.root)):plan.selected.root;
    // Existing rows stay in storage; counters are physical structural poles.
    rebuildNumericCounters(db);
    verifyNumericLinks(db);
    db.exec('COMMIT');
    return {status:'NEW_ROOT_MATERIALIZED',rootLinkId,plan,
      insertedPhysicalRows:mapping.size,
      rootPublication:'EXTERNAL_NOT_ATOMIC'};
  }catch(e){
    if(db.isTransaction)db.exec('ROLLBACK');
    throw e;
  }
}
