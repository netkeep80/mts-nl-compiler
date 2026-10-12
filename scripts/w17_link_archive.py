#!/usr/bin/env python3
"""W17: canonical INSTALL-DATA archive = W15 serialized Link DAG + XZ + metadata.

SQLite is deliberately neither input nor mandatory output of this format.
Research distributions are NOT legally cleared for public release.
"""
import argparse
import hashlib
import io
import json
import lzma
import os
from pathlib import Path
import tempfile
import zipfile

from w15_fixed_pair_codec import decode_cold

SCHEMA='mts-nl/archived-link-aseti/v1'
LIMIT=100_000_000
MAX_WIRE=64_000_000
DATE=(1980,1,1,0,0,0)
MEMBERS=('manifest.json','links.w15f1.xz')

def digest(data):return hashlib.sha256(data).hexdigest()

def info(name):
    i=zipfile.ZipInfo(name,date_time=DATE)
    i.create_system=3
    i.external_attr=0o644 <<16
    i.compress_type=zipfile.ZIP_STORED
    return i

def pinned_docs(witness):
    if witness is None:return None
    content=json.loads(Path(witness).read_text(encoding='utf8'))
    docs=content.get('coldReadOnlyReplay')
    if not isinstance(docs,list) or not docs:raise ValueError('missing pinned source document digests')
    return docs

def check_replay(decoded,expected):
    docs=decoded['replay']
    if expected is not None:
        if len(expected)!=len(docs):raise ValueError('pinned source document count differs')
        for i,(old,new) in enumerate(zip(expected,docs)):
            if old.get('sha256')!=new['sha256'] or old.get('bytes')!=new['bytes']:
                raise ValueError('document does not match independent pinned sha, index '+str(i))
    return [dict(index=i,id=(expected[i]['id'] if expected else 'document-%03d'%i),
        sha256=d['sha256'],bytes=d['bytes'],scalars=d['scalars']) for i,d in enumerate(docs)]

def build(wire_path,target,*,witness=None,budget=LIMIT,reserve=10_000_000):
    """Package only the exact independent W15F1 Link grammar; never a SQLite DB."""
    wire_path=Path(wire_path);target=Path(target)
    if target.exists():raise ValueError('refusing to overwrite archive')
    if not 0<reserve<budget<=LIMIT:raise ValueError('bad 100MB budget/reserve')
    if wire_path.stat().st_size>MAX_WIRE:raise ValueError('oversized graph')
    plain=wire_path.read_bytes();expected=pinned_docs(witness)
    decoded=decode_cold(plain,source_sha=([x['sha256'] for x in expected] if expected else None))
    if decoded['variant']!='progressive':raise ValueError('canonical archive requires W15 progressive mode')
    documents=check_replay(decoded,expected)
    if len(documents)>1000:raise ValueError('too many source books')
    compressed=lzma.compress(plain,format=lzma.FORMAT_XZ,preset=6)
    manifest={
        'schema':SCHEMA,'payload':'links.w15f1.xz','serialization':'W15F1-progressive',
        'archiveCodec':'xz-6','payloadBytes':len(compressed),'payloadSha256':digest(compressed),
        'wireBytes':len(plain),'wireSha256':digest(plain),
        'nodeCount':decoded['nodeCount'],'atomEncoding':'Unicode scalar atoms in W15F1',
        'documentCount':len(documents),'documents':documents,
        'sourceBytes':sum(d['bytes'] for d in documents),
        'archiveBudgetBytes':budget,'runtimeReserveBytes':reserve,
        'releaseApproved':False,'distribution':'RESEARCH_ONLY_UNTIL_PER_WORK_LICENSE_CLEARANCE',
        'runtime':'Decode W15F1 directly, or optionally derive an SQLite cache after decoding',
        'doesNotContain':['SQLite DB','plaintext source books','compiler executable']
    }
    manifest_bytes=(json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
    with zipfile.ZipFile(target,'w',allowZip64=True) as z:
        z.writestr(info(MEMBERS[0]),manifest_bytes)
        z.writestr(info(MEMBERS[1]),compressed)
    size=target.stat().st_size
    if size+reserve>budget:
        target.unlink();raise ValueError('installer + archive exceeds 100MB ceiling')
    return {'status':'RESEARCH_ARCHIVED_ASETI_BUILT','archiveBytes':size,
      'headroomBytes':budget-reserve-size,'wireBytes':len(plain),'sourceDocuments':len(documents),
      'originalSourceBytes':manifest['sourceBytes'],'sha256':digest(target.read_bytes())}

def verify(archive,restore_wire=None):
    """Strict cold decode from only ZIP payload, without SQLite or text sources."""
    archive=Path(archive);dest=Path(restore_wire) if restore_wire else None
    if dest and dest.exists():raise ValueError('refusing to overwrite restored wire')
    with zipfile.ZipFile(archive,'r') as z:
        if z.namelist()!=list(MEMBERS):raise ValueError('unexpected archive members')
        meta=json.loads(z.read(MEMBERS[0]))
        if meta.get('schema')!=SCHEMA or meta.get('payload')!=MEMBERS[1] or meta.get('serialization')!='W15F1-progressive':
            raise ValueError('invalid package identity')
        cap=meta.get('wireBytes')
        if not isinstance(cap,int) or not 0<cap<=MAX_WIRE:raise ValueError('decompressed size over budget')
        if z.getinfo(MEMBERS[1]).file_size > MAX_WIRE * 2:
            raise ValueError('compressed payload over resource limit')
        compressed=z.read(MEMBERS[1])
        if len(compressed)!=meta['payloadBytes'] or digest(compressed)!=meta['payloadSha256']:
            raise ValueError('wrong compressed payload SHA')
        decomp=lzma.LZMADecompressor(format=lzma.FORMAT_XZ)
        plain=decomp.decompress(compressed,max_length=cap+1)
        if len(plain)!=cap or not decomp.eof or decomp.unused_data or digest(plain)!=meta['wireSha256']:
            raise ValueError('XZ truncated/overrun/wire SHA mismatch')
    decoded=decode_cold(plain,source_sha=[x['sha256'] for x in meta['documents']])
    documents=check_replay(decoded,meta['documents'])
    if decoded['variant']!='progressive' or decoded['nodeCount']!=meta['nodeCount']:
        raise ValueError('Link graph structural mismatch')
    if len(documents)!=meta['documentCount'] or sum(d['bytes'] for d in documents)!=meta['sourceBytes']:
        raise ValueError('source lengths mismatch')
    if dest:
        dest.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=dest.parent,delete=False) as tmp:
            name=tmp.name
            try:
                tmp.write(plain);tmp.flush();os.fsync(tmp.fileno())
            except Exception:
                Path(name).unlink(missing_ok=True);raise
        os.replace(name,dest)
    return {'status':'COLD_LINK_ONLY_60_DOCUMENT_REPLAY_PASS' if len(documents)==60 else 'COLD_LINK_ONLY_REPLAY_PASS',
      'sourceDocuments':len(documents),'sourceBytes':meta['sourceBytes'],
      'nodeCount':decoded['nodeCount'],'wireBytes':len(plain),
      'archiveBytes':archive.stat().st_size,'wireSHA256':digest(plain),
      'sqliteRequired':False,'restoredWire':str(dest) if dest else None}

def self_test():
    from array import array
    from w15_fixed_pair_codec import encode
    with tempfile.TemporaryDirectory(prefix='w17-') as td:
        p=Path(td);wire=p/'x.w15f1'
        wire.write_bytes(encode([ord('м'),ord('а')],2,array('I',[0,1,2,2]),[3],[(8,4)],'progressive'))
        a=p/'a.zip';b=p/'b.zip'
        x=build(wire,a,budget=1_000_000,reserve=100_000)
        y=build(wire,b,budget=1_000_000,reserve=100_000)
        assert x['sha256']==y['sha256'],'non-deterministic archive'
        v=verify(a,p/'restored.w15f1')
        assert v['sourceBytes']==8 and (p/'restored.w15f1').read_bytes()==wire.read_bytes()
        with zipfile.ZipFile(a) as z:
            assert all('sqlite' not in name for name in z.namelist())
        wire.write_bytes(b'invalid')
        try:build(wire,p/'invalid.zip',budget=1_000_000,reserve=100_000)
        except ValueError:pass
        else:raise AssertionError('invalid Link wire allowed')
    print('W17_ARCHIVED_ASETI_SELF_TEST_PASS')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--wire');p.add_argument('--output');p.add_argument('--witness')
    p.add_argument('--verify');p.add_argument('--restore-wire')
    p.add_argument('--budget',type=int,default=LIMIT)
    p.add_argument('--reserve',type=int,default=10_000_000)
    a=p.parse_args()
    if a.self_test:self_test();return
    if a.verify:result=verify(a.verify,a.restore_wire)
    elif a.wire and a.output:result=build(a.wire,a.output,witness=a.witness,budget=a.budget,reserve=a.reserve)
    else:p.error('supply --wire + --output or --verify')
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()