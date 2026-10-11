import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {LinkGraph} from "../experiments/inference-v0.mjs";
import {loadRows,counterMismatches} from "../src/store.mjs";
import {exportObjectTree,serializeObjectTree,importObjectTree,parseStrictJson,FORMAT}
  from "../experiments/object-tree-json-v0.mjs";

function fixture(){
 const g=new LinkGraph();
 g.atom("m","м");g.atom("a","а");g.atom("nil","NIL");
 // A single shared "ма" duplet has two references in "мама".
 g.pair("ma","m","a");
 g.pair("mama","ma","ma",.75);
 const chars=["m","a","m","a"];
 let tail="nil";
 for(let i=chars.length-1;i>=0;i--){
  const id="s:"+String(i+1);
  g.pair(id,chars[i],tail);
  tail=id;
 }
 return {g,sequences:{text:{root:"s:1",terminator:"nil"}}};
}
function prohibitArraysNumbersBooleans(v) {
 if(v===null||typeof v==="string")return;
 assert.equal(typeof v,"object");
 assert.equal(Array.isArray(v),false);
 for(const x of Object.values(v))prohibitArraysNumbersBooleans(x);
}
function selectedSymbols(doc,name){
 const nodes=doc.$links;
 const out=[],seen=new Set(),selector=doc.$sequences[name];
 let id=selector.$root;
 while(id!==selector.$terminator){
  if(seen.has(id))throw new Error("cyclic fixture");
  seen.add(id);
  const n=nodes[id];
  assert.ok(n);
  const a=nodes[n.from];
  assert.ok(a);
  out.push(a.string);id=n.to;
 }
 return out.join("");
}

test("JSON projection has only strings/objects/null and null ends a sequence",()=>{
 const {g,sequences}=fixture();
 const doc=exportObjectTree(g,{sequences});
 prohibitArraysNumbersBooleans(doc);
 assert.equal(doc.$format,FORMAT);
 assert.equal(selectedSymbols(doc,"text"),"мама");
 assert.equal(doc.$sequences.text.$tree.$id,"s:1");
 let node=doc.$sequences.text.$tree;
 for(let i=0;i<4;i++){
  assert.equal(node.$item.$ref,i%2===0?"m":"a");
  node=node.$next;
 }
 assert.equal(node,null);
 assert.equal(doc.$links.mama.weight,"0.75");
 assert.equal(Object.hasOwn(doc.$links.ma,"weight"),false);
 assert.deepEqual(Object.keys(doc.$links.ma).sort(),["from","to"]);
});

test("strict byte-for-byte canonical JSON export -> import -> export",()=>{
 const {g,sequences}=fixture();
 const s=serializeObjectTree(g,{sequences});
 const restored=importObjectTree(s);
 const s2=serializeObjectTree(restored.rows,{sequences:restored.sequences});
 assert.equal(s2,s);
 const dag=restored.rows.find(n=>n.link_id==="mama");
 assert.equal(dag.from_id,"ma");
 assert.equal(dag.to_id,"ma");
 assert.equal(dag.weight,.75);
});

test("example file can be independently imported and fully restored",()=>{
 const text=readFileSync(new URL("../experiments/fixtures/mama-object-tree.json",import.meta.url),"utf8");
 const restore=importObjectTree(text);
 const doc=restore.canonical;
 assert.equal(selectedSymbols(doc,"text"),"мама");
 assert.equal(doc.$links.mama.from,"ma");
 assert.equal(doc.$links.mama.to,"ma");
 assert.equal(doc.$links.mama.weight,"0.75");
 assert.equal(serializeObjectTree(restore.rows,{sequences:restore.sequences}),text);
});

test("empty sequence uses null as termination, not as Link identity",()=>{
 const g=new LinkGraph();
 g.atom("nil","NIL");
 const s=serializeObjectTree(g,{sequences:{empty:{root:"nil",terminator:"nil"}}});
 const doc=JSON.parse(s);
 assert.equal(doc.$sequences.empty.$tree,null);
 assert.ok(Object.hasOwn(doc.$links,"nil"));
 const result=importObjectTree(s);
 assert.equal(result.rows.length,1);
});

test("parallel Links, identical atom labels, special IDs and cycles roundtrip",()=>{
 const g=new LinkGraph();
 g.atom("a","а");g.atom("a:alias","а");g.atom("nil","NIL");
 g.pair("same:1","a","a:alias");
 g.pair("same:2","a","a:alias");
 g.pair("self","self","a"); // Not a sequence root; graph cycles survive via IDs.
 g.atom("__proto__","text");
 const raw=serializeObjectTree(g);
 const r=importObjectTree(raw);
 assert.equal(r.rows.length,7);
 assert.equal(r.rows.find(x=>x.link_id==="self").from_id,"self");
 assert.ok(Object.hasOwn(JSON.parse(raw).$links,"__proto__"));
 assert.equal(serializeObjectTree(r.rows,{sequences:r.sequences}),raw);
});

test("shared sequence tails are references, no expanded duplicate ownership",()=>{
 const g=new LinkGraph();
 for(const [id,value] of [["nil","NIL"],["a","а"],["b","б"],["c","в"]])g.atom(id,value);
 g.pair("tail","c","nil");
 g.pair("one","a","tail");
 g.pair("two","b","tail");
 const opts={sequences:{
  first:{root:"one",terminator:"nil"},
  second:{root:"two",terminator:"nil"}
 }};
 const doc=exportObjectTree(g,opts);
 assert.equal(doc.$sequences.first.$tree.$next.$id,"tail");
 assert.deepEqual(doc.$sequences.second.$tree.$next,{"$ref":"tail"});
 const source=serializeObjectTree(g,opts);
 assert.equal(serializeObjectTree(importObjectTree(source).rows,{
  sequences:importObjectTree(source).sequences}),source);
});

test("strict parser rejects duplicate members, including escaped aliases",()=>{
 assert.throws(()=>parseStrictJson('{"a":"x","a":"y"}'),/duplicate member/);
 assert.throws(()=>parseStrictJson('{"a":"x","\\u0061":"y"}'),/duplicate member/);
 assert.throws(()=>importObjectTree('{"$format":"x","$format":"y"}'),/duplicate member/);
 assert.throws(()=>importObjectTree(JSON.parse(serializeObjectTree(fixture().g))),/requires original JSON text/);
});

test("null cannot stand for unknown weight/atom/endpoint",()=>{
 const {g,sequences}=fixture();
 const doc=exportObjectTree(g,{sequences});
 doc.$links.mama.weight=null;
 assert.throws(()=>importObjectTree(JSON.stringify(doc)),/null only at sequence end/);
 delete doc.$links.mama.weight;
 doc.$links.m.from=null;
 assert.throws(()=>importObjectTree(JSON.stringify(doc)),/null only at sequence end/);
});

test("tampered projection, unknown roots, and invalid terminators reject",()=>{
 const {g,sequences}=fixture();
 const obj=exportObjectTree(g,{sequences});
 obj.$sequences.text.$tree.$item.$ref="a";
 assert.throws(()=>importObjectTree(JSON.stringify(obj)),/contradicts underlying Link references/);
 assert.throws(()=>exportObjectTree(g,{sequences:{broken:{root:"missing",terminator:"nil"}}}),/unknown selected/);
 assert.throws(()=>exportObjectTree(g,{sequences:{broken:{root:"s:1",terminator:"ma"}}}),/terminator must be atom/);
});

test("cyclic sequence is rejected but cyclic graph remains exportable",()=>{
 const g=new LinkGraph([
  {link_id:"nil",string:"NIL"},
  {link_id:"a",string:"a"},
  {link_id:"loop",from_id:"a",to_id:"loop"}
 ]);
 const raw=serializeObjectTree(g);
 assert.equal(importObjectTree(raw).rows.length,3);
 assert.throws(()=>serializeObjectTree(g,{sequences:{
  bad:{root:"loop",terminator:"nil"}
 }}),/cyclic selected sequence/);
});

test("no JSON numbers/arrays/bools, bad weights, dangling refs and lone surrogates",()=>{
 for(const input of ['{"a":1}','{"a":true}','{"a":false}','{"a":[]}','{"a":[null]}'])
  assert.throws(()=>parseStrictJson(input),/only objects, strings and null/);
 const {g,sequences}=fixture();
 const d=exportObjectTree(g,{sequences});
 d.$links.mama.weight="1.00";
 assert.throws(()=>importObjectTree(JSON.stringify(d)),/invalid\/noncanonical weight/);
 d.$links.mama.weight="0.5";
 d.$links.ma.from="missing";
 assert.throws(()=>importObjectTree(JSON.stringify(d)),/dangling endpoint/);
 assert.throws(()=>parseStrictJson('{"x":"\\ud800"}'),/lone high surrogate/);
});

test("exported Link rows replay in one SQLite table with rebuilt positional caches",()=>{
 const {g,sequences}=fixture();
 const exported=serializeObjectTree(g,{sequences});
 const restored=importObjectTree(exported);
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(readFileSync(new URL("../db/schema.sql",import.meta.url),"utf8"));
  loadRows(db,restored.rows);
  assert.deepEqual(counterMismatches(db),[]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM links").get().n,g.nodes.size);
  assert.equal(db.prepare("SELECT from_uses,to_uses FROM links WHERE link_id='ma'")
    .get().from_uses,1);
  assert.equal(db.prepare("SELECT from_uses,to_uses FROM links WHERE link_id='ma'")
    .get().to_uses,1);
  const rows=db.prepare("SELECT link_id,from_id,to_id,string,weight FROM links")
    .all().map(x=>({...x}));
  assert.equal(serializeObjectTree(rows,{sequences}),exported);
 }finally{db.close();}
});
