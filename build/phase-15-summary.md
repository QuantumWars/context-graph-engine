# PHASE 15 SUMMARY — The linking reject option — 2026-08-20

**No pre-written prompt**; acceptance clauses are stated per task.

## 1. Verdict

**Phase closed.** Linking's reject option went from **1 of 7 to 5 of 7 without losing a single
correct answer**, and `DEC-014`'s reversal condition — set two phases before it was met — was
executed as an amendment rather than a rewrite.

```
$ bun run --cwd engine check
 436 pass
 0 fail
 1212 expect() calls
Ran 436 tests across 28 files. [4.57s]

$ bun run --cwd engine eval:link
  candidate generation   Recall@any 100.0%   17/17
  ranking                Top-1       88.2%   15/17     (unchanged)
  the reject option      NIL flagged 71.4%    5/7      (was 14.3%, 1/7)
                         soft cost: 2 correct answers also flagged weak — candidates kept
```

| | before | after |
|---|---|---|
| NIL handled | 1/7 · 14.3% | **5/7 · 71.4%** |
| Top-1 | 15/17 | **15/17 — unchanged** |
| `nil-far` | 1/2 | **2/2** |
| `nil-near` | 0/5 | **3/5** |

**First, the question that was asked: no, linking was not otherwise fixed.** Re-measured at the
start of this phase, Phases 13 and 14 having been extraction work: Top-1 88.2%, abbreviation 1/2,
ambiguous 1/2, all unchanged since Phase 12. Two of those remain open below.

---

## Task 15.1 — Calibrate, and report the whole curve

Acceptance: sweep the candidate rules rather than pick a number; report where no rule separates the
populations; and state what the best rule costs, not only what it gains.

**The comparison.** `semantica`'s reject is a score threshold — `similarity_threshold` default
**0.8**, `similarity >= threshold` or the candidate is dropped (`entity_linker.py:128,404`). That is
defensible for their scorer and not transferable: measured in Phase 11, their scorer gives 0.900 to
identical records and **0.656 to two entirely unrelated companies**, so its usable range is
compressed and 0.8 sits high inside it. A threshold copied between scorers means nothing.

**Met.** `eval/link-sweep.ts`, twenty-four rules:

```
none (today)   kept 15/17  nil 0/7  total 62.5%
score < 0.30   kept 13/17  nil 5/7  total 75.0%   <- best
score < 0.34   kept 11/17  nil 6/7  total 70.8%
margin < 0.05  kept 11/17  nil 5/7  total 66.7%   <- every margin rule is worse
```

```
with a referent, top-1 correct : 0.081 … 0.700
no referent (should reject)    : 0.000 … 0.495
```

**The populations overlap**, so 0.30 is the best of a bad set rather than a boundary. And the margin
— the obvious candidate, and the signal Phase 12 measured as strongly separating right from wrong
top-1s — is worse than the top score at every setting. `DEC-014`'s choice to report the margin
rather than threshold it survived its own calibration.

---

## Task 15.2 — Label rather than reject

Acceptance: the rule must not destroy a correct answer; the improvement measured; no candidate
dropped.

**Met, and the cost of the alternative was measured first.** A hard cut at 0.30 would silence:

```
0.081  "no friday releases"        [reworded] -> d-friday
0.293  "the follow the sun rota"   [reworded] -> d-oncall
```

Both correct, both rewordings — exactly the cases a linker exists to catch. And it would still miss:

```
0.336  "the payments team"                    [nil-near] -> svc-payments
0.495  "the third quarter reliability review" [nil-near] -> q2-review
```

So `weak` is a **fourth verdict, not a filter**: the full ranked list is returned unchanged and the
result is labelled. NIL handling 1/7 → 5/7, Top-1 unchanged, and the two correct answers it also
flags are reported as `weakButRight` so the soft cost is visible rather than hidden.

`DEC-017` records it, and **amends `DEC-014` rather than superseding it** — only the no-constant
clause moved. Reporting over deciding, the margin as a report, and no identity claim from a score
all stand.

---

## Task 15.3 — Present it as a warning on both surfaces

Acceptance: a caller reading the output must not take rank 1 from a weak result by default.

**Met.** The CLI prints the verdict in yellow with an explanation; `extract` marks a weak endpoint
list `(probably none of these)`; the MCP description says plainly that a weak verdict means the
phrase probably refers to nothing, with the measured five-of-seven behind it, and the tool's `note`
field changes accordingly.

The CLI test asserts the warning text and that the candidates are still listed, because a verdict
nobody reads is the same as no verdict.

---

## 2. The guard that made this phase possible

Phase 10 wrote a test asserting `src/extract/link.ts` **exported no numeric constant at all**, and
proved it could fail by scanning a synthetic `LINK_FLOOR = 0.35`. Adding `LINK_WEAK_SCORE` turned it
red immediately:

```
(fail) Task 10.1 — the module introduces no constant > no exported numeric constant
```

That is exactly what it was for. A constant could not arrive here quietly, so `DEC-017` had to be
written before the code could ship — the guard enforced the decision record, not just the code.

It was **narrowed rather than deleted**: it now asserts `LINK_WEAK_SCORE` is the *only* exported
numeric constant, that it carries a `PROVENANCE: **calibrated**` note naming the run, and that the
only decimal comparison in the file is against it. Adding a second constant still turns it red.

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| `weak` removes nothing | filtering candidates below the threshold | red — 4 tests |
| exactly one constant | adding a second `export const` | red — 2 tests |
| the `weak` verdict | reverting to three verdicts | red — 3 tests |
| the CLI warning | (asserted directly on real CLI output) | asserted |

## 4. Still open

- **`nil-near` is 3/5, not 5/5.** *"the payments team"* (0.336) and *"the third quarter reliability
  review"* (0.495) both score above anything a threshold can safely cut. They are near-misses of
  records that genuinely exist — a payments *service* does, a q2 review does — and separating them
  needs the linker to know that "team" and "service" are different kinds of thing, which is
  type-awareness rather than a better number.
- **Abbreviations, 1/2**, unchanged: *"the SLO doc"* ranks `svc-search` first and leaves the gold at
  rank 2. Trigrams cannot expand an acronym.
- **Ambiguous, 1/2**, unchanged.
- **`LINK_WEAK_SCORE` is calibrated on 24 author-written mentions.** That is a real calibration and a
  small one, and any change to `src/resolve/similarity.ts` invalidates it — exactly as a scoring
  change invalidated the retrieval floors twice.
- **The extraction parenthetical gap** (Phase 14) is untouched.
- Everything else carried from Phase 14.
