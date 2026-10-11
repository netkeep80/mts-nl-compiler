// Full corpus build: exactly pinned literary works → SQLite bigint Links.
// Every successful full build MUST write both TOP-1000 reports and performance.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,rmSync,existsSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {NUMERIC_LINK_SCHEMA_V1} from '../src/numeric-link-store-v1.mjs';
import {CountedNumericCorpusLoader,topObservedWords,topRankedMarkdown}
 from '../src/corpus-top-report-v1.mjs';
const tick=()=>process.hrtime.bigint();
const ms=from=>+(Number(tick()-from)/1e6).toFixed(3);
const manifest=JSON.parse(readFileSync(new URL('../corpus/large-books-v1.json',import.meta.url),'utf8'));
if(manifest.schema!=='mts-nl/large-book-corpus/v1'||
 manifest.books.length<60||new Set(manifest.books.map(x=>x.id)).size!==manifest.books.length)
 throw Error('Large corpus must contain at least 60 distinct exact-pinned works');
const totalExpected=manifest.books.reduce((n,x)=>n+x.expectedBytes,0);
if(totalExpected!==manifest.expectedTotalSourceBytes)throw Error('Corpus source budget mismatch');
mkdirSync('reports',{recursive:true});
const databasePath=resolve('reports/knowledge-large.sqlite');
const reportJson=resolve('reports/top-1000-links.json');
const reportMd=resolve('reports/top-1000-links.md');
const perfPath=resolve('reports/large-corpus-performance.json');
// Never allow stale artifacts from a previous successful build to survive failure.
for(const file of [databasePath,reportJson,reportMd,perfPath])
 if(existsSync(file))rmSync(file,{force:true});
const db=new DatabaseSync(':memory:');
let loader;
const documents=[],measurements=[];
let perf,top;
try{
 const begin=tick();
 db.exec(NUMERIC_LINK_SCHEMA_V1);
 const schemaMs=ms(begin);
 const startup=tick();
 loader=new CountedNumericCorpusLoader(db);
 const cacheInitializationMs=ms(startup);
 const start=tick();
 for(const item of manifest.books){
  const path=resolve(item.path),bytes=readFileSync(path);
  if(bytes.length!==item.expectedBytes)throw Error('Pinned byte count drift: '+item.id);
  const row=loader.appendBook(bytes,{id:item.id,maxCodePoints:1000000});
  documents.push({id:item.id,title:item.title,author:item.author,
   bytes,rootLinkId:row.rootLinkId});
  measurements.push({...row,title:item.title,author:item.author});
  console.log('LARGE_BOOK_IMPORTED '+JSON.stringify({
   id:item.id,title:item.title,sourceBytes:row.sourceBytes,
   newLinks:row.insertedLinks,linksPerSecond:row.insertLinksPerSecond,
   loadMs:row.loadTotalMs}));
 }
 const insertWallMs=ms(start);
 const finalizeStart=tick();
 const final=loader.finalize();
 const finishMs=ms(finalizeStart);
 top=loader.topLinks(1000);
 if(top.top.length!==1000)throw Error('TOP-1000 links missing/underfilled');
 if(top.denominatorPairEvents!==measurements.reduce((n,x)=>n+Math.max(0,x.codepoints-1),0))
  throw Error('Observed pair event count inconsistent with sources');
 const sqliteStart=tick();
 db.exec("VACUUM INTO '"+databasePath.replaceAll("'","''")+"'");
 const vacuumMs=ms(sqliteStart);
 const coldStart=tick();
 const reader=new DatabaseSync(databasePath,{readOnly:true});
 let cold;
 try{
  const q=reader.prepare('SELECT from_id,to_id,string FROM links WHERE link_id=?');
  q.setReadBigInts(true);
  const cache=new Map(),maxCache=140000,results=[];
  const fetch=id=>{
   const cached=cache.get(id);if(cached)return cached;
   const row=q.get(id);if(!row)throw Error('Missing cold numeric Link '+id);
   if(cache.size>=maxCache)cache.clear();
   cache.set(id,row);return row;
  };
  for(const doc of documents){
   const parts=[],stack=[{id:BigInt(doc.rootLinkId),end:false}],active=new Set();
   let expanded=0;
   while(stack.length){
    const x=stack.pop();
    if(x.end){active.delete(x.id);continue;}
    const row=fetch(x.id);
    if(row.from_id===null){
     parts.push(row.string);
     expanded+=[...row.string].length;
     if(expanded>1000000)throw Error('Cold source expansion budget');
    }else{
     if(active.has(x.id))throw Error('Cold source cycle');
     active.add(x.id);
     stack.push({id:x.id,end:true},{id:row.to_id,end:false},{id:row.from_id,end:false});
    }
   }
   if(!Buffer.from(parts.join(''),'utf8').equals(doc.bytes))
    throw Error('Byte-exact cold replay mismatch: '+doc.id);
   results.push({id:doc.id,sourceBytes:doc.bytes.length,expandedCodepoints:expanded});
  }
  assert.equal(reader.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM links').get().n,Number(final.links));
  cold={status:'COLD_READ_ONLY_ALL_BOOKS_EXACT_PASS',books:results.length,
   measuredCacheCap:maxCache};
 }finally{reader.close();}
 const coldMs=ms(coldStart);
 const count=Number(final.links);
 const sum=measurements.reduce((n,x)=>n+x.insertedLinks,0);
 if(sum!==count)throw Error('Inserted Link mismatch');
 const totalSource=documents.reduce((n,x)=>n+x.bytes.length,0);
 perf={schema:'mts-nl/large-corpus-performance/v1',status:'BUILD_AND_COLD_REPLAY_PASS',
  sourceRepository:manifest.source.repo,sourceGitCommit:manifest.source.gitCommit,
  books:documents.length,sourceBytes:totalSource,
  observedCodepoints:measurements.reduce((n,x)=>n+x.codepoints,0),
  insertedLinks:sum,reusedAtoms:measurements.reduce((n,x)=>n+x.reusedAtoms,0),
  reusedPairs:measurements.reduce((n,x)=>n+x.reusedPairs,0),
  linkCreationPerSecond:+(sum/(insertWallMs/1000)).toFixed(1),
  inputMiBPerSecond:+((totalSource/1048576)/(insertWallMs/1000)).toFixed(3),
  schemaMs,cacheInitializationMs,insertWallMs,finalizeWallMs:finishMs,
  counterRebuildMs:final.counterRebuildMs,
  integrityCheckMs:final.integrityCheckMs,
  vacuumMs,coldReplayMs:coldMs,
  sqliteLogicalBytes:final.sqliteLogicalBytes,
  sqliteVacuumBytes:statSync(databasePath).size,
  indexPlans:final.indexPlans,peakObservedRssBytes:process.memoryUsage().rss,
  runtime:{node:process.version,sqlite:db.prepare('SELECT sqlite_version() v').get().v,
   arch:process.arch,platform:process.platform,ci:!!process.env.CI},
  perBook:measurements,
  probabilisticScope:'Raw observed occurrence frequencies, not calibrated learned word/phrase probabilities'};
 console.log('LARGE_CORPUS_SQLITE '+JSON.stringify({
  books:perf.books,sourceBytes:perf.sourceBytes,insertedLinks:perf.insertedLinks,
  linksPerSecond:perf.linkCreationPerSecond,
  insertWallMs:perf.insertWallMs,sqliteVacuumBytes:perf.sqliteVacuumBytes,
  coldReplayMs:perf.coldReplayMs}));
 // Finish SQL before linguistic frequency accounting; explicit memory release.
 loader=null;
}finally{db.close();}
if(!perf)throw Error('Incomplete build refused: TOP1000 not published');
if(global.gc)global.gc();
const wordsStart=tick();
const docsForWords=documents.map(x=>({id:x.id,source:x.bytes.toString('utf8')}));
const words=topObservedWords(docsForWords,1000);
if(words.classes.some(x=>x.top.length!==1000))throw Error('TOP1000 words or phrases incomplete');
const wordStatsMs=ms(wordsStart);
perf.wordPhraseFrequencyMs=wordStatsMs;
// Reopen TOP links for output from in-memory record retained in the build.
// The reports are emitted ONLY after all validation has completed.
if(!top)throw Error('TOP1000 unavailable after loader close');
writeFileSync(reportJson,JSON.stringify({schema:'mts-nl/full-corpus-top1000/v2',
 corpus:{books:perf.books,sourceBytes:perf.sourceBytes,insertedLinks:perf.insertedLinks},
 links:top,words},null,2)+'\n');
writeFileSync(reportMd,topRankedMarkdown(top,words));
writeFileSync(perfPath,JSON.stringify(perf,null,2)+'\n');
console.log('LARGE_CORPUS_TOP1000_ROWS '+JSON.stringify(top.top));
console.log('LARGE_CORPUS_TOP1000 '+JSON.stringify({
 links:top.top.length,words:words.classes[0].top.length,
 bigrams:words.classes[1].top.length,trigrams:words.classes[2].top.length,
 mostObservedLink:top.top[0],topReport:reportMd,
 wordPhraseFrequencyMs:wordStatsMs}));
