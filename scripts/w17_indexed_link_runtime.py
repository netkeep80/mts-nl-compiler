#!/usr/bin/env python3
"""W17R1: SQLite-free indexed, read-only runtime for archived W15F1 Link aseti.

Every Link is either a Unicode-scalar atom or an ordered immutable duplet.
No natural-language classes, inferred word boundary, SQL schema, or training hints.
The XZ and Link bitstreams are validated before queries are allowed.
"""
import argparse
from array import array
import hashlib
import json
import lzma
from pathlib import Path
import zipfile

from w15_fixed_pair_codec import DenseReader, MAGIC, ru
from w17_link_archive import MAX_WIRE, MEMBERS, SCHEMA

MAX_NODES = 10_000_000
MAX_DOCUMENTS = 1000
MAX_EXPANDED_SCALARS = 100_000_000
MAX_QUERY_SCALARS = 4096


def _digest(data):
    return hashlib.sha256(data).hexdigest()


class IndexedAseti:
    """Compact ordered DAG with O(1) Link ID lookup and lazy source ranges.

    Arrays use 32-bit link IDs and 64-bit aggregate subtree lengths. Optional
    SQLite materialization is deliberately absent from this runtime.
    """

    def __init__(self, wire, *, max_nodes=MAX_NODES):
        if not isinstance(wire, (bytes, bytearray)) or not wire.startswith(MAGIC):
            raise ValueError('W17R1 requires an exact W15F1 stream')
        pos = len(MAGIC)
        if pos >= len(wire) or wire[pos] != 3:  # W15 progressive only
            raise ValueError('W17R1 requires canonical progressive rule packing')
        pos += 1
        atom_count, pos = ru(wire, pos)
        if atom_count > 0x110001:
            raise ValueError('atom limit')
        atoms = array('I')
        scalar_sizes = array('Q')
        byte_sizes = array('Q')
        atom_seen = set()
        for _ in range(atom_count):
            cp, pos = ru(wire, pos)
            if cp > 0x110000 or 0xd800 <= cp <= 0xdfff or cp in atom_seen:
                raise ValueError('bad / duplicate atom')
            atom_seen.add(cp)
            atoms.append(cp)
            scalar_sizes.append(0 if cp == 0x110000 else 1)
            byte_sizes.append(0 if cp == 0x110000 else 1 if cp < 128 else 2 if cp < 2048 else 3 if cp < 65536 else 4)
        pair_count, pos = ru(wire, pos)
        total_nodes = atom_count + pair_count
        if total_nodes == 0 or total_nodes > max_nodes or total_nodes > 2**32-1:
            raise ValueError('Link count beyond runtime budget')
        doc_count, pos = ru(wire, pos)
        if not 0 < doc_count <= MAX_DOCUMENTS:
            raise ValueError('document count invalid')
        left = array('I')
        right = array('I')
        reader = DenseReader(wire, pos, 1)
        for i in range(pair_count):
            reader.width = max(1, (atom_count + i - 1).bit_length())
            a, b = reader.read(), reader.read()
            if a >= atom_count + i or b >= atom_count + i:
                raise ValueError('forward or invalid Link poles')
            scalars = scalar_sizes[a] + scalar_sizes[b]
            source_bytes = byte_sizes[a] + byte_sizes[b]
            if scalars > MAX_EXPANDED_SCALARS or source_bytes > MAX_EXPANDED_SCALARS * 4:
                raise ValueError('subtree expansion exceeds budget')
            left.append(a)
            right.append(b)
            scalar_sizes.append(scalars)
            byte_sizes.append(source_bytes)
        pos = reader.finish()  # requires canonical zero end padding
        reader = DenseReader(wire, pos, max(1, (total_nodes - 1).bit_length()))
        roots = array('I', (reader.read() for _ in range(doc_count)))
        pos = reader.finish()
        lengths = []
        for root in roots:
            source_bytes, pos = ru(wire, pos)
            scalars, pos = ru(wire, pos)
            if root >= total_nodes or scalars != scalar_sizes[root] or source_bytes != byte_sizes[root]:
                raise ValueError('root byte or scalar length mismatch')
            if scalars > MAX_EXPANDED_SCALARS:
                raise ValueError('document expansion budget exceeded')
            lengths.append((source_bytes, scalars))
        if pos != len(wire):
            raise ValueError('trailing noncanonical bytes')
        self.atoms, self.left, self.right = atoms, left, right
        self.scalar_sizes, self.byte_sizes = scalar_sizes, byte_sizes
        self.roots, self.lengths = roots, lengths
        self.node_count, self.pair_count, self.atom_count = total_nodes, pair_count, atom_count
        self.wire_sha256 = _digest(wire)
        self._atom_reverse = {cp: i for i, cp in enumerate(atoms)}

    @classmethod
    def from_archive(cls, archive, *, verify_documents=False, max_wire=MAX_WIRE):
        """Read only W17 ZIP(XZ(W15F1)), never extract/write SQLite or texts."""
        with zipfile.ZipFile(archive, 'r') as z:
            if z.namelist() != list(MEMBERS):
                raise ValueError('unrecognized archive members')
            manifest_raw = z.read(MEMBERS[0])
            if len(manifest_raw) > 2_000_000:
                raise ValueError('manifest budget')
            meta = json.loads(manifest_raw)
            if meta.get('schema') != SCHEMA or meta.get('serialization') != 'W15F1-progressive' or meta.get('payload') != MEMBERS[1]:
                raise ValueError('archive incompatible with runtime')
            n = meta.get('wireBytes')
            if type(n) is not int or not 0 < n <= max_wire:
                raise ValueError('uncompressed size budget')
            item = z.getinfo(MEMBERS[1])
            if item.file_size > max_wire * 2 or item.compress_type != zipfile.ZIP_STORED:
                raise ValueError('compressed payload budget')
            compressed = z.read(item)
            if len(compressed) != meta.get('payloadBytes') or _digest(compressed) != meta.get('payloadSha256'):
                raise ValueError('compressed payload checksum')
            unpacker = lzma.LZMADecompressor(format=lzma.FORMAT_XZ)
            wire = unpacker.decompress(compressed, max_length=n + 1)
            if len(wire) != n or not unpacker.eof or unpacker.unused_data or _digest(wire) != meta.get('wireSha256'):
                raise ValueError('decompressed payload integrity')
        graph = cls(wire)
        if graph.node_count != meta.get('nodeCount') or len(graph.roots) != meta.get('documentCount'):
            raise ValueError('archive metadata mismatch')
        documents = meta.get('documents')
        if not isinstance(documents, list) or len(documents) != len(graph.roots):
            raise ValueError('document manifest mismatch')
        for i, d in enumerate(documents):
            if d.get('bytes') != graph.lengths[i][0] or d.get('scalars') != graph.lengths[i][1]:
                raise ValueError('manifest document length mismatch')
            if not isinstance(d.get('sha256'), str) or len(d['sha256']) != 64:
                raise ValueError('missing SHA witness')
        graph.documents = documents
        graph.archive_metadata = meta
        if verify_documents:
            for i, expected in enumerate(documents):
                if _digest(graph.document_bytes(i)) != expected['sha256']:
                    raise ValueError('cold document hash mismatch at '+str(i))
        return graph

    def link(self, idx):
        if not isinstance(idx, int) or idx < 0 or idx >= self.node_count:
            raise IndexError('unknown Link index')
        data = {'index': idx, 'scalars': self.scalar_sizes[idx], 'bytes': self.byte_sizes[idx]}
        if idx < self.atom_count:
            cp = self.atoms[idx]
            return {**data, 'kind': 'atom', 'scalar': cp, 'text': '' if cp == 0x110000 else chr(cp)}
        i = idx-self.atom_count
        return {**data, 'kind': 'pair', 'from': self.left[i], 'to': self.right[i]}

    def atom_index(self, scalar):
        if not isinstance(scalar, str) or len(scalar) != 1:
            raise ValueError('expected one Unicode scalar')
        return self._atom_reverse.get(ord(scalar))

    def find_pair(self, left, right):
        """Linear inverse lookup without a RAM-expensive global reverse index."""
        if not isinstance(left, int) or not isinstance(right, int) or min(left, right) < 0:
            raise ValueError('invalid pair poles')
        if left >= self.node_count or right >= self.node_count:
            return None
        for i, (a, b) in enumerate(zip(self.left, self.right)):
            if a == left and b == right:
                return self.atom_count+i
        return None

    def scalars(self, doc_idx, start=0, stop=None):
        """Yield exact source scalars lazily; skip nonintersecting sub-DAGs."""
        if not isinstance(doc_idx, int) or not 0 <= doc_idx < len(self.roots):
            raise IndexError('unknown document index')
        length = self.lengths[doc_idx][1]
        if stop is None:
            stop = length
        if not isinstance(start, int) or not isinstance(stop, int) or start < 0 or stop < start or stop > length:
            raise ValueError('invalid scalar slice')
        stack = [(self.roots[doc_idx], 0)]
        while stack:
            idx, offset = stack.pop()
            if offset >= stop or offset + self.scalar_sizes[idx] <= start:
                continue
            if idx < self.atom_count:
                cp = self.atoms[idx]
                if cp != 0x110000:
                    yield chr(cp)
            else:
                j = idx-self.atom_count
                a, b = self.left[j], self.right[j]
                stack.append((b, offset+self.scalar_sizes[a]))
                stack.append((a, offset))

    def document_slice(self, doc_idx, start=0, stop=None):
        return ''.join(self.scalars(doc_idx, start, stop))

    def document_bytes(self, doc_idx):
        return self.document_slice(doc_idx).encode('utf8')

    def document_find(self, doc_idx, pattern, *, max_hits=100):
        """Streaming exact KMP search across any Link boundaries; scalar offsets."""
        if not isinstance(pattern, str) or not 0 < len(pattern) <= MAX_QUERY_SCALARS or not 0 < max_hits <= 10000:
            raise ValueError('pattern/hit budget')
        chars = list(pattern)
        pi = [0] * len(chars)
        j = 0
        for i in range(1, len(chars)):
            while j and chars[i] != chars[j]:
                j = pi[j-1]
            if chars[i] == chars[j]:
                j += 1
            pi[i] = j
        result = []
        j = 0
        for offset, cp in enumerate(self.scalars(doc_idx)):
            while j and cp != chars[j]:
                j = pi[j-1]
            if cp == chars[j]:
                j += 1
            if j == len(chars):
                result.append(offset-len(chars)+1)
                if len(result) >= max_hits:
                    break
                j = pi[j-1]
        return result


def self_test():
    from array import array
    import tempfile
    from w15_fixed_pair_codec import encode
    from w17_link_archive import build
    with tempfile.TemporaryDirectory(prefix='w17-runtime-') as td:
        p = Path(td)
        # two books, reused "ма", with Cyrillic, emoji and source punctuation.
        # atoms: м, а, 🚀, space, ( ;  5=(м,а), 6=(5,5), 7=(6,space), 8=(7,rocket)
        atoms = [ord(c) for c in 'ма🚀 (']
        pairs = array('I', [0,1, 5,5, 6,3, 7,2])
        roots = [6,8]
        original = ['мама', 'мама 🚀']
        wire = p/'data.w15f1'
        wire.write_bytes(encode(atoms,4,pairs,roots,[(len(t.encode()),len(t)) for t in original],'progressive'))
        arch = p/'data.zip'
        build(wire,arch,budget=1_000_000,reserve=100_000)
        g = IndexedAseti.from_archive(arch,verify_documents=True)
        assert len(g.roots) == 2 and g.node_count == 9
        assert g.document_slice(0,1,3) == 'ам'
        assert g.document_bytes(1) == original[1].encode()
        assert g.document_find(1,'ма') == [0,2]
        assert g.document_find(1,'а 🚀') == [3]
        assert g.link(6)['kind'] == 'pair'
        assert g.atom_index('(') == 4
        assert g.find_pair(5,5) == 6
        try:g.document_slice(1,0,100)
        except ValueError:pass
        else:raise AssertionError('out-of-range slice accepted')
        with zipfile.ZipFile(arch) as z:
            raw = z.read(MEMBERS[1])
            modified = bytearray(lzma.decompress(raw))
            modified[0] ^= 1
            try:IndexedAseti(modified)
            except ValueError:pass
            else:raise AssertionError('malformed W15 accepted')
    print('W17_INDEXED_ASETI_SELF_TEST_PASS')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--archive')
    ap.add_argument('--document',type=int,default=0)
    ap.add_argument('--slice',help='scalar offsets START:END')
    ap.add_argument('--find',help='exact Unicode substring in one document')
    ap.add_argument('--list',action='store_true')
    ap.add_argument('--verify-all',action='store_true')
    ap.add_argument('--self-test',action='store_true')
    args = ap.parse_args()
    if args.self_test:
        self_test();return
    if not args.archive:
        ap.error('--archive is mandatory')
    g = IndexedAseti.from_archive(args.archive,verify_documents=args.verify_all)
    response = {'nodes':g.node_count,'atoms':g.atom_count,'pairs':g.pair_count,
                'books':len(g.roots),'indexBased':True,'sqliteRequired':False}
    if args.list:
        response['documents']=[{'index':i,'bytes':sz[0],'scalars':sz[1],
             'id':g.documents[i].get('id')} for i,sz in enumerate(g.lengths)]
    if args.slice:
        left,right = args.slice.split(':',1)
        response['slice'] = g.document_slice(args.document,int(left),int(right))
    if args.find is not None:
        response['matches'] = g.document_find(args.document,args.find)
    print(json.dumps(response,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()