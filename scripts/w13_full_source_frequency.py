#!/usr/bin/env python3
"""W13: standalone exact, source-first Unicode ngram → physical SQLite Link trial.
Data input is the W10 exact-pinned physical SQLite artifact, not redistributed books.
Frozen Unicode boundary is an EXPLICIT trained parameter, not a whitespace rule.
Python standard library only. Research-only, no normative schema changes.
"""
import argparse, hashlib, json, math, sqlite3, time
from pathlib import Path

def original_documents(database, performance, limit):
    p=json.loads(Path(performance).read_text(encoding='utf8'))
    if p['books']!=60 or len(p['perBook'])!=60:
        raise ValueError('60 pinned documents expected')
    db=sqlite3.connect(f'file:{Path(database).resolve()}?mode=ro',uri=True)
    sql=db.cursor();cache={};docs=[]
    def row(k):
        r=cache.get(k)
        if r is None:
            r=sql.execute('SELECT from_id,to_id,string FROM links WHERE link_id=?',(k,)).fetchone()
            if r is None:raise ValueError('missing Link')
            if len(cache)<500000:cache[k]=r
        return r
    for d in p['perBook']:
        stack=[int(d['rootLinkId'])];parts=[];n=0
        while stack and n<limit:
            a,b,s=row(stack.pop())
            if a is None:
                part=s[:limit-n];parts.append(part);n+=len(part)
            else:stack.extend((b,a))
        text=''.join(parts);payload=text.encode('utf8')
        if n!=min(limit,d['codepoints']):raise ValueError('wrong source scalar count')
        if limit>=d['codepoints'] and len(payload)!=d['sourceBytes']:
            raise ValueError('wrong source byte count')
        docs.append((d['id'],text,payload))
    ddl=db.execute("SELECT sql FROM sqlite_master WHERE name='links' AND type='table'").fetchone()[0]
    indexes=[r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE tbl_name='links' AND type='index' AND sql IS NOT NULL")]
    db.close()
    return p,docs,ddl,indexes

def train_source_frequencies(docs,minimum):
    # Count ALL overlapping windows in original text, never tree nodes.
    counts={}
    for _,text,_ in docs:
        for width in range(2,9):
            for i in range(len(text)-width+1):
                key=text[i:i+width]
                counts[key]=counts.get(key,0)+1
    total=len(counts)
    counts={k:v for k,v in counts.items() if v>=minimum}
    return counts,{'distinct':total,'eligible':len(counts),'minObserved':minimum}

class Graph:
    def __init__(self):
        self.atoms={};self.pairs={};self.roots=[];self.next=0
    def atom(self,c):
        x=self.atoms.get(c)
        if x is None:
            self.next+=1;x=self.next;self.atoms[c]=x
        return x
    def pair(self,a,b):
        key=(a,b);x=self.pairs.get(key)
        if x is None:
            self.next+=1;x=self.next;self.pairs[key]=x
        return x
    def balanced(self,items):
        def build(a,b):
            if a==b:return self.atom('')
            if a+1==b:return items[a]
            mid=a+(b-a)//2
            return self.pair(build(a,mid),build(mid,b))
        return build(0,len(items))

def local_cut(text,freq):
    n=len(text)
    if n<2:raise ValueError('composite span required')
    offsets=range(1,n) if n<=17 else sorted(set(
        [*range(1,9),n//2,(n+1)//2,*range(n-8,n)]))
    best=-float('inf');winner=None
    for i in offsets:
        if not 1<=i<n:continue
        left=freq.get(text[:i],0) if 2<=i<=8 else 0
        right=freq.get(text[i:],0) if 2<=n-i<=8 else 0
        score=(math.log2(1+left)*i*i
            +math.log2(1+right)*(n-i)**2
            -0.1*abs(2*i-n))
        if score>best:best=score;winner=i
    return winner

def compile_links(docs,boundary,freq):
    graph=Graph();cache={};per_doc=[]
    def build(s):
        x=cache.get(s)
        if x is not None:return x
        if len(s)==1:x=graph.atom(s)
        else:
            i=local_cut(s,freq)
            x=graph.pair(build(s[:i]),build(s[i:]))
        cache[s]=x
        return x
    for name,text,_ in docs:
        chunks=[];start=0
        for i,c in enumerate(text):
            if c==boundary:
                chunks.append(text[start:i+1]);start=i+1
        if start<len(text):chunks.append(text[start:])
        graph.roots.append(graph.balanced([build(s) for s in chunks]))
        per_doc.append({'id':name,'cumulative':graph.next})
    return graph,per_doc

def persist(db_path,graph,ddl,indexes):
    path=Path(db_path)
    if path.exists():raise ValueError('refuse to overwrite existing SQLite')
    con=sqlite3.connect(path)
    try:
        con.execute('PRAGMA foreign_keys=ON')
        con.execute('PRAGMA journal_mode=OFF')
        con.execute('PRAGMA synchronous=OFF')
        con.execute(ddl)
        for statement in indexes:con.execute(statement)
        cur=con.cursor();cur.execute('BEGIN IMMEDIATE')
        cur.executemany('INSERT INTO links(link_id,string) VALUES(?,?)',
            ((i,s) for s,i in graph.atoms.items()))
        cur.executemany('INSERT INTO links(link_id,from_id,to_id) VALUES(?,?,?)',
            ((i,a,b) for (a,b),i in graph.pairs.items()))
        cur.execute('COMMIT')
        con.execute('UPDATE links SET '
            'from_uses=(SELECT count(*) FROM links AS x WHERE x.from_id=links.link_id),'
            'to_uses=(SELECT count(*) FROM links AS x WHERE x.to_id=links.link_id)')
        con.commit()
        if con.execute('SELECT count(*) FROM links').fetchone()[0]!=graph.next:
            raise ValueError('incorrect physical row count')
        if list(con.execute('PRAGMA foreign_key_check')):raise ValueError('FK violations')
        if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':
            raise ValueError('SQLite integrity failed')
        con.execute('VACUUM')
        return {'physicalLinks':graph.next,'sqliteVacuumBytes':path.stat().st_size,
            'fkViolations':0,'integrity':'ok'}
    finally:con.close()

def replay_read_only(db_path,roots,docs):
    con=sqlite3.connect(f'file:{Path(db_path).resolve()}?mode=ro',uri=True)
    cursor=con.cursor();cache={};verified=[]
    try:
        for root,(name,_,original) in zip(roots,docs):
            stack=[root];parts=[]
            while stack:
                ident=stack.pop();r=cache.get(ident)
                if r is None:
                    r=cursor.execute('SELECT from_id,to_id,string FROM links WHERE link_id=?',(ident,)).fetchone()
                    if r is None:raise ValueError('missing cold Link')
                    if len(cache)<500000:cache[ident]=r
                a,b,s=r
                if a is None:parts.append(s)
                else:stack.extend((b,a))
            decoded=''.join(parts).encode('utf8')
            if decoded!=original:raise ValueError('byte mismatch '+name)
            verified.append({'id':name,'sourceBytes':len(decoded),
                'sha256':hashlib.sha256(decoded).hexdigest()})
    finally:con.close()
    return verified

def self_test():
    # Synthetic alphabet is intentionally independent of natural-language separators.
    data=[('a','|мама|','|мама|'.encode('utf8')),
          ('b','|мама🚀','|мама🚀'.encode('utf8'))]
    frequencies,meta=train_source_frequencies(data,2)
    assert meta['distinct']>=meta['eligible']
    g,_=compile_links(data,'|',frequencies)
    assert g.next==len(g.atoms)+len(g.pairs)
    assert local_cut('мама',frequencies) in (1,2,3)
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        template=('CREATE TABLE links(link_id INTEGER PRIMARY KEY AUTOINCREMENT,'
            'from_id INTEGER REFERENCES links(link_id) DEFERRABLE INITIALLY DEFERRED,'
            'to_id INTEGER REFERENCES links(link_id) DEFERRABLE INITIALLY DEFERRED,'
            'string TEXT,from_uses INTEGER NOT NULL DEFAULT 0,'
            'to_uses INTEGER NOT NULL DEFAULT 0)')
        db=Path(folder)/'test.sqlite'
        assert persist(db,g,template,[])['physicalLinks']==g.next
        assert len(replay_read_only(db,g.roots,data))==2
    print('W13_SELF_TEST_PASS')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-sqlite');p.add_argument('--source-performance')
    p.add_argument('--output-sqlite');p.add_argument('--report-json')
    p.add_argument('--boundary-hex');p.add_argument('--minimum',type=int,default=2)
    p.add_argument('--max-scalars',type=int,default=1000000)
    p.add_argument('--self-test',action='store_true')
    a=p.parse_args()
    if a.self_test:self_test();return
    if not all((a.source_sqlite,a.source_performance,a.report_json,a.boundary_hex)):
        p.error('source, performance, output report and frozen marker required')
    cp=int(a.boundary_hex.removeprefix('U+'),16)
    if a.minimum<1 or a.max_scalars<1 or cp>0x10ffff or 0xd800<=cp<=0xdfff:
        p.error('invalid codepoint or budget')
    start=time.monotonic()
    perf,docs,ddl,indexes=original_documents(a.source_sqlite,a.source_performance,a.max_scalars)
    training=[d for i,d in enumerate(docs) if i%5!=4]
    counts,statistics=train_source_frequencies(training,a.minimum)
    graph,per_doc=compile_links(docs,chr(cp),counts)
    result={'schema':'mts-nl/W13/source-first-physical-v0',
        'books':60,'trainBooks':48,'heldoutBooks':12,'boundaryHex':a.boundary_hex,
        'minimumFrequency':a.minimum,'ngramLengths':[2,8],
        'sourceScalars':sum(len(d[1]) for d in docs),
        'sourceBytes':sum(len(d[2]) for d in docs),
        'trainingNgrams':statistics,'physicalLinks':graph.next,
        'baselineBalancedPhysicalLinks':perf['insertedLinks'],
        'baselineWordAlignedPhysicalLinks':perf['wordAlignedAB']['wordAligned']['insertedLinks'],
        'perDoc':per_doc,
        'caveat':'Source statistics exclude 12 heldout books. Frozen boundary was trained separately in W11. This is not a full-bit MDL score.'}
    if a.output_sqlite:
        result['sqlite']=persist(a.output_sqlite,graph,ddl,indexes)
        result['coldReplay']=replay_read_only(a.output_sqlite,graph.roots,docs)
        result['status']='SQLITE_INTEGRITY_AND_COLD_EXACT_PASS'
    else:result['status']='IN_MEMORY_RESEARCH_ONLY'
    result['seconds']=round(time.monotonic()-start,2)
    Path(a.report_json).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('W13_RESULT',json.dumps({k:v for k,v in result.items() if k not in ('coldReplay','perDoc')},ensure_ascii=False))
if __name__=='__main__':main()
