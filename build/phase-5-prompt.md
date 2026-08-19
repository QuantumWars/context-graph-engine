# Phase 5 — The evaluation harness — 2026-08-19

**Why this phase exists.** `POSTMORTEM.md` H9 names it as the oldest open item and the largest
single gap: `RRF_K = 60`, `LEXICAL_FLOOR`, `STRUCTURAL_FLOOR` and the causal distance bands are
**adopted, not measured**. Every one carries a declared-placeholder note, which is honest and is not
the same as knowing whether the value is any good.

It is also the exact failure the teardown found in the system this engine was built from:
`semantica/evals/__init__.py` is ten lines reading `__status__ = "coming_soon"`, so every weight and
threshold in it is uncalibrated by construction and nothing in that repository could establish
otherwise. Shipping four phases without a harness put us on the same path, later.

```
⛔ HARD RULES

1. Read before write; cite file:line.
2. One PR per phase. The PR body pastes real output — a query result, a
   captured row, a screenshot, a terminal transcript. No evidence, no merge.
3. Tests assert positive outcomes on real artifacts. "No error" is not
   evidence, and neither is "tests pass".
4. No silent returns. Every guard logs a reason code.
5. Never fabricate. Unverifiable ⇒ write UNVERIFIED and the exact query or
   command that would settle it.
6. An assertion that fails three times ⇒ STOP and report. Do not keep trying.
```

## The trap this phase must not fall into

**A harness that can only confirm the current constants is decoration**, and it is worse than no
harness because the number it blesses then looks measured. The labelled set will be built by the
same session that chose the constants, so the risk of grading our own homework is not hypothetical —
it is the default outcome unless something prevents it.

Two requirements follow, and they are not optional:

- **The labelling rule is written down before any constant is looked at**, and is mechanical enough
  that a second person could apply it and get the same labels.
- **The harness must be shown to reject a value.** If every sweep it runs endorses what we already
  shipped, that is evidence the harness is blind, not that the constants are right.

## Task 5.1 — Build the labelled set, and say who labelled it

`eval/` — a fixed corpus of records and a set of queries, each with the ids that *should* be
returned and the ids that should not. Realistic: the corpus is the kind of thing an agent actually
records — incidents, decisions, runbooks, notes — with the causal edges between them.

State the labelling rule at the top of the file, state that the labels were written by the same
session that wrote the retrieval code, and state what that means for how much the numbers are worth.

Acceptance: a corpus of at least 30 records with edges, and at least 15 queries carrying explicit
relevant and irrelevant ids — including at least three queries that **should return nothing**,
because an engine that abstains must be graded on abstaining. The labelling rule is stated, and a
test asserts every labelled id actually exists in the corpus so a typo cannot silently become a
missed hit.

## Task 5.2 — Define the metrics, including the ones for abstention

Precision and recall alone are the wrong instrument for this engine, because it can decline to
answer. A wrong answer and a refusal are different failures and must be counted differently.

Acceptance: metrics implemented as pure functions with their own tests — precision@k, recall@k,
MRR, and the two abstention measures: **false-serve** (served when it should have abstained) and
**false-abstain** (abstained when a relevant record existed). Each has a test with a hand-computed
expected value, so the metric itself is checked rather than trusted.

## Task 5.3 — Run the harness, against a baseline arm

A number with nothing to compare it to is not a measurement. Run the real retrieval path over the
labelled set, and run at least one deliberately simple baseline beside it.

Acceptance: a `bun eval/run.ts` that prints the metrics for the real path and for the baseline, over
the whole labelled set, with per-query detail available. The output is pasted. If the real path does
not beat the baseline, **say so** — that is a finding about the engine, not a reason to change the
baseline.

## Task 5.4 — Sweep the constants, and prove the sweep can say no

For each constant, run the labelled set across a range of values and report what the data says.

Acceptance: a sweep over `RRF_K`, `LEXICAL_FLOOR` and `STRUCTURAL_FLOOR`, with the metric at each
value pasted. Every constant ends the phase either **calibrated** — the value is what the sweep
chose, with the run recorded — or **still a declared placeholder**, with the reason the sweep could
not settle it. And the harness is shown to be capable of rejection: construct a case where the
shipped value is measurably wrong, run the sweep, and paste it choosing a different value.

## Task 5.5 — The constants ledger, and a lint that can fail

Every constant on the retrieval and causal paths gets a row: its value, its status — calibrated,
declared placeholder, or no provenance — and where that status is established.

Acceptance: `docs/constants-ledger.md` with a row per constant, and a **lint that fails** on a
constant with no provenance note at its definition site. The lint is demonstrated red against a
deliberately unprovenanced constant, and that demonstration is pasted. A constant that the sweep
calibrated says so, and names the run.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`.claude/check.sh` at exit 0, the sweep output pasted, the rejection demonstration pasted, and the
work pushed as feature branches on `QuantumWars/context-graph-engine`.
