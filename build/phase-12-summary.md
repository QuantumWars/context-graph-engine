# PHASE 12 SUMMARY — An evaluation harness for entity linking — 2026-08-20

**No pre-written prompt**, as in Phase 11: this was asked for directly, and the acceptance clauses
are stated per task below.

## 1. Verdict

**Phase closed.** Linking now has a labelled set, three metrics from the literature, and a runner.
Phases 9 and 10 both closed saying "no evaluation harness, so quote no figure". There are figures
now, and one of them is bad.

```
$ bun run --cwd engine check
 397 pass
 0 fail
 1068 expect() calls
Ran 397 tests across 26 files. [4.38s]

$ bun run --cwd engine eval:link
  candidate generation
    Recall@any   100.0%   17/17 — gold reachable at all
    Recall@3     100.0%   17/17
  ranking
    Top-1         88.2%   15/17
  the reject option
    NIL correct   14.3%   1/7 answered "nothing here"
```

| | |
|---|---|
| Candidate generation | **loses nothing** — 17/17 |
| Ranking | **88.2%** top-1, better than Phase 10 feared |
| The reject option | **14.3%**, and `nil-near` is **0/5** — the failure of this phase |
| `DEC-014`'s margin claim | **vindicated**: median 0.3154 when right, 0.0048 when wrong |

---

## Task 12.1 — Build the labelled set, with NIL as a first-class label

Acceptance: the labelling rule and its author are stated at the top of the file as `eval/dataset.ts`
and `eval/duplicates.ts` do; a meaningful fraction of the set is NIL; and the hard NIL family is
proven hard rather than asserted to be.

**The comparison.** `semantica` has **no labelled set at all** — `grep -rn "ground_truth"` over its
source and its tests returns nothing. What it has instead is
`semantic_extract/extraction_validator.py`, whose docstring at line 18 advertises
*"Validation Metrics: Precision, recall, F1-score calculations"*. Measured: that phrase appears
exactly once in the file, in the docstring, and **nowhere in the code**. What it computes is:

```python
score = 1.0
score *= 1.0 - low_conf_ratio * 0.5
score *= 1.0 - dup_ratio * 0.3
score *= 0.5 + avg_confidence * 0.5
```

A function of the extractor's **own self-reported confidence**, with five unprovenanced constants.
An extractor emitting `confidence=1.0` for everything scores perfectly; the score cannot detect a
wrong answer, only a diffident one. Given finding A-8 — `confidence=0.6,  # Meets default threshold`
— the numbers being fed in were chosen to clear a filter in the first place.

**A validator whose input is the thing it validates is not a measurement.** Every function in
`eval/link-metrics.ts` therefore takes a gold label it did not produce.

**Met.** `eval/linking.ts`: 20 records, 24 mentions, 7 of them NIL. Seven families, and the rule
states why the hard ones exist:

> The NIL-near family is the point. A linker is easy to fool with NIL-far mentions and every scheme
> gets those right; the ones worth having look linkable and are not.

The set is honest about its own weakness in the same place `duplicates.ts` is — same session wrote
the labels and the linker — and about its size: 24 mentions means one label moves a metric by about
four points. **It is enough to catch a regression and to test the margin claim, and not enough to
compare two designs.**

---

## Task 12.2 — Metrics from the literature, hand-computed in tests

Acceptance: Recall@k, Top-1 and NIL accuracy as pure functions; every count in the tests worked out
by hand rather than by running the code; candidate-generation loss reported separately from ranking
loss, because one is recoverable and the other is not.

**Met.** `eval/link-metrics.ts`, with `scoreLinking` asserted against a six-row fixture whose every
number is counted by hand:

```ts
expect(s).toEqual({
  inStore: 4, recallAtAny: 3, recallAtK: 2, k: 3,
  top1: 1, nil: 2, nilCorrect: 1, missed: ['d'],
});
```

`recallAtAny` is kept apart from `top1` deliberately: a mention the generator drops is gone, because
nothing downstream ever looks at it, while a bad rank is a scoring problem a better scorer can fix.
One number would hide which of the two is failing — and on this set the answer is unambiguous.

---

## Task 12.3 — Test whether the margin is worth anything

Acceptance: a measurement that could refute `DEC-014` rather than illustrate it — if the median
margin behind a correct answer is no larger than behind a wrong one, the margin is decoration and
the decision record has to say so.

**Met, and `DEC-014` survives it.**

```
  is the margin worth anything?  DEC-014 rests on this
    median margin when top-1 is RIGHT  0.3154  (n=12)
    median margin when top-1 is WRONG  0.0048  (n=2)
    separation +0.3106 — a wider gap does mean a better answer, on this set
```

A wrong top-1 sits essentially on top of its runner-up; a right one is clear of it by about a third.
`DEC-014` returns a margin instead of applying a threshold on the argument that the gap is the honest
signal, and on this set that argument holds. `n=2` on the wrong side is thin and is printed.

---

## 2. The finding: the reject option barely works

**`nil-near` scores 0 out of 5.** Every mention that refers to nothing but *looks* like it might got
an answer:

```
MISS the checkout redesign workshop    want (nothing)  got proj-checkout-rewrite @0.272
MISS the payments team                 want (nothing)  got svc-payments @0.336
MISS the third quarter reliability review  want (nothing)  got q2-review @0.495
MISS the search rewrite                want (nothing)  got svc-search @0.269
MISS the deploy freeze policy          want (nothing)  got d-gate @0.114
MISS the cafeteria menu rotation       want (nothing)  got proj-migration @0.098
```

This is not a surprise so much as a measurement of a known shape. `DEC-014` adopted the two
threshold-free NIL techniques — *no candidates at all* and *a tie at the top* — precisely because
they need no number, and `no_candidates` only fires when blocking finds nothing whatever. Blocking
is generous by design, so it almost always finds something.

**The numbers say a threshold would work.** Wrong NIL answers cluster at 0.098–0.336 while correct
in-store answers sit at 0.320–0.700, and the margin separates cleanly as measured above.

**`DEC-014`'s own reversal condition is now met.** It says:

> Any future NIL threshold arrives with the labelled set that calibrates it and supersedes this
> record; it may not be added as a default parameter.

The labelled set now exists. **I have not added the threshold**, because adding one supersedes a
current decision record and that is the operator's call, not mine. The two overlapping ranges above
(0.336 against 0.320) also mean no single score cut separates them cleanly on this set — which is
itself worth knowing before anyone picks a number.

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| the headline regression guard | making `link` return only its top candidate | red |
| real NIL coverage | emptying the NIL rows | red |
| `nil-near` is genuinely near | (rewritten — see below) | — |

**The `nil-near` guard was wrong first.** It compared whitespace-split words against record names
and failed on *"the deploy freeze policy"*, because the records say `pre-deploy` as one token while
the blocker splits hyphens. The test was stricter than the thing it was describing. Rewritten to
assert what actually makes a nil-near mention a trap: **it draws candidates and still has no
referent.**

## 4. Still open

- **The reject option, above.** The largest known defect in linking, now with a number on it.
- **Abbreviations are a real weakness**, 1/2: *"the SLO doc"* ranks `svc-search` first and puts the
  gold `doc-slo` at rank 2. Trigrams cannot expand an acronym, and nothing here tries to.
- **The labelled set is author-written and small.** 24 mentions, 20 records, labels and code from one
  session. Same weakness `eval/dataset.ts` and `eval/duplicates.ts` both carry.
- **The set is synthetic.** The records are plausible for a context store and are not from one.
- **No evaluation harness for extraction** (Phase 9) — still absent.
- Everything carried from Phase 11.
