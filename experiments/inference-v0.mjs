// Experimental finite Horn-like inference over ONE binary Link relation.
// This deliberately does NOT claim accepted FORMAL/v0.15 conformance.
// All predicates, patterns, rules, facts, bindings and proof witnesses are Links;
// the host implements only selected context membership, generic structural matching,
// variable binding, ordered sequence containers, instantiation and bounded fixpoint.
import { createHash } from "node:crypto";

const hash = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export class LinkGraph {
  constructor(rows = []) {
    this.nodes = new Map();
    this.pairIndex = new Map();
    for (const row of rows) this.add(row);
  }
  add(row) {
    const {link_id,from_id = null,to_id = null,string = null,weight = null} = row;
    if (this.nodes.has(link_id)) throw new Error("Duplicate Link id: "+link_id);
    if ((from_id === null) !== (to_id === null)) throw new Error("Half-defined Link");
    if (from_id === null && string === null) throw new Error("Unlabelled atom");
    if (weight !== null && (!Number.isFinite(weight) || weight<0 || weight>1))
      throw new Error("Invalid stored weight");
    const link = {link_id,from_id,to_id,string,weight};
    this.nodes.set(link_id,link);
    if (from_id !== null) {
      const key = JSON.stringify([from_id,to_id]);
      if (!this.pairIndex.has(key)) this.pairIndex.set(key,link_id);
    }
    return link_id;
  }
  atom(id,s) { return this.add({link_id:id,string:s}); }
  pair(id,a,b,weight=null) { return this.add({link_id:id,from_id:a,to_id:b,weight}); }
  get(id) { const l=this.nodes.get(id);if(!l)throw new Error("Unknown Link "+id);return l; }
  ensureClosed() {
    for (const n of this.nodes.values()) if(n.from_id!==null) {
      this.get(n.from_id);this.get(n.to_id);
    }
  }
  linksFrom(id) {
    return [...this.nodes.values()].filter(n=>n.from_id===id&&n.to_id!==null)
      .sort((a,b)=>a.link_id.localeCompare(b.link_id,"en"));
  }
  makeDerived(a,b) {
    const key = JSON.stringify([a,b]);
    if(this.pairIndex.has(key)) return this.pairIndex.get(key);
    const id="derived:"+hash(["pair",a,b]);
    if(this.nodes.has(id)) throw new Error("Derived ID collision");
    this.pair(id,a,b);
    return id;
  }
  makeList(items,nil) {
    return items.reduceRight((tail,item)=>this.makeDerived(item,tail),nil);
  }
}

function readList(g,root,nil,maxNodes) {
  const out=[],seen=new Set();
  while(root!==nil) {
    if (out.length>=maxNodes) throw new Error("List bound exceeded");
    if (seen.has(root)) throw new Error("Cyclic exact sequence");
    seen.add(root);
    const n=g.get(root);
    if(n.from_id===null) throw new Error("Invalid exact-sequence carrier");
    out.push(n.from_id);root=n.to_id;
  }
  return out;
}
function match(g,pattern,term,variables,env,visited=new Set()) {
  if(variables.has(pattern)) {
    if(env.has(pattern)) return env.get(pattern)===term ? env : null;
    const result=new Map(env);result.set(pattern,term);return result;
  }
  const p=g.get(pattern),t=g.get(term);
  if(p.from_id===null) return p.link_id===t.link_id?env:null;
  if(t.from_id===null) return null;
  if(visited.has(pattern)) throw new Error("Cyclic pattern not supported");
  const next=new Set(visited);next.add(pattern);
  const left=match(g,p.from_id,t.from_id,variables,env,next);
  return left===null ? null : match(g,p.to_id,t.to_id,variables,left,next);
}
function instantiate(g,template,variables,env,visited=new Set()) {
  if(variables.has(template)) {
    if(!env.has(template)) throw new Error("Unbound output variable");
    return env.get(template);
  }
  const p=g.get(template);
  if(p.from_id===null) return template;
  if(visited.has(template)) throw new Error("Cyclic output template");
  const next=new Set(visited);next.add(template);
  return g.makeDerived(instantiate(g,p.from_id,variables,env,next),
                       instantiate(g,p.to_id,variables,env,next));
}
function parseRule(g,ruleId,nil,maxItems) {
  const rule=g.get(ruleId),body=g.get(rule.to_id);
  if(rule.from_id===null||body.from_id===null)throw new Error("Malformed Rule");
  const variables=new Set(readList(g,rule.from_id,nil,maxItems));
  const antecedents=readList(g,body.from_id,nil,maxItems);
  const images=readList(g,body.to_id,nil,maxItems);
  if(!antecedents.length)throw new Error("Grounded zero-antecedent rules deferred");
  for(const x of variables)if(g.get(x).from_id!==null)throw new Error("Variable not an atom");
  return {id:ruleId,variables,antecedents,images};
}
function* matchingTuples(g,patterns,vars,facts,level=0,env=new Map(),used=[]) {
  if(level===patterns.length) { yield {env,used};return; }
  for(const fact of facts) {
    const next=match(g,patterns[level],fact,vars,env);
    if(next) yield* matchingTuples(g,patterns,vars,facts,level+1,next,[...used,fact]);
  }
}

export function infer(g,{theory,context,nil,maxFirings=1000,maxRounds=100,maxItems=1000}={}) {
  g.ensureClosed();
  // Only links that are members of explicit theory/context anchors participate.
  const rules=g.linksFrom(theory).map(n=>parseRule(g,n.to_id,nil,maxItems));
  const active=new Set(g.linksFrom(context).map(n=>n.to_id));
  const proofs=[],seenFirings=new Set();
  let firings=0;
  for(let round=0;round<maxRounds;round++) {
    const snapshot=[...active].sort();
    let grew=false;
    for(const rule of rules) {
      for(const m of matchingTuples(g,rule.antecedents,rule.variables,snapshot)) {
        const bindings=[...m.env].sort((a,b)=>a[0].localeCompare(b[0]));
        const signature=hash([rule.id,m.used,bindings]);
        if(seenFirings.has(signature))continue;
        if(firings>=maxFirings) return {status:"RESOURCE_LIMIT",complete:false,active:[...active].sort(),proofs,firings};
        seenFirings.add(signature);
        const results=rule.images.map(x=>instantiate(g,x,rule.variables,m.env));
        // Symbolic proof is itself a temporary Link DAG, not a host-only assertion.
        const supports=g.makeList(m.used,nil);
        const outputs=g.makeList(results,nil);
        const bindingsGraph=g.makeList(bindings.map(([x,y])=>g.makeDerived(x,y)),nil);
        // Proof witnesses MUST NOT have from_id=context: linksFrom(context)
        // selects facts, so such a proof would become a false premise on replay.
        // Keep context only as the SECOND pole of a dedicated provenance pair.
        const proofRoot=g.makeDerived(g.makeDerived(rule.id,context),
          g.makeDerived(bindingsGraph,g.makeDerived(supports,outputs)));
        proofs.push({rule:rule.id,premises:m.used,conclusions:results,
          bindings,proofRoot,kind:results.length?"APPLIED_NONEMPTY":"APPLIED_EMPTY"});
        firings++;
        for(const out of results) if(!active.has(out)){active.add(out);grew=true;}
      }
    }
    if(!grew) return {status:firings?"QUIESCENT":"NO_MATCH",
      complete:true,active:[...active].sort(),proofs,firings};
  }
  return {status:"RESOURCE_LIMIT",complete:false,active:[...active].sort(),proofs,firings};
}
