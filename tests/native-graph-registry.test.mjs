import assert from "node:assert/strict";
import {test} from "node:test";
import {validateGraphRows,compareRowsExactly}
 from "../experiments/native-graph-registry-v0.mjs";

const atom=(id,s)=>({link_id:id,from_id:null,to_id:null,string:s,weight:null});
test("native registry preflight: sorted canonical five fields, cycles, duplicate poles",()=>{
 const items=[
  atom("P","P"),atom("a","а"),atom("b","а"),
  {link_id:"r2",from_id:"P",to_id:"a",string:null,weight:0},
  {link_id:"r1",from_id:"P",to_id:"a",string:null,weight:null},
  {link_id:"self",from_id:"self",to_id:"b",string:"циклическая",weight:1}
 ];
 const rows=validateGraphRows(items.reverse());
 assert.deepEqual(rows.map(x=>x.link_id),["P","a","b","r1","r2","self"]);
 assert.equal(rows.find(x=>x.link_id==="r1").weight,null);
 assert.equal(rows.find(x=>x.link_id==="r2").weight,0);
 assert.equal(compareRowsExactly(rows,[...rows].reverse()),true);
 assert.equal(compareRowsExactly(rows,rows.filter(row=>row.link_id!=="r2")),false);
});
test("native registry preflight: invalid source identity or data fail closed",()=>{
 const valid=[atom("a","а")];
 assert.throws(()=>validateGraphRows([...valid,atom("a","а")]),/duplicate/);
 assert.throws(()=>validateGraphRows([atom("","а")]),/empty/);
 assert.throws(()=>validateGraphRows([atom("a","\ud800")]),/unpaired surrogate/);
 assert.throws(()=>validateGraphRows([atom("a","\udc00")]),/unpaired surrogate/);
 assert.throws(()=>validateGraphRows([{...atom("a","а"),from_id:"a"}]),/one-sided/);
 assert.throws(()=>validateGraphRows([{
  link_id:"pair",from_id:"a",to_id:"unknown",string:null,weight:null
 },...valid]),/dangling endpoint/);
 assert.throws(()=>validateGraphRows([{
  ...atom("a","а"),weight:1.5
 }]),/invalid weight/);
 assert.throws(()=>validateGraphRows([{
  ...atom("a","а"),weight:NaN
 }]),/invalid weight/);
 assert.throws(()=>validateGraphRows([{
  link_id:"atom",from_id:null,to_id:null,string:null,weight:null
 }]),/atom requires a string/);
});
