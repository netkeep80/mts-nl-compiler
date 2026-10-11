import assert from "node:assert/strict";
import {test} from "node:test";
import {LinkGraph,infer} from "../experiments/inference-v0.mjs";
function setup() {
 const g=new LinkGraph();
 for(const id of ["NIL","Theory","Context","P","Q","R","a","b","x","y"])
   g.atom(id,id);
 let counter=0;
 const pair=(a,b)=>g.pair("e:"+String(++counter).padStart(3,"0"),a,b);
 const seq=(items)=>items.reduceRight((tail,item)=>pair(item,tail),"NIL");
 const fact=(predicate,individual)=>pair(predicate,individual);
 const rule=(vars,antecedents,images)=>{
  const varList=seq(vars),anteList=seq(antecedents),imageList=seq(images);
  const body=pair(anteList,imageList),r=pair(varList,body);
  pair("Theory",r);return r;
 };
 const known=(id)=>{pair("Context",id);return id;};
 return {g,pair,seq,fact,rule,known};
}
const derive=(e,opts)=>infer(e.g,{theory:"Theory",context:"Context",nil:"NIL",...opts});
function structuralExists(g,result,predicate,object){
 return result.active.some(id=>{const p=g.get(id);return p.from_id===predicate&&p.to_id===object;});
}
test("variable rule infers a never-memorized grounded fact",()=>{
 const e=setup();
 const px=e.fact("P","x"),qx=e.fact("Q","x");
 const rid=e.rule(["x"],[px],[qx]);const pa=e.known(e.fact("P","a"));
 const out=derive(e);
 assert.equal(out.status,"QUIESCENT");assert.equal(out.complete,true);
 assert.equal(structuralExists(e.g,out,"Q","a"),true);
 assert.equal(out.proofs[0].rule,rid);
 assert.deepEqual(out.proofs[0].premises,[pa]);
 assert.deepEqual(out.proofs[0].bindings,[["x","a"]]);
 const proofHead=e.g.get(e.g.get(out.proofs[0].proofRoot).from_id);
 assert.equal(proofHead.from_id,rid);
 assert.equal(proofHead.to_id,"Context");
});
test("transitive chained implication, without memorized destination link",()=>{
 const e=setup();e.known(e.fact("P","b"));
 e.rule(["x"],[e.fact("P","x")],[e.fact("Q","x")]);
 e.rule(["y"],[e.fact("Q","y")],[e.fact("R","y")]);
 const out=derive(e);
 assert.equal(structuralExists(e.g,out,"R","b"),true);
 assert.equal(out.proofs.length,2);
});
test("no premise = NO_MATCH, reverse implication cannot fire",()=>{
 let e=setup();e.rule(["x"],[e.fact("P","x")],[e.fact("Q","x")]);
 let out=derive(e);
 assert.equal(out.status,"NO_MATCH");assert.equal(out.firings,0);
 e=setup();e.known(e.fact("P","a"));
 e.rule(["x"],[e.fact("Q","x")],[e.fact("P","x")]);
 out=derive(e);
 assert.equal(out.status,"NO_MATCH");
 assert.equal(structuralExists(e.g,out,"Q","a"),false);
});
test("two antecedents share SAME variable, no false mixed-object join",()=>{
 const e=setup();
 e.known(e.fact("P","a"));e.known(e.fact("Q","b"));
 e.rule(["x"],[e.fact("P","x"),e.fact("Q","x")],[e.fact("R","x")]);
 let out=derive(e);
 assert.equal(out.status,"NO_MATCH");
 assert.equal(structuralExists(e.g,out,"R","a"),false);
 e.known(e.fact("Q","a"));
 out=derive(e);
 assert.equal(structuralExists(e.g,out,"R","a"),true);
 assert.equal(structuralExists(e.g,out,"R","b"),false);
});
test("explicit zero image != no match; multiple results one shared firing",()=>{
 let e=setup();e.known(e.fact("P","a"));
 e.rule(["x"],[e.fact("P","x")],[]);
 let out=derive(e);
 assert.equal(out.status,"QUIESCENT");
 assert.equal(out.proofs.length,1);
 assert.equal(out.proofs[0].kind,"APPLIED_EMPTY");
 assert.deepEqual(out.proofs[0].conclusions,[]);
 e=setup();e.known(e.fact("P","a"));
 e.rule(["x"],[e.fact("P","x")],[e.fact("Q","x"),e.fact("R","x")]);
 out=derive(e);
 assert.equal(out.proofs.length,1);
 assert.equal(out.proofs[0].conclusions.length,2);
 assert.equal(structuralExists(e.g,out,"R","a"),true);
});
test("recursive cycle reaches fixed point, no endlessly repeated activation",()=>{
 const e=setup();e.known(e.fact("P","a"));
 e.rule(["x"],[e.fact("P","x")],[e.fact("Q","x")]);
 e.rule(["y"],[e.fact("Q","y")],[e.fact("P","y")]);
 const out=derive(e,{maxFirings:10,maxRounds:10});
 assert.equal(out.status,"QUIESCENT");
 assert.equal(out.complete,true);
 assert.equal(out.proofs.length,2);
});
test("zero search budget explicitly RESOURCE_LIMIT, never success",()=>{
 const e=setup();e.known(e.fact("P","a"));
 e.rule(["x"],[e.fact("P","x")],[e.fact("Q","x")]);
 const out=derive(e,{maxFirings:0});
 assert.equal(out.status,"RESOURCE_LIMIT");assert.equal(out.complete,false);
});
test("physical adjacent pair does not imply logically active rule",()=>{
 const e=setup();e.known(e.fact("P","a"));
 e.pair("P","Q"); // neither active Theory membership nor an executable Rule
 const out=derive(e);
 assert.equal(out.status,"NO_MATCH");
 assert.equal(structuralExists(e.g,out,"Q","a"),false);
});


test("proof provenance never masquerades as an active fact on replay",()=>{
 const e=setup();e.known(e.fact("P","a"));
 e.rule(["x"],[e.fact("P","x")],[e.fact("Q","x")]);
 const one=derive(e);
 const two=derive(e);
 assert.equal(one.proofs.length,1);
 assert.equal(two.proofs.length,1);
 assert.deepEqual(one.active,two.active);
 const members=e.g.linksFrom("Context").map(x=>x.to_id);
 assert.equal(members.length,1);
});
