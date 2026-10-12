#!/usr/bin/env python3
"""W17R1: exact archive-only latency/RSS experiment; no SQLite or source text files.

Use the published W17 research-only archive as --archive. No online access.
"""
import argparse
import hashlib
import json
import resource
import time
from w17_indexed_link_runtime import IndexedAseti


def benchmark(archive):
    start = time.monotonic()
    g = IndexedAseti.from_archive(archive, verify_documents=True)
    load_seconds = time.monotonic() - start
    sample_indices = sorted(set([0,7,19,44,len(g.roots)-1]))
    for doc in sample_indices:
        text = g.document_slice(doc)
        assert hashlib.sha256(text.encode('utf8')).hexdigest() == g.documents[doc]['sha256']
        for begin in [0,1,max(0,len(text)//2-37),max(0,len(text)-53)]:
            assert g.document_slice(doc, begin, min(len(text), begin+53)) == text[begin:begin+53]
        for pattern in [' что ', 'мама', '\n', ' и ', 'ѣ']:
            hits = g.document_find(doc, pattern, max_hits=128)
            expected=[];i=0
            while len(expected)<128:
                i=text.find(pattern,i)
                if i<0:break
                expected.append(i);i+=1
            assert hits==expected, (doc, pattern)
    x = g.document_slice(0,120,140)
    assert g.document_find(0,x,max_hits=1) == [120]
    start=time.monotonic()
    for _ in range(1000):
        assert g.document_slice(0,120,140) == x
    slices=time.monotonic()-start
    start=time.monotonic()
    for _ in range(20):
        g.document_find(0,' что ',max_hits=100)
    finds=time.monotonic()-start
    return {'schema':'mts-nl/W17R1/indexed-runtime-benchmark/v0',
        'status':'ARCHIVE_ONLY_60_EXACT_DOCUMENT_SHA_PASS',
        'sqliteOpened':False,'readOnly':True,
        'nodeCount':g.node_count,'atomCount':g.atom_count,
        'bookCount':len(g.roots),'fullShaVerifiedBooks':len(g.roots),
        'searchCrossesDupletBoundaries':True,'probeDocumentIndices':sample_indices,
        'loadAndShaVerifySeconds':round(load_seconds,3),
        '1000RangeSlicesSeconds':round(slices,3),
        '20FullDocumentFindSeconds':round(finds,3),
        'maxRssKb':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'sourceScalars':sum(s for _,s in g.lengths),
        'notes':['Time/RSS from one laboratory Linux environment, not Windows',
                 'Full Sha verification is an opt-in load option',
                 'Runtime is O(graph links) RAM; gigabyte packages need paged/chunked implementation']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',required=True)
    parser.add_argument('--output')
    args=parser.parse_args()
    result=benchmark(args.archive)
    payload=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if args.output:
        from pathlib import Path
        Path(args.output).write_text(payload,encoding='utf8')
    print(payload)