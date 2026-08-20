# DEC-016 — A relation is emitted only when its clause asserts it, and scope is a clause rather than a window

_Decided 2026-08-20 · status: current_

Phase 13 measured the rule-based extractor and found every false positive it had was polarity: it
matched a trigger word wherever the word appeared, so *"The friday deploy never caused the checkout
outage"* and *"The deploy may have caused the outage"* both produced a `CAUSED` edge.

**A match is emitted only if the clause containing its verb asserts the relation.** A cue of denial,
uncertainty, counterfactual or reported speech, appearing before the verb in the same clause,
suppresses the match.

**Scope is the clause, not a token window.** From the nearest clause boundary before the verb up to
the verb.

**A suppressed match is reported, never silently dropped.** `extractWithSuppressed` returns it with
the cue that governed it.

**Subject extent and polarity scope use different boundary lists**, because they answer different
questions.

**No numeric constant is introduced.**

## Why

**Because a window needs a number and a clause does not.** NegEx — the standard approach — is
trigger terms, pseudo-negation terms, termination terms and a scope of five to six tokens, and its
documented failure mode is that fixed window: with several candidates inside it the window produces
false positives, which is why later work replaces it with dependency paths. This engine does not
need either. The rule that matched already reports the exact offset of the verb, so scope can be the
thing a window approximates. That also keeps the module free of a constant nothing here could
calibrate.

**Because a parser is not available to `src/`.** `DEC-011` keeps third-party code out of `src/`, so
a dependency parse is not an option. Cue lists plus clause scope are what remains, and the
measurement says they are enough for the cases that occur.

**Because pseudo-negation is not optional.** It was skipped in the first version and held-out
testing found it immediately: *"No one disputes that the deploy caused the outage"* asserts, and a
cue list alone reads the leading "no" and suppresses. NegEx names these terms as part of the
algorithm; leaving them out cost two of four held-out failures.

**Because the two boundary lists really are different questions.** Polarity asks *does a cue govern
this predicate*, and a denial in a main clause does govern its `that`-complement — *"Nobody believes
that the deploy caused the outage"* is a denial. Subject extent asks *where does this noun phrase
begin*, and there the complementiser is exactly the boundary: the subject of `caused` is `the
deploy`, not `disputes that the deploy`. Measured: with one shared list, either the subject swallowed
`disputes that` or the denial stopped being seen. There is no single list that gets both right.

**Because suppressing silently would look like not noticing.** A caller who expected an edge and got
nothing deserves to know the text mentioned the relation and declined to assert it.

## What was rejected

- **A token window**, NegEx's own scope rule. Rejected: it needs a calibrated number, its failure
  mode is documented, and the verb offset makes it unnecessary here.
- **Emitting the relation with a `polarity: negative` flag** instead of suppressing. Rejected: every
  consumer would have to remember to check it, and the one that forgets writes a causal edge
  asserting the opposite of the text. `DEC-013` already puts the burden on the extractor to emit
  only what is stated.
- **A dependency parse.** Rejected under `DEC-011`: `src/` stays dependency-free. This is the
  reversal trigger — if polarity accuracy matters more than that boundary, the parse belongs behind
  the same interface and this record is superseded.
- **One boundary list for both questions.** Rejected on measurement, above.
- **Dropping suppressed matches silently.** Rejected: it makes a deliberate refusal
  indistinguishable from a rule that did not fire.

## What this constrains

- Every rule must declare a `verb` named group. Without it there is no offset to scope from, and the
  check degrades to always-assert — which is what the first implementation did, silently, until it
  was measured.
- A cue must match on word boundaries. Without that, `no` fires inside `notice`.
- `PSEUDO_CUES` is a hole in the negation check by construction, so an entry there costs precision.
  Keep it short and justify each addition.
- Any change here is re-measured with `bun run --cwd engine eval:extract`, and both precision **and**
  recall are reported — a cue list is the easiest thing in this codebase to improve on one and
  destroy on the other.

## How to reverse it

Cheap. Nothing is stored, the check is one call in the extraction loop, and removing it restores the
Phase 13 behaviour exactly. Replacing clause scope with a dependency parse is the expensive
direction, and it supersedes `DEC-011` rather than this record.
