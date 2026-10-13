// W19-S0 research-only semantic candidate boundary experiment.
// All language knowledge lives in an external definition pack. This module
// contains no Russian grammar, accepted FORMAL runtime, truth probability,
// or physical Link identity semantics.
import {createHash} from 'node:crypto';

const fail=s=>{throw new Error('W19_S0: '+s);};
const scalarChars=s=>{
  if(typeof s!=='string')fail('Unicode string required');
  const a=[...s];
  if(a.some(ch=>{const cp=ch.codePointAt(0);return cp>=0xD800&&cp<=0xDFFF;}))
    fail('unpaired UTF-16 surrogate');
  return a;
};
const stable=value=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
};
export const digestObject=value=>createHash('sha256').update(stable(value),'utf8').digest('hex');

const isWordScalar=ch=>/[\p{L}\p{M}\p{N}]/u.test(ch);
const isWhitespace=ch=>/\p{White_Space}/u.test(ch);

export function exactUnicodeTokens(text){
  const scalars=scalarChars(text),tokens=[];
  let byte=0,scalar=0,word=null;
  const flush=()=>{
    if(!word)return;
    tokens.push(Object.freeze(word));word=null;
  };
  for(const ch of scalars){
    const bytes=Buffer.byteLength(ch,'utf8'),wordish=isWordScalar(ch);
    if(wordish){
      if(!word)word={surface:'',startUtf8:byte,endUtf8:byte,startScalar:scalar,endScalar:scalar};
      word.surface+=ch;word.endUtf8=byte+bytes;word.endScalar=scalar+1;
    }else{
      flush();
      if(!isWhitespace(ch))tokens.push(Object.freeze({
        surface:ch,startUtf8:byte,endUtf8:byte+bytes,startScalar:scalar,endScalar:scalar+1
      }));
    }
    byte+=bytes;scalar++;
  }
  flush();
  return Object.freeze(tokens);
}

class ExactTextLinkGraph{
  constructor(){this.nodes=[null];this.atoms=new Map();this.pairs=new Map();}
  atom(s){
    let id=this.atoms.get(s);if(id!==undefined)return id;
    id=this.nodes.length;this.nodes.push(Object.freeze({kind:'atom',value:s}));
    this.atoms.set(s,id);return id;
  }
  pair(from,to){
    const key=from+','+to;let id=this.pairs.get(key);if(id!==undefined)return id;
    id=this.nodes.length;this.nodes.push(Object.freeze({kind:'pair',from,to}));
    this.pairs.set(key,id);return id;
  }
  encode(text,shape='balanced'){
    if(!['left','balanced'].includes(shape))fail('bad source Link shape');
    const units=scalarChars(text).map(x=>this.atom(x));
    if(!units.length)return null;
    if(shape==='left'){
      let root=units[0];for(let i=1;i<units.length;i++)root=this.pair(root,units[i]);return root;
    }
    const build=(a,b)=>{
      if(b-a===1)return units[a];
      const m=a+Math.floor((b-a)/2);
      return this.pair(build(a,m),build(m,b));
    };
    return build(0,units.length);
  }
  decode(root){
    if(root===null)return '';
    let out='',expanded=0;const stack=[root];
    while(stack.length){
      const node=this.nodes[stack.pop()];if(!node)fail('bad source Link root');
      if(node.kind==='atom'){out+=node.value;if(++expanded>10000)fail('source replay limit');}
      else{stack.push(node.to,node.from);}
    }
    return out;
  }
  stats(){return {links:this.nodes.length-1,atoms:this.atoms.size,pairs:this.pairs.size};}
}

// Generic JSON-like value representation over immutable atom/pair Links.
// It is a research transport proving representability, not native MTS identity.
class LinkValueStore{
  constructor(){
    this.nodes=[null];this.atoms=new Map();this.pairs=new Map();
    this.nil=this.atom('@nil');
  }
  atom(value){
    const key=String(value);let id=this.atoms.get(key);if(id!==undefined)return id;
    id=this.nodes.length;this.nodes.push(Object.freeze({kind:'atom',value:key}));
    this.atoms.set(key,id);return id;
  }
  pair(from,to){
    const key=from+','+to;let id=this.pairs.get(key);if(id!==undefined)return id;
    id=this.nodes.length;this.nodes.push(Object.freeze({kind:'pair',from,to}));
    this.pairs.set(key,id);return id;
  }
  list(values){
    let root=this.nil;
    for(let i=values.length-1;i>=0;i--)root=this.pair(values[i],root);
    return root;
  }
  readList(root){
    const out=[];let current=root,guard=0;
    while(current!==this.nil){
      if(++guard>10000)fail('Link value list limit');
      const node=this.nodes[current];
      if(!node||node.kind!=='pair')fail('malformed Link value list');
      out.push(node.from);current=node.to;
    }
    return out;
  }
  encode(value){
    if(value===null||['string','number','boolean'].includes(typeof value)){
      return this.pair(this.atom('@primitive'),this.atom(JSON.stringify(value)));
    }
    if(Array.isArray(value)){
      return this.pair(this.atom('@array'),this.list(value.map(x=>this.encode(x))));
    }
    if(typeof value==='object'){
      const fields=Object.keys(value).sort().map(key=>
        this.pair(this.atom('@key:'+key),this.encode(value[key])));
      return this.pair(this.atom('@object'),this.list(fields));
    }
    fail('unsupported Link value type');
  }
  atomValue(id){
    const node=this.nodes[id];if(!node||node.kind!=='atom')fail('expected Link atom');
    return node.value;
  }
  decode(root){
    const node=this.nodes[root];if(!node||node.kind!=='pair')fail('bad Link value root');
    const tag=this.atomValue(node.from);
    if(tag==='@primitive')return JSON.parse(this.atomValue(node.to));
    if(tag==='@array')return this.readList(node.to).map(x=>this.decode(x));
    if(tag==='@object'){
      const out={};
      for(const fieldId of this.readList(node.to)){
        const field=this.nodes[fieldId];
        if(!field||field.kind!=='pair')fail('bad object field Link');
        const key=this.atomValue(field.from);
        if(!key.startsWith('@key:'))fail('bad object key Link');
        out[key.slice(5)]=this.decode(field.to);
      }
      return out;
    }
    fail('unknown Link value tag');
  }
  stats(){return {links:this.nodes.length-1,atoms:this.atoms.size,pairs:this.pairs.size};}
}

export function prepareLinkDefinitionPack(pack){
  validatePack(pack);
  const store=new LinkValueStore(),packRoot=store.encode(pack),definitionRoots={};
  for(const item of [...pack.lexemes,...pack.templates])definitionRoots[item.id]=store.encode(item);
  const decoded=store.decode(packRoot);
  validatePack(decoded);
  if(stable(decoded)!==stable(pack))fail('definition Link replay mismatch');
  return Object.freeze({
    schema:'mts-nl/W19S0/link-definition-pack/v0',
    pack:decoded,packRoot,definitionRoots:Object.freeze({...definitionRoots}),
    graphStats:Object.freeze(store.stats()),store
  });
}

function validatePack(pack){
  if(!pack||typeof pack!=='object'||!Array.isArray(pack.lexemes)||!Array.isArray(pack.templates))
    fail('invalid definition pack');
  const ids=new Set();
  for(const item of [...pack.lexemes,...pack.templates]){
    if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id))fail('duplicate definition id');
    ids.add(item.id);
  }
  for(const lx of pack.lexemes){
    if(!Array.isArray(lx.surface)||!lx.surface.length||lx.surface.some(x=>typeof x!=='string'||!x)||
      typeof lx.kind!=='string'||typeof lx.concept!=='string')fail('invalid lexeme');
    if(lx.contexts!==undefined&&(!Array.isArray(lx.contexts)||lx.contexts.some(x=>typeof x!=='string'||!x)))
      fail('invalid lexeme contexts');
  }
  for(const tpl of pack.templates){
    if(!Array.isArray(tpl.pattern)||!tpl.pattern.length||!tpl.emit||typeof tpl.emit!=='object')
      fail('invalid template');
    for(const seg of tpl.pattern)
      if(!seg||typeof seg.kind!=='string'||('slot' in seg&&typeof seg.slot!=='string'))fail('invalid pattern');
  }
}

function applicableLexemes(pack,tokens,contextId){
  const byStart=Array.from({length:tokens.length},()=>[]);
  for(let pos=0;pos<tokens.length;pos++)for(const def of pack.lexemes){
    if(def.contexts&&contextId!==null&&contextId!==undefined&&!def.contexts.includes(contextId))continue;
    if(pos+def.surface.length>tokens.length)continue;
    let ok=true;for(let j=0;j<def.surface.length;j++)if(tokens[pos+j].surface!==def.surface[j]){ok=false;break;}
    if(!ok)continue;
    byStart[pos].push(Object.freeze({
      id:def.id,kind:def.kind,concept:def.concept,startToken:pos,endToken:pos+def.surface.length,
      surface:def.surface.join(' '),startUtf8:tokens[pos].startUtf8,
      endUtf8:tokens[pos+def.surface.length-1].endUtf8,contexts:def.contexts??null
    }));
  }
  for(const a of byStart)a.sort((x,y)=>x.id.localeCompare(y.id));
  return byStart;
}

function resolveEmit(value,bindings,contextId){
  if(typeof value==='string'&&value.startsWith('$')){
    const m=/^\$([A-Za-z0-9_]+)\.(concept|surface)$/.exec(value);
    if(!m)fail('invalid emit binding '+value);
    const bound=bindings[m[1]];if(!bound)fail('unbound emit slot '+m[1]);
    return bound[m[2]];
  }
  if(value==='$context')return contextId;
  if(Array.isArray(value))return value.map(x=>resolveEmit(x,bindings,contextId));
  if(value&&typeof value==='object')
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveEmit(v,bindings,contextId)]));
  return value;
}

function matchTemplates(text,contextId,pack,{definitionRoots=null}={}){
  const tokens=exactUnicodeTokens(text),byStart=applicableLexemes(pack,tokens,contextId),raw=[];
  for(const tpl of pack.templates){
    const walk=(segIndex,pos,bindings,evidence)=>{
      if(segIndex===tpl.pattern.length){
        if(pos!==tokens.length)return;
        const relation=resolveEmit(tpl.emit,bindings,contextId);
        const spans={};
        for(const [slot,b] of Object.entries(bindings))
          spans[slot]={surface:b.surface,startUtf8:b.startUtf8,endUtf8:b.endUtf8};
        const ids=[tpl.id,...evidence.map(x=>x.id)];
        raw.push({
          relation,
          evidence:{
            templateId:tpl.id,definitionIds:[...new Set(ids)],
            definitionLinkRoots:definitionRoots?
              Object.fromEntries([...new Set(ids)].map(id=>[id,definitionRoots[id]])):null,
            spans,contextId
          }
        });
        return;
      }
      if(pos>=tokens.length)return;
      const seg=tpl.pattern[segIndex];
      for(const lx of byStart[pos]){
        if(lx.kind!==seg.kind)continue;
        if(seg.slot&&bindings[seg.slot]&&bindings[seg.slot].id!==lx.id)continue;
        const nextBindings=seg.slot?{...bindings,[seg.slot]:lx}:bindings;
        walk(segIndex+1,lx.endToken,nextBindings,[...evidence,lx]);
      }
    };
    walk(0,0,{},[]);
  }
  const unique=new Map();
  for(const c of raw){
    const key=stable(c.relation);
    if(!unique.has(key))unique.set(key,c);
  }
  const candidates=[...unique.values()].sort((a,b)=>stable(a.relation).localeCompare(stable(b.relation)));
  return {tokens,candidates,status:candidates.length===0?'UNKNOWN':candidates.length===1?'PROPOSED':'AMBIGUOUS'};
}

const semanticCore=result=>({
  status:result.status,
  candidates:result.candidates.map(x=>x.relation)
});

export function interpretStructureOnly(text,{shape='balanced'}={}){
  const graph=new ExactTextLinkGraph(),root=graph.encode(text,shape),replay=graph.decode(root);
  if(replay!==text)fail('source ExactSequence replay mismatch');
  return Object.freeze({
    mode:'A_STRUCTURE_ONLY',status:'UNKNOWN',semanticCandidates:[],
    observed:Object.freeze({
      exactText:text,utf8Bytes:Buffer.byteLength(text,'utf8'),unicodeScalars:scalarChars(text).length,
      tokens:exactUnicodeTokens(text),sourceShape:shape,sourceRoot:root,sourceGraph:graph.stats(),
      replayStatus:'EXACT_UNICODE_REPLAY_PASS'
    }),
    semanticBoundary:'No definitions supplied; structure alone is not semantic evidence'
  });
}

export function interpretFlat(text,{contextId=null,pack}={}){
  validatePack(pack);
  const matched=matchTemplates(text,contextId,pack);
  return Object.freeze({
    mode:'B_FLAT_TEMPLATE_BASELINE',status:matched.status,
    candidates:matched.candidates,tokens:matched.tokens,contextId
  });
}

export function interpretLink(text,{contextId=null,prepared,shape='balanced'}={}){
  if(!prepared||prepared.schema!=='mts-nl/W19S0/link-definition-pack/v0')fail('prepared Link pack required');
  const source=new ExactTextLinkGraph(),root=source.encode(text,shape),replay=source.decode(root);
  if(replay!==text)fail('Link source replay mismatch');
  const matched=matchTemplates(replay,contextId,prepared.pack,{definitionRoots:prepared.definitionRoots});
  return Object.freeze({
    mode:'B_LINK_DEFINITION_GRAPH',status:matched.status,candidates:matched.candidates,
    tokens:matched.tokens,contextId,sourceShape:shape,sourceRoot:root,sourceGraph:source.stats(),
    definitionGraph:prepared.graphStats,replayStatus:'EXACT_UNICODE_REPLAY_PASS'
  });
}

export function ablateDefinitionPack(pack,control={}){
  validatePack(pack);
  if(!control||typeof control!=='object'||Array.isArray(control))fail('bad control');
  const remove=new Set(control.removeDefinitionIds??[]);
  const known=new Set([...pack.lexemes,...pack.templates].map(x=>x.id));
  for(const id of remove)if(!known.has(id))fail('unknown ablation definition '+id);
  const next={...pack,
    lexemes:pack.lexemes.filter(x=>!remove.has(x.id)).map(x=>({...x})),
    templates:pack.templates.filter(x=>!remove.has(x.id)).map(x=>({...x}))
  };
  validatePack(next);return next;
}

export function runS0Case(example,pack){
  if(!example||typeof example.id!=='string'||typeof example.text!=='string')fail('bad example');
  const aLeft=interpretStructureOnly(example.text,{shape:'left'});
  const aBalanced=interpretStructureOnly(example.text,{shape:'balanced'});
  const prepared=prepareLinkDefinitionPack(pack);
  const bLeft=interpretLink(example.text,{contextId:example.contextId??null,prepared,shape:'left'});
  const bBalanced=interpretLink(example.text,{contextId:example.contextId??null,prepared,shape:'balanced'});
  const flat=interpretFlat(example.text,{contextId:example.contextId??null,pack});
  if(stable(semanticCore(bLeft))!==stable(semanticCore(bBalanced)))fail('binaryization changed semantics '+example.id);
  if(stable(semanticCore(bBalanced))!==stable(semanticCore(flat)))fail('Link/flat knowledge mismatch '+example.id);
  const cPack=ablateDefinitionPack(pack,example.control??{});
  const cPrepared=prepareLinkDefinitionPack(cPack);
  const cContext=example.control&&Object.prototype.hasOwnProperty.call(example.control,'contextOverride')?
    example.control.contextOverride:(example.contextId??null);
  const c=interpretLink(example.text,{contextId:cContext,prepared:cPrepared,shape:'balanced'});
  return Object.freeze({
    id:example.id,text:example.text,contextId:example.contextId??null,
    A:{left:aLeft,balanced:aBalanced},
    B:{link:bBalanced,flat},
    C:{link:c,contextId:cContext,removedDefinitionIds:example.control?.removeDefinitionIds??[]},
    invariants:{
      exactReplay:aLeft.observed.exactText===aBalanced.observed.exactText&&
        aLeft.observed.exactText===example.text,
      binaryizationSemanticInvariant:stable(semanticCore(bLeft))===stable(semanticCore(bBalanced)),
      linkEqualsFlatAtSameKnowledge:stable(semanticCore(bBalanced))===stable(semanticCore(flat))
    }
  });
}

export function runS0Corpus(examples,pack){
  if(!Array.isArray(examples)||examples.length<1)fail('examples required');
  const ids=new Set();
  for(const e of examples){if(ids.has(e.id))fail('duplicate example id');ids.add(e.id);}
  const cases=examples.map(e=>runS0Case({
    id:e.id,text:e.text,contextId:e.contextId??null,control:e.control??{}
  },pack));
  const countStatus=(mode,status)=>cases.filter(c=>mode(c)===status).length;
  return Object.freeze({
    schema:'mts-nl/W19S0/semantic-boundary-report/v0',
    cases,
    metrics:{
      examples:cases.length,
      modeA:{proposed:countStatus(c=>c.A.balanced.status,'PROPOSED'),
        unknown:countStatus(c=>c.A.balanced.status,'UNKNOWN')},
      modeB:{proposed:countStatus(c=>c.B.link.status,'PROPOSED'),
        ambiguous:countStatus(c=>c.B.link.status,'AMBIGUOUS'),
        unknown:countStatus(c=>c.B.link.status,'UNKNOWN')},
      modeC:{proposed:countStatus(c=>c.C.link.status,'PROPOSED'),
        ambiguous:countStatus(c=>c.C.link.status,'AMBIGUOUS'),
        unknown:countStatus(c=>c.C.link.status,'UNKNOWN')},
      binaryizationDisagreements:cases.filter(c=>!c.invariants.binaryizationSemanticInvariant).length,
      linkVsFlatDisagreements:cases.filter(c=>!c.invariants.linkEqualsFlatAtSameKnowledge).length,
      exactReplayFailures:cases.filter(c=>!c.invariants.exactReplay).length,
      semanticAccuracy:'NOT_SCORED_NO_INDEPENDENT_GOLD',
      probabilityMetrics:'NOT_DEFINED'
    }
  });
}
