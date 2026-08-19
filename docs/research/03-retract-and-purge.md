# Research — Algorithm 3, retract and purge

**Ran:** 2026-08-19, Phase 1 Task 1.3.
**Method:** built-in `WebSearch`.

> **Evidence caveat.** One hop from source through a summarisation layer. Good enough to
> design from, not good enough to quote. Nothing below is a verbatim quotation.

## The question the phase prompt put

`DEC-004` names purge as the remedy for a secret that reaches the store, and the store is an
append-only hash chain. The prompt required a real answer about what purge does to chain
verification rather than a note declaring erasure out of scope.

## It was already answered, in Task 1.1

The chain half of this question was settled by `01-provenance-chain.md` and locked as
`DEC-007`: hash a **salted commitment** to the content rather than the content itself. Purge
deletes `content` and `salt` together; `contentDigest`, `digest`, `prev` and `seq` stand, so
the chain still verifies across a purged record. That is asserted, not assumed — `chain.test.ts`
carries "a purged entry still verifies, and the chain stays valid", and separately "a purge
still cannot hide a real break elsewhere".

**So this task's research had one question left: is clearing our own store the whole of an
erasure obligation?** It is not, and the answer changed the tombstone.

## GDPR Art. 17 reaches every copy, not the primary record

The sources are consistent on two points relevant here:

- Erasure reaches **every copy** of the data, not only the production record. Personal data
  persists in backups, archives and decommissioned media after deletion from the live system,
  and a controller honouring an erasure request has to account for those.
- Where data was made public, the controller must take reasonable steps to **inform other
  controllers** holding it that erasure was requested. Those downstream holders are then
  independently responsible within their own systems. Recital 66 is cited as the structural
  basis for the duty in Art. 17(2).

## What that changed

Semantica's `purge_node` docstring already says its scope is one graph and that it is "one
step of an erasure workflow, not the whole of it" (`context_graph.py:1734`). The research
says that is **correct posture rather than a cop-out**, so it is carried over — and made
machine-visible rather than left in a docstring:

```
scope: 'this-store-only'
```

Every tombstone carries it. A tombstone without it implies an obligation was discharged when
only part of it was, and the party most likely to be misled is a future session of this
engine reporting to a user that data "has been erased".

The cost is stated in the same place it is incurred: this store can clear its own copy and
can say so precisely. It cannot reach a copy something else made, and it must not imply
otherwise.

## Carried over unchanged, because the reasoning is at the site

- **The narrowing rule** (`_closing_valid_until`, `context_graph.py:191-208`). A retraction
  takes the earlier of an existing end bound and the retraction instant. Without it, a record
  whose window already closed in the past is reported active for the span between its original
  end and the retraction.
- **A purge supersedes a prior retraction.** One subject carries one removal record.
- **The cascade snapshot** (`context_graph.py:1626-1628`). The already-retracted set is taken
  before the loop, not consulted live, because Semantica's edge ids are content-derived and
  can collide — with a live set, the record written for the first of two colliding edges
  blocks the second from ever being closed, leaving an edge open against a retracted node.
  This one was initially tested with distinct ids, which could not catch the bug at all; the
  test was rewritten around two edges sharing an id and only then had a proven failure.

## Sources

One hop from source; spot-check before quoting.

- [Art. 17 GDPR — Right to erasure](https://gdpr-info.eu/art-17-gdpr/)
- [Article 17 — Right to erasure, annotated](https://gdpr-text.com/read/article-17/)
- [Right to Erasure under GDPR — overview](https://www.legiscope.com/blog/right-to-erasure-gdpr.html)
- Chain-side answer and its sources: [`01-provenance-chain.md`](./01-provenance-chain.md)
