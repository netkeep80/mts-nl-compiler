// E7: append-only, exact Unicode source Link-root construction.
// Binary-carry blocks keep O(log n) new internal pairs per external scalar,
// without rebuilding all prior text. Structural oracle ONLY; not native Γ.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validScalar=s=>typeof s==='string'&&[...s].length===1&&Buffer.from(s,'utf8').toString('utf8')===s;
const ordered=(a,b)=>a<b?-1:a>b?1:0;
const atomId=s=>'a:'+digest(s);
const pairId=(a,b)=>'p:'+digest([a,b]);
const invalid=s=>{throw new Error('E7 incremental source: '+s);};

export class IncrementalSourceRoot {
 constructor({maxCodePoints=1000000,maxRows=4000000}={}) {
  if(!Number.isSafeInteger(maxCodePoints)||maxCodePoints<0||
     !Number.isSafeInteger(maxRows)||maxRows<1)invalid('invalid budgets');
  this.maxCodePoints=maxCodePoints;
  this.maxRows=maxRows;
  this.rows=new Map();
  this.events=new Map();
  this.blocks=[];
  this.length=0;
  this.bytes=0;
  this.sourceHash=createHash('sha256');
  this.root=atomId('');
  this.rows.set(this.root,{link_id:this.root,from_id:null,to_id:null,string:'',weight:null});
  this.work={externalAppends:0,allocatedLinks:1,maxNewLinksPerAppend:0};
 }
 get sourceSha256(){return this.sourceHash.copy().digest('hex');}

 // All graph effects are prepared in stage and published atomically after
 // resource checks. Hash IDs do not depend on insertion order/SQL row order.
 append(symbol,{eventId}={}) {
  if(!validScalar(symbol)||typeof eventId!=='string'||!eventId)
   invalid('one valid UTF-8 scalar and external eventId required');
  if(this.events.has(eventId)){
   if(this.events.get(eventId)!==symbol)invalid('contradictory eventId replay');
   return {status:'REPLAY_NOOP',root:this.root,sourceSha256:this.sourceSha256};
  }
  if(this.length>=this.maxCodePoints)invalid('RESOURCE_LIMIT codepoints');
  const stage=new Map(),blocks=this.blocks.slice();
  const add=(row)=>{
   const previous=stage.get(row.link_id)??this.rows.get(row.link_id);
   if(previous){assert.deepEqual(previous,row,'Link hash collision');return row.link_id;}
   stage.set(row.link_id,row);
   return row.link_id;
  };
  const atom=s=>add({link_id:atomId(s),from_id:null,to_id:null,string:s,weight:null});
  const pair=(a,b)=>add({link_id:pairId(a,b),from_id:a,to_id:b,string:null,weight:null});
  let incoming={size:1,root:atom(symbol)};
  while(blocks.length&&blocks.at(-1).size===incoming.size){
   const prev=blocks.pop();
   incoming={size:prev.size+incoming.size,root:pair(prev.root,incoming.root)};
  }
  blocks.push(incoming);
  let root=blocks[0].root;
  for(let i=1;i<blocks.length;i++)root=pair(root,blocks[i].root);
  if(this.rows.size+stage.size>this.maxRows)invalid('RESOURCE_LIMIT Link rows');
  // One external scalar is committed only after every graph precondition passes.
  for(const [id,row] of stage)this.rows.set(id,row);
  this.blocks=blocks;
  this.root=root;
  this.length++;
  this.bytes+=Buffer.byteLength(symbol,'utf8');
  this.sourceHash.update(Buffer.from(symbol,'utf8'));
  this.events.set(eventId,symbol);
  this.work.externalAppends++;
  this.work.allocatedLinks+=stage.size;
  this.work.maxNewLinksPerAppend=Math.max(this.work.maxNewLinksPerAppend,stage.size);
  return {status:'APPLIED',root,sourceSha256:this.sourceSha256,
   codePoints:this.length,newLinks:stage.size};
 }

 decode(root=this.root,{maxCodePoints=this.maxCodePoints}={}) {
  if(typeof root!=='string'||!Number.isSafeInteger(maxCodePoints)||maxCodePoints<0)
   invalid('invalid decode budget/root');
  const active=new Set();
  let count=0;
  const walk=id=>{
   const row=this.rows.get(id);
   if(!row)invalid('missing Link '+id);
   if(active.has(id))invalid('cyclic Link '+id);
   if(row.from_id===null){
    count+=[...row.string].length;
    if(count>maxCodePoints)invalid('RESOURCE_LIMIT decoded codepoints');
    return row.string;
   }
   active.add(id);
   const result=walk(row.from_id)+walk(row.to_id);
   active.delete(id);
   return result;
  };
  return walk(root);
 }

 selectedRows(root=this.root) {
  const seen=new Set(),active=new Set(),rows=[];
  const visit=id=>{
   if(active.has(id))invalid('cyclic Link '+id);
   if(seen.has(id))return;
   const row=this.rows.get(id);
   if(!row)invalid('missing Link '+id);
   active.add(id);
   if(row.from_id!==null){visit(row.from_id);visit(row.to_id);}
   active.delete(id);
   seen.add(id);rows.push({...row});
  };
  visit(root);
  return rows.sort((a,b)=>ordered(a.link_id,b.link_id));
 }
 snapshot(){
  return {status:'E7_INCREMENTAL_FULL_SOURCE_ROOT',root:this.root,
   sourceSha256:this.sourceSha256,sourceCodePoints:this.length,
   sourceBytes:this.bytes,totalRetainedRows:this.rows.size,
   frontierBlocks:this.blocks.length,work:{...this.work}};
 }
}
