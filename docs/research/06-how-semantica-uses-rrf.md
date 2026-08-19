# Research — how Semantica actually uses RRF

**Ran:** 2026-08-19, after Phase 5 found that this engine's two retrieval channels are disjoint,
so `RRF_K` cannot affect any ordering. The question was whether the system we ported from had
solved the overlap problem, and whether its answer is worth copying.

**Method:** reference search over the real source at
`graph-engine/semantica/`, read-only. Everything below is a citation, not an inference.

## The answer: it does not solve it, because its RRF never runs

The implementation at `semantica/vector_store/hybrid_search.py:148-186` is correct — Phase 1
ported it and said so. What Phase 5's question needed was the *caller*, and the caller chain ends
in nothing:

```
reciprocal_rank_fusion   ← called only by SearchRanker.rank        (hybrid_search.py:242, :247)
SearchRanker.rank        ← called only by multi_source_search      (hybrid_search.py:564)
                           …plus 4 tests and 1 docstring
multi_source_search      ← called only by 1 test and 1 docstring
                           tests/vector_store/test_vector_store_deepdive.py:345
```

**No shipped entry point reaches `multi_source_search`.** The recon's finding A-7 recorded that a
correct RRF existed and the headline class could not reach it. This is stronger and worse: *nothing*
reaches it. The fusion is dead code with a good implementation inside it.

The one production path that touches `HybridSearch` at all is
`semantica/context/decision_query.py:246`, which calls `hybrid_search.search(...)` — a different
method. `search()` performs a vector search with an optional metadata filter and **never calls the
ranker**. So the shipped behaviour of the class named `HybridSearch` involves no fusion of any kind.

## Second finding: "hybrid" does not mean lexical + vector there

A keyword search across the whole file returns nothing:

```
$ command grep -niE "bm25|keyword|lexical|tf.?idf|sparse|text_search" semantica/vector_store/hybrid_search.py
305:        # that and raises "got multiple values for keyword argument".
```

The single hit is a comment about Python keyword arguments. **There is no lexical channel.** What
`multi_source_search` fuses is several *vector sources* — each `{vectors, metadata, ids}` — so
"hybrid" means multi-corpus vector search, not the lexical-plus-semantic sense the name usually
carries and the sense this engine uses it in.

That matters for the overlap question directly. Fusing several corpora is precisely the case where
a document id belongs to **one** source, which is the same inert configuration Phase 5 measured
here. Its only exercise confirms it — the two sources carry disjoint ids:

```python
sources = [
    {"vectors": [self.vectors[0]], "metadata": [self.metadata[0]], "ids": ["vec_1"]},
    {"vectors": [self.vectors[1]], "metadata": [self.metadata[1]], "ids": ["vec_2"]}
]
multi_res = search.multi_source_search(np.array([1.0, 0.0]), sources, k=2)
self.assertEqual(len(multi_res), 2)
```

## Third finding: where ids *do* overlap, the ordering is untested

Four tests call the ranker directly with overlapping ids, and every one asserts only the length.
The comment beside the assertion is the most useful thing in the file:

```python
fused = ranker.rank([res1, res2])
self.assertEqual(len(fused), 2)
# ID 2 should be top because it's high in both? Or ID 1?
# RRF: 1/(k+1) + 1/(k+2) vs 1/(k+2) + 1/(k+1). They are equal rank-wise (1st and 2nd).
```

The author was unsure what the correct outcome was, wrote the uncertainty down, and asserted the
one thing they were confident of. That is honest, and it means **the fusion's ordering behaviour
has never been asserted anywhere in that repository** — which is consistent with it never running.

## What this settles for us

**There is no prior art here to copy.** The question "how should disjoint channels be fused" was
never faced in the system we ported from, because its fusion is unreachable and its channels are
corpora rather than methods.

So Phase 5's finding stands on its own, and the options remain the two it named:

1. **Rename to what it is.** Two disjoint ranked lists interleaved by rank is not fusion, and
   calling the module `rrf.ts` overstates it. `RRF_K` would become documentation of a formula whose
   parameter provably cannot matter in this configuration.
2. **Make the channels able to overlap**, so agreement can be rewarded. Measured in Phase 5: it
   creates overlap and scores **0.819, identical** to the current design at the calibrated floor.

The measurement does not support option 2 today. It also does not rule it out for a corpus with
more graph density than 34 records and 11 edges, and that caveat belongs with the number.

**One thing this repo does better than the original, and it is worth naming:** our RRF is reachable
from a shipped entry point, exercised by 15 tests, and its ordering is asserted — including the
property that agreement across channels beats a single first place. We discovered the channels
never overlap *because* the code runs and the harness measured it. Semantica could not have found
this, because nothing there ever executes the path.

## Sources

Read directly this session, read-only, in `graph-engine/semantica/`:

- `semantica/vector_store/hybrid_search.py:148-186` — the RRF implementation
- `semantica/vector_store/hybrid_search.py:530-566` — `multi_source_search`, the only caller
- `semantica/vector_store/hybrid_search.py:276-300` — `search()`, the shipped path, no ranker
- `semantica/context/decision_query.py:164, :246` — the one production construction and call
- `tests/vector_store/test_vector_store_deepdive.py:330-346` — the only exercise of either
