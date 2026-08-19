# Research — Algorithm 6, entity resolution

**Ran:** 2026-08-19, Phase 7, after the port and before the design was fixed.
**Method:** built-in `WebSearch`.

> **Evidence caveat.** One hop from source through a summarisation layer. Good enough to design
> from, not good enough to quote. Nothing below is presented as a verbatim quotation.

## The question

Semantica blocks with overlapping keys — token prefixes, optionally type-scoped, optionally
phonetic. Is that still the right family, and how should it be measured?

## The family is right; there are three others worth knowing

The survey literature names four approaches. Semantica's is **standard blocking with multiple
overlapping keys**, and the alternatives trade differently rather than dominating:

| Approach | How | Trade |
|---|---|---|
| **Standard / multi-key blocking** | build cheap keys, compare within a block | simple, deterministic; a bad key family loses matches |
| **Sorted neighbourhood** | sort by key, slide a window of size *w* | `O(n·w)`, bounded work; sensitive to what sorts adjacent |
| **Canopy clustering** | cheap similarity, two thresholds, overlapping canopies | catches matches keys miss; more candidates |
| **LSH / MinHash** | shingle, minhash, bucket by hash | approximate, scales; a probability of missing, not a guarantee |

**Kept multi-key blocking.** With 26 records and a store that grows by hand-recorded decisions,
the scaling arguments for LSH do not apply, and its cost is a *probabilistic* miss — which is the
one thing this design has been consistent about refusing elsewhere. Sorted neighbourhood is the
strongest alternative and is a real option if a single key family ever has to carry everything.

**The trigger to revisit:** a store where all-pairs is genuinely infeasible — tens of thousands of
records — or one where the token families stop separating. Neither is close.

## The measures, taken from the literature rather than invented

Four standard metrics, and the phase uses them unchanged:

- **Pair Completeness** `PC = |D(B)| / |D(E)|` — recall. Of all true duplicate pairs, how many
  survived blocking.
- **Pairs Quality** `PQ = |D(B)| / ‖B‖` — precision of the candidate set.
- **Reduction Ratio** `RR = 1 − ‖B‖ / ‖E‖` — effort saved against all-pairs.
- **F-Measure** `FM = 2·PC·PQ / (PC+PQ)`.

Higher PC means a more *effective* scheme; higher PQ and RR mean a more *efficient* one.

**PC is not symmetric with the others and the asymmetry drives the whole design.** A pair blocking
drops is gone — no downstream scorer, threshold or clustering step can recover it, because nothing
ever looks at it. PQ and RR only cost time. A scheme reporting `RR = 0.999` and `PC = 0.4` has
thrown away three fifths of the answer to save work nobody asked it to save.

That is exactly why the ported cap was rewritten: keeping the lowest-*indexed* neighbours sheds PC
by accident of load order, and PC is the one thing that cannot be recovered.

## What was measured here

```
  configuration         PC     PQ     RR  compared  missed
  all-pairs         100.0%   1.8%   0.0%       325       0
  token only         66.7%  19.0%  93.5%        21       2
  + type-scoped      66.7%  19.0%  93.5%        21       2
  + phonetic        100.0%  25.0%  92.6%        24       0
```

**Phonetic keys are what lift recall to complete**, at a cost of three extra comparisons. Type
scoping changed nothing on this set — it is a precision tool, and this set's duplicates already
share a type.

### One of the two phonetic recoveries is luck, and saying so matters

Phonetic keys recovered two pairs. Only one of them is the mechanism working:

- `per-5a`/`per-5b` — `oleary` and `olery` both encode `O460`. A real spelling variant, recovered
  for the right reason.
- `hard-9a`/`hard-9b` — *"p1 checkout unavailable forty minutes"* and *"the friday outage"* share
  **no tokens at all**. They collide because `forty` and `friday` both encode `F630`.

Reading `PC = 100%` as "the phonetic family handles name variants" would be wrong. It handles one,
and got the other by an accidental code collision. Both are asserted in the suite so the
distinction survives.

**This is not a defect.** Soundex is a deliberately coarse hash; over-collision is the mechanism,
not a failure of it — blocking's job is to be generous and the scorer's job is to be strict. But a
metric that is right for the wrong reason is exactly the shape `guard-integrity` rule 9 exists to
catch, and it was caught by predicting that phonetic could not reach a pair sharing no tokens, then
checking why it did.

### And Soundex cannot see a differing first letter

`catherine` is `C365`, `katherine` is `K365`. The initial is kept literally, so the codes differ
however alike the sound. That is Soundex as specified, not a porting error, and it is why the
labelled pair is recovered by its **surname**. Asserted in the suite so nobody "fixes" it.

## Transitivity, which the literature is quieter about than it should be

Blocking gives pairs; resolution needs entities, and the usual step is connected components. But
similarity is not transitive: `Jon Smith` ~ `J. Smith` ~ `Jane Smith` chains two reasonable matches
into one wrong entity, silently.

No threshold makes this safe — it only moves where the chain breaks. So the design does what
Algorithm 5 does for causal chains: **form the component, and report the weakest link holding it
together.** A cluster whose weakest edge is 0.42 is a different claim from one whose weakest edge
is 0.95, and the caller gets both rather than a merged blob.

## Sources

One hop from source; spot-check before quoting.

- [A Survey of Blocking and Filtering Techniques for Entity Resolution](https://arxiv.org/pdf/1905.06167)
- [Blocking and Filtering Techniques for Entity Resolution: A Survey (CSUR)](https://helios2.mi.parisdescartes.fr/~themisp/publications/csur20-blockingfiltering.pdf)
- [Comparative Analysis of Approximate Blocking Techniques for Entity Resolution (VLDB)](http://www.vldb.org/pvldb/vol9/p684-papadakis.pdf)
- [Skyblocking for Entity Resolution](https://arxiv.org/pdf/1805.12319)
