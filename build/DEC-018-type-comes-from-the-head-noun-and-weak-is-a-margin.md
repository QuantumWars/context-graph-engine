# DEC-018 — A mention's type is inferred from its head noun, and `weak` is a margin rather than a score

_Decided 2026-08-20 · status: current — supersedes `DEC-017`'s constant, keeps everything else it says_

Phase 15 left two mentions no threshold could reject and diagnosed them as a type problem. **That
diagnosis was wrong**, and measuring it is what this record is.

**A mention's semantic type is inferred from its head noun**, against a `TYPE_NOUNS` vocabulary. A
phrase with no type noun is untyped, and an untyped side never causes a mismatch.

**Record types for linking are inferred the same way**, falling back to the record kind.

**`weak` fires on a small margin, not a low score.** `LINK_WEAK_MARGIN = 0.1` replaces
`LINK_WEAK_SCORE = 0.3`.

**A null margin counts as confident**, and that is an assumption this set cannot test.

Everything else in `DEC-017` stands: `weak` labels and never filters, candidates are never dropped,
and it remains the only constant this feature holds.

## Why

**Because the type component was dead and nobody had noticed.** `link` built its probe with
`type: opts.type ?? ''`, and an empty string never equals a record's kind, so `WEIGHTS.type` — a
fifth of the total — contributed **zero to every linking call ever made**. A perfect name match
capped at 0.700, which is exactly the highest score the eval set had ever produced.

**Because the mention's type has to be inferred or the constraint is unreachable.** `semantica` has
the constraint — `entity_linker.py:392` skips a candidate whose `type` differs — and it requires the
caller to already know the mention's type. Nothing there derives one from text. Our mentions arrive
as raw phrases from `extract`, so an inferred type is the only way the filter can ever run.

**Because the head noun is where English puts the kind**, and only a vocabulary makes it safe. Using
the last word unconditionally would type *"no friday releases"* as `releases` and destroy a correct
link scoring 0.081. Only phrases ending in a known kind word are typed at all.

**Because the two failing mentions were not type errors.** Measured:

```
"the payments team"                     inferType -> "team"
    0.415  team-platform   type="team"      <- promoted by the type match, still wrong
    0.336  svc-payments    type="service"   <- correctly demoted
"the third quarter reliability review"  inferType -> "review"
    0.695  q2-review       type="review"    <- was 0.495, now HIGHER
```

Type inference did exactly what it should and the mentions still got confident wrong answers,
because both are **within-type** near-misses: a team among teams, a quarter among quarters. Type
awareness raises confidence on same-type near-misses, which is the nil-near failure mode itself.

**Because the margin is what those two cases have in common.** Their gaps to the runner-up are 0.019
and 0.017. Measured as the flag the engine actually ships:

```
rule                     NIL flagged   Top-1    soft cost
score  < 0.30 (Phase 15)       4/7     15/17        1
margin < 0.05                  5/7     15/17        1
margin < 0.10                  6/7     15/17        1   <- adopted
score < 0.30 or margin < 0.10  6/7     15/17        2
```

**Phase 15's sweep measured a design the code does not use.** It evaluated every rule as a hard
reject, where a margin rule drops six correct answers and looks hopeless, and concluded margin rules
were all worse. As a flag it drops nothing and wins outright. `eval/link-sweep.ts` now prints both
tables.

**Because type inference still earns its place under the new rule.** Measured with it reverted: same
NIL, same Top-1, **soft cost 2 instead of 1**. It keeps one correct answer from being flagged, which
is the whole of its contribution and enough to justify it.

## What was rejected

- **The Phase 15 diagnosis**, that these needed type awareness. Rejected by building it: it did not
  fix either case. Recorded rather than quietly replaced, because a wrong diagnosis that gets
  overwritten teaches nothing.
- **A hard type filter**, `semantica`'s rule. Rejected: it discards candidates, which `DEC-017`
  forbids, and on these cases it would discard the *correctly demoted* one while leaving the wrong
  ones.
- **Keeping the score threshold alongside the margin.** Rejected on measurement: same NIL, double
  the soft cost.
- **A score fallback for single-candidate results.** Rejected: all three such mentions here are
  correct answers and no NIL mention has one candidate, so the fallback added soft cost and caught
  nothing.
- **Typing on the last word without a vocabulary.** Rejected: it destroys a correct link at 0.081.

## What this constrains

- `TYPE_NOUNS` is a vocabulary, not a taxonomy, and carries a declared-placeholder note. Adding a
  word that is not a kind of thing will type phrases that should be untyped.
- A null margin is treated as confident, and the limit of that is now known precisely. Against the
  20-record set an unrelated phrase draws **16** candidates with tiny gaps and is correctly weak;
  against a 3-record fixture the same phrase drew **one**, had no margin, and came back `ranked` at
  0.051. **In a store too small for a mention to draw two candidates, a weak lone match reads as
  confident.** A score fallback was measured and rejected — on the labelled set it flagged two
  correct answers and caught nothing — so this is a stated limitation rather than a fixed one, and
  it shrinks as a store grows.
- Any change to `src/resolve/similarity.ts` invalidates `LINK_WEAK_MARGIN`. Phase 16 changed the
  scorer and the constant moved from a score to a margin; that is the rule working, not an accident.
- A sweep must evaluate the rule in the form the engine ships it. Measuring a reject and shipping a
  flag is how Phase 15 reached a conclusion its own data did not support.

## How to reverse it

Cheap in both halves. Nothing is stored; removing `inferType` restores the dead type component and
costs one extra soft flag, and reverting to a score threshold costs two NIL detections. Neither
touches data on disk.
