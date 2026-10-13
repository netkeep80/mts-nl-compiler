// W19-G0 research-only TSV and SHA validator. NO gold creation or semantic scoring.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const home=resolve(dirname(fileURLToPath(import.meta.url)),'../data/w19-g0');
const sha=b=>createHash('sha256').update(b).digest('hex');
const reject=s=>{throw new Error('W19_G0: '+s);};
export const headers={
 source:'case_id\tcontext\ttext',
 origins:'case_id\tkind\tsource\tsource_blob_sha\tcategory',
 annotation:'case_id\tstage\tannotator\treading\tfield\tvalue\tsurface\tstart_utf8\tend_utf8\tjudgement\tevidence\tnote'
};
export function parseTsv(raw,expected){
 if(typeof raw!=='string'||!raw.endsWith('\n')||raw.includes('\r'))reject('TSV must end with LF and contain no CR');
 const lines=raw.slice(0,-1).split('\n');
 if(lines[0]!==expected)reject('TSV header mismatch');
 return lines.slice(1).map((line,i)=>{
  if(line==='')reject('blank TSV row '+(i+2));
  const vals=line.split('\t'),names=expected.split('\t');
  if(vals.length!==names.length)reject('TSV column count at '+(i+2));
  return Object.fromEntries(names.map((n,j)=>[n,vals[j]]));
 });
}
export function parseManifest(raw){
 if(!raw.endsWith('\n')||raw.includes('\r'))reject('manifest line endings');
 const out={};
 for(const line of raw.trimEnd().split('\n')){
  const at=line.indexOf('=');if(at<=0)reject('bad manifest line');
  const k=line.slice(0,at),v=line.slice(at+1);
  if(!/^[a-z0-9_]+$/.test(k)||Object.hasOwn(out,k))reject('bad manifest key '+k);
  out[k]=v;
 }
 return out;
}
export function validateSources(dir=home){
 const get=f=>readFileSync(resolve(dir,f));
 const manifest=parseManifest(get('manifest.txt').toString('utf8'));
 if(manifest.format_version!=='W19-G0-A-TSV-1'||manifest.human_gold!=='NOT_COLLECTED'||manifest.holdout_machine_seen!=='NO'||manifest.holdout_status!=='FROZEN_PRE_INFERENCE')
  reject('invalid research freeze gates');
 const names=[['s0-blind.tsv','s0_blind_sha256'],['holdout.tsv','holdout_sha256'],['origins.tsv','origins_sha256'],['annotation-template.tsv','annotation_template_sha256']];
 for(const [f,key] of names)if(sha(get(f))!==manifest[key])reject('SHA mismatch: '+f);
 for(const k of ['source_main','s0_draft_head','s0_corpus_sha256','s0_definitions_sha256','s0_engine_sha256'])
  if(!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(manifest[k]??''))reject('invalid source pin '+k);
 const s0=parseTsv(get('s0-blind.tsv').toString('utf8'),headers.source);
 const h=parseTsv(get('holdout.tsv').toString('utf8'),headers.source);
 const origins=parseTsv(get('origins.tsv').toString('utf8'),headers.origins);
 const template=parseTsv(get('annotation-template.tsv').toString('utf8'),headers.annotation);
 if(template.length!==0)reject('annotation-template must be empty: no fake gold');
 if(s0.length!==28||h.length!==33||origins.length!==33)reject('unexpected stratum size');
 const seen=new Set();
 for(const [prefix,rows] of [['B',s0],['H',h]]){
  for(let i=0;i<rows.length;i++){
   const row=rows[i],id=prefix+String(i+1).padStart(3,'0');
   if(row.case_id!==id||seen.has(id))reject('case ID/order invalid: '+row.case_id);
   if(!row.text||row.text.includes('\0'))reject('empty/unusable text '+id);
   seen.add(id);
  }
 }
 if(new Set(origins.map(o=>o.case_id)).size!==h.length)reject('duplicate origin IDs');
 for(let i=0;i<h.length;i++){
  const o=origins[i];if(o.case_id!==h[i].case_id||!o.kind||!o.category||!o.source)reject('missing origin '+h[i].case_id);
  if(o.kind==='QUOTED_PUBLIC_REPO'){if(!/^[a-f0-9]{40}$/.test(o.source_blob_sha))reject('bad blob pin');}
  else if(o.kind!=='SYNTHETIC_AI_CONSTRUCTED'||o.source_blob_sha!=='')reject('unknown provenance');
 }
 const order=(manifest.s0_blind_source_order??'').split(',');
 if(order.length!==28||new Set(order).size!==28||order.some(x=>!/^S\d{2}$/.test(x)))reject('invalid S0 blind mapping');
 // Only structural lexical leakage checks, never call semantic engine.
 const norm=s=>s.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const dist=(a,b)=>{let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row[j]=Math.min(prev[j]+1,row[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=row;}return prev.at(-1);};
 for(const x of h)for(const y of s0){
  const a=Array.from(norm(x.text)),b=Array.from(norm(y.text));
  const sim=1-dist(a,b)/Math.max(a.length,b.length);
  if(sim>=0.88)reject('holdout near-duplicate of S0: '+x.case_id+' / '+y.case_id);
 }
 return {manifest,blind:s0,holdout:h,origins,ids:seen};
}
const fields=/^(subject|action|object|modality|negation|negation_scope|quantifier|quantifier_scope|condition|temporal|context|syntax|logic|ambiguity|coverage)(:[1-9]\d*)?$/;
export function validateAnnotations(raw,bundle){
 const rows=parseTsv(raw,headers.annotation),seen=new Set(),txt=new Set(),defs=[];
 if(rows.length===0)reject('empty submission is not human annotation');
 const source=new Map([...bundle.blind,...bundle.holdout].map(x=>[x.case_id,x.text]));
 for(const r of rows){
  if(!bundle.ids.has(r.case_id))reject('unknown case '+r.case_id);
  if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(r.annotator))reject('bad annotator pseudonym');
  if(!/^R[1-9]\d*$/.test(r.reading))reject('bad reading ID');
  if(!fields.test(r.field))reject('bad field '+r.field);
  if(!['TEXT','DEFINITIONS'].includes(r.stage))reject('bad stage');
  if(!(['TEXT'].includes(r.stage)?['PRESENT','ABSENT','UNCERTAIN']:['SUPPORTED','UNSUPPORTED','UNRESOLVED']).includes(r.judgement))reject('bad judgement');
  const k=[r.case_id,r.stage,r.annotator,r.reading,r.field].join('|');
  if(seen.has(k))reject('duplicate annotation row '+k);seen.add(k);
  if(r.stage==='TEXT'){
   txt.add([r.case_id,r.annotator,r.reading].join('|'));
   if(r.judgement==='PRESENT'&&!r.value.trim())reject('PRESENT needs value');
   if(r.evidence.includes('tpl.')||r.evidence.includes('lx.'))reject('definition IDs leaked into TEXT');
  }else{
   defs.push(r);
   if(r.field!=='coverage')reject('DEFINITIONS requires reading-level coverage only');
   if(r.judgement==='SUPPORTED'&&!r.evidence.trim())reject('SUPPORTED needs pack evidence');
  }
  const haveSpan=[r.surface,r.start_utf8,r.end_utf8].some(v=>v!=='');
  if(haveSpan){
   if(!r.surface||!/^(0|[1-9]\d*)$/.test(r.start_utf8)||!/^(0|[1-9]\d*)$/.test(r.end_utf8))reject('partial span');
   const b=Buffer.from(source.get(r.case_id),'utf8'),a=Number(r.start_utf8),z=Number(r.end_utf8);
   if(!Number.isSafeInteger(a)||!Number.isSafeInteger(z)||a>=z||z>b.length||!b.subarray(a,z).equals(Buffer.from(r.surface,'utf8')))reject('invalid UTF-8 span');
  }else if(r.start_utf8!==''||r.end_utf8!=='')reject('empty span must have empty offsets');
 }
 for(const r of defs)if(!txt.has([r.case_id,r.annotator,r.reading].join('|')))reject('DEFINITIONS reading without TEXT '+r.case_id);
 return {rows:rows.length,annotators:new Set(rows.map(r=>r.annotator)).size,stageText:rows.filter(r=>r.stage==='TEXT').length,stageDefinitions:defs.length};
}
function cli(){
 const args=process.argv.slice(2),bundle=validateSources();
 if(args.length===0||args[0]==='--check'){
  if(args.length>1)reject('unexpected arguments');
  console.log('W19-G0 FREEZE_VALID: B='+bundle.blind.length+' H='+bundle.holdout.length+' manifest='+bundle.manifest.holdout_sha256);
  console.log('W19-G0 HUMAN_GOLD=NOT_COLLECTED; SEMANTIC_ACCURACY=NOT_SCORED; G0-B=NOT_EXECUTED');return;
 }
 if(args.length===2&&args[0]==='--annotations'){
  const result=validateAnnotations(readFileSync(resolve(args[1]),'utf8'),bundle);
  console.log('W19-G0 FORMAT_VALIDATED_NOT_GOLD '+JSON.stringify(result));
  return;
 }
 reject('usage: node scripts/w19_g0_validate.mjs [--check|--annotations <tsv>]');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{cli();}catch(e){console.error(e.message);process.exitCode=1;}
}
