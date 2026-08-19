# DEC-013 — A span is a pointer into an immutable record, never a copy of the text; an extractor proposes and never writes

_Decided 2026-08-20 · status: current_

Extraction produces claims about what a text says. This record fixes what a claim may carry, what
it may not, and who is allowed to turn one into an edge.

**A span is `{ source, start, end }`.** `source` is the id of a record already in this store;
`start` and `end` are offsets into that record's text. **The text itself is never copied into the
span.** The quoted passage is derived on demand by reading the source record, exactly as clusters
are derived and never stored.

**Offsets are UTF-16 code units**, stated in the type and tested with a character that
distinguishes them from code points.

**An extractor emits only what a rule matched**, and every emitted relation carries three spans:
the subject, the object, and the **trigger** — the text that stated the relation. Proximity emits
nothing.

**Extraction proposes and never writes.** `extract` returns proposals and appends nothing. A caller
turns a proposal into an edge, and that edge records the spans it came from.

**No confidence float is emitted from a rule match.** A rule matched or it did not.

## Why

**Because a copied span is a second copy of content, and purge cannot reach it.** Semantica's
`Relation` carries `context: str`, filled by slicing ±30 characters around the match, and has no
offsets at all. Porting that would put source text inside every edge — so purging a record would
clear the record and leave its sentences sitting in the edges extracted from it. That is
`DEC-004`'s erasure hole rebuilt through a side door, and `DEC-007`'s objection to derived copies
in a different shape.

**Because immutability makes the copy unnecessary.** The W3C Web Annotation Data Model pairs a
position selector with a quote selector so that a drifting document can be re-anchored. Records
here cannot drift — `DEC-007` makes them immutable — so an offset into one is stable for as long as
the record exists, and the quote adds duplication rather than robustness.

When the source **is** purged, the span resolves to nothing. That is the honest outcome and the
one we want: the evidence is genuinely gone, and an edge that claims a text supports it should stop
being able to show that text at the moment the text is erased.

**Because the unit is a silent defect waiting to happen.** Python indexes by code point and
TypeScript by UTF-16 code unit, so `len("👍")` is 1 and `"👍".length` is 2. Porting Semantica's
`start_char` without porting the unit makes every offset after the first astral character wrong by
an amount nothing reports. Every ASCII fixture passes either way, which is what makes it dangerous.

**Because proposing is what `DEC-012` already decided for the same reason.** An automatic merge is
an unreviewable assertion about identity; an automatic edge is an unreviewable assertion about
causation, written into a log whose entire purpose is to be trusted later. The resolver proposes and
a caller disposes; the extractor does the same.

**Because a confidence float would be invented.** Semantica emits `0.6`, `0.7` and `0.75` from
three rule-based extractors, none with provenance, and the `0.6` carries the comment
`# Meets default threshold` — the number was chosen to clear the filter it would be tested against.
This repository's constants rule allows calibrated or declared-placeholder, and a per-match
confidence is neither: there is no labelled set to calibrate it against and no honest default. The
edge carries the rule that fired and the span it read, which is information the reader can check,
rather than a number they cannot.

## What was rejected

- **Copying the matched text into the span** (Semantica's `context`). Rejected: it duplicates
  content into a place purge does not reach, which is the erasure hole `DEC-004` closed. This is
  the option that looks harmless and is the whole reason this record exists.
- **Storing a hash of the quote instead of the quote.** Rejected as unnecessary rather than wrong:
  it exists to detect drift, records cannot drift, and a short quote is low-entropy enough that an
  unsalted digest is not a safe stand-in for the text. Salting it would mean storing a salt that
  purge must then reach, which is the same problem again.
- **Co-occurrence or proximity extraction in any form.** Rejected: this is finding A-8. An edge
  emitted because two entities were within *n* characters is not supported by the text, and the
  graph degrades with no error and no failing test.
- **A confidence score on an extracted relation.** Rejected: it would be invented. If a future
  extractor is statistical rather than rule-based, its scores are a new decision arriving with the
  evaluation harness that calibrates them.
- **Writing edges automatically above some quality bar.** Rejected for `DEC-012`'s reason: an
  unreviewable assertion into a trusted log. There is no threshold that makes this safe, only
  thresholds that move where it goes wrong.
- **Byte offsets, or code-point offsets, without saying which.** Rejected: the unit is the defect.
  Either is defensible; leaving it implicit is not.
- **Extracting entities as well as relations in this phase.** Deferred rather than rejected — the
  spans have to be defined and proven first, and an entity recogniser is a separate build with its
  own evaluation.

## What this constrains

- A span may never carry text. A test scans a stored edge for every field value of its source's
  content, the way the tombstone test does.
- Resolving a span whose source was purged returns nothing **with a reason code**, never an empty
  string and never a stale copy.
- An extractor that emits an edge without a trigger span is a defect, not a degraded mode.
- Any future statistical extractor must arrive with the labelled set that calibrates it, and may
  not reuse this record as cover for emitting a confidence float.
- Offsets are UTF-16 code units everywhere, including at the CLI and MCP boundary.

## How to reverse it

Cheap to reverse toward *more* provenance: adding a quote selector later is additive, and any span
already stored still resolves. Reversing toward copied text is not cheap — every edge written under
this record would need its source re-read to backfill, and any source purged in the meantime is
gone, so the backfill would be silently incomplete. Reversing "proposes, never writes" means
deciding that an unreviewed assertion may enter the log, which contradicts `DEC-012` and would need
that record superseded first.
