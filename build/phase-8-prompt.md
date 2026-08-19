# Phase 8 — Wire resolution into the store — 2026-08-20

**Why this phase.** Phase 7 built blocking, similarity and clustering as a Stage 1 island, and
nothing calls them. Under this project's own rule that is the point at which a component is
decoration: *a passing suite is not evidence that anything is wired.*

The interlink needs a decision first, and `DEC-012` makes it: **a cluster is derived and never
stored; a merge is an appended assertion carrying ids and never content; reads resolve through
merges and say which merge they used; a merge is retractable because a merge can be wrong.**

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

## Task 8.1 — Propose clusters from the real store, without writing anything

A `suggest` path: read the log, build candidates from records that carry a name, cluster them, and
return the proposals with the weakest link that holds each together. **It must write nothing** —
`DEC-012` makes clusters derived, and a derived thing that persists is a second store.

Acceptance: a test proves the log is byte-identical before and after a suggestion run, and that a
suggestion names its weakest link. A run against the real store is pasted, whatever it finds —
including if it finds nothing, which on 18 hand-ided records is a plausible and reportable outcome.

## Task 8.2 — Append a merge, and resolve reads through it

The `merge` record kind, and every content read path resolving through it to the canonical record.

Acceptance: after merging B into A, a read for B answers from A **and names the merge that
redirected it**. The merge record contains no field value of either member's content, asserted by
scanning it the way the tombstone test does. The chain verifies after the merge.

## Task 8.3 — Retract a merge, and prove the un-merge

`DEC-012` says there is no separate un-merge: retraction is the mechanism.

Acceptance: after retracting the merge, a read for B answers from B again. A point-in-time query
before the retraction still resolves through the merge, and after it does not — so the un-merge is
visible on the valid-time axis rather than being a silent revert.

## Task 8.4 — The interactions nothing has thought through

This is the part of the phase most likely to find something. Merge crosses retraction, purge, the
two time axes and the causal walk, and each crossing is a decision that has not been made.

At minimum: purge a merged member; retract a merged member without retracting the merge; merge a
record that is already merged; a merge naming a record that does not exist; and a merge whose
canonical member is later purged — that last one is the uncomfortable case, because reads redirect
*to* it.

Acceptance: each interaction has a test asserting a named outcome and a reason code where it
refuses. Any case whose right answer is genuinely unclear is reported as an open question with the
options, not resolved by whatever the code happens to do.

## Task 8.5 — Reach it from the CLI and MCP

A `suggest` verb and a `merge` verb on both surfaces, `merge` requiring explicit members —
`DEC-012` forbids automatic merging, and a verb that merges what it suggested in one step would be
automatic merging with extra steps.

Acceptance: a pasted session against a real store — suggest, merge, read through it, verify,
retract, read again. Driven through the shipped surface, not the API.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`.claude/check.sh` at exit 0, the real-store session pasted, every guard seen red, and the work
pushed as feature branches.
