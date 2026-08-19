# Research — Algorithm 4, Reciprocal Rank Fusion

**Ran:** 2026-08-19, Phase 1 Task 1.4, after the port.
**Method:** built-in `WebSearch`.

> **Evidence caveat.** One hop from source through a summarisation layer. Good enough to
> design from, not good enough to quote. Nothing below is a verbatim quotation.

## The source

Cormack, Clarke & Buettcher, **SIGIR 2009**, *Reciprocal Rank Fusion outperforms Condorcet and
Individual Rank Learning Methods*. The reported result: RRF combines rankings from multiple IR
systems and consistently beats both any individual system and Condorcet Fuse, demonstrated over
TREC runs and as a meta-learner on LETOR 3.

Semantica's implementation at `hybrid_search.py:148-186` is faithful to it. That part needed no
improvement, which is worth saying plainly — the recon found twelve defects in that repository,
and this function is not one of them.

## Why rank fusion rather than score fusion, restated

The channels here are lexical and structural. Their scores are not on a common scale and never
will be, so any scheme that adds their magnitudes is adding units that do not compare. RRF uses
only the *rank*, which every channel produces in the same units by construction. That is also
precisely why finding A-6's per-source min–max normalisation is wrong rather than merely
crude: normalising restores comparability by destroying the information that made the
comparison meaningful.

## `k = 60`

The sources agree it is the paper's own default and that it usually performs well without
tuning. The mechanism: `k` damps the dominance of a single high rank, so an outstanding vote
from one channel becomes comparable to agreement across channels rather than overwhelming it.

**Status here: declared placeholder, adopted and not calibrated.** It has not been measured
against this engine's query distribution, because no such distribution exists yet. That is
recorded at the definition site in `src/retrieval/rrf.ts`, per the monorepo rule that a
constant ships as calibrated, declared placeholder, or with no provenance — one of the three,
at the definition site. `memory/src/recall.ts:353-361` reached the same conclusion
independently and says so in the same terms.

## Weighted variants — considered, not adopted

Weighted RRF exists and would let one channel count for more. Rejected for now on the same
ground as the constant: there is nothing to fit the weights to. Introducing a weight before an
evaluation harness exists produces a number nobody can defend, which is the structural problem
the teardown found in Semantica — `semantica/evals/__init__.py` is ten lines reading
`__status__ = "coming_soon"`, so every weight in that system is uncalibrated by construction.
Adding an unfittable weight here would import the disease along with the cure.

## Sources

One hop from source; spot-check before quoting.

- [Cormack, Clarke & Buettcher — RRF outperforms Condorcet and Individual Rank Learning Methods (SIGIR 2009)](https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/)
- [Semantic Scholar entry for the same paper](https://www.semanticscholar.org/paper/Reciprocal-rank-fusion-outperforms-condorcet-and-Cormack-Clarke/9e698010f9d8fa374e7f49f776af301dd200c548)
- [Reciprocal Rank Fusion explained](https://blog.serghei.pl/posts/reciprocal-rank-fusion-explained/)
