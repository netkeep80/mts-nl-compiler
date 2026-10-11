// #24 Reference adapter between research CONS/NIL views and the accepted
// v0.15 ExactSequence cell *shape*.
// Upstream contract (anum_docs/ts/src/exact-sequence.ts):
// current = R;
// for each value: payload = Link(current,value);
//                 current = Cell(self, payload).
// Equality of physical Link handles to upstream MTS is NOT established.
// This stays an experimental one-table LinkGraph, not a native compiler.
import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(JSON.stringify(value),"utf8").digest("hex");
const err = s => {throw new Error("ExactSequence bridge: "+s);};

export function readTransportSequence(graph,root,terminator,{maxCells=10000}={}) {
 if(!Number.isSafeInteger(maxCells)||maxCells<0)err("invalid cell budget");
 graph.get(terminator);
 const values=[],seen=new Set();let current=root;
 while(current!==terminator) {
  if(values.length>=maxCells)err("RESOURCE_LIMIT transport");
  if(seen.has(current))err("cyclic transport");
  seen.add(current);
  const pair=graph.get(current);
  if(pair.from_id===null)err("invalid transport cell");
  values.push(pair.from_id);
  current=pair.to_id;
 }
 return values;
}

export function materializeCellSequence(graph,root,values,{maxCells=10000}={}) {
 if(!Number.isSafeInteger(maxCells)||maxCells<0||values.length>maxCells)
  err("RESOURCE_LIMIT materialization");
 graph.get(root);let current=root;
 for(const value of values) {
  graph.get(value);
  const payload=graph.makeDerived(current,value);
  const cellId="cell:"+hash(["self-closed",payload]);
  if(graph.nodes.has(cellId)) {
   const old=graph.get(cellId);
   if(old.from_id!==cellId||old.to_id!==payload)err("cell ID collision");
  }else graph.pair(cellId,cellId,payload);
  current=cellId;
 }
 return current;
}

export function readCellSequence(graph,root,final,{maxCells=10000}={}) {
 if(!Number.isSafeInteger(maxCells)||maxCells<0)err("invalid cell budget");
 graph.get(root);graph.get(final);
 let current=final;
 const reverse=[],cells=[],visited=new Set();
 while(current!==root){
  if(reverse.length>=maxCells)err("RESOURCE_LIMIT cell read");
  if(visited.has(current))err("cyclic self-closed cell chain");
  visited.add(current);
  const cell=graph.get(current);
  if(cell.from_id!==current)err("not a self-closed Cell");
  const payload=graph.get(cell.to_id);
  if(payload.from_id===null)err("not a pair payload");
  cells.push(current);
  reverse.push(payload.to_id);
  current=payload.from_id;
 }
 return {values:reverse.reverse(),cells:cells.reverse()};
}

export function bridgeTransportToCell(graph,{root,terminator,semanticRoot,
 maxCells=10000}={}) {
 const values=readTransportSequence(graph,root,terminator,{maxCells});
 const final=materializeCellSequence(graph,semanticRoot,values,{maxCells});
 const decoded=readCellSequence(graph,semanticRoot,final,{maxCells});
 if(JSON.stringify(decoded.values)!==JSON.stringify(values))
  err("nonidentical Link-position sequence");
 return {transportRoot:root,transportTerminator:terminator,
  semanticRoot,cellFinal:final,values,cells:decoded.cells};
}
