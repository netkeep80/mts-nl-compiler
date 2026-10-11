import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {DatabaseSync} from "node:sqlite";
import {loadRows,validateClosure,rebuildCounters,counterMismatches} from "../src/store.mjs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const open=()=>{const db=new DatabaseSync(":memory:");db.exec(read("../db/schema.sql"));return db;};
const put=(db,id,f=null,t=null,s=null,w=null)=>db.prepare("INSERT INTO links(link_id,from_id,to_id,string,weight) VALUES(?,?,?,?,?)").run(id,f,t,s,w);
test("one table; canonical rows rebuild",()=>{
 const db=open();
 try {
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name),["links"]);
  const rows=JSON.parse(read("../data/links.json"));
  loadRows(db,rows);
  assert.equal(db.prepare("SELECT count(*) n FROM links").get().n,rows.length);
  assert.deepEqual(counterMismatches(db),[]);
 }finally{db.close();}
});
test("atoms, labelled pairs, parallel edges, weights, cache position counts",()=>{
 const db=open();
 try {
  put(db,"m",null,null,"м");put(db,"a",null,null,"а");
  put(db,"ma","m","a","ма",1);put(db,"ma2","m","a",null,0);
  put(db,"mama","ma","ma","мама",.8);
  validateClosure(db);rebuildCounters(db);
  assert.deepEqual({...db.prepare("SELECT from_uses,to_uses FROM links WHERE link_id='ma'").get()},{from_uses:1,to_uses:1});
  assert.deepEqual({...db.prepare("SELECT from_uses,to_uses FROM links WHERE link_id='m'").get()},{from_uses:2,to_uses:0});
  assert.equal(db.prepare("SELECT weight FROM links WHERE link_id='m'").get().weight,null);
  assert.deepEqual(counterMismatches(db),[]);
  assert.throws(()=>put(db,"bad","m",null,null,.3));
  assert.throws(()=>put(db,"bad",null,"m",null,.3));
  assert.throws(()=>put(db,"bad","m","a",null,-.1));
  assert.throws(()=>put(db,"bad","m","a",null,1.1));
  assert.throws(()=>put(db,"m",null,null,"duplicate"));
 }finally{db.close();}
});
test("rebuild after mutations; dangling endpoints explicitly fail",()=>{
 const db=open();
 try {
  put(db,"a",null,null,"a");put(db,"aa","a","a");
  rebuildCounters(db);assert.deepEqual(counterMismatches(db),[]);
  put(db,"aaa","aa","a");assert.notDeepEqual(counterMismatches(db),[]);
  rebuildCounters(db);assert.deepEqual(counterMismatches(db),[]);
  db.prepare("DELETE FROM links WHERE link_id='aaa'").run();
  rebuildCounters(db);assert.deepEqual(counterMismatches(db),[]);
  put(db,"bad","missing","a");assert.throws(()=>validateClosure(db),/Dangling/);
 }finally{db.close();}
});
