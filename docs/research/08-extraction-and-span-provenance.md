# Research — Algorithm 7, extraction with span provenance

**Ran:** 2026-08-20, Phase 9, after the port and before the design was fixed.
**Method:** built-in `WebSearch`, plus reading `semantica/` directly.

> **Evidence caveat.** One hop from source through a summarisation layer. Good enough to design
> from, not good enough to quote. Nothing below is presented as a verbatim quotation.

## The question

The recon's Task 3.2 says: *an edge is written only when something in the source text supports its
predicate; proximity is not support.* Nothing in this engine extracts anything, so every edge is
asserted by hand and that rule is satisfied trivially. What should an extractor look like, and how
should the span it read from be recorded?

## What the port found

### A-8 is exactly as the recon states, and the comment is the evidence

`semantica/semantica/semantic_extract/methods.py`, `extract_relations_cooccurrence`:

```python
distance = abs(entity1.end_char - entity2.start_char)
if distance < 100:  # Within 100 characters
    ...
    confidence=0.6,  # Meets default threshold
```

The predicate is the literal string `"related_to"`. Ten entities in a paragraph produce 45
identical edges, none read from the text. The `# Meets default threshold` comment states that the
confidence was chosen to clear the filter it would be tested against.

**Nothing in the text supported any of those edges.** Proximity is the only input.

### The good idea to take: the pattern extractor emits only on a match

`extract_relations_regex` in the same file is the honest one. It runs named patterns
(`founded_by`, `located_in`) with `(?P<subject>…)` / `(?P<object>…)` groups, resolves both ends
against the entity map, and emits **only when both resolve**. A paragraph with no matching pattern
produces nothing. That shape is worth porting.

Its weaknesses are worth porting away from: `confidence=0.75` has no provenance, and
`entity_map = {e.text.lower(): e for e in entities}` is last-wins, so two entities with the same
surface text silently collapse to one.

### `context` is a copy of the text, and that is the important finding

`Relation` (`types.py:25`) carries `context: str = ""`, and every extractor fills it by slicing
±30 characters around the match. **There is no offset pair on a relation at all** — only a copied
string. `Entity` has `start_char` / `end_char`; `Relation` does not.

For this engine that is not a small difference. Content copied into an edge is a second copy of
that content, and `DEC-004`'s purge cannot reach it — which is `DEC-007`'s objection to derived
copies, arriving through a different door. An extractor that copies source text into every edge
would quietly rebuild the erasure hole the store was designed to close.

### The provenance layer is a library with no shipped caller

`semantic_extract_provenance.py` (490 lines) wraps five extractors. Measured this session:

```
$ grep -rn "RelationExtractorWithProvenance|NERExtractorWithProvenance|…" --include=*.py \
    | grep -v /tests/ | grep -v semantic_extract_provenance.py
(no output)
```

Every reference outside the defining file is a test. And what it records as provenance is:

```python
source=source or text[:100],
```

repeated in all five classes. When a caller does not pass a source, the provenance is **the first
100 characters of the input**. That does not identify which span the relation came from, and it
does not identify the document either — two documents sharing an opening sentence are
indistinguishable. Reachability aside, this is not span provenance.

## The prior art: selectors, and why two of them

The W3C **Web Annotation Data Model** is the standard for saying "this annotation is about that
piece of that text", and it defines two relevant selectors:

| Selector | What it stores | Fails when |
|---|---|---|
| `TextPositionSelector` | `start` and `end` offsets | the document changes and offsets shift |
| `TextQuoteSelector` | the exact text, plus a prefix and suffix to disambiguate | the quoted text appears differently, or is long |

The model's own answer is that **selectors refine one another** — a position selector paired with a
quote selector, so that if offsets drift the quote can re-anchor.

**We need only one of them, and this is the design's one real insight.** The re-anchoring problem
exists because documents change. In this engine **records are immutable** — `DEC-007` — so a source
record's text cannot drift, and an offset into it is stable for as long as the record exists.

That collapses the whole question:

- **Offsets alone are sufficient**, because the thing they index cannot change.
- **Storing the quote is therefore not robustness, it is duplication** — and duplication is the
  thing that reopens the purge hole.
- If the source is **purged**, the offsets correctly resolve to nothing. A span that dangles after
  a purge is the honest outcome, not a bug: the evidence is genuinely gone.

So a span here is `{ source, start, end }` and the quote is **derived on demand** by reading the
source record, exactly as clusters are derived and never stored.

## The trap that would have been silently wrong

Offsets need a **unit**, and the two languages involved disagree:

- **Python** indexes strings by Unicode **code point**. `len("👍") == 1`.
- **JavaScript / TypeScript** indexes by **UTF-16 code unit**. `"👍".length === 2`.

Semantica's `start_char` / `end_char` are code points. This engine is TypeScript. Porting the
numbers without porting the unit means every offset after the first astral character — an emoji, a
rare CJK ideograph, a musical symbol — is wrong, and wrong by a silent amount.

The wider ecosystem has not settled this either: EPUB CFI specifies UTF-16 code units, the Language
Server Protocol carries a long-running issue about the same choice, and the W3C annotation group
has an open issue on it. The lesson taken is not "pick the right one" — it is **state the unit at
the definition site and test it with a character that distinguishes them**, because every ASCII
fixture in the world passes either way.

This is exactly the shape rule 8 warns about: boundary values include the ones that look impossible
until they arrive.

## The measure, taken from the literature rather than invented

The standard criterion for relation extraction is strict: an extracted triple counts as correct
only if **the relation and the spans of both subject and object are correct**. Partial credit for
getting the entities right with the wrong span is not given.

Three failure modes are named in the survey material, and the middle one is A-8's:

- **recall misses** — relations plainly present in the text and not extracted
- **precision failures** — extractions the text does not support
- **grounding failures** — mapping to the wrong predicate

This design deliberately trades recall away. A rule-based extractor will miss relations that are
stated in ways no rule covers, and that is an acceptable, measurable, *visible* cost. A manufactured
edge is none of those things: it is invisible, it looks like knowledge, and the graph gets worse
while every test stays green.

## What was decided from this

- A span is **offsets into an immutable source record**, never a copy of the text.
- The offset unit is **stated in the type and tested with an astral character**.
- An extractor emits **only what a rule matched**, and carries the trigger span that matched.
- Extraction **proposes and never writes**, mirroring `DEC-012` — the resolver proposes, a caller
  disposes, and for the same reason: an automatic assertion into a log designed to be trusted is
  unreviewable.
- **No confidence float is emitted from a rule match.** A rule matched or it did not; a number would
  be invented, and inventing numbers is the failure this repository is built around.

## Sources

One hop from source; spot-check before quoting.

- [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)
- [TextPositionSelector, Unicode code point vs UTF-16 code unit (w3c/web-annotation issue 350)](https://github.com/w3c/web-annotation/issues/350)
- [Change character units from UTF-16 code unit to Unicode codepoint (language-server-protocol issue 376)](https://github.com/microsoft/language-server-protocol/issues/376)
- [STAM: Stand-off Text Annotation Model](https://annotation.github.io/stam/)
- [A Comprehensive Survey on Relation Extraction: Recent Advances and New Frontiers (ACM CSUR)](https://dl.acm.org/doi/full/10.1145/3674501)
- [Designing the W3C Open Annotation Data Model](https://arxiv.org/pdf/1304.6709)
