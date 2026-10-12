// W6 probe: exact trailing Unicode windows 4/5/6, full Catalan regrouping.
// All statistics are frozen before evaluation; no words, spaces or language hints.
import {DatabaseSync} from 'node:sqlite';
import {NUMERIC_LINK_SCHEMA_V1} from './numeric-link-store-v1.mjs';
import {coldNumericCorpusReplay} from './numeric-corpus-loader-v1.mjs';
import {UniversalRepairNumericLoader} from './universal-repair-numeric-v0.mjs';

const fail = message => {throw Error('FRONTIER_WINDOW: '+message);};
const tick = () => process.hrtime.bigint();
const elapsed = start => +(Number(tick()-start)/1e6).toFixed(3);
const cmp = (a,b) => a<b?-1:a>b?1:0;
const decoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function scalars(bytes, limit=Infinity) {
  if (!Buffer.isBuffer(bytes)) fail('source bytes required');
  const text = decoder.decode(bytes);
  if (!Buffer.from(text,'utf8').equals(bytes)) fail('non-exact UTF-8');
  return [...text].slice(0,limit);
}
function shapes(length) {
  const recur = (lo,hi) => {
    if (hi-lo===1) return [{node:{lo,hi},internal:[]}];
    const result=[];
    for(let mid=lo+1;mid<hi;mid++)
      for(const a of recur(lo,mid))
        for(const b of recur(mid,hi))
          result.push({
            node:{lo,hi,left:a.node,right:b.node},
            internal:[...a.internal,...b.internal,[lo,hi]]
          });
    return result;
  };
  return recur(0,length);
}
const shapeCache = new Map();
function topologies(length) {
  if (!shapeCache.has(length)) shapeCache.set(length,shapes(length));
  return shapeCache.get(length);
}
function bestShape(chars, frequency) {
  const alternatives=topologies(chars.length);
  // All full binary trees have the same root and the same number of Links.
  // Prefer trees whose INTERNAL substrings have more disjoint training uses.
  const intervalScore=new Map();
  const score=(a,b)=>{
    const key=a+','+b;
    if(!intervalScore.has(key)) {
      const term=chars.slice(a,b).join('');
      intervalScore.set(key,Math.log2(1+(frequency.get(term)?.disjoint??0)));
    }
    return intervalScore.get(key);
  };
  let best=0,bestScore=-Infinity;
  for(let i=0;i<alternatives.length;i++) {
    let s=0;
    for(const [a,b] of alternatives[i].internal) s+=score(a,b);
    if (s>bestScore+1e-10) {bestScore=s;best=i;}
  }
  return {shape:alternatives[best],candidates:alternatives.length};
}
export function trainFrontierWindow(documents,{
  window=4,maxCodepointsPerBook=16384,maxSelectedPhrases=384,
  minOccurrences=3
}={}) {
  if (![4,5,6].includes(window)||!Array.isArray(documents)||!documents.length||
      !Number.isSafeInteger(maxCodepointsPerBook)||maxCodepointsPerBook<window||
      !Number.isSafeInteger(maxSelectedPhrases)||maxSelectedPhrases<1||maxSelectedPhrases>4096||
      !Number.isSafeInteger(minOccurrences)||minOccurrences<2)
    fail('invalid training parameters');
  const start=tick(),ids=new Set(),samples=[],frequency=new Map();
  let sampled=0,windows=0;
  for(let docIndex=0;docIndex<documents.length;docIndex++) {
    const doc=documents[docIndex];
    if(!doc||typeof doc.id!=='string'||!doc.id||ids.has(doc.id)) fail('invalid document');
    ids.add(doc.id);
    const chars=scalars(doc.bytes,maxCodepointsPerBook);
    samples.push(chars);sampled+=chars.length;
    // Streaming enumeration of every length-2..window trailing substring.
    for(let end=0;end<chars.length;end++) {
      let phrase='';
      for(let length=1;length<=window && end-length+1>=0;length++) {
        phrase=chars[end-length+1]+phrase;
        if(length<2) continue;
        const from=end-length+1;
        let stat=frequency.get(phrase);
        if(!stat) {
          stat={observed:0,disjoint:0,lastDoc:-1,lastEnd:-1};
          frequency.set(phrase,stat);
        }
        stat.observed++;
        if(stat.lastDoc!==docIndex||stat.lastEnd<=from) {
          stat.disjoint++;
          stat.lastDoc=docIndex;
          stat.lastEnd=end+1;
        }
      }
    }
  }
  const countMs=elapsed(start),parseStarted=tick(),parseCache=new Map(),votes=new Map();
  let evaluatedTrees=0;
  // For every new scalar, enumerate all possible binary trees of its trailing window.
  // Exact parses for identical windows can be memoized because frequencies are frozen.
  for(const chars of samples) {
    for(let end=window;end<=chars.length;end++) {
      const segment=chars.slice(end-window,end);
      const key=segment.join('');
      let chosen=parseCache.get(key);
      if(chosen===undefined) {
        const result=bestShape(segment,frequency);
        chosen=topologies(window).indexOf(result.shape);
        parseCache.set(key,chosen);
        evaluatedTrees+=result.candidates;
      }
      windows++;
      const tree=topologies(window)[chosen];
      for(const [a,b] of tree.internal) {
        const sub=segment.slice(a,b).join('');
        votes.set(sub,(votes.get(sub)??0)+1);
      }
    }
  }
  const parseMs=elapsed(parseStarted),rankingStarted=tick();
  const ranked=[...votes].filter(([s])=>
    (frequency.get(s)?.disjoint??0)>=minOccurrences)
    .map(([text,voteCount])=>{
      const length=[...text].length,stat=frequency.get(text);
      return {text,length,observed:stat.observed,disjoint:stat.disjoint,
        votes:voteCount,gain:(stat.disjoint-1)*(length-1)};
    })
    .sort((a,b)=>b.gain-a.gain||b.disjoint-a.disjoint||b.votes-a.votes||cmp(a.text,b.text))
    .slice(0,maxSelectedPhrases);
  const symbols=new Map(),terms=new Map(),rules=[],pairTokens=new Map();
  let next=1;
  const terminal=char=>{
    if(!symbols.has(char)) {
      symbols.set(char,next);terms.set(next,{text:char,length:1});next++;
    }
    return symbols.get(char);
  };
  // Stable terminal ID assignment, independent of the candidate sort order.
  for(const chars of samples) for(const char of chars) terminal(char);
  const makeNode=(node,chars)=>{
    if(!node.left) return terminal(chars[node.lo]);
    const a=makeNode(node.left,chars),b=makeNode(node.right,chars);
    const pair=a+','+b;
    if(pairTokens.has(pair)) return pairTokens.get(pair);
    const text=chars.slice(node.lo,node.hi).join('');
    const token=next++;
    pairTokens.set(pair,token);
    terms.set(token,{text,length:node.hi-node.lo,left:a,right:b});
    rules.push({token,left:a,right:b,text,length:node.hi-node.lo,
      trainingDisjointReplacements:frequency.get(text)?.disjoint??0,
      trainingOverlappingPairObservations:frequency.get(text)?.observed??0});
    return token;
  };
  for(const candidate of ranked) {
    const chars=[...candidate.text];
    const shape=bestShape(chars,frequency).shape;
    makeNode(shape.node,chars);
  }
  const selectedLengthHistogram={};
  for(const x of ranked)
    selectedLengthHistogram[x.length]=(selectedLengthHistogram[x.length]??0)+1;
  return {
    schema:'mts-nl/frontier-window-grammar/v0',
    parameters:{window,maxCodepointsPerBook,maxSelectedPhrases,minOccurrences},
    trainingDocuments:documents.length,trainingSampledCodepoints:sampled,
    trailingWindows:windows,uniqueWindowParses:parseCache.size,
    candidateBinaryTreesEvaluated:evaluatedTrees,
    catalanPerWindow:topologies(window).length,
    countedSubstrings:frequency.size,selectedPhrases:ranked.length,
    selectedLengthHistogram,physicalRuleTemplates:rules.length,
    topSelected:ranked.slice(0,20).map(x=>({...x})),
    trainingMs:elapsed(start),countMs,parseMs,rankingMs:elapsed(rankingStarted),
    symbols,terms,rules
  };
}
export function compareFrontierWindows(documents,baseline,{
  windows=[4,5,6],maxCodepointsPerBook=16384,maxSelectedPhrases=384,
  minOccurrences=3
}={}) {
  if(!Array.isArray(documents)||documents.length!==60||
      !baseline||baseline.books!==documents.length||
      !Number.isSafeInteger(baseline.insertedLinks)||
      !windows.length||new Set(windows).size!==windows.length||
      windows.some(w=>![4,5,6].includes(w))) fail('invalid complete benchmark inputs');
  const train=documents.filter((_,i)=>i%5!==4);
  const results=[];
  const expectedBytes=documents.reduce((n,d)=>n+d.bytes.length,0);
  if(expectedBytes!==baseline.sourceBytes||train.length!==48) fail('corpus mismatch');
  for(const window of windows) {
    const grammar=trainFrontierWindow(train,{
      window,maxCodepointsPerBook,maxSelectedPhrases,minOccurrences});
    if(!grammar.rules.length) fail('no learned grammar links');
    const db=new DatabaseSync(':memory:');
    try {
      db.exec(NUMERIC_LINK_SCHEMA_V1);
      const loader=new UniversalRepairNumericLoader(db,grammar);
      const roots=[],coverage={train:{codepoints:0,covered:0,events:0},
        heldout:{codepoints:0,covered:0,events:0}};
      const start=tick();
      for(let i=0;i<documents.length;i++) {
        const d=documents[i];
        const record=loader.appendBook(d.bytes,{id:d.id,maxCodePoints:1000000});
        roots.push({id:d.id,bytes:d.bytes,rootLinkId:record.rootLinkId});
        const partition=i%5===4?'heldout':'train';
        coverage[partition].codepoints+=record.codepoints;
        coverage[partition].covered+=record.selectedCoveredCodepoints;
        coverage[partition].events+=record.selectedLearnedOccurrences;
      }
      const insertMs=elapsed(start),final=loader.finalize();
      const cold=coldNumericCorpusReplay(db,roots);
      if(cold.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS'||
         cold.documents.length!==documents.length) fail('cold exact replay failed for '+window);
      const links=Number(final.links);
      for(const v of Object.values(coverage))
        v.rate=v.codepoints?+(v.covered/v.codepoints).toFixed(6):0;
      results.push({
        window,status:'EXACT_60_BOOK_NUMERIC_SQLITE_REPLAY_PASS',
        grammar:{
          trainingDocuments:grammar.trainingDocuments,
          trainingSampledCodepoints:grammar.trainingSampledCodepoints,
          trailingWindows:grammar.trailingWindows,
          uniqueWindowParses:grammar.uniqueWindowParses,
          candidateBinaryTreesEvaluated:grammar.candidateBinaryTreesEvaluated,
          catalanPerWindow:grammar.catalanPerWindow,
          countedSubstrings:grammar.countedSubstrings,
          selectedPhrases:grammar.selectedPhrases,
          selectedLengthHistogram:grammar.selectedLengthHistogram,
          physicalRuleTemplates:grammar.physicalRuleTemplates,
          topSelected:grammar.topSelected,
          trainingMs:grammar.trainingMs,countMs:grammar.countMs,
          parseMs:grammar.parseMs,rankingMs:grammar.rankingMs
        },
        numericGraph:{
          physicalLinks:links,sqliteVacuumBytes:cold.sqliteVacuumBytes,
          insertMs,coldReadOnlyReplayMs:cold.coldReadOnlyReplayMs,
          comparedToBalancedRatio:+(links/baseline.insertedLinks).toFixed(6),
          coldStatus:cold.status
        },
        coverage
      });
    } finally {db.close();}
  }
  return {schema:'mts-nl/frontier-4-5-6-comparison/v0',
    status:'ALL_WINDOWS_60_BOOK_EXACT_REPLAY_PASS',
    caveat:'The sliding window counts exact overlapping observations; frequencies are frozen before exhaustive enumeration. Winning subtrees train a shared grammar; full corpus then uses greedy longest exact match. This is not online graph rewriting, a minimal grammar, or a parallel runtime speedup.',
    books:documents.length,sourceBytes:expectedBytes,
    split:{train:48,heldout:12,method:'index modulo 5 == 4'},
    settings:{maxCodepointsPerBook,maxSelectedPhrases,minOccurrences},
    variants:results};
}
