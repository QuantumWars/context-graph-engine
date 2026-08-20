# Research — Algorithm 8, entity linking

**Ran:** 2026-08-20, Phase 10, after the port and before the design was fixed.
**Method:** built-in `WebSearch`, plus reading `semantica/` directly.

> **Evidence caveat.** One hop from source through a summarisation layer. Good enough to design
> from, not good enough to quote. Nothing below is presented as a verbatim quotation.

## The question

Phase 9 left one gap, stated plainly in its summary: a proposal says what the text states and **not
which records those phrases refer to**. `extract` finds "The friday deploy caused a checkout
outage"; a caller must then type both endpoint ids by hand. Closing that means mapping a mention to
a record — entity linking.

## What the port found

`semantica/semantica/context/entity_linker.py` (898 lines). Unlike the extraction-provenance
wrappers of Phase 9, **this one ships**: `context_graph.py:478` instantiates it
(`self.entity_linker = self.config.get("entity_linker") or EntityLinker()`).

### Identity is decided by an inline `0.9`, and the comparison ignores word order

`entity_linker.py:444`:

```python
link_type="same_as" if similarity >= 0.9 else "related_to",
confidence=similarity,
```

`similarity` comes from `_calculate_text_similarity` (`:481`), which is set-Jaccard over
whitespace-split words:

```python
words1 = set(text1.split())
words2 = set(text2.split())
...
return len(intersection) / len(union)
```

The caller lowercases both sides (`:400`), so case is handled. **Word order is not.** Transcribing
that function exactly and running it:

```
  1.000  same_as    'dog bites man' vs 'man bites dog'
  1.000  same_as    'the deploy caused the outage' vs 'the outage caused the deploy'
  0.500  related_to 'acme' vs 'acme corp'
```

Two statements with **opposite causal direction** are declared the same entity, at confidence 1.000,
in a library whose purpose is building a causal graph. A set has no order, so no threshold on this
function can ever separate them — raising `0.9` to `0.99` changes nothing, because the score is
exactly 1.0.

Three separate problems are stacked here and it is worth keeping them apart:

1. **The number has no provenance.** `0.9` appears inline, in an expression, with no comment.
2. **It decides identity**, which is the most consequential claim a graph can make, and `DEC-012`
   already refused to make it automatically for merges.
3. **The function it thresholds cannot support the claim** at any threshold.

The third is the one that matters. A better constant would not fix it.

### And the score is reported as confidence

`confidence=similarity` hands a Jaccard word-overlap ratio to downstream consumers as a confidence.
The recon's finding A-7 is the same function in a different place — Jaccard word overlap presented
as semantic similarity, where its length bias penalises longer, better-reasoned records.

## The prior art: three stages, and a reject option

The survey literature describes entity linking as three components:

| Stage | What it does | What we already have |
|---|---|---|
| **Candidate generation** | short-list KB entries that a mention could refer to | `src/resolve/blocking.ts` |
| **Ranking** | order the candidates by how likely each is | `src/resolve/similarity.ts` |
| **Unlinkable / NIL prediction** | decide the mention refers to nothing known | nothing yet |

**NIL prediction is described as classification with a reject option**, and four ways of doing it
are named:

- the candidate generator yields nothing for the mention;
- a threshold on the best candidate's score;
- a special `NIL` entity added to the ranking;
- a separate binary classifier over mention-entity pairs.

And a second, sharper technique appears in the evaluation literature: **take the difference between
the two highest-scoring candidates and compare that margin with a threshold.** A mention whose top
candidate scores 0.9 against a runner-up at 0.88 is ambiguous, however high the top score is —
which a threshold on the top score alone cannot see.

That is the standard practice, and it is not something invented for this build.

## Why this design reports rather than decides

Two of the four NIL techniques need a threshold, and this repository has no labelled set to
calibrate one against — the same position Phase 9 was in with extraction. Inventing `LINK_FLOOR`
and `LINK_MARGIN` would put two more unprovenanced numbers next to the one whose absence of
provenance is the finding.

**Two of the four techniques need no number at all**, and they are the ones adopted:

- **no candidates at all** — the generator returned nothing, which is a fact, not a threshold;
- **a tie at the top** — the two best candidates score identically, which is also a fact.

Everything else is returned as a **ranked list with its scores and the computed margin**, and the
caller judges. The margin is reported as a number and never compared against one. This is the same
shape retrieval already uses, where a decision record carries each channel's top score, floor and
margin rather than only its verdict.

The cost is real and worth stating: a caller who wants a single answer does not get one
automatically. That is deliberate, and it is `DEC-012`'s position — the resolver proposes, a caller
disposes — applied to a third mechanism.

## How this would be measured, if it ever is

Standard metrics, so nothing has to be invented later:

- **Recall@k** for candidate generation — is the correct record in the top *k*.
- **Top-1 accuracy** for ranking — is the top candidate the correct one.
- **InKB micro-P/R/F1** end to end, where a prediction counts only if the mention span **and** the
  linked entity both match.

What would calibrate a NIL threshold is a labelled set of mentions from this store's own records
with their true referents, including mentions that genuinely refer to nothing. That does not exist,
and until it does no threshold here is defensible.

## What was decided from this

- Reuse `src/resolve/` for both candidate generation and ranking. A second scorer in one package is
  the duplication this monorepo has already made four times.
- Report a **ranked list with scores and the margin**; never assert a link from a score.
- The only verdicts are threshold-free facts: `no_candidates`, `tie`, `ranked`.
- Linking **proposes and never writes**, like `DEC-012` and `DEC-013` before it.
- Never emit a `same_as`-style identity claim from a similarity score. Identity is `merge`, and
  `DEC-012` requires a caller to assert it.

## Sources

One hop from source; spot-check before quoting.

- [Neural Entity Linking: A Survey of Models Based on Deep Learning](https://arxiv.org/pdf/2006.00575)
- [Entity Linking with a Knowledge Base: Issues, Techniques, and Solutions (TKDE)](https://dbgroup.cs.tsinghua.edu.cn/wangjy/papers/TKDE14-entitylinking.pdf)
- [A Fair and In-Depth Evaluation of Existing End-to-End Entity Linking Systems](https://arxiv.org/pdf/2305.14937)
- [Unified Examination of Entity Linking in Absence of Candidate Sets](https://arxiv.org/pdf/2404.11061)
- [ENTITY-LINKINGS: A Unified Library for Entity Linking](https://aclanthology.org/2026.eacl-demo.42.pdf)
