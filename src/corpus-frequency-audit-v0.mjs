// W10 research-only source vs balanced-Link frequency oracle. No training hints.
// Independent positional source n-grams must NOT be conflated with tree-node uses.
const err=s=>{throw Error('FREQUENCY_AUDIT: '+s);};
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const bump=(m,key,n=1)=>m.set(key,(m.get(key)??0)+n);
const visible=s=>s.replaceAll(' ','␠').replaceAll('\n','␊').replaceAll('\r','␍').replaceAll('\t','␉');
const compare=(a,b)=>a<b?-1:a>b?1:0;
const ranked=(map,n)=>[...map].sort((a,b)=>b[1]-a[1]||compare(a[0],b[0]))
 .slice(0,n).map(([text,count],i)=>({rank:i+1,text,escaped:JSON.stringify(text),visible:visible(text),count}));
const syllableCandidate=s=>/^[А-Яа-яЁё]{2,3}$/u.test(s)&&
 [...s].filter(c=>'аеёиоуыэюяАЕЁИОУЫЭЮЯ'.includes(c)).length===1;

/** Corpus sources may contain BOM, CR/LF and combining codepoints. No normalization.
 * Orthographic syllable candidates in the OUTPUT are only a diagnostic filter:
 * 2/3 consecutive Cyrillic letters with exactly one written vowel, NOT actual
 * phonetic/linguistic syllables and never a learner input or merge constraint.
 */
export function auditCorpusFrequencies(documents,loader,{topN=40,maxDistinct=1_500_000}={}){
 if(!Array.isArray(documents)||!documents.length||!loader||
  !Number.isSafeInteger(topN)||topN<1||topN>1000||
  !Number.isSafeInteger(maxDistinct)||maxDistinct<1)err('input/limits');
 const maps=[new Map(),new Map(),new Map()];
 const balanced=[null,new Map(),new Map()];
 let totalScalars=0,totalPairWindows=0,totalTripleWindows=0,balanceEvents=0;
 const coverage=Array.from({length:7},(_,i)=>({scalars:i+2,sourceWindows:0,nodeEvents:0}));
 for(const doc of documents){
  if(!doc||!Buffer.isBuffer(doc.bytes)||typeof doc.id!=='string'||!doc.id)err('invalid document');
  const s=decoder.decode(doc.bytes);
  if(!Buffer.from(s,'utf8').equals(doc.bytes))err('noncanonical UTF-8');
  const chars=[...s],length=chars.length;
  totalScalars+=length;totalPairWindows+=Math.max(0,length-1);
  totalTripleWindows+=Math.max(0,length-2);
  for(const entry of coverage)entry.sourceWindows+=Math.max(0,length-entry.scalars+1);
  for(let i=0;i<length;i++){
   bump(maps[0],chars[i]);
   if(i+1<length)bump(maps[1],chars[i]+chars[i+1]);
   if(i+2<length)bump(maps[2],chars[i]+chars[i+1]+chars[i+2]);
  }
  // Independent, content-only reproduction of the published balanced split
  // policy; counts tree subexpressions, not every overlapping source substring.
  const stack=[[0,length]];
  while(stack.length){
   const [start,end]=stack.pop(),n=end-start;
   if(n<=1)continue;
   balanceEvents++;
   if(n>=2&&n<=8)coverage[n-2].nodeEvents++;
   if(n===2)bump(balanced[1],chars[start]+chars[start+1]);
   if(n===3)bump(balanced[2],chars[start]+chars[start+1]+chars[start+2]);
   const mid=start+Math.floor(n/2);
   stack.push([mid,end],[start,mid]);
  }
  if(maps.reduce((sum,m)=>sum+m.size,0)>maxDistinct)err('distinct substring budget');
 }
 if(loader.pairEvents!==balanceEvents||balanceEvents!==totalPairWindows)
  err('structural event conservation mismatch');
 // Atom usage is independently observed during leaf creation by the counted
 // loader. Physical from_uses/to_uses CANNOT stand in for occurrence counts.
 if(!(loader.atomCounts instanceof Map))err('atomic event counter absent');
 const atomic=new Map();
 const q=loader.db.prepare('SELECT from_id,to_id,string FROM links WHERE link_id=?');
 q.setReadBigInts(true);
 for(const [id,e] of loader.atomCounts){
  const r=q.get(id);
  if(!r||r.from_id!==null||r.to_id!==null||r.string!==e.text)
   err('nonterminal/wrong atomic Link '+id);
  if(e.text==='')continue; // empty document sentinel emits no scalar
  if([...e.text].length!==1)err('non-scalar leaf');
  bump(atomic,e.text,e.count);
 }
 const actualAtoms=ranked(maps[0],maps[0].size);
 for(const x of actualAtoms)if(x.count!==atomic.get(x.text))
  err('atomic count differs from source for '+x.escaped);
 for(const [x,count] of atomic)if(maps[0].get(x)!==count)
  err('extra atomic event for '+JSON.stringify(x));
 // The published TOP is explicitly censored (1000 most-used physical IDs).
 // Check every sampled Link against the independent complete structural
 // histogram, not just against overlapping raw text.
 const linkTop=loader.topLinks(1000),sampled=new Map(),checks=[];
 for(const item of linkTop.top){
  const n=item.expandedCodepoints;
  if(n!==2&&n!==3)continue;
  const text=item.preview,raw=maps[n-1].get(text)??0;
  const structural=balanced[n-1].get(text)??0;
  if(item.count>raw||item.count>structural)
   err('Link '+item.id+' exceeds independent source/balanced count');
  bump(sampled,text,item.count);
  checks.push({linkId:item.id,text,escaped:JSON.stringify(text),
   rawOccurrences:raw,balancedOccurrences:structural,linkNodeOccurrences:item.count,
   positionCoverage:raw?+(item.count/raw).toFixed(6):null});
 }
 for(const [text,count] of sampled){
  const n=[...text].length;
  if(count>(balanced[n-1].get(text)??0))
   err('same-text Link nodes exceed independent balanced count');
 }
 const asTop=(raw,tree)=>ranked(raw,topN).map(row=>({
  ...row,balancedTreeOccurrences:tree.get(row.text)??0,
  sampledTop1000LinkOccurrences:sampled.get(row.text)??0,
  treeCoverage:+((tree.get(row.text)??0)/row.count).toFixed(6),
  sampledLinkCountIsLowerBound:true
 }));
 const rawCandidates=new Map([...maps[1],...maps[2]].filter(([s])=>syllableCandidate(s)));
 return {schema:'mts-nl/frequency-audit/v0',status:'SOURCE_ATOM_TREE_CONSERVATION_PASS',
  scope:'full source Unicode scalars and overlapping n-grams; separate balanced-tree structural nodes',
  documents:documents.length,sourceScalars:totalScalars,
  sourcePairWindows:totalPairWindows,sourceTripleWindows:totalTripleWindows,
  balancedPairEvents:balanceEvents,observedPairEvents:loader.pairEvents,
  checkedTopLinkNodes:checks.length,checkedAtoms:atomic.size,
  scalarTop:ranked(maps[0],topN),lettersTop:ranked(new Map([...maps[0]].filter(([c])=>/\p{L}/u.test(c))),topN),
  bigramTop:asTop(maps[1],balanced[1]),trigramTop:asTop(maps[2],balanced[2]),
  syllableLikeTop:ranked(rawCandidates,topN).map(x=>({...x,
   balancedTreeOccurrences:balanced[[...x.text].length-1].get(x.text)??0})),
  sampledTopLinkChecks:checks.slice(0,topN),
  structuralCoverageByLength:coverage.map(x=>({...x,
   fraction:x.sourceWindows?+(x.nodeEvents/x.sourceWindows).toFixed(8):0})),
  note:'Cyrillic syllable-like filter is posthoc and not phonetic syllabification; TOP1000 Link figures count only observed balanced tree nodes.'};
}
export function frequencyAuditMarkdown(a){
 const lines=['# Независимая проверка частот исходных текстов и Link','',
  '**'+a.status+'**; books='+a.documents+'; scalars='+a.sourceScalars+
  '; overlapping pairs='+a.sourcePairWindows+'; structural pair events='+a.observedPairEvents+'.','',
  'TOP1000 counts are balanced-tree **node uses**, not all substring occurrences. '+
  'A literal character is the atomic Link terminal; self-equal pair poles do not indicate an atom.',''];
 lines.push('## Доля окон исходника, доступных как цельный Link','',
  '| Длина | Все позиционные окна | Узлы сбалансированного дерева | Доля |',
  '|---:|---:|---:|---:|');
 for(const x of a.structuralCoverageByLength)lines.push('| '+x.scalars+' | '+x.sourceWindows+
  ' | '+x.nodeEvents+' | '+(100*x.fraction).toFixed(2)+'% |');
 lines.push('','Это покрытие **всех позиций**, а не только TOP1000.','');
 const sections=[['Все символы',a.scalarTop],['Буквы',a.lettersTop],
  ['Перекрывающиеся биграммы против сбалансированных узлов',a.bigramTop],
  ['Перекрывающиеся триграммы против сбалансированных узлов',a.trigramTop],
  ['Условные слогоподобные сочетания (не настоящие слоги)',a.syllableLikeTop]];
 for(const [title,rows] of sections){
  lines.push('## '+title,'','| Значение | Частота в исходнике | Узел сбалансированного дерева |',
   '|---|---:|---:|');
  for(const x of rows)lines.push('| `'+x.escaped.replaceAll('|','\\|')+'` | '+x.count+
   ' | '+(x.balancedTreeOccurrences??'—')+' |');
  lines.push('');
 }
 return lines.join('\n')+'\n';
}