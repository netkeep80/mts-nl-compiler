// W11 research adapter: learned boundary, ordinary numeric SQLite Link storage.
// No schema changes, no space/word heuristics, no hash IDs.
import {NumericCorpusLoader,coldNumericCorpusReplay} from './numeric-corpus-loader-v1.mjs';
import {newNumericLinkDb} from './numeric-link-store-v1.mjs';
import {exactScalars} from './source-first-frequencies-v0.mjs';
const fail=s=>{throw Error('SOURCE_FIRST_SQLITE: '+s);};
export class SourceFirstNumericLoader extends NumericCorpusLoader{
 appendSource(bytes,{id='source',boundary=null,maxScalars=1000000}={}){
  if(this.db.isTransaction||typeof id!=='string'||!id||!Number.isSafeInteger(maxScalars)||maxScalars<0)
   fail('input/transaction');
  if(boundary!==null&&[...boundary].length!==1)fail('boundary must be a scalar');
  const scalars=exactScalars(bytes);
  if(scalars.length>maxScalars)fail('RESOURCE_LIMIT');
  const c={insertedAtoms:0,insertedPairs:0,reusedAtoms:0,reusedPairs:0};
  let root;
  const balanced=(tokens,a=0,b=tokens.length)=>{
   if(a===b)return this._atom('',c);
   if(b-a===1)return tokens[a];
   const m=a+Math.floor((b-a)/2);
   return this._pair(balanced(tokens,a,m),balanced(tokens,m,b),c);
  };
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const chunks=[];let from=0;
   if(boundary!==null){
    for(let i=0;i<scalars.length;i++)if(scalars[i]===boundary){
     chunks.push(scalars.slice(from,i+1));from=i+1;
    }
   }
   if(from<scalars.length)chunks.push(scalars.slice(from));
   const ids=chunks.map(chunk=>balanced(chunk.map(scalar=>this._atom(scalar,c))));
   root=balanced(ids);
   this.db.exec('COMMIT');
   return {id,rootLinkId:root.toString(),sourceBytes:bytes.length,
    codepoints:scalars.length,insertedLinks:c.insertedAtoms+c.insertedPairs,
    reusedAtoms:c.reusedAtoms,reusedPairs:c.reusedPairs};
  }catch(e){this.db.exec('ROLLBACK');this.loadCaches();throw e;}
 }
}
export function compareNumericSourceAnchors(documents,boundary,{maxScalars=8192}={}){
 const results={};
 for(const [name,char] of [['balanced',null],['sourceFirst',boundary]]){
  const db=newNumericLinkDb();
  try{
   const loader=new SourceFirstNumericLoader(db);const docs=[];
   for(const d of documents){
    const bytes=Buffer.from(exactScalars(d.bytes).slice(0,maxScalars).join(''),'utf8');
    const r=loader.appendSource(bytes,{id:d.id,boundary:char});
    docs.push({...r,bytes});
   }
   const final=loader.finalize();
   const replay=coldNumericCorpusReplay(db,docs);
   if(replay.status!=='EXACT_NUMERIC_SQLITE_REPLAY_PASS')fail('cold replay');
   results[name]={physicalLinks:Number(final.links),vacuumBytes:replay.sqliteVacuumBytes,
    coldStatus:replay.status,books:docs.length};
  }finally{db.close();}
 }
 return results;
}