# PHASE 5 SUMMARY — The evaluation harness — 2026-08-19

## 1. Verdict

**Phase closed. The harness rejected a shipped constant on its first run, which is the only
result that would have made it worth building.**

```
$ bun run --cwd engine check
 241 pass
 0 fail
 606 expect() calls
Ran 241 tests across 17 files. [2.48s]

$ bash .claude/check.sh
check.sh exit=0
```

Two findings, and the second is the more interesting one.

| # | Finding | Consequence |
|---|---|---|
| 1 | **`LEXICAL_FLOOR` was 40× too low.** 0.01 → 0.4 | precision@10 **39.6% → 78.8%**, correct abstentions **1 of 3 → 3 of 3**, false serves 2 → 0 |
| 2 | **The engine is not actually doing rank fusion.** The two channels are disjoint by construction, so `RRF_K` cannot affect any ordering, ever | `RRF_K` stays a declared placeholder — now for a *measured* reason instead of an unexamined one |

---

## Task 5.1 — Build the labelled set, and say who labelled it

Acceptance: a corpus of at least 30 records with edges, and at least 15 queries carrying explicit
relevant and irrelevant ids — including at least three queries that **should return nothing**,
because an engine that abstains must be graded on abstaining. The labelling rule is stated, and a
test asserts every labelled id actually exists in the corpus so a typo cannot silently become a
missed hit.

**Met.** 34 records, 11 edges, 19 queries, 3 of which expect nothing.

```
  corpus: 34   queries: 19   edges: 11
```

The labelling rule is at the top of `eval/dataset.ts` and was written before any constant was
looked at. It is deliberately narrow: a record is relevant if it is *about* the query's subject, or
if it is the direct cause or consequence of such a record **and the graph records that link
explicitly**. One hop, and only asserted edges. Sharing a word is not relevance — that clause is
what makes the noise records do their job.

**Who labelled it, stated in the file rather than a footnote:** the same session that wrote the
retrieval code. That is the weakest thing about this dataset. It means the numbers are evidence the
retrieval path behaves as intended on cases its author considered, and not evidence it behaves well
on cases its author did not think of. Two things limit the damage and neither eliminates it — the
rule was written first and labels follow the rule rather than the engine's output, and the sweep is
required to be capable of rejecting a shipped value. What would genuinely fix it is labels from
someone who did not write the code. That is not available offline and pretending otherwise would be
worse than saying so.

The integrity test caught a real defect in my own dataset on its first run: `q16`'s note was 19
characters, below the 20-character bar the test sets for "every query carries its reasoning". The
note was expanded rather than the bar lowered — the note exists so a reader who disagrees with a
label can see why it was made.

---

## Task 5.2 — Define the metrics, including the ones for abstention

Acceptance: metrics implemented as pure functions with their own tests — precision@k, recall@k,
MRR, and the two abstention measures: **false-serve** and **false-abstain**. Each has a test with a
hand-computed expected value, so the metric itself is checked rather than trusted.

**Met.** 20 tests, every expected value computed by hand in the comment beside it.

```
$ bun test --cwd engine test/metrics.test.ts
 20 pass
 0 fail
 31 expect() calls
```

Precision and recall alone are the wrong instrument for an engine that can decline to answer, so a
wrong answer and a refusal are counted separately and never averaged into one number that hides
which happened. The subtlety that needed its own test: **precision, recall and MRR are averaged
over answerable queries only.** Averaging a correctly-abstaining query's precision of 0 into the
same mean would score a *correct decision* as a failure. There is a test asserting the difference:

```ts
const wrongWay = (0.5 + 0 + 0) / 3;        // 0.1666 — a correct abstention dragging the mean down
expect(r.precision).not.toBeCloseTo(wrongWay, 6);
expect(r.precision).toBeCloseTo(0.25, 10);  // the right way
```

---

## Task 5.3 — Run the harness, against a baseline arm

Acceptance: a `bun eval/run.ts` that prints the metrics for the real path and for the baseline,
over the whole labelled set. If the real path does not beat the baseline, **say so** — that is a
finding about the engine, not a reason to change the baseline.

**Met.** Two baselines: `lexical-only` (one channel, no floor, never abstains) and `return-all`
(returns the corpus, deliberately terrible, present to prove the metric discriminates).

**Before calibration**, which is the run that mattered:

```
  arm              score   P@10   R@10    MRR  falseServe  falseAbstain  forbidden
  engine           0.509  39.6%  89.6%  77.1%           2             0          2
  lexical-only     0.439  37.1%  67.7%  91.7%           2             0          2
  return-all       0.119  11.2%  43.8%  24.2%           3             0          2

  ✓ the engine beats every baseline
  correct abstentions: 1 of 3
```

The engine won, and the win was thin — and `lexical-only` had **better MRR**, meaning the
structural channel was pushing relevant items *down* the ranking. Abstaining correctly on 1 of 3
was the clearest signal that something was wrong.

**After calibration:**

```
  engine           0.819  78.8%  87.5%  84.4%           0             1          1
  lexical-only     0.439  37.1%  67.7%  91.7%           2             0          2
  return-all       0.119  11.2%  43.8%  24.2%           3             0          2

  ✓ the engine beats every baseline
  correct abstentions: 3 of 3
```

`lexical-only` still has the better MRR (91.7% vs 84.4%). Recorded rather than smoothed over: the
structural channel buys recall and costs rank position, and whether that trade is right depends on
whether a reader scans a list or takes the top item. Nothing here measured that.

---

## Task 5.4 — Sweep the constants, and prove the sweep can say no

Acceptance: a sweep over `RRF_K`, `LEXICAL_FLOOR` and `STRUCTURAL_FLOOR`, with the metric at each
value pasted. Every constant ends the phase either **calibrated** or **still a declared
placeholder** with the reason the sweep could not settle it. And the harness is shown to be capable
of rejection: construct a case where the shipped value is measurably wrong, run the sweep, and
paste it choosing a different value.

**Met — and no case had to be constructed, because the shipped value was already wrong.**

```
LEXICAL_FLOOR   shipped: 0.01
     value   score   P@10   R@10    MRR  fServe  fAbstain
      0.01   0.509  39.6%  89.6%  77.1%       2         0  ◄ shipped
       0.2   0.509  39.6%  89.6%  77.1%       2         0
       0.3   0.627  50.3%  90.6%  81.3%       1         0
       0.4   0.819  78.8%  87.5%  84.4%       0         1  ◄ best
       0.5   0.819  78.8%  87.5%  84.4%       0         1
       0.6   0.529  55.7%  62.5%  62.5%       0         6
         1   0.348  43.8%  43.8%  43.8%       0         9
  → the sweep prefers 0.4 over the shipped 0.01 (0.819 vs 0.509)
```

At 0.01, one incidental token was enough to answer a question the corpus knows nothing about.
`"graphql schema stitching strategy"` returned two database records because they contain the word
*schema*; `"quarterly revenue forecast by region"` returned a note about watering plants because
both contain *by*. The floor was doing nothing.

0.4 rather than 0.5 because they score identically and 0.4 sits further from the cliff at 0.6. The
trade is stated at the definition site: false abstains 0 → 1, recall 89.6% → 87.5%.

### The second finding: this engine is not doing rank fusion

`RRF_K` came back **completely flat** — 1, 5, 10, 20, 30, 60, 120, 300 all scoring 0.819. Rule 1
says a flat result is either "the constant does not matter" or "the constant is not wired", and the
two must be distinguished. It is wired:

```
  rrfK=  1  canary-gate:0.50000  checkout-outage:0.50000  fire-drill:0.33333
  rrfK= 60  canary-gate:0.01639  checkout-outage:0.01639  fire-drill:0.01613
  rrfK=300  canary-gate:0.00332  checkout-outage:0.00332  fire-drill:0.00331
```

The scores move by two orders of magnitude and **the ordering never changes**. The cause:

```
  queries checked         : 19
  queries with any overlap: 0
  => a document appears in BOTH channels in 0 of 19 queries
```

`structuralChannel` excludes every lexical seed by construction, so the channels are **disjoint**.
With one contribution per item the score is `1/(k+rank)` — monotonically decreasing in rank for any
positive `k` — so the ordering is by rank and `k` cannot affect it.

**RRF's entire mechanism is rewarding agreement across channels, and these channels can never
agree, because they can never both contain the same document.** What the engine does is not
fusion; it is two disjoint ranked lists interleaved by rank.

A variant that lets seeds also score structurally was measured before drawing any conclusion. It
does create overlap — 18 at the calibrated floor — and scores **0.819, identical**. Not adopted: a
design change that costs complexity and buys nothing measurable is not an improvement.

**`STRUCTURAL_FLOOR`** the sweep agreed with, weakly: 1 was already the best of four values, and
raising it trades recall for MRR monotonically with no interior optimum.

---

## Task 5.5 — The constants ledger, and a lint that can fail

Acceptance: `docs/constants-ledger.md` with a row per constant, and a **lint that fails** on a
constant with no provenance note at its definition site. The lint is demonstrated red against a
deliberately unprovenanced constant, and that demonstration is pasted.

**Met.** `scripts/lint-constants.mjs`, wired into `.claude/check.sh`, exit 0/1/2 with exit 2
reserved for "found nothing to check".

```
$ node scripts/lint-constants.mjs
lint-constants: PASS — 8 constant(s), every one accounted for
```

**Demonstrated red twice**, because the interesting failure is not the missing comment — it is the
comment that sounds like provenance and is not:

```
$ printf 'export const UNPROVENANCED_THRESHOLD = 0.42;' >> src/retrieval/rrf.ts
lint-constants: FAIL — 1 of 9 constant(s) have no provenance
  src/retrieval/rrf.ts:153  UNPROVENANCED_THRESHOLD
    no comment at all
  exit=1

$ printf '/** A carefully chosen value that works well in practice. */\nexport const PLAUSIBLE_SOUNDING = 0.42;' >> src/retrieval/rrf.ts
  lint exit=1
  lint-constants: FAIL — 1 of 9 constant(s) have no provenance
    src/retrieval/rrf.ts:154  PLAUSIBLE_SOUNDING
      a comment, but no `PROVENANCE: **calibrated|declared placeholder|no provenance**`
```

**The lint found six real gaps on its first run**, including two constants written minutes earlier
in this same phase. It also forced the causal distance bands out of the function body into named
constants — a magic number the lint cannot reach is a magic number with no provenance, whatever a
comment nearby says.

The ledger's most uncomfortable row is `FALSE_SERVE_PENALTY`, recorded as **no provenance**: it is
a judgement that a wrong answer costs twice a refusal, nothing measured it, and **it steers every
calibration the sweep performs.** Change it to 1:1 and `LEXICAL_FLOOR` may move. The sweep prints
precision, recall and both failure counts beside the score so a reader who disagrees with the
weighting can still use the table.

---

## 2. The characteristic failure of this phase

**My own instrument reported a tie as a preference.** The sweep printed

```
  → the sweep prefers 1 over the shipped 60 (0.819 vs 0.819)
```

Identical scores. "Prefers" was wrong, and had I acted on it I would have changed a shipped
constant for no reason and recorded it as calibrated. Fixed to distinguish three cases — a genuine
preference, agreement, and **FLAT**, where every value scores the same and the honest report is
that the sweep *cannot* calibrate this constant.

That is the tenth instance of this build's characteristic failure — a check that appeared to work —
and it arrived in the phase whose entire purpose is producing trustworthy instruments. The rule
that caught it is rule 1, applied to the sweep's own output rather than to the code under test.

## 3. Still open

- **The labels were written by the author of the code.** Stated in `eval/dataset.ts`. The single
  largest uncertainty in every number this phase produced.
- **`RRF_K` cannot be calibrated while the channels are disjoint.** Either accept that this is
  rank-interleaving rather than fusion and rename it, or change the channels so they can overlap —
  and the measurement says the second buys nothing today.
- **The causal distance bands are still placeholders.** They need a labelled set of *causal*
  questions — "is a three-hop chain still useful evidence?" — which is a different dataset from the
  retrieval one. The sweep infrastructure already exists to consume it.
- **`lexical-only` still has better MRR than the engine.** The structural channel buys recall and
  costs rank position. Whether that trade is right depends on whether a reader scans or takes the
  top item, and nothing here measured that.
- **19 queries is a small set.** Wide plateaux in the sweep are reassuring; a narrow optimum on a
  set this size would have been overfitting and should be treated as such.

## 4. What a next build depends on from this one

A harness that has been shown to reject a shipped value, so a future constant can be argued about
with data instead of taste. And a lint that makes silence about a threshold impossible, which is
the thing the studied system never had — it shipped 89 CLI commands and an evaluation package of
ten lines reading `__status__ = "coming_soon"`.
