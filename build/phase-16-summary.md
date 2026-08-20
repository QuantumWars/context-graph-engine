# PHASE 16 SUMMARY — Type awareness, and the diagnosis it refuted — 2026-08-20

**No pre-written prompt**; acceptance clauses are stated per task.

## 1. Verdict

**Phase closed, and Phase 15's diagnosis was wrong.** Type awareness was built, measured, and did
not fix the cases it was built for. What fixed them was already in the data.

```
$ bun run --cwd engine check
 438 pass
 0 fail
 1221 expect() calls
Ran 438 tests across 28 files. [4.76s]

$ bun run --cwd engine eval:link
  ranking            Top-1        88.2%   15/17     (unchanged)
  the reject option  NIL flagged  85.7%    6/7      (was 71.4%)
                     soft cost: 1 correct answer also flagged weak
  nil-near           4/5  80.0%                     (was 3/5)
```

| | Phase 12 | Phase 15 | Phase 16 |
|---|---|---|---|
| NIL flagged | 1/7 · 14.3% | 5/7 · 71.4% | **6/7 · 85.7%** |
| `nil-near` | 0/5 | 3/5 | **4/5** |
| Soft cost | — | 2 | **1** |
| Top-1 | 15/17 | 15/17 | **15/17** |

---

## Task 16.1 — Infer a type, because the constraint is otherwise unreachable

Acceptance: the mention's type is derived from its text, not supplied; a phrase with no type word is
untyped and untouched; and the dead type weight is shown to have been dead.

**The comparison.** `semantica` has the type constraint — `entity_linker.py:392` skips a candidate
whose `type` differs from the mention's — and **the caller must already know the mention's type**.
Measured: nothing in that repository derives one from text; `guess_type` and `_infer_type` are MIME
types and JSON schema. Our mentions arrive as raw phrases from `extract`, so the filter is
unreachable without inference.

**Met**, and it exposed something first:

```
record type          : "node"
probe type           : ""
similarity breakdown : {"total":0.7,"name":1,"type":0,"props":0}
=> the type component is DEAD (always 0)
```

`link` built its probe with `type: opts.type ?? ''`, and an empty string never equals a record kind.
**A fifth of the scoring weight contributed nothing to every linking call ever made**, and a perfect
name match capped at 0.700 — exactly the highest score the eval set had ever produced.

`inferType` reads the head noun against a `TYPE_NOUNS` vocabulary. Only a vocabulary makes it safe:
typing on the last word unconditionally would type *"no friday releases"* as `releases` and destroy
a correct link scoring 0.081. That negative is asserted directly.

---

## Task 16.2 — Measure it against the cases it was built for

Acceptance: report what it does to *"the payments team"* and *"the third quarter reliability
review"*, whatever that is.

**Met, and it refuted the design.**

```
"the payments team"                     inferType -> "team"
    0.415  team-platform   type="team"      <- promoted by the type match, still wrong
    0.396  team-growth     type="team"
    0.336  svc-payments    type="service"   <- correctly demoted
"the third quarter reliability review"  inferType -> "review"
    0.695  q2-review       type="review"    <- was 0.495, now HIGHER
    0.678  q1-review       type="review"
```

Type inference did exactly what it is supposed to — it demoted the service and promoted the teams —
and **both mentions still got confident wrong answers**. NIL flagged went *down*, 5/7 → 4/7.

Because these were never type errors. Both are **within-type** near-misses: a team among teams, a
quarter among quarters. Type awareness raises confidence on same-type near-misses, which is the
`nil-near` failure mode itself. Phase 15 wrote that these needed "type-awareness rather than a
better number"; that was a guess stated as a diagnosis, and building it is what showed the
difference.

---

## Task 16.3 — Find what those cases actually have in common

Acceptance: a rule chosen on measurement, evaluated in the form the engine ships it.

**Met.** Their gaps to the runner-up are **0.019 and 0.017**. Evaluated as a flag:

```
rule                     NIL flagged   Top-1    soft cost
score  < 0.30 (Phase 15)       4/7     15/17        1
margin < 0.05                  5/7     15/17        1
margin < 0.10                  6/7     15/17        1   <- adopted
score < 0.30 or margin < 0.10  6/7     15/17        2
```

`LINK_WEAK_MARGIN = 0.1` replaces `LINK_WEAK_SCORE = 0.3`. `DEC-018` records it.

### Phase 15's sweep measured a design the code does not use

Phase 15 concluded "every margin rule is worse" and wrote that into `DEC-017`. It swept every rule
as a **hard reject**, where a margin rule drops six correct answers and looks hopeless — and then
shipped a **flag**, where it drops nothing and wins outright. The conclusion did not survive being
measured in the right form.

`eval/link-sweep.ts` now prints both tables, and `DEC-018` states the rule: a sweep must evaluate
the rule in the form the engine ships it.

### And type inference still earns its place

Measured with it reverted, under the new rule: same NIL, same Top-1, **soft cost 2 instead of 1**.
It keeps one correct answer from being flagged. That is the whole of its contribution, it is small,
and it is why the code stays rather than being reverted with the diagnosis that motivated it.

---

## 2. The limitation a test found that the eval set could not

A CLI test failed with *"the cafeteria menu"* coming back `ranked` at 0.051. Against the three-record
CLI fixture it drew **one** candidate, so there was no margin to be small. Against the twenty-record
eval set the same phrase draws **sixteen** and is correctly `tie`.

**In a store too small for a mention to draw two candidates, a weak lone match reads as confident.**
A score fallback was measured and rejected — on the labelled set it flagged two correct answers and
caught nothing — so this is stated in `DEC-018` as a limitation that shrinks as a store grows, not
one that is fixed.

The eval set could not have found this: all three of its single-candidate mentions are correct
answers, and no NIL mention there has exactly one candidate.

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| the margin rule | reverting to a score threshold | red — 3 tests |
| the type vocabulary | typing every phrase by its last word | red |
| exactly one constant | (carried from Phase 15, now naming `LINK_WEAK_MARGIN`) | asserted |
| `weak` removes nothing | (carried, rewritten for the margin rule) | asserted |

## 4. Still open

- **`nil-near` is 4/5.** The remaining one is *"the search rewrite"* — a checkout rewrite exists and a
  search indexer exists, and the phrase is neither. It has enough of a gap to look confident.
- **Abbreviations, 1/2**, unchanged: trigrams cannot expand `SLO`.
- **Ambiguous, 1/2**, unchanged.
- **`TYPE_NOUNS` is a vocabulary, not a taxonomy**, hand-written from the kinds of thing this
  engine's records are. What would calibrate it is a labelled set of mentions with their types;
  `eval/linking.ts` has referents but not types.
- **`LINK_WEAK_MARGIN` is calibrated on 24 author-written mentions**, and moved from a score to a
  margin the moment the scorer changed. Any change to `src/resolve/similarity.ts` invalidates it
  again.
- **The extraction parenthetical gap** (Phase 14) is untouched.
