// Research witness for #18: a compression rewrite is a selected Link rule.
// NO special-purpose rewrite logic is implemented here. It uses infer() from #16.
// The observer is separate: it checks decoded sequence equality and costs.
import { LinkGraph, infer } from "./inference-v0.mjs";

export function makeRewriteFixture({left="м",right="а",last=null,selected=true,
                                  contextSelected=true}={}) {
  const g = new LinkGraph();
  for (const id of ["nil","theory","context","var:X","var:Y"]) g.atom(id,id);

  // A rule is built exclusively as ordinary ordered-pair Links:
  // V -> (ExactSequence([lhs]) -> ExactSequence([rhs])).
  const xy=g.makeDerived("var:X","var:Y");
  const lhs=g.makeDerived(g.makeDerived(xy,"var:X"),"var:Y");
  const rhs=g.makeDerived(xy,xy);
  const antecedents=g.makeList([lhs],"nil");
  const images=g.makeList([rhs],"nil");
  const vars=g.makeList(["var:X","var:Y"],"nil");
  const rule=g.makeDerived(vars,g.makeDerived(antecedents,images));
  if(selected) g.pair("membership:rule","theory",rule);

  g.atom("atom:X",left);
  g.atom("atom:Y",right);
  const tail=last===null?"atom:Y":"atom:Z";
  if(last!==null) g.atom("atom:Z",last);
  const common=g.makeDerived("atom:X","atom:Y");
  const root=g.makeDerived(g.makeDerived(common,"atom:X"),tail);
  if(contextSelected) g.pair("membership:input","context",root);
  return {g,rule,root,common,source:left+right+left+(last??right)};
}

export function decodeSequence(g,root,{maxVisits=100_000}={}) {
  let visits=0;
  const active=new Set();
  function walk(id) {
    if(++visits>maxVisits) throw new Error("Sequence decode budget exhausted");
    if(active.has(id)) throw new Error("Cyclic sequence carrier");
    const n=g.get(id);
    if(n.from_id===null) return n.string;
    active.add(id);
    const str=walk(n.from_id)+walk(n.to_id);
    active.delete(id);
    return str;
  }
  return walk(root);
}

export function representationCost(g,root) {
  const visited=new Set();
  function traverse(id) {
    if(visited.has(id))return;
    visited.add(id);
    const n=g.get(id);
    if(n.from_id!==null) {
      traverse(n.from_id);traverse(n.to_id);
    }
  }
  traverse(root);
  const rows=[...visited].sort().map(id=>g.get(id));
  const pairs=rows.filter(r=>r.from_id!==null).length;
  // Complete stand-alone JSON encoding with node IDs, strings and root reference;
  // intentionally NOT an entropy/MDL codec nor cost of the rest of the database.
  const bytes=Buffer.byteLength(JSON.stringify({root,rows}),"utf8");
  return {uniquePairs:pairs,atomCount:rows.length-pairs,serializedBytes:bytes};
}

export function evaluateRewrite(g,root,{theory="theory",context="context",nil="nil",
                                 maxFirings=40,maxRounds=10}={}) {
  const input=decodeSequence(g,root);
  const beforeRoot=representationCost(g,root);
  const physicalBefore=[...g.nodes.values()].filter(n=>n.from_id!==null).length;
  const outcome=infer(g,{theory,context,nil,maxFirings,maxRounds});
  const proposals=[];
  for (const proof of outcome.proofs) {
    for(const candidateRoot of proof.conclusions) {
      // The generic Γ constructed this candidate and a proof Link structure.
      // These are checks performed AFTER inference, not a compress() opcode.
      const decoded=decodeSequence(g,candidateRoot);
      const exact=Buffer.from(decoded,"utf8").equals(Buffer.from(input,"utf8"));
      const proposedCost=representationCost(g,candidateRoot);
      proposals.push({
        root:candidateRoot,provenance:proof.proofRoot,rule:proof.rule,
        premises:proof.premises,bindings:proof.bindings,
        exactBytes:exact,decoded,
        representationCost:proposedCost,
        fewerUniquePairs:proposedCost.uniquePairs<beforeRoot.uniquePairs,
        // Does not claim net storage savings while original and proof still live.
        accepted:false
      });
    }
  }
  const physicalAfter=[...g.nodes.values()].filter(n=>n.from_id!==null).length;
  return {inputRoot:root,input,sourceCost:beforeRoot,physicalBefore,physicalAfter,
    status:outcome.status,complete:outcome.complete,proofs:outcome.proofs.length,
    candidates:proposals};
}
