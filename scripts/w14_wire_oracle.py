#!/usr/bin/env python3
"""W14L1 deterministic reference bitstream for a topologically constructed binary Link DAG.

No SQLite physical IDs are transmitted. Every atomic Unicode scalar, every
binary ordered pair, every document byte/scalar length and root *rank* is paid
for in the wire. Both baseline and learned graph receive the identical codec.
Independent decoding needs only the resulting wire file, not the SQLite.
Metadata e.g. filenames is deliberately excluded from both equally.
"""
import argparse, hashlib, json, sqlite3, time
from array import array
from pathlib import Path

MAGIC=b'W14L1\0'
MAX_NODES=10_000_000
MAX_BYTES=100_000_000

def uvar_write(out,n):
    if n<0:raise ValueError('negative integer')
    while n>=128:
        out.append((n&127)|128);n >>= 7
    out.append(n)

def uvar_read(inp,index):
    start=index;val=0;shift=0
    while True:
        if index>=len(inp):raise ValueError('truncated varint')
        b=inp[index];index+=1
        if index-start>10:raise ValueError('varint overflow')
        val|=(b&127)<<shift
        if b<128:
            if index-start>1 and b==0:raise ValueError('noncanonical varint')
            return val,index
        shift+=7

def resolve_sources(base):
    base=Path(base)
    perf=json.loads((base/'large-corpus-performance.json').read_text('utf8'))
    learned=json.loads((base/'w13-portable-full.json').read_text('utf8'))
    if perf['books']!=60 or learned['books']!=60:raise ValueError('not pinned 60 books')
    output=[]
    for j,doc in enumerate(perf['perBook']):
        checksum=learned['coldReadOnlyReplay'][j]
        if checksum['id']!=doc['id'] or checksum['bytes']!=doc['sourceBytes']:
            raise ValueError('incompatible document ordering')
        output.append({'id':doc['id'],'expected_bytes':doc['sourceBytes'],
           'expected_scalars':doc['codepoints'],'expected_sha256':checksum['sha256'],
           'balanced_root':int(doc['rootLinkId']),
           'learned_root':int(learned['perDocumentCumulative'][j]['cumulativePhysicalLinks'])})
    return output

def encode(db_path, roots, wire_path):
    src=sqlite3.connect(f'file:{Path(db_path).resolve()}?mode=ro',uri=True)
    n,atoms=src.execute('SELECT count(*),sum(from_id IS NULL) FROM links').fetchone()
    if n<1 or n>MAX_NODES or atoms<1 or atoms>0x110001:raise ValueError('unreasonable database size')
    ids=array('I',[0])*(n+1)
    symbol_rows=list(src.execute('SELECT link_id,string FROM links WHERE from_id IS NULL ORDER BY link_id'))
    if len(symbol_rows)!=atoms:raise ValueError('atom census changed')
    wire=bytearray(MAGIC)
    uvar_write(wire,atoms)
    for rank,(physical,text) in enumerate(symbol_rows):
        cp=0x110000 if text=='' else ord(text) if len(text)==1 else None
        if cp is None or cp>0x110000 or 0xd800<=cp<=0xdfff:raise ValueError('invalid atom')
        uvar_write(wire,cp);ids[physical]=rank+1
    uvar_write(wire,n-atoms)
    rank=atoms
    for physical,left,right in src.execute('SELECT link_id,from_id,to_id FROM links WHERE from_id IS NOT NULL ORDER BY link_id'):
        if right is None or left is None or left>=physical or right>=physical:
            raise ValueError('DAG not insertion-ordered; topological sort required')
        l,r=ids[left],ids[right]
        if not l or not r or l>rank or r>rank:raise ValueError('broken DAG rank')
        uvar_write(wire,l-1);uvar_write(wire,r-1)
        rank+=1;ids[physical]=rank
    src.close()
    if rank!=n:raise ValueError('wrong DAG cardinality')
    uvar_write(wire,len(roots))
    for entry in roots:
        root=ids[entry['root']]
        if not root:raise ValueError('missing root')
        uvar_write(wire,root-1)
        uvar_write(wire,entry['expected_bytes'])
        uvar_write(wire,entry['expected_scalars'])
    Path(wire_path).write_bytes(wire)
    return {'nodes':n,'atoms':atoms,'pairs':n-atoms,'wireBytes':len(wire),
            'wireBits':len(wire)*8,'sha256':hashlib.sha256(wire).hexdigest()}

def encode_graph(graph,manifest,wire_path):
    """Emit exactly the same W14L1 bytes directly from an interned Link graph.
    Used for word oracle: no physically persisted but unaccounted SQLite rows.
    """
    n=graph.next;a=len(graph.atoms)
    if n<1 or n>MAX_NODES or a<1:raise ValueError('graph size')
    lookup=array('I',[0])*(n+1);wire=bytearray(MAGIC)
    uvar_write(wire,a)
    for rank,(symbol,physical) in enumerate(sorted(graph.atoms.items(),key=lambda x:x[1])):
        cp=0x110000 if symbol=='' else ord(symbol) if len(symbol)==1 else None
        if cp is None:raise ValueError('invalid scalar')
        uvar_write(wire,cp);lookup[physical]=rank+1
    uvar_write(wire,n-a)
    rank=a
    for (l,r),physical in sorted(graph.pairs.items(),key=lambda x:x[1]):
        ll,rr=lookup[l],lookup[r]
        if not ll or not rr or ll>rank or rr>rank:raise ValueError('non-topological graph')
        uvar_write(wire,ll-1);uvar_write(wire,rr-1)
        rank+=1;lookup[physical]=rank
    if rank!=n:raise ValueError('missing graph records')
    uvar_write(wire,len(manifest))
    for entry in manifest:
        root=lookup[entry['root']]
        if not root:raise ValueError('missing root')
        uvar_write(wire,root-1);uvar_write(wire,entry['expected_bytes']);uvar_write(wire,entry['expected_scalars'])
    Path(wire_path).write_bytes(wire)
    return {'nodes':n,'atoms':a,'pairs':n-a,'wireBytes':len(wire),'wireBits':8*len(wire),
      'sha256':hashlib.sha256(wire).hexdigest()}

def decode_cold(wire_path,expected=None):
    wire=Path(wire_path).read_bytes()
    if len(wire)<len(MAGIC) or not wire.startswith(MAGIC):raise ValueError('magic')
    at=len(MAGIC)
    a,at=uvar_read(wire,at)
    if a<1 or a>0x110001:raise ValueError('invalid alphabet size')
    scalars=array('I')
    for _ in range(a):
        cp,at=uvar_read(wire,at)
        if cp>0x110000 or 0xd800<=cp<=0xdfff:raise ValueError('invalid scalar')
        scalars.append(cp)
    k,at=uvar_read(wire,at)
    if a+k>MAX_NODES:raise ValueError('node budget exceeded')
    lefts=array('I');rights=array('I')
    for j in range(k):
        l,at=uvar_read(wire,at);r,at=uvar_read(wire,at)
        if l>=a+j or r>=a+j:raise ValueError('forward rule')
        lefts.append(l);rights.append(r)
    d,at=uvar_read(wire,at)
    if d>1000:raise ValueError('doc count')
    restored=[]
    for j in range(d):
        root,at=uvar_read(wire,at)
        want_bytes,at=uvar_read(wire,at)
        want_chars,at=uvar_read(wire,at)
        if root>=a+k or want_bytes>MAX_BYTES or want_chars>MAX_BYTES:raise ValueError('document budget')
        pending=[root];buf=bytearray();characters=0
        while pending:
            item=pending.pop()
            if item<a:
                cp=scalars[item]
                if cp==0x110000:continue
                buf.extend(chr(cp).encode('utf8'))
                characters+=1
                if len(buf)>want_bytes or characters>want_chars:raise ValueError('expanded document oversized')
            else:
                idx=item-a
                pending.append(rights[idx]);pending.append(lefts[idx])
        if len(buf)!=want_bytes or characters!=want_chars:raise ValueError('decoded length mismatch')
        digest=hashlib.sha256(buf).hexdigest()
        if expected:
            item=expected[j]
            if digest!=item['expected_sha256'] or len(buf)!=item['expected_bytes']:
                raise ValueError('independent SHA-256 mismatch for document '+str(j))
        restored.append({'sha256':digest,'bytes':len(buf),'scalars':characters})
    if at!=len(wire):raise ValueError('trailing extra bytes')
    return {'documents':len(restored),'totalSourceBytes':sum(x['bytes'] for x in restored),
        'totalScalars':sum(x['scalars'] for x in restored),'verified':True,
        'docs':restored}

def self_test():
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        x=Path(td);db=x/'test.sqlite'
        con=sqlite3.connect(db)
        con.execute('CREATE TABLE links(link_id INTEGER PRIMARY KEY,from_id INTEGER,to_id INTEGER,string TEXT)')
        con.executemany('INSERT INTO links VALUES(?,?,?,?)',[(1,None,None,'м'),(2,None,None,'а'),(3,1,2,None),(4,3,3,None)])
        con.commit();con.close()
        source='мама'.encode();e=[{'root':4,'expected_bytes':len(source),'expected_scalars':4,
             'expected_sha256':hashlib.sha256(source).hexdigest()}]
        meta=encode(db,e,x/'ok.w14');out=decode_cold(x/'ok.w14',e)
        assert out['documents']==1 and out['totalSourceBytes']==len(source)
        damaged=bytearray((x/'ok.w14').read_bytes());damaged[-1]=100
        (x/'bad.w14').write_bytes(damaged)
        try:decode_cold(x/'bad.w14',e)
        except ValueError:pass
        else:raise AssertionError('tampering not rejected')
    print('W14_WIRE_SELF_TEST_PASS',meta['wireBytes'])

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir')
    parser.add_argument('--output-dir')
    parser.add_argument('--self-test',action='store_true')
    parser.add_argument('--mode',choices=['balanced','learned','both'],default='both')
    args=parser.parse_args()
    if args.self_test:self_test();return
    if not args.data_dir or not args.output_dir:parser.error('--data-dir and --output-dir required')
    docs=resolve_sources(args.data_dir)
    output=Path(args.output_dir);output.mkdir(exist_ok=True,parents=True)
    data={};t=time.monotonic()
    for method in ['balanced','learned']:
        if args.mode not in ['both',method]:continue
        db=Path(args.data_dir)/('knowledge-large.sqlite' if method=='balanced' else 'w13-portable-full.sqlite')
        manifest=[{'root':row[method+'_root'],**row} for row in docs]
        wire=output/(method+'.w14l1')
        meta=encode(db,manifest,wire)
        cold=decode_cold(wire,manifest)
        data[method]={**meta,'replay':{k:v for k,v in cold.items() if k!='docs'}}
        print('W14_VERIFIED',method,json.dumps(data[method]),flush=True)
    if len(data)==2:
        a=data['balanced']['wireBytes'];b=data['learned']['wireBytes']
        data['comparison']={'deltaWireBytes':b-a,'relativePct':round(100*(b/a-1),5),
            'sourceBytes':sum(x['expected_bytes'] for x in docs),
            'losslessCompressionRatioBalanced':round(sum(x['expected_bytes'] for x in docs)/a,5),
            'losslessCompressionRatioLearned':round(sum(x['expected_bytes'] for x in docs)/b,5)}
    data['elapsedSeconds']=round(time.monotonic()-t,2)
    (output/'w14_wire_comparison.json').write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
    print('W14_COMPLETE',json.dumps({k:v for k,v in data.items() if k not in ('balanced','learned')}),flush=True)
if __name__=='__main__':main()