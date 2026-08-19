# DEC-012 — A merge is an appended assertion about identity; a cluster is a derived view that is never stored

_Decided 2026-08-20 · status: current_

Entity resolution produces two different things and they are stored differently.

**A cluster is derived.** `src/resolve/` proposes that some records look like the same thing. That
is a computation over the log, recomputed on load like every other derived view, and **never
written to disk**. It is a suggestion, not a fact.

**A merge is asserted.** When a caller confirms that records genuinely are one thing, that is a new
record of kind `merge`:

```
{ kind: 'merge', id, members: [recordId, ...], canonical: recordId, reason, ... }
```

Nothing is rewritten. The merged records stay exactly as they were, byte for byte, and their
digests are untouched — `DEC-007` says records are immutable and a correction appends, and a merge
is a correction about identity.

**Reads resolve through merges.** A query for a merged record answers from the canonical one and
names the merge that redirected it, so an answer can always say *why* it came from a different
record than the one asked for.

**A merge is retractable, because a merge can be wrong.** Retracting the merge record un-merges the
identity from that instant, exactly as retracting any other record closes its window. There is no
separate un-merge operation, and there must not be — a second mechanism for undoing one assertion
is how two code paths drift apart.

## Why

The alternative that looks simpler is rewriting the records into one. It is forbidden and would
break more than the rule: erasing two records into a third breaks both digests, breaks every `prev`
after them, and destroys the history that makes "what did we believe in March" answerable. The
whole engine rests on not doing that.

The split between derived and asserted is the same one `DEC-005` and `DEC-007` already make, and
applying it here is what keeps the system coherent:

- The resolver's output is **derived** — recomputable from the log, so persisting it would create a
  second store that purge would have to reach. `DEC-007` forbids exactly that.
- A human or agent confirming an identity is **explicit** — the caller chose to record it, which is
  the test `DEC-005` uses for what may be stored at all.

**A `merge` record carries ids, never content.** That matters for `DEC-004`: if a merged record is
later purged, its content goes and the merge record needs no purging, because it never held any.

**Why an appended record rather than a `SAME_AS` edge.** An edge would reuse machinery that already
exists, and that is its only advantage. The edge vocabulary is a closed causal set — `CAUSED`,
`INFLUENCED`, `PRECEDENT_FOR` — and identity is not a causal claim. Adding it there would mean
`why` traverses identity as though it were causation, which is precisely the conflation finding A-8
is about in a different guise: a mechanism asserting a relationship the source never supported.

## What was rejected

- **Rewriting merged records into one.** Rejected: it breaks the chain, contradicts `DEC-007`, and
  destroys the history the second time axis depends on. This is the option someone will propose
  again because it is what a mutable database would do.
- **Storing the resolver's clusters.** Rejected: they are derived, they are recomputable, and a
  persisted derived copy is a second store — `DEC-007`'s core objection. It would also freeze a
  suggestion into a fact, which is the opposite of what a suggestion is.
- **A `SAME_AS` edge in the causal vocabulary.** Rejected: identity is not causation, and mixing
  them would let `why` walk an identity link and report it as a cause.
- **Auto-merging above a similarity threshold.** Rejected, and this is the important one. No
  threshold makes transitivity safe — Phase 7 demonstrated `jon-smith ~ j-smith ~ jane-smith`
  merging three records where the ends are plainly different, and raising the threshold only moves
  where the chain breaks. An automatic merge is an unreviewable assertion about identity, written
  into a log designed to be trusted. **The resolver proposes; a caller disposes.**
- **A separate un-merge operation.** Rejected: retraction already means "this stopped being true",
  a merge is a record, and a second undo mechanism is how two paths drift.

## What this constrains

- `src/resolve/` stays pure and stays derived. Nothing in it may write.
- A `merge` record may contain ids and a reason, and **never content** from its members.
- Every read path that resolves through a merge must be able to say which merge it used. An answer
  that silently comes from a different record than the one asked for is the same failure as a
  retrieval that cannot say why it served.
- Merging is **never automatic**. Any future auto-merge is a new decision, not an extension of this
  one, and it must arrive with an evaluation harness that measures precision on real labels.
- Purging a merged member removes that member's content and leaves the merge intact, because the
  merge holds no content. A test must pin this, because the alternative — cascading a purge into
  the merge record — would quietly destroy an identity claim that was never the problem.

## How to reverse it

Retracting a merge un-merges it, so an individual decision is cheap to undo by design. Reversing
the *policy* — deciding merges should be rewrites after all — is not reversible: it means
rebuilding the log, invalidating every digest, and discarding the history. Deciding clusters should
be persisted is cheaper but reintroduces the second-store problem `DEC-007` exists to prevent, and
would need that record superseded first.
