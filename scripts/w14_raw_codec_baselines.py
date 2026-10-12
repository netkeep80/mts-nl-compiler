#!/usr/bin/env python3
"""Source-bytes-only lossless compressor baselines on identical W10 corpus.
Full source is expanded from its already published exact physical Link roots.
No source books are redistributed; standard-library codecs only.
"""
import argparse,bz2,hashlib,json,lzma,sqlite3,time,zlib
from array import array
from pathlib import Path
from w14_wire_oracle import uvar_write,resolve_sources

def original_bytes_from_sqlite(data_dir,manifest):
    db=sqlite3.connect(f'file:{(Path(data_dir)/"knowledge-large.sqlite").resolve()}?mode=ro',uri=True)
    n=db.execute('SELECT count(*) FROM links').fetchone()[0]
    if not 0<n<=10_000_000:raise ValueError('node limit')
    left=array('I',[0])*(n+1);right=array('I',[0])*(n+1);atoms={}
    for physical,a,b,s in db.execute('SELECT link_id,from_id,to_id,string FROM links ORDER BY link_id'):
        if a is None:
            if b is not None or s is None:raise ValueError('invalid scalar atom')
            atoms[physical]=s
        else:
            if not (0<a<physical and 0<b<physical):raise ValueError('forward edge')
            left[physical]=a;right[physical]=b
    db.close()
    documents=[]
    for row in manifest:
        stack=[row['balanced_root']];parts=[]
        while stack:
            item=stack.pop()
            if left[item]:stack.append(right[item]);stack.append(left[item])
            else:parts.append(atoms[item])
        raw=''.join(parts).encode('utf8')
        if len(raw)!=row['expected_bytes'] or hashlib.sha256(raw).hexdigest()!=row['expected_sha256']:
            raise ValueError('source mismatch')
        documents.append(raw)
    return documents

def make_raw_wire(docs):
    # Metadata for independent reconstruction of all 60 exact documents.
    wire=bytearray(b'W14R0\0');uvar_write(wire,len(docs))
    for raw in docs:uvar_write(wire,len(raw))
    for raw in docs:wire.extend(raw)
    return bytes(wire)

def verify_raw_wire(wire,docs):
    from w14_wire_oracle import uvar_read
    assert wire.startswith(b'W14R0\0')
    at=6;n,at=uvar_read(wire,at)
    if n!=len(docs):raise ValueError('document count')
    lengths=[]
    for _ in range(n):
        z,at=uvar_read(wire,at);lengths.append(z)
    for source,size in zip(docs,lengths):
        if bytes(wire[at:at+size])!=source:raise ValueError('source changed')
        at+=size
    if at!=len(wire):raise ValueError('trailing data')

def compare(raw_wire,docs):
    compressors=[('zlib9',lambda b:zlib.compress(b,9),zlib.decompress),
                 ('bz2-9',lambda b:bz2.compress(b,9),bz2.decompress),
                 ('lzma-6',lambda b:lzma.compress(b,preset=6),lzma.decompress)]
    r={};verify_raw_wire(raw_wire,docs)
    for name,compress,decompress in compressors:
        t=time.monotonic();compressed=compress(raw_wire)
        if decompress(compressed)!=raw_wire:raise ValueError('compression corrupted data')
        verify_raw_wire(decompress(compressed),docs)
        r[name]={'bytes':len(compressed),'seconds':round(time.monotonic()-t,3)}
    return r

def self_test():
    documents=[b'\xef\xbb\xbfHello\r\n', 'лес|сад🚀'.encode('utf8'),b'']
    wire=make_raw_wire(documents)
    verify_raw_wire(wire,documents)
    result=compare(wire,documents)
    assert all(v['bytes']>0 for v in result.values())
    print('W14_RAW_CODEC_SELF_TEST_PASS')

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--data-dir');ap.add_argument('--output-json')
    ap.add_argument('--self-test',action='store_true');a=ap.parse_args()
    if a.self_test:self_test();return
    if not a.data_dir or not a.output_json:ap.error('--data-dir and --output-json required')
    docs=original_bytes_from_sqlite(a.data_dir,resolve_sources(a.data_dir))
    wire=make_raw_wire(docs)
    results=compare(wire,docs)
    report={'sourceBytes':sum(map(len,docs)),'rawWithDocumentFrameBytes':len(wire),
            'docs':len(docs),'results':results}
    Path(a.output_json).write_text(json.dumps(report,indent=2)+'\n')
    print('W14_RAW_SOURCE_BASELINES',json.dumps(report),flush=True)
if __name__=='__main__':main()