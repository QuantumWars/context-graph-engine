# Constants ledger

Every numeric constant on a decision path, its status, and where that status is established.

**Three statuses are acceptable, and one of them must be stated at the definition site:**
**calibrated** (and name the run), **declared placeholder** (and name what would calibrate it),
or **no provenance** (and say so plainly). Silence is not one of them.

`scripts/lint-constants.mjs` enforces this and **fails** — it is wired into `.claude/check.sh`, and
it was demonstrated red twice: against a constant with no comment, and against one with a
plausible-sounding comment that says nothing.

```
$ node scripts/lint-constants.mjs
lint-constants: PASS — 8 constant(s), every one accounted for
```

## The ledger

| Constant | Value | Status | Established by |
|---|---|---|---|
| `LEXICAL_FLOOR` | **0.4** | **calibrated** | `eval/sweep.ts`, 2026-08-19, 19 labelled queries. Was 0.01. |
| `STRUCTURAL_FLOOR` | 1 | **calibrated**, weakly | `eval/sweep.ts` — best of four values; no interior optimum. |
| `RRF_K` | 60 | **declared placeholder** | Sweep ran it and **could not discriminate** — see below. |
| `BAND_DIRECT_MAX` | 1 | declared placeholder | Ported from `helpers.py:586-605`; needs a causal-question set. |
| `BAND_NEAR_MAX` | 3 | declared placeholder | as above |
| `BAND_MID_MAX` | 6 | declared placeholder | as above |
| `FALSE_SERVE_PENALTY` | 0.02 | **no provenance** | A judgement. Steers every calibration — see below. |
| `FALSE_ABSTAIN_PENALTY` | 0.01 | **no provenance** | Half of the above, by the same judgement. |

## `LEXICAL_FLOOR` — the one the harness actually moved

This is the evidence that the harness is not decoration. It was asked to check a value we had
already shipped, and it rejected it.

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

At 0.01 a single incidental token was enough to answer a question the corpus knows nothing
about — "graphql schema stitching strategy" returned two database records because they contain
the word *schema*, and "quarterly revenue forecast" returned a note about watering plants because
both contain *by*.

**The trade is real and is not free:** false abstains went 0 → 1 and recall@10 fell 89.6% → 87.5%.
The whole-set effect: correct abstentions went from **1 of 3 to 3 of 3**.

0.4 rather than 0.5 because they score identically and 0.4 sits further from the cliff at 0.6.

## `RRF_K` — measured, and still a placeholder, for a reason worth reading

The sweep ran 1, 5, 10, 20, 30, 60, 120, 300. **Every value scored 0.819.** That is not a shortage
of data; it is structural:

```
  queries checked         : 19
  queries with any overlap: 0
  => a document appears in BOTH channels in 0 of 19 queries
```

`structuralChannel` excludes every lexical seed by construction, so the two channels are
**disjoint**. With one contribution per item, RRF's score is `1/(k+rank)` — monotonically
decreasing in rank for any positive `k` — so the ordering is by rank and `k` cannot change it.

**RRF's entire mechanism is rewarding agreement across channels, and this engine's channels can
never agree, because they cannot both contain the same document.** What we have is not fusion; it
is two disjoint ranked lists interleaved by rank.

A variant that lets seeds also score structurally was measured. It does create overlap — 18 at the
calibrated floor — and it scores **0.819, identical**. Not adopted: a design change that costs
complexity and buys nothing measurable is not an improvement.

So `RRF_K = 60` stands as the source paper's default (Cormack, Clarke & Buettcher, SIGIR 2009),
and **no document may describe it as tuned.** What would settle it: channels that can genuinely
overlap, and a labelled set where the difference matters.

## The penalties — the most load-bearing unmeasured numbers here

`FALSE_SERVE_PENALTY` and `FALSE_ABSTAIN_PENALTY` are a **judgement**: a wrong answer is penalised
twice as hard as a refusal, because a wrong answer propagates into whatever consumes it while a
refusal only costs the query.

Nothing measured that ratio and nothing here could — it depends on what reads the output.
**And it steers every calibration the sweep performs.** Change it to 1:1 and `LEXICAL_FLOOR` may
move. That is why `eval/sweep.ts` prints precision, recall and both failure counts beside the
score: a reader who disagrees with the weighting can still use the table.

## What the ledger does not cover

- **Values inside functions that are not named constants.** The lint sees exported numeric
  constants; a literal buried in an expression is invisible to it. The causal bands were extracted
  into named constants for exactly this reason, and a future threshold should be too.
- **The labels themselves**, which are the biggest uncertainty in every number above. They were
  written by the session that wrote the retrieval code. `eval/dataset.ts` says so at the top and
  says what it is worth.
