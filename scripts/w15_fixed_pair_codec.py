#!/usr/bin/env python3
"""W15F1: minimal fixed-bit, packed 24-bit, and uint32-aligned binary Link DAG wire.
Source: existing self-contained W14L1 streams. No hidden SQLite/file names.
Three variants use identical atoms/roots/source lengths and *independent* cold decode.
"""
import argparse, hashlib, json, math, struct, sys, time, zlib, bz2, lzma
from array import array
from pathlib import Path

MAGIC=b'W15F1\0';SOURCE_MAGIC=b'W14L1\0'
MODES={'dense':0,'packed24':1,'aligned32':2,'progressive':3}
LIMIT_N=10_000_000

def wu(out,n):
    if n<0:raise ValueError('negative integer')
    while n>=128:out.append((n&127)|128);n>>=7
    out.append(n)
def ru(src,pos):
    value=0;shift=0;start=pos
    while True:
        if pos>=len(src):raise ValueError('truncated uvar')
        c=src[pos];pos+=1
        if pos-start>10:raise ValueError('uvar too large')
        value|=(c&127)<<shift
        if c<128:
            if pos-start>1 and c==0:raise ValueError('noncanonical uvar')
            return value,pos
        shift+=7

def read_w14(path):
    b=Path(path).read_bytes();pos=len(SOURCE_MAGIC)
    if not b.startswith(SOURCE_MAGIC):raise ValueError('not W14L1')
    a,pos=ru(b,pos)
    if a>0x110001:raise ValueError('invalid atom count')
    atoms=[]
    for _ in range(a):
        cp,pos=ru(b,pos);atoms.append(cp)
    k,pos=ru(b,pos)
    if a+k>LIMIT_N:raise ValueError('oversized graph')
    pairs=array('I')
    for j in range(k):
        x,pos=ru(b,pos);y,pos=ru(b,pos)
        if x>=a+j or y>=a+j:raise ValueError('non-topological input')
        pairs.extend((x,y))
    d,pos=ru(b,pos);roots=[];lengths=[]
    for _ in range(d):
        r,pos=ru(b,pos);bl,pos=ru(b,pos);sc,pos=ru(b,pos)
        if r>=a+k:raise ValueError('root range')
        roots.append(r);lengths.append((bl,sc))
    if pos!=len(b):raise ValueError('trailing W14 data')
    return atoms,k,pairs,roots,lengths

class DenseWriter:
    __slots__=('out','acc','bits','width')
    def __init__(self,out,width):self.out=out;self.acc=0;self.bits=0;self.width=width
    def write(self,v):
        if v<0 or v>=(1<<self.width):raise ValueError('out-of-range ref')
        self.acc=(self.acc<<self.width)|v;self.bits+=self.width
        while self.bits>=8:
            self.bits-=8;self.out.append((self.acc>>self.bits)&255)
            self.acc&=(1<<self.bits)-1
    def finish(self):
        if self.bits:self.out.append(self.acc<<(8-self.bits))
        self.bits=self.acc=0

class DenseReader:
    __slots__=('src','pos','acc','bits','width')
    def __init__(self,src,pos,width):self.src=src;self.pos=pos;self.acc=0;self.bits=0;self.width=width
    def read(self):
        while self.bits<self.width:
            if self.pos>=len(self.src):raise ValueError('truncated packed field')
            self.acc=(self.acc<<8)|self.src[self.pos];self.pos+=1;self.bits+=8
        self.bits-=self.width
        v=self.acc>>self.bits;self.acc&=(1<<self.bits)-1
        return v
    def finish(self):
        if self.acc:raise ValueError('non-zero padding')
        self.acc=self.bits=0
        return self.pos

def width_for(n,mode):
    w=max(1,(n-1).bit_length())
    if mode=='packed24':
        if n>1<<24:raise ValueError('24-bit field overflow')
        return 24
    if mode=='aligned32':
        if n>1<<32:raise ValueError('32-bit field overflow')
        return 32
    return w

def write_fixed(out,v,mode):
    if mode=='packed24':
        if v<0 or v>=1<<24:raise ValueError('24-bit overflow')
        out.extend((v&255,(v>>8)&255,(v>>16)&255))
    elif mode=='aligned32':
        if v<0 or v>=1<<32:raise ValueError('32-bit overflow')
        out.extend(struct.pack('<I',v))
    else:raise ValueError('bad mode')

def read_fixed(b,pos,mode):
    if mode=='packed24':
        if pos+3>len(b):raise ValueError('truncated index')
        return b[pos]|(b[pos+1]<<8)|(b[pos+2]<<16),pos+3
    if mode=='aligned32':
        if pos+4>len(b):raise ValueError('truncated uint32')
        return struct.unpack_from('<I',b,pos)[0],pos+4
    raise ValueError('bad mode')

def encode(atoms,k,pairs,roots,lengths,mode):
    if mode not in MODES:raise ValueError('unknown mode')
    n=len(atoms)+k
    if len(pairs)!=2*k or len(roots)!=len(lengths):raise ValueError('inconsistent source')
    w=width_for(n,mode)
    out=bytearray(MAGIC);out.append(MODES[mode]);wu(out,len(atoms))
    for cp in atoms:wu(out,cp)
    wu(out,k);wu(out,len(roots))
    if mode in ('dense','progressive'):
        writer=DenseWriter(out,w)
        if mode=='dense':
            for v in pairs:writer.write(v)
        else:
            for j in range(k):
                writer.width=max(1,(len(atoms)+j-1).bit_length())
                writer.write(pairs[2*j]);writer.write(pairs[2*j+1])
        writer.finish()
        writer=DenseWriter(out,w)
        for v in roots:writer.write(v)
        writer.finish()
    else:
        for v in pairs:write_fixed(out,v,mode)
        for v in roots:write_fixed(out,v,mode)
    for bl,sc in lengths:wu(out,bl);wu(out,sc)
    return bytes(out)

def decode_cold(wire,source_sha=None,emit_documents=False):
    if not isinstance(wire,(bytes,bytearray)) or not wire.startswith(MAGIC):raise ValueError('bad magic')
    pos=len(MAGIC);variant=wire[pos];pos+=1
    if variant not in MODES.values():raise ValueError('variant code')
    mode=next(k for k,v in MODES.items() if v==variant)
    a,pos=ru(wire,pos);atoms=array('I')
    if a>0x110001:raise ValueError('atom budget')
    for _ in range(a):
        cp,pos=ru(wire,pos)
        if cp>0x110000 or 0xd800<=cp<=0xdfff:raise ValueError('bad Unicode atom')
        atoms.append(cp)
    k,pos=ru(wire,pos);n=a+k
    if n>LIMIT_N:raise ValueError('node limit')
    d,pos=ru(wire,pos)
    if d>1000:raise ValueError('document limit')
    w=width_for(n,mode)
    left=array('I');right=array('I')
    if mode in ('dense','progressive'):
        reader=DenseReader(wire,pos,w)
        for i in range(k):
            if mode=='progressive':reader.width=max(1,(a+i-1).bit_length())
            x=reader.read();y=reader.read()
            if x>=a+i or y>=a+i:raise ValueError('forward DAG reference')
            left.append(x);right.append(y)
        pos=reader.finish();reader=DenseReader(wire,pos,w)
        roots=[reader.read() for _ in range(d)];pos=reader.finish()
    else:
        for i in range(k):
            x,pos=read_fixed(wire,pos,mode);y,pos=read_fixed(wire,pos,mode)
            if x>=a+i or y>=a+i:raise ValueError('forward DAG reference')
            left.append(x);right.append(y)
        roots=[]
        for _ in range(d):
            x,pos=read_fixed(wire,pos,mode);roots.append(x)
    lengths=[]
    for _ in range(d):
        bl,pos=ru(wire,pos);sc,pos=ru(wire,pos)
        if bl>100_000_000 or sc>100_000_000:raise ValueError('resource limit')
        lengths.append((bl,sc))
    if pos!=len(wire):raise ValueError('trailing bytes')
    results=[];documents=[]
    for i,(root,(bl,sc)) in enumerate(zip(roots,lengths)):
        if root>=n:raise ValueError('invalid root')
        todo=[root];data=bytearray();scalars=0
        while todo:
            u=todo.pop()
            if u<a:
                cp=atoms[u]
                if cp!=0x110000:
                    data.extend(chr(cp).encode('utf8'));scalars+=1
                    if len(data)>bl or scalars>sc:raise ValueError('overlong document')
            else:
                u-=a;todo.append(right[u]);todo.append(left[u])
        if len(data)!=bl or scalars!=sc:raise ValueError('source lengths mismatch')
        digest=hashlib.sha256(data).hexdigest()
        if source_sha is not None and digest!=source_sha[i]:raise ValueError('source content changed')
        results.append({'bytes':bl,'scalars':sc,'sha256':digest})
        if emit_documents:documents.append(bytes(data))
    return {'variant':mode,'indexBits':w,'nodeCount':n,'documents':d,'replay':results,'output':documents}

def selftest():
    atoms=[ord('м'),ord('а')];pairs=array('I',[0,1,2,2]);roots=[3];lengths=[(8,4)]
    for mode in MODES:
        encoded=encode(atoms,2,pairs,roots,lengths,mode)
        output=decode_cold(encoded,emit_documents=True)
        assert output['output']==['мама'.encode('utf8')],mode
        try:decode_cold(encoded[:-1])
        except ValueError:pass
        else:raise AssertionError('truncated bitstream accepted')
        if mode in ('dense','progressive'):
            invalid=bytearray(encoded)
            # A two-bit root consumes only the two high bits of its byte.
            # Low bits are *padding* and must be canonical zeroes.
            invalid[-3]|=1
            try:decode_cold(invalid)
            except ValueError:pass
            else:raise AssertionError('nonzero bit padding accepted')
        print('W15_TEST',mode,'bits/field',output['indexBits'],'wire',len(encoded))
    # Check exactly 24-bit overflow and 32-bit alignment, no compiler-dependent padding.
    assert len(encode(atoms,2,pairs,roots,lengths,'packed24'))+5==len(encode(atoms,2,pairs,roots,lengths,'aligned32'))
    # Source-level layout verification: custom uint8_t[3] pair has align=1,
    # two native uint32_t fields have struct alignment 4 and stride 8.
    import ctypes
    class P24(ctypes.Structure):
        _fields_=[('from_index',ctypes.c_ubyte*3),('to_index',ctypes.c_ubyte*3)]
    class Aligned32(ctypes.Structure):
        _fields_=[('from_index',ctypes.c_uint32),('to_index',ctypes.c_uint32)]
    assert (ctypes.sizeof(P24),ctypes.alignment(P24))==(6,1)
    assert (ctypes.sizeof(Aligned32),ctypes.alignment(Aligned32))==(8,4)
    assert width_for((1<<21),'dense')==21 and width_for((1<<21)+1,'dense')==22
    try:width_for((1<<24)+1,'packed24')
    except ValueError:pass
    else:raise AssertionError('24-bit index width overflow must fail')
    # Encoding exact pair structs does not silently add per-row padding.
    print('W15_ALIGN_STRUCT', 'uint24_array=6/align1', 'uint32_pair=8/align4')
    print('W15_SELF_TEST_PASS')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--source-dir');p.add_argument('--output-dir');p.add_argument('--self-test',action='store_true')
    p.add_argument('--label',choices=['balanced','word-aligned','learned']);p.add_argument('--mode',choices=list(MODES))
    p.add_argument('--expected-manifest',help='external W13 full-corpus replay JSON; compare SHA of every document')
    a=p.parse_args()
    if a.self_test:selftest();return
    if not a.source_dir or not a.output_dir:p.error('source-dir and output-dir required')
    src=Path(a.source_dir);dest=Path(a.output_dir);dest.mkdir(parents=True,exist_ok=True)
    report={'format':'W15F1','variants':{},'sources':{}}
    if a.expected_manifest:
        v=json.loads(Path(a.expected_manifest).read_text('utf8'))
        expected_sha=[item['sha256'] for item in v['coldReadOnlyReplay']]
        if len(expected_sha)!=60:raise ValueError('external source hashes not pinned 60')
        report['externalSourceHashesChecked']=60
    else:expected_sha=None
    for label in ([a.label] if a.label else ['balanced','word-aligned','learned']):
        source=src/(label+'.w14l1');t=time.monotonic()
        atoms,k,pairs,roots,lengths=read_w14(source)
        previous=hashlib.sha256(source.read_bytes()).hexdigest()
        if len(roots)!=60:raise ValueError('pinned source must have 60 documents')
        first=None;record={'nodes':len(atoms)+k,'atoms':len(atoms),'pairs':k,'w14Bytes':source.stat().st_size,'w14Sha256':previous,'variants':{}}
        for mode in ([a.mode] if a.mode else MODES):
            packed=encode(atoms,k,pairs,roots,lengths,mode)
            outfile=dest/f'{label}.{mode}.w15f1'
            outfile.write_bytes(packed)
            verified=decode_cold(packed,source_sha=expected_sha or first)
            first=[x['sha256'] for x in verified['replay']]
            if sum(z['bytes'] for z in verified['replay'])!=19_701_816:raise ValueError('source mismatch')
            record['variants'][mode]={
               'bitsPerIndex':verified['indexBits'],'bytesPerPair':verified['indexBits']/4,
               'pairBlockBytes':(
                  (sum(2*max(1,(len(atoms)+j-1).bit_length()) for j in range(k))+7)//8 if mode=='progressive'
                  else ((k*2*verified['indexBits']+7)//8 if mode=='dense' else 2*k*(verified['indexBits']//8))),
               'wireBytes':len(packed),'wireBits':len(packed)*8,
               'sha256':hashlib.sha256(packed).hexdigest(),
               'zlib9Bytes':len(zlib.compress(packed,9))}
        record['seconds']=round(time.monotonic()-t,2)
        report['sources'][label]=record
        print('W15_SOURCE',label,record,flush=True)
    report['sameExactSourceReplay']=True
    (dest/'w15_fixed_pair_comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':main()