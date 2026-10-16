#!/usr/bin/env python3
"""W16 research-only deterministic corpus data pack, max archive budget, integrity restore.

Archive includes one XZ-compressed SQLite Link graph, document root IDs and SHA
proofs, plus provenance status. Does NOT claim installer.exe is already built.
Release distribution requires separate per-document rights evidence.
"""
import argparse,hashlib,json,lzma,os,sqlite3,sys,tempfile,zipfile
from pathlib import Path
MAGIC='mts-nl/w16-corpus-pack/v0'
MAX_ARCHIVE=100_000_000
DATE=(1980,1,1,0,0,0)

def sha256_path(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(2**20),b''):h.update(b)
 return h.hexdigest()

def report_docs(report):
 rows=report.get('perDocumentCumulative');checks=report.get('coldReadOnlyReplay');
 if not isinstance(rows,list) or not isinstance(checks,list) or len(rows)!=len(checks) or len(rows)<1:
  raise ValueError('missing pinned root and exact-source witness list')
 docs=[]
 for r,c in zip(rows,checks):
  if r['id']!=c['id']:raise ValueError('document index mismatch')
  docs.append({'id':r['id'],'root':int(r['cumulativePhysicalLinks']),'sourceBytes':c['bytes'],'sourceSHA256':c['sha256']})
 if len(set(d['id'] for d in docs))!=len(docs):raise ValueError('duplicate document IDs')
 return docs

def packed_zip_info(name):
 z=zipfile.ZipInfo(name,date_time=DATE);z.compress_type=zipfile.ZIP_STORED
 z.external_attr=0o644 <<16;z.create_system=3;return z

def build(sqlite_path,report_path,target,budget=MAX_ARCHIVE,reserve=10_000_000,rights_path=None):
 if budget>MAX_ARCHIVE or budget<=0 or reserve<0 or reserve>=budget:raise ValueError('invalid hard cap/reserve')
 target=Path(target);source=Path(sqlite_path)
 if target.exists():raise ValueError('archive exists; no overwrite')
 r=json.loads(Path(report_path).read_text('utf8'));docs=report_docs(r)
 if not source.is_file():raise ValueError('missing DB')
 conn=sqlite3.connect(f'file:{source.resolve()}?mode=ro',uri=True)
 try:
  n=conn.execute('SELECT count(*) FROM links').fetchone()[0]
  if n!=r['physicalLinkCount']:raise ValueError('reported Link count mismatch')
  if conn.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('broken source SQLite')
  for doc in docs:
   if not conn.execute('SELECT 1 FROM links WHERE link_id=?',(doc['root'],)).fetchone():
    raise ValueError('missing document root')
 finally:conn.close()
 rights={'releaseApproved':False,'status':'PENDING_PER_DOCUMENT_REVIEW','sourceClaim':'d0rj/RusLit: README asserts public domain, jurisdiction-specific review required'}
 if rights_path:
  rights=json.loads(Path(rights_path).read_text('utf8'))
  if rights.get('releaseApproved'):
   expected={d['id'] for d in docs};items=rights.get('documents',[])
   if {x.get('id') for x in items}!=expected or len(items)!=len(expected) or any(x.get('status')!='VERIFIED' or not x.get('evidenceUrl') or not x.get('attribution') for x in items):
    raise ValueError('release requires independent per-work rights verification')
 with tempfile.TemporaryDirectory(prefix='w16-') as folder:
  compressed=Path(folder)/'links.sqlite.xz'
  with source.open('rb') as f,lzma.open(compressed,'wb',format=lzma.FORMAT_XZ,preset=6) as g:
   for part in iter(lambda:f.read(2**20),b''):g.write(part)
  manifest={'schema':MAGIC,'codec':'xz-6','payload':'links.sqlite.xz',
   'payloadSHA256':sha256_path(compressed),'sqliteSHA256':sha256_path(source),
   'sqliteBytes':source.stat().st_size,'physicalLinks':n,'documents':docs,
   'sourceBytes':sum(x['sourceBytes'] for x in docs),'archiveBudgetBytes':budget,
   'reservedForInstallerBytes':reserve,'distribution':rights,
   'warning':'Data-only bundle. No executable/runtime included; reserved budget is not measured installed binary size.'}
  b=(json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode('utf8')
  with zipfile.ZipFile(target,'w',allowZip64=True) as z:
   z.writestr(packed_zip_info('manifest.json'),b)
   with z.open(packed_zip_info('links.sqlite.xz'),'w') as out,compressed.open('rb') as src:
    for chunk in iter(lambda:src.read(2**20),b''):out.write(chunk)
  if target.stat().st_size+reserve>budget:
   target.unlink();raise ValueError('installer archive+reserved bytes exceeds hard 100MB budget')
  return {'status':'PACKAGE_CREATED_RESEARCH_ONLY' if not rights.get('releaseApproved') else 'PACKAGE_CREATED_RIGHTS_REVIEWED',
   'archive':str(target),'archiveBytes':target.stat().st_size,'sqliteBytes':source.stat().st_size,
   'remainingWithinBudgetBytes':budget-target.stat().st_size-reserve,'reservedInstallerBytes':reserve,
   'archiveSHA256':sha256_path(target),'verifiedSources':len(docs),'manifest':manifest}

def verify(archive,restore_path,check_roots=True):
 dest=Path(restore_path)
 if dest.exists():raise ValueError('destination exists: refusing overwrite')
 with zipfile.ZipFile(archive) as z:
  if z.namelist()!=['manifest.json','links.sqlite.xz']:raise ValueError('unrecognized archive content')
  manifest=json.loads(z.read('manifest.json'))
  if manifest['schema']!=MAGIC or manifest['codec']!='xz-6':raise ValueError('unknown pack schema')
  digest=hashlib.sha256()
  with tempfile.NamedTemporaryFile(prefix='w16-restore-',suffix='.sqlite',dir=dest.parent,delete=False) as temp:
   tempname=Path(temp.name)
   try:
    with z.open('links.sqlite.xz') as packed:
     # Bounded streaming decompression: read at most 1 MiB at once.
     compressor=lzma.LZMADecompressor(format=lzma.FORMAT_XZ)
     source_digest=hashlib.sha256();compressed_digest=hashlib.sha256();total=0
     while block:=packed.read(2**20):
      compressed_digest.update(block)
      raw=compressor.decompress(block)
      total+=len(raw)
      if total>manifest['sqliteBytes']:raise ValueError('decompressed output too large')
      source_digest.update(raw);temp.write(raw)
     if not compressor.eof:raise ValueError('truncated XZ stream')
    if total!=manifest['sqliteBytes'] or source_digest.hexdigest()!=manifest['sqliteSHA256'] or compressed_digest.hexdigest()!=manifest['payloadSHA256']:
     raise ValueError('compressed or restored SHA/length mismatch')
    temp.flush();os.fsync(temp.fileno())
   except Exception:
    tempname.unlink(missing_ok=True);raise
 try:
  con=sqlite3.connect(f'file:{tempname.resolve()}?mode=ro',uri=True)
  try:
   if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('restore SQLite corruption')
   if con.execute('SELECT count(*) FROM links').fetchone()[0]!=manifest['physicalLinks']:raise ValueError('Link count mismatch')
   if check_roots:
    q=con.cursor();cache={}
    for doc in manifest['documents']:
     stack=[doc['root']];size=0;h=hashlib.sha256()
     while stack:
      ident=stack.pop();record=cache.get(ident)
      if record is None:
       record=q.execute('SELECT from_id,to_id,string FROM links WHERE link_id=?',(ident,)).fetchone()
       if record is None:raise ValueError('missing root subtree')
       if len(cache)<250000:cache[ident]=record
      left,right,txt=record
      if left is None:
       buf=txt.encode('utf8');size+=len(buf);h.update(buf)
       if size>doc['sourceBytes']:raise ValueError('root expansion overrun')
      else:stack.extend((right,left))
     if size!=doc['sourceBytes'] or h.hexdigest()!=doc['sourceSHA256']:
      raise ValueError('source document hash mismatch: '+doc['id'])
  finally:con.close()
  os.replace(tempname,dest)
  return {'status':'RESTORE_SHA_AND_ALL_ROOTS_PASS' if check_roots else 'RESTORE_SHA_AND_SQLITE_PASS',
   'sqliteBytes':dest.stat().st_size,'documents':len(manifest['documents']),
   'sqliteSHA256':sha256_path(dest)}
 except Exception:
  tempname.unlink(missing_ok=True);raise

def self_test():
 import random
 with tempfile.TemporaryDirectory() as d:
  p=Path(d);db=p/'a.sqlite';cn=sqlite3.connect(db)
  cn.execute('CREATE TABLE links(link_id INTEGER PRIMARY KEY,from_id INTEGER,to_id INTEGER,string TEXT)')
  cn.executemany('INSERT INTO links VALUES(?,?,?,?)',[(1,None,None,'м'),(2,None,None,'а'),(3,1,2,None),(4,3,3,None)])
  cn.commit();cn.close()
  ref={'physicalLinkCount':4,'perDocumentCumulative':[{'id':'a','cumulativePhysicalLinks':4}],
   'coldReadOnlyReplay':[{'id':'a','bytes':8,'sha256':hashlib.sha256('мама'.encode()).hexdigest()}]}
  (p/'report.json').write_text(json.dumps(ref))
  info=build(db,p/'report.json',p/'a.zip',budget=2000000,reserve=100000)
  info2=build(db,p/'report.json',p/'c.zip',budget=2000000,reserve=100000)
  assert info2['archiveSHA256']==info['archiveSHA256'],'nondeterministic ZIP bytes'
  recovered=verify(p/'a.zip',p/'restored.sqlite',check_roots=True)
  assert recovered['documents']==1 and recovered['sqliteSHA256']==sha256_path(db)
  # Every release declaration without per-work rights evidence must fail.
  (p/'rights.json').write_text('{"releaseApproved":true,"documents":[]}')
  try:build(db,p/'report.json',p/'b.zip',budget=2000000,reserve=100000,rights_path=p/'rights.json')
  except ValueError:pass
  else:raise AssertionError('unsourced distribution approval accepted')
  print('W16_BUNDLE_SELF_TEST_PASS',info['archiveBytes'])

def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--self-test',action='store_true');ap.add_argument('--verify');ap.add_argument('--restore');ap.add_argument('--sqlite');ap.add_argument('--report');ap.add_argument('--out');ap.add_argument('--budget',type=int,default=MAX_ARCHIVE);ap.add_argument('--reserve',type=int,default=10_000_000);ap.add_argument('--rights-manifest');ap.add_argument('--skip-root-replay',action='store_true')
 a=ap.parse_args()
 if a.self_test:self_test();return
 if a.verify:
  if not a.restore:ap.error('restore path required')
  result=verify(a.verify,a.restore,not a.skip_root_replay)
 else:
  if not (a.sqlite and a.report and a.out):ap.error('--sqlite --report --out required')
  result=build(a.sqlite,a.report,a.out,a.budget,a.reserve,a.rights_manifest)
 print(json.dumps({k:v for k,v in result.items() if k!='manifest'},indent=2,ensure_ascii=False))
if __name__=='__main__':main()