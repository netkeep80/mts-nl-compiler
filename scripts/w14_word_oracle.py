#!/usr/bin/env python3
"""Word/separator ORACLE for benchmarking ONLY, not for blind training.
Reproduces the published W10 word-aligned exact Unicode L/M/N segmentation.
Uses only Python stdlib and the already published W10 physical source roots.
"""
import argparse,hashlib,json,sqlite3,time,unicodedata
from pathlib import Path
from w14_wire_oracle import resolve_sources,encode_graph,decode_cold

class InternedGraph:
    def __init__(self):self.atoms={};self.pairs={};self.roots=[];self.next=0
    def atom(self,scalar):
        if scalar not in self.atoms:
            self.next+=1;self.atoms[scalar]=self.next
        return self.atoms[scalar]
    def pair(self,left,right):
        key=(left,right)
        if key not in self.pairs:
            self.next+=1;self.pairs[key]=self.next
        return self.pairs[key]
    def balanced(self,children):
        def f(a,b):
            if a==b:return self.atom('')
            if a+1==b:return children[a]
            mid=a+(b-a)//2
            return self.pair(f(a,mid),f(mid,b))
        return f(0,len(children))
    def literal(self,chars):return self.balanced([self.atom(c) for c in chars])

def is_lmn(ch):return unicodedata.category(ch)[0] in ('L','M','N')

def oracle_segments(text):
    if not text:return []
    start=0;kind=is_lmn(text[0]);result=[]
    for i in range(1,len(text)):
        nxt=is_lmn(text[i])
        if nxt!=kind:
            result.append((text[start:i],kind));start=i;kind=nxt
    result.append((text[start:],kind))
    return result

def make_oracle_graph(documents):
    g=InternedGraph()
    for doc in documents:
        chunks=oracle_segments(doc['source'])
        units=[];i=0
        while i<len(chunks):
            text,isword=chunks[i];link=g.literal(text)
            if isword and i+1<len(chunks) and not chunks[i+1][1]:
                unit=g.pair(link,g.literal(chunks[i+1][0]));i+=2
            else:unit=link;i+=1
            units.append(unit)
        g.roots.append(g.balanced(units))
    return g

def read_source_roots(base,manifest):
    db=sqlite3.connect(f'file:{(Path(base)/"knowledge-large.sqlite").resolve()}?mode=ro',uri=True)
    cur=db.cursor();cache={};docs=[]
    def get(physical):
        row=cache.get(physical)
        if row is None:
            row=cur.execute('SELECT from_id,to_id,string FROM links WHERE link_id=?',(physical,)).fetchone()
            if row is None:raise ValueError('missing SQLite source Link')
            if len(cache)<300000:cache[physical]=row
        return row
    try:
        for entry in manifest:
            stack=[entry['balanced_root']];chunks=[];n=0
            while stack:
                left,right,s=get(stack.pop())
                if left is None:chunks.append(s);n+=len(s)
                else:stack.append(right);stack.append(left)
            source=''.join(chunks)
            if n!=entry['expected_scalars'] or len(source.encode('utf8'))!=entry['expected_bytes']:
                raise ValueError('source size mismatch')
            if hashlib.sha256(source.encode('utf8')).hexdigest()!=entry['expected_sha256']:
                raise ValueError('independent source hash mismatch')
            docs.append({**entry,'source':source})
    finally:db.close()
    return docs

def self_test():
    assert oracle_segments('лес|сад')==[('лес',True),('|',False),('сад',True)]
    assert oracle_segments('🦊 |')==[('🦊 |',False)]
    s='мама | 🚀\r\n';g=make_oracle_graph([{'source':s}])
    assert g.next>0 and g.roots
    print('W14_WORD_ORACLE_SELF_TEST_PASS')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data-dir');p.add_argument('--output-dir')
    p.add_argument('--predecoded-dir',help='Optional independently SHA-verified exact source prefix files')
    p.add_argument('--self-test',action='store_true')
    a=p.parse_args()
    if a.self_test:self_test();return
    if not a.data_dir or not a.output_dir:p.error('data-dir and output-dir required')
    ts=time.monotonic();manifest=resolve_sources(a.data_dir)
    if a.predecoded_dir:
        source=[]
        for d in manifest:
            raw=(Path(a.predecoded_dir)/(d['id']+'.txt')).read_bytes()
            if len(raw)!=d['expected_bytes'] or hashlib.sha256(raw).hexdigest()!=d['expected_sha256']:
                raise ValueError('predecoded text differs from physical source root')
            source.append({**d,'source':raw.decode('utf8')})
    else:source=read_source_roots(a.data_dir,manifest)
    g=make_oracle_graph(source)
    print('W14_WORD_GRAPH',g.next,'elapsed',round(time.monotonic()-ts,2),flush=True)
    out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True)
    wire=out/'word-aligned.w14l1'
    meta=encode_graph(g,[{'root':root,**entry} for root,entry in zip(g.roots,manifest)],wire)
    assert meta['nodes']==2031925,'not same word-aligned baseline as W10'
    cold=decode_cold(wire,manifest)
    report={'model':'word-aligned','oracle':'Unicode categories L/M/N',**meta,
     'coldReplay':{k:v for k,v in cold.items() if k!='docs'},'seconds':round(time.monotonic()-ts,2)}
    (out/'w14_word_oracle.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('W14_WORD_FULL_RESULT',json.dumps(report),flush=True)
if __name__=='__main__':main()