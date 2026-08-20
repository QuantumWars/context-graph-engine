# PHASE 18 SUMMARY — The remaining gaps, in one phase — 2026-08-20

**No pre-written prompt.** Deliberately one phase for all three remaining gaps rather than three,
because three phases on one feature is the pattern the operator named after Phase 17.

## 1. Verdict

**Phase closed.** Extraction is perfect on its set; linking's reject option is complete.

```
$ bun run --cwd engine check
 461 pass
 0 fail
 1259 expect() calls
Ran 461 tests across 29 files. [4.78s]

$ bun run --cwd engine eval:extract
    precision  100.0%   15/15    recall  100.0%   15/15    F1 100.0%    silence 100.0%  18/18

$ bun run --cwd engine eval:link
    Recall@any 100.0%   Top-1 94.1%  16/17   NIL flagged 100.0%  7/7   nil-near 5/5
```

| | before | after |
|---|---|---|
| Extraction recall | 93.3% | **100%** |
| Linking NIL | 6/7 · 85.7% | **7/7 · 100%** |
| `nil-near` | 4/5 | **5/5** |
| Top-1 | 16/17 | 16/17 — unchanged |

**One gap remains and it is arguably not one.** See §4.

---

## Task 18.1 — The parenthetical subject

Acceptance: *"The audit, if thorough, informed the rewrite"* emits its relation, without changing
what any other sentence emits, and without a numeric bound.

**Met.** An optional parenthetical between subject and verb: `(?:\s*,[^,.;:!?]*,)?`. It cannot cross
a comma or a sentence boundary, so it is bounded **structurally** — there is no token count to
calibrate.

```
"The audit, if thorough, informed the rewrite."
   current : no match
   proposed: "The audit"→"the rewrite"
"The March postmortem informed the rollback policy."
   current : "The March postmortem"→"the rollback policy"
   proposed: "The March postmortem"→"the rollback policy"
```

Every other sentence is untouched, checked before the change landed. Extraction is now **100%
precision, 100% recall, 100% silence** on 31 texts and 15 gold relations.

---

## Task 18.2 — `nil-near`: agreeing on kind is not agreeing on identity

Acceptance: a rule chosen on measurement that flags the remaining `nil-near` mention without
costing a correct answer.

**The measurement first:**

```
"the search rewrite"  type="rewrite"  verdict=ranked  margin=0.181
  0.450  proj-checkout-rewrite   type=rewrite   "the checkout rewrite"
  0.269  svc-search              type=indexer   "the search indexer"
```

The type match **promoted** the wrong answer — Phase 16's finding again, and this is its other half.
*"the search rewrite"* and *"the checkout rewrite"* share exactly one word, and it is the type noun.
They agree on **kind** and on nothing else, which is agreement about a category rather than about
an identity.

**Met.** `typeOnlyMatch` makes that a `weak` verdict. Measured over the whole labelled set before
being adopted:

```
  NIL   "the payments team"     top=team-platform
  NIL   "the search rewrite"    top=proj-checkout-rewrite
type-only rule would newly flag: 2 NIL mention(s), and 0 correct answer(s)
```

Two NIL mentions, **zero correct answers**. `nil-near` 4/5 → 5/5; NIL 6/7 → 7/7; Top-1 unchanged.

### The cost, stated plainly

It needed `NON_DISTINGUISHING`, a closed-class stopword list, because without it *"the"* counts as
agreement and the rule never fires. **That is the third hand-written vocabulary in this feature**
after `TYPE_NOUNS` and the polarity cues, and it is the standing weakness of this build. What would
calibrate it is document frequency over a real store — which `lexicalChannel` already computes for
retrieval and which is not reusable here, because `link` scores against a candidate pool rather than
a corpus. The note is at the definition site rather than in a footnote.

`tokenise` was checked first as a way to avoid the list; it keeps `the`.

---

## Task 18.3 — Put the shipped rule in the sweep

Acceptance: the sweep table must show the rule the engine actually ships.

**Met, and it mattered.** After the type-only rule the sweep still reported `margin < 0.10` as best
at nil 6/7, while the engine was getting 7/7 — the table understated what was deployed. That is
**rule 12** (*measure the rule in the form you ship it*) recurring inside the same file the rule was
written for.

```
  margin < 0.10                      nil  6/7  top-1 16/17  soft 1
  score < 0.30 or margin < 0.10      nil  6/7  top-1 16/17  soft 2
  SHIPPED: margin or type-only       nil  7/7  top-1 16/17  soft 1   ◀ best
```

## 2. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| the type-only rule | removing it from the verdict | red — 2 tests |
| the stopword set | emptying it | red — 3 tests |
| the parenthetical | reverting the rule patterns | red |

## 3. A mistake worth recording

The first version of the sweep's shipped-rule row read
`MENTIONS.find((m) => m.gold === r.gold || true)` — the `|| true` makes it always return the first
mention, so the row would have measured one sentence twenty-four times. It typechecked. Caught by
reading it back rather than by any test, because a sweep row has no assertion behind it.

## 4. Still open

- **`ambiguous` is 1/2, and the engine is arguably right.** *"the checkout problem"* returns
  **`tie`** — two candidates at exactly 0.300, gold at rank 3 with 0.221. The engine is saying *"I
  cannot tell"*, which is true; the Top-1 metric counts it as a miss, which is also true. Ranking
  the incident first needs *problem* ≈ *outage*, which is a synonym resource this build does not
  have and which would be a **fourth** hand-written vocabulary. Left alone deliberately.
- **Every evaluation set is still author-written**, which remains the ceiling on all of these
  numbers.
- `TYPE_NOUNS`, `POLARITY_CUES`, `PSEUDO_CUES`, `NON_DISTINGUISHING` — four hand-written
  vocabularies, none corpus-calibrated.
