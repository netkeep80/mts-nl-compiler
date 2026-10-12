import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {newNumericLinkDb,readNumericLinks} from '../src/numeric-link-store-v1.mjs';
import {CountedNumericCorpusLoader,topObservedWords,topRankedMarkdown,visibleLinkText}
 from '../src/corpus-top-report-v1.mjs';

test('TOP ranks expanded source occurrences, not unique SQL rows or pole counts',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  const first=loader.appendBook(Buffer.from('aaaa'),{id:'one'});
  const second=loader.appendBook(Buffer.from('aaaa'),{id:'two'});
  assert.equal(first.rootLinkId,second.rootLinkId);
  const top=loader.topLinks(10);
  assert.equal(top.books,2);
  assert.equal(top.denominatorPairEvents,6);
  assert.equal(top.top[0].preview,'aa');
  assert.equal(top.top[0].count,4);
  assert.equal(top.top[0].documents,2);
  assert.equal(top.top[0].empiricalRate,+(4/6).toPrecision(8));
  assert.equal(top.top[0].expandedCodepoints,2);
  assert.ok(/^[1-9][0-9]*$/.test(top.top[0].id));
  assert.equal(top.top[1].preview,'aaaa');
  assert.equal(top.top[1].count,2);
  assert.equal(top.top[1].documents,2);
  assert.ok(readNumericLinks(db).every(r=>typeof r.link_id==='bigint'));
  assert.ok(loader.finalize().links);
 }finally{db.close();}
});
test('word and phrase frequencies count actual source token windows, not Link pointers',()=>{
 const words=topObservedWords([
  {id:'a',source:'Мама мыла раму. Мама мыла раму!'},
  {id:'b',source:'Мама мыла окно.'}],10);
 assert.deepEqual(words.classes.map(x=>x.name),['word','two-words','three-words']);
 assert.equal(words.classes[0].top[0].text,'мама');
 assert.equal(words.classes[0].top[0].count,3);
 assert.equal(words.classes[0].top[0].documents,2);
 assert.equal(words.classes[1].top[0].text,'мама мыла');
 assert.equal(words.classes[1].top[0].count,3);
 assert.equal(words.classes[2].top[0].text,'мама мыла раму');
 assert.equal(words.classes[2].top[0].count,2);
 assert.equal(words.classes[2].top[0].documents,1);
 assert.equal(words.classes[2].top.some(x=>x.text.includes('раму мама')),false);
 assert.equal(words.notLinkWeights,true);
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  loader.appendBook(Buffer.from('aaa'),{id:'short'});
  const md=topRankedMarkdown(loader.topLinks(10),words);
  assert.match(md,/TOP 1000/);
  assert.match(md,/mama|мама/);
  assert.match(md,/observed/);
 }finally{db.close();}
});
test('empty and erroneous corpora cannot silently produce complete TOP100',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  assert.equal(loader.topLinks(100).top.length,0);
  assert.throws(()=>loader.appendBook(Buffer.from([0x80]),{id:'invalid'}));
  assert.throws(()=>loader.topLinks(100),/invalid\/incomplete/);
  assert.throws(()=>loader.appendBook(Buffer.from('aa'),{id:'retry'}),/fresh database/);
 }finally{db.close();}
});
test('large corpus manifest is exactly pinned and has >=60 distinct full works',()=>{
 const fs=JSON.parse(readFileSync(new URL('../corpus/large-books-v1.json',import.meta.url),'utf8'));
 assert.equal(fs.books.length,60);
 assert.equal(new Set(fs.books.map(x=>x.path)).size,60);
 assert.equal(fs.books.reduce((n,b)=>n+b.expectedBytes,0),fs.expectedTotalSourceBytes);
 assert.equal(fs.expectedTotalSourceBytes,19701816);
 assert.ok(fs.books.every(b=>b.repoPath.startsWith('prose/')&&b.expectedBytes>=125000));
});

test('TOP1000 selector keeps the numerically smallest physical IDs at equal frequency',()=>{
 const db=newNumericLinkDb();
 try{
  const compiler=new CountedNumericCorpusLoader(db,{reusePairs:false,reuseAtoms:true});
  compiler.appendBook(Buffer.from('ab'),{id:'seed'});
  const atoms=readNumericLinks(db).filter(x=>x.from_id===null);
  const statement=db.prepare('INSERT INTO links(from_id,to_id) VALUES(?,?)');
  statement.setReadBigInts(true);
  for(let i=0;i<1200;i++){
   const id=statement.run(atoms[0].link_id,atoms[1].link_id).lastInsertRowid;
   compiler.pairCounts.set(id,{count:2,documents:2,last:2});
  }
  const top=compiler.topLinks(1000);
  assert.equal(top.top.length,1000);
  assert.ok(top.top.every(x=>x.count===2));
  assert.deepEqual(top.top.map(x=>BigInt(x.id)),[...top.top.map(x=>BigInt(x.id))].sort((a,b)=>a<b?-1:a>b?1:0));
  assert.throws(()=>compiler.topLinks(1001),/invalid/);
  assert.match(topRankedMarkdown(top,topObservedWords([{id:'x',source:'a b c'}],3)),/TOP 1000/);
 }finally{db.close();}
});
test('TOP1000 word unigram bigram trigram rank cap is enforced',()=>{
 const words=Array.from({length:1100},(_,i)=>'word'+i.toString(36)).join(' ');
 const report=topObservedWords([{id:'stress',source:words}],1000);
 assert.deepEqual(report.classes.map(x=>x.top.length),[1000,1000,1000]);
 assert.throws(()=>topObservedWords([{id:'stress',source:words}],1001),/invalid top rank/);
});

test('W10 atomic TOP counts all source glyphs exactly even when parent Link is reused',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  const docs=[' , а, ', 'а, а '];
  for(const [i,value] of docs.entries())loader.appendBook(Buffer.from(value),{id:'atom-'+i});
  loader.finalize();
  const atoms=loader.topAtoms(1000);
  const expected=new Map();
  for(const ch of docs.flatMap(s=>[...s]))expected.set(ch,(expected.get(ch)??0)+1);
  const byChar=new Map(atoms.top.map(x=>[x.text,x]));
  assert.equal(atoms.denominatorAtomicOccurrences,docs.reduce((n,s)=>n+[...s].length,0));
  assert.equal(atoms.top.reduce((n,x)=>n+x.count,0),atoms.denominatorAtomicOccurrences);
  for(const [ch,n] of expected){
   assert.equal(byChar.get(ch).count,n);
   const physical=readNumericLinks(db).find(x=>x.link_id===BigInt(byChar.get(ch).id));
   assert.equal(physical.from_id,null);
   assert.equal(physical.to_id,null);
   assert.equal(physical.string,ch);
  }
  assert.equal(byChar.get(' ').visible,'⟦␠⟧');
  assert.equal(byChar.get(',').visible,'⟦,⟧');
  assert.equal(byChar.get(' ').escaped,'" "');
  assert.match(topRankedMarkdown(loader.topLinks(100),topObservedWords([{id:'x',source:docs[0]}],3),atoms),
   /Source atomic Link frequency/);
  assert.equal(atoms.top[0].count>=atoms.top.at(-1).count,true);
 }finally{db.close();}
});

test('W10 tree reproduces SQLite pole identities and exact balanced grouping',()=>{
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  const value='a ,␠';
  const r=loader.appendBook(Buffer.from(value),{id:'tree'});
  loader.appendBook(Buffer.from(value),{id:'tree-repeat'});
  const top=loader.topLinks(100);
  const root=top.top.find(x=>x.id===r.rootLinkId);
  assert.ok(root);
  assert.equal(root.expandedCodepoints,[...value].length);
  assert.equal(root.binaryTree.startsWith('#'+root.id+'('),true);
  assert.equal(root.treeTruncated,false);
  assert.ok(root.binaryTree.includes('⟦␠⟧'));
  assert.ok(root.binaryTree.includes('⟦,⟧'));
  assert.equal(/#[0-9]+\(/.test(root.binaryTree),true);
  assert.equal(root.visiblePreview,'⟦a␠,␠␠⟧');
  assert.equal(root.escapedPreview,JSON.stringify(value));
  const rows=new Map(readNumericLinks(db).map(x=>[x.link_id,x]));
  const decodeTree=id=>{
   const x=rows.get(id);
   if(x.from_id===null)return '⟦'+(x.string===' '?'␠':x.string)+'⟧';
   return '#'+id.toString()+'('+decodeTree(x.from_id)+','+decodeTree(x.to_id)+')';
  };
  assert.equal(root.binaryTree,decodeTree(BigInt(root.id)));
  const md=topRankedMarkdown(top,topObservedWords([{id:'tree',source:value}],5),loader.topAtoms());
  assert.match(md,/Physical binary tree/);
  assert.match(md,/⟦a␠,␠␠⟧/);
  assert.match(md,/Atom Link ID/);
 }finally{db.close();}
});

test('W10 whitespace and boundary markers are diagnostic and unambiguous',()=>{
 assert.equal(visibleLinkText(', '),'⟦,␠⟧');
 assert.equal(visibleLinkText(' о'),'⟦␠о⟧');
 assert.equal(visibleLinkText('о '),'⟦о␠⟧');
 assert.equal(visibleLinkText('\r\n'),'⟦␍␊⟧');
 assert.equal(visibleLinkText('\t\u00a0\ufeff'),'⟦␉⍽⟨BOM⟩⟧');
 assert.equal(visibleLinkText(''),'⟦⟧');
 const db=newNumericLinkDb();
 try{
  const loader=new CountedNumericCorpusLoader(db);
  loader.appendBook(Buffer.from('  '),{id:'double-space'});
  loader.appendBook(Buffer.from('  '),{id:'double-space-repeat'});
  const atom=loader.topAtoms().top.find(x=>x.text===' ');
  const pair=loader.topLinks().top.find(x=>x.preview==='  ');
  assert.equal(pair.fromId,atom.id);
  assert.equal(pair.toId,atom.id);
  assert.equal(pair.binaryTree,'#'+pair.id+'(⟦␠⟧,⟦␠⟧)');
  assert.equal(pair.visiblePreview,'⟦␠␠⟧');
  assert.equal(atom.count,4);
  assert.equal(pair.count,2);
 }finally{db.close();}
});
