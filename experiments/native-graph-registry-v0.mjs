// #26 — one-ANet structural registry for FULL arbitrary source Link IDs.
// Uses only actual native Memory + StringAnum + ExactSequence functions passed
// as dependencies. Row ID anchor != native semantic Link identity: this is a
// transport registry, NOT accepted FORMAL source ANet semantics.
//
// The registry is self-contained under an explicitly supplied namespace.
// Root contains a native ExactSequence of ID anchors. Each anchor has role
// edges to 0/2 pole IDs, an optional label, and an optional weight.
// There is no new subject table and no host "compress" or "execute" opcode.
const fail=s=>{throw new Error("Native graph registry: "+s);};
const unicode=s=>{
 if(typeof s!=="string")fail("expected string");
 for(let i=0;i<s.length;i++){
  const n=s.charCodeAt(i);
  if(n>=0xd800&&n<=0xdbff){
   const next=s.charCodeAt(++i);
   if(!(next>=0xdc00&&next<=0xdfff))fail("unpaired surrogate");
  }else if(n>=0xdc00&&n<=0xdfff)fail("unpaired surrogate");
 }
 return s;
};
const encoder=new TextEncoder(),decoder=new TextDecoder("utf-8",{fatal:true});
const byId=(a,b)=>a.link_id<b.link_id?-1:a.link_id>b.link_id?1:0;
const fields=["link_id","from_id","to_id","string","weight"];

export function validateGraphRows(rows) {
 if(!Array.isArray(rows))fail("rows must be an array from canonical $links");
 const map=new Map();
 for(const input of rows){
  if(input===null||typeof input!=="object"||Array.isArray(input))fail("invalid row");
  const id=unicode(input.link_id);
  if(!id||map.has(id))fail("empty or duplicate Link ID");
  const f=input.from_id??null,t=input.to_id??null,label=input.string??null;
  if((f===null)!==(t===null))fail("one-sided pair "+id);
  if(f===null&&label===null)fail("atom requires a string "+id);
  if(f!==null){
   if(!unicode(f)||!unicode(t))fail("empty endpoint "+id);
  }
  if(label!==null)unicode(label);
  const w=input.weight??null;
  if(w!==null&&(!Number.isFinite(w)||w<0||w>1))fail("invalid weight "+id);
  map.set(id,{link_id:id,from_id:f,to_id:t,string:label,weight:w});
 }
 for(const row of map.values())
  if(row.from_id!==null&&(!map.has(row.from_id)||!map.has(row.to_id)))
   fail("dangling endpoint "+row.link_id);
 return [...map.values()].sort(byId);
}
function nativeFns(native) {
 for(const fn of ["materializeV012StringAnum","readV012StringAnum",
  "materializeExactSequence","readExactSequence"])
  if(typeof native?.[fn]!=="function")fail("missing native binding "+fn);
 return native;
}
export function createNativeRegistry(memory,basis,native,inputRows){
 const api=nativeFns(native);
 const rows=validateGraphRows(inputRows);
 const namespace=memory.ensureStartSelfClosed(memory.ensure(basis.O,basis.U));
 const role=Object.freeze({
  from:memory.ensure(namespace,basis.O),
  to:memory.ensure(namespace,basis.C),
  string:memory.ensure(namespace,basis.L),
  weight:memory.ensure(namespace,basis.U)
 });
 const encode=x=>api.materializeV012StringAnum(memory,basis,
  encoder.encode(unicode(x))).anumLink;
 const ids=new Map();
 // Allocate every row identity first. Cyclic from/to references are allowed.
 for(const row of rows) {
  const handle=memory.ensure(namespace,encode(row.link_id));
  for(const h of ids.values())if(h===handle)fail("noninjective ID carrier");
  ids.set(row.link_id,handle);
 }
 function add(anchor,marker,value) {
  const property=memory.ensure(marker,value);
  memory.ensure(anchor,property);
 }
 for(const row of rows){
  const anchor=ids.get(row.link_id);
  if(row.from_id!==null){
   add(anchor,role.from,ids.get(row.from_id));
   add(anchor,role.to,ids.get(row.to_id));
  }
  if(row.string!==null)add(anchor,role.string,encode(row.string));
  if(row.weight!==null)add(anchor,role.weight,encode(String(row.weight)));
 }
 const registryRoot=api.materializeExactSequence(memory,
  rows.map(row=>ids.get(row.link_id)));
 return {namespace,role,registryRoot,ids,rows};
}

export function readNativeRegistry(memory,basis,native,{
 namespace,role,registryRoot,maxRows=100000,maxUtf8Bytes=1000000
}){
 const api=nativeFns(native);
 if(!Number.isSafeInteger(maxRows)||maxRows<0)fail("bad row budget");
 if(!Number.isSafeInteger(maxUtf8Bytes)||maxUtf8Bytes<0)fail("bad byte budget");
 function text(handle){
  const bytes=api.readV012StringAnum(memory,basis,handle).bytes;
  if(bytes.length>maxUtf8Bytes)fail("RESOURCE_LIMIT text bytes");
  let result;
  try{result=decoder.decode(bytes);}
  catch{fail("invalid native UTF-8");}
  unicode(result);
  return result;
 }
 const anchors=[...api.readExactSequence(memory,registryRoot).values];
 if(anchors.length>maxRows)fail("RESOURCE_LIMIT row count");
 const byAnchor=new Map(),raw=new Map();
 for(const anchor of anchors){
  if(byAnchor.has(anchor))fail("duplicate selected anchor");
  const poles=memory.poles(anchor);
  if(poles.start!==namespace)fail("foreign anchor namespace");
  const id=text(poles.end);
  if(!id||raw.has(id))fail("duplicate/empty decoded id");
  byAnchor.set(anchor,id);raw.set(id,{link_id:id});
 }
 for(const anchor of anchors){
  const name=byAnchor.get(anchor),n=raw.get(name),attributes=new Map();
  for(const edge of memory.outgoing(anchor)){
   const property=memory.poles(edge).end;
   const q=memory.poles(property);
   let field;
   for(const [key,marker] of Object.entries(role))
    if(q.start===marker)field=key;
   if(!field)fail("unknown/untyped attribute on "+name);
   if(attributes.has(field))fail("duplicate role edge: "+field);
   attributes.set(field,q.end);
  }
  const hasFrom=attributes.has("from"),hasTo=attributes.has("to");
  if(hasFrom!==hasTo)fail("half-defined row "+name);
  const getId=key=>{
   const v=byAnchor.get(attributes.get(key));
   if(v===undefined)fail("unselected pole identity "+name);
   return v;
  };
  n.from_id=hasFrom?getId("from"):null;
  n.to_id=hasTo?getId("to"):null;
  n.string=attributes.has("string")?text(attributes.get("string")):null;
  n.weight=null;
  if(attributes.has("weight")){
   const value=text(attributes.get("weight")),number=Number(value);
   if(!value||!Number.isFinite(number)||number<0||number>1||
      String(number)!==value)fail("invalid canonical stored weight");
   n.weight=number;
  }
  if(n.from_id===null&&n.string===null)fail("unlabeled atom "+name);
 }
 return validateGraphRows([...raw.values()]);
}

export function compareRowsExactly(left,right) {
 const a=validateGraphRows(left),b=validateGraphRows(right);
 return JSON.stringify(a.map(row=>fields.map(f=>row[f])))===
  JSON.stringify(b.map(row=>fields.map(f=>row[f])));
}
