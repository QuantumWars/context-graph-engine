# Phase 7 — Entity resolution: blocking before pairwise comparison — 2026-08-19

**Why this phase.** It is the last unbuilt item on `recon-semantica/70-rebuild-plan.md`'s take
list, and the recon rates it highly: *"the second-best-engineered thing here."* Six of the seven
takes are built; this is the seventh.

**Why it matters beyond completing a list.** A context store fragments silently. An agent records
`checkout-outage` in March and `friday-incident` in June for the same event, and nothing notices —
the graph just gets worse answers, with no error and no failing test. And finding A-1 is blocked on
it: Semantica detects conflicts by grouping records on a shared identifier, then runs deduplication
*afterwards*, so the detector has nothing to compare. **Disagreement is evidence about a merge, and
you cannot have it before identity is resolved.**

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

## What the source actually does, confirmed this session

`semantica/semantica/deduplication/similarity_calculator.py:651-692` builds overlapping blocks from
several key families — 4-character token prefixes, optionally type-scoped, optionally phonetic —
and unions them, so an entity belongs to many blocks and only same-block pairs are compared. That
design is sound and is the thing to take.

Two defects travel with it, both confirmed by reading the file:

- **A-11.** `strategy = options.get("candidate_strategy", "legacy")`, and `legacy` blocks on
  `name[0]`. The good implementation is reachable only by passing an option that the CLI sets and
  the documented Python API does not. The advertised "blocking + semantic deduplication" is
  first-letter bucketing for most callers.
- **The cap drops the wrong neighbours.** `sorted(neighbors)[:max_candidates]` keeps the
  **lowest-indexed** neighbours, not the most similar, so truncation sheds recall in insertion
  order — and it is applied per entity from both ends, so it is not a degree bound either.

## Task 7.1 — Port blocking, with one strategy and no legacy default

Build `engine/src/resolve/blocking.ts`: token-prefix keys, type-scoped keys, phonetic keys, unioned
into candidate pairs. **There is no `legacy` mode and no strategy option** — a default that silently
degrades the advertised behaviour is the defect, not a feature to preserve.

Acceptance: two records whose names share a token produce a candidate pair; two that share nothing
produce none; an entity with no name is not silently made a candidate for every other nameless one
without that being a stated, tested choice. Blocking is proven to reduce comparisons against the
all-pairs baseline on a fixture, with the reduction stated as a number.

## Task 7.2 — Cap by similarity, never by index

When an entity has more candidates than the cap allows, keep the **most similar**, not the
lowest-indexed.

Acceptance: a fixture where the true match sits at a high index and the cap is smaller than the
candidate count. Under an index-ordered cap the true match is dropped; under a similarity-ordered
cap it survives. **Both assertions in the same test**, so it fails against the ported behaviour.

## Task 7.3 — Score similarity, with the weights stated once

A similarity function over name, type and properties. Finding A-12 is that the original's
docstring names four weights and its signature uses four different ones — embedding is documented
as the largest term and is off by default.

Acceptance: the weights exist in exactly one place, sum to a stated total, and a test fails if a
weight is changed without the total being restated. Every weight carries a `PROVENANCE:` note, so
`constants-gate` passes.

## Task 7.4 — Cluster, and say what transitivity costs

Blocking yields pairs; resolution needs entities. Two records matching a third does not always mean
they match each other, and a naive transitive closure merges a chain of weak links into one entity.

Acceptance: connected components over the accepted pairs, with the transitivity risk **demonstrated**
— a fixture of three records where A~B and B~C but A is plainly not C, showing what the closure
does, and the chosen policy stated with its cost. No silent merge.

## Task 7.5 — Measure it with the standard metrics

Blocking has established measures and this phase uses them rather than inventing any:

- **Pair Completeness** `PC = |D(B)| / |D(E)|` — the share of true duplicates surviving blocking.
  Recall. A match blocking drops is unrecoverable downstream.
- **Pairs Quality** `PQ = |D(B)| / ‖B‖` — precision of the candidate set.
- **Reduction Ratio** `RR = 1 − ‖B‖ / ‖E‖` — comparisons saved against all-pairs.

Acceptance: a labelled duplicate set in `eval/`, with the labelling rule and its author stated as
`eval/dataset.ts` does. PC, PQ and RR computed as pure functions with hand-computed tests, reported
for the real blocker and for an all-pairs baseline. Any constant introduced is swept or declared.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`.claude/check.sh` at exit 0, PC/PQ/RR pasted, every guard seen red, and the work pushed as feature
branches on `QuantumWars/context-graph-engine`.
