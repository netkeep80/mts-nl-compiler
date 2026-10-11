// #22: only JSON objects/strings/null (null is ONLY a sequence terminator).
// Canonical $links owns identities; $sequences is an independently checked view.
// This is research transport, not a claimed native FORMAL v0.15 serialization.
import assert from "node:assert/strict";
export const FORMAT="mts-nl/anet-object-tree/v1";
const own=(o,k)=>Object.hasOwn(o,k);
const obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const err=s=>{throw new Error("Object-tree JSON: "+s);};
function uni(s) {
 for(let i=0;i<s.length;i++){
  const c=s.charCodeAt(i);
  if(c>=0xD800&&c<=0xDBFF){const d=s.charCodeAt(++i);
   if(!(d>=0xDC00&&d<=0xDFFF))err("lone high surrogate");}
  else if(c>=0xDC00&&c<=0xDFFF)err("lone low surrogate");
 }
}
function string(x,at){if(typeof x!=="string")err(at+" must be string");uni(x);return x;}
function keys(x,want,at) {
 if(!obj(x))err(at+" must be object");
 if(JSON.stringify(Object.keys(x).sort())!==JSON.stringify([...want].sort()))
  err(at+" invalid members");
}
function graphRows(graph) {
 const rows=graph?.nodes instanceof Map?[...graph.nodes.values()]:graph;
 if(!Array.isArray(rows))err("expected LinkGraph or row array");
 const links=new Map();
 for(const n of rows){
  if(!obj(n))err("invalid row");
  const id=string(n.link_id,"link ID");
  if(!id.length||links.has(id))err("empty/duplicate link ID");
  const from=n.from_id??null,to=n.to_id??null,label=n.string??null,weight=n.weight??null;
  if((from===null)!==(to===null))err("one-sided pair: "+id);
  if(from===null&&label===null)err("unlabeled atom: "+id);
  if(from!==null){
   string(from,"from");string(to,"to");
   if(!from.length||!to.length)err("empty endpoint");
  }
  if(label!==null)string(label,"label");
  if(weight!==null&&(
    typeof weight!=="number"||!Number.isFinite(weight)||weight<0||weight>1))
    err("invalid weight");
  links.set(id,{link_id:id,from_id:from,to_id:to,string:label,weight});
 }
 for(const n of links.values())
  if(n.from_id!==null&&(!links.has(n.from_id)||!links.has(n.to_id)))
   err("dangling endpoint at "+n.link_id);
 return links;
}
function selectorsMap(sequences) {
 if(!obj(sequences))err("sequences must be object");
 const m=new Map();
 for(const [name,s] of Object.entries(sequences)) {
  string(name,"sequence name");
  if(!name.length||m.has(name))err("duplicate/empty sequence name");
  keys(s,["root","terminator"],"selector");
  m.set(name,{root:string(s.root,"root"),terminator:string(s.terminator,"terminator")});
 }
 return m;
}
function sequenceView(links,root,terminator,seen,maxNodes) {
 const visiting=new Set();let count=0;
 function visit(id) {
  if(id===terminator)return null;
  if(++count>maxNodes)err("sequence bound exceeded");
  if(visiting.has(id))err("cyclic selected sequence");
  if(seen.has(id))return {"$ref":id};
  const n=links.get(id);
  if(!n||n.from_id===null)err("not a sequence pair: "+id);
  visiting.add(id);seen.add(id);
  const next=visit(n.to_id);
  visiting.delete(id);
  return {"$id":id,"$item":{"$ref":n.from_id},"$next":next};
 }
 return visit(root);
}
export function exportObjectTree(graph,{sequences={},maxNodes=10000}={}) {
 if(!Number.isSafeInteger(maxNodes)||maxNodes<1)err("invalid traversal bound");
 const links=graphRows(graph),selectors=selectorsMap(sequences);
 const definitions=Object.create(null),views=Object.create(null),seen=new Set();
 for(const id of [...links.keys()].sort()) {
  const n=links.get(id),d=Object.create(null);
  if(n.from_id===null)d.string=n.string;
  else {d.from=n.from_id;d.to=n.to_id;if(n.string!==null)d.string=n.string;}
  if(n.weight!==null)d.weight=String(n.weight);
  definitions[id]=d;
 }
 for(const name of [...selectors.keys()].sort()) {
  const {root,terminator}=selectors.get(name);
  if(!links.has(root)||!links.has(terminator))err("unknown selected root or terminator");
  if(links.get(terminator).from_id!==null)err("terminator must be atom");
  views[name]={"$root":root,"$terminator":terminator,
   "$tree":sequenceView(links,root,terminator,seen,maxNodes)};
 }
 return {"$format":FORMAT,"$links":definitions,"$sequences":views};
}
export function serializeObjectTree(graph,options) {
 return JSON.stringify(exportObjectTree(graph,options),null,2)+"\n";
}

// Lexically reject duplicate object members before JSON.parse silently loses them.
// Reject arrays, numbers and booleans in the same single-pass grammar scanner.
export function parseStrictJson(input) {
 string(input,"JSON source");
 let i=0;
 const ws=()=>{while(i<input.length&&/[\x20\t\r\n]/.test(input[i]))i++;};
 function scanString(){
  ws();if(input[i]!=='"')err("expected quoted member/value at "+i);
  const start=i++;let closed=false;
  while(i<input.length){
   const c=input[i++];
   if(c==="\\"){if(i>=input.length)break;i++;continue;}
   if(c==='"'){closed=true;break;}
  }
  if(!closed)err("unterminated string");
  let out;
  try{out=JSON.parse(input.slice(start,i));}
  catch(e){err("invalid quoted token: "+e.message);}
  uni(out);return out;
 }
 function value() {
  ws();
  if(input[i]==='"'){scanString();return;}
  if(input[i]==="{"){
   i++;ws();const seen=new Set();
   if(input[i]==="}"){i++;return;}
   while(i<input.length) {
    const name=scanString();
    if(seen.has(name))err("duplicate member: "+name);
    seen.add(name);ws();
    if(input[i++]!==":")err("expected colon");
    value();ws();
    const c=input[i++];
    if(c==="}")return;
    if(c!==",")err("expected comma or }");
   }
   err("unterminated object");
  }
  if(input.startsWith("null",i)){i+=4;return;}
  err("only objects, strings and null are permitted at "+i);
 }
 value();ws();if(i!==input.length)err("trailing content");
 try{return JSON.parse(input);}
 catch(e){err("invalid JSON: "+e.message);}
}
function checkTypes(v,key="",path="$"){
 if(v===null) {
  if(key!=="$next"&&key!=="$tree")err("null only at sequence end: "+path);
 }else if(typeof v==="string")uni(v);
 else if(obj(v)){
  for(const [k,x] of Object.entries(v)){uni(k);checkTypes(x,k,path+"."+k);}
 }else err("invalid JSON type: "+path);
}
export function importObjectTree(input,{maxNodes=10000}={}) {
 const doc=typeof input==="string"?parseStrictJson(input):input;
 checkTypes(doc);
 keys(doc,["$format","$links","$sequences"],"document");
 if(doc.$format!==FORMAT)err("unknown protocol format");
 if(!obj(doc.$links))err("links must be object");
 const rows=[];
 for(const [id,d] of Object.entries(doc.$links)) {
  string(id,"Link ID");if(!id.length)err("empty Link ID");
  if(!obj(d))err("bad Link definition");
  const f=own(d,"from"),t=own(d,"to");
  if(f!==t)err("half-pair");
  if(Object.keys(d).some(k=>!["from","to","string","weight"].includes(k)))
   err("unknown field in Link: "+id);
  if(!f&&!own(d,"string"))err("atom requires string");
  let weight=null;
  if(own(d,"weight")) {
   const w=string(d.weight,"weight");
   weight=Number(w);
   if(!w||!Number.isFinite(weight)||weight<0||weight>1||String(weight)!==w)
    err("invalid/noncanonical weight");
  }
  rows.push({link_id:id,from_id:f?string(d.from,"from"):null,
   to_id:t?string(d.to,"to"):null,
   string:own(d,"string")?string(d.string,"label"):null,weight});
 }
 const links=graphRows(rows);
 if(!obj(doc.$sequences))err("sequences must be object");
 const selectors=Object.create(null);
 for(const [name,d] of Object.entries(doc.$sequences)) {
  string(name,"sequence name");if(!name.length)err("empty name");
  keys(d,["$root","$terminator","$tree"],"sequence");
  selectors[name]={root:string(d.$root,"root"),
   terminator:string(d.$terminator,"terminator")};
 }
 // Rebuild the entire derived tree from Link identities and compare it exactly.
 const canonical=exportObjectTree([...links.values()],{sequences:selectors,maxNodes});
 assert.deepStrictEqual(JSON.parse(JSON.stringify(doc.$sequences)),
  JSON.parse(JSON.stringify(canonical.$sequences)),
  "JSON tree contradicts underlying Link references");
 return {rows:[...links.values()].sort((a,b)=>a.link_id<b.link_id?-1:a.link_id>b.link_id?1:0),
  sequences:selectors,canonical};
}
