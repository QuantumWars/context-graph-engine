# DEC-009 — Keep both RRF implementations, because they answer different questions, and name the boundary between them

_Decided 2026-08-19 · status: current_

`engine/src/retrieval/rrf.ts` and `memory/src/recall.ts:363` both implement Reciprocal Rank
Fusion. **Both stay.** This is not a tie left unbroken — the two have different contracts, and
the boundary is:

| | `memory/src/recall.ts` | `engine/src/retrieval/rrf.ts` |
|---|---|---|
| Channels | exactly two, named in the signature | any number |
| Returns | `string[]` — ids only | items carrying per-channel rank, original score and RRF share |
| Missing id | impossible by type; no runtime path | hard error, `missing_id` |
| Duplicate id within a channel | silently last-wins | hard error, `duplicate_id_in_channel` |
| Purpose | rank memories for recall | fuse retrieval channels and **explain** the ranking |

Neither is rewritten in terms of the other, and `engine/` does not import `memory/`'s.

**If a third implementation is ever proposed, this record is the thing to read first.** Two is
the maximum, and each has a stated reason.

## Why

The obvious move was to import `memory/`'s and delete ours, and it does not survive contact
with either the code or the acceptance.

**Contract.** Its signature is `(lexical, embedding, k) => string[]`
(`memory/src/recall.ts:363-376`): two fixed channels, and a return of bare ids. Task 1.4's
acceptance requires every fused item to carry its per-channel rank and its original per-channel
score, and requires an id-less candidate to be a named error. Neither is expressible in a
function that returns `string[]`, so adopting it would mean weakening the acceptance to fit the
code we already had — the exact inversion this build exists to avoid.

**Dependencies.** `recall.ts` imports `./index-db` and `./embed`, so importing its fusion pulls
`bun:sqlite` and an ONNX runtime into a package that deliberately has no model. Measured in
Phase 0:

```
$ command grep -an '^import' memory/src/recall.ts
33:import { type MemoryIndex, type SearchHit } from './index-db';
34:import type { Memory } from './store';
35:import type { EmbeddingHit } from './embed';
```

**And the reverse move is worse.** Widening `memory/`'s function to n channels and a
score-carrying return changes a **live-wired** package — its hooks are registered in the
monorepo root `.claude/settings.json` — to serve a package with no users yet. That is a real
risk taken for a hypothetical benefit.

The honest summary: this is duplication of an *algorithm*, which is four lines of arithmetic
from a 2009 paper, not duplication of a *component*. `DEC-001`'s concern was the second kind —
four stale copies of a whole skill-graph. Two implementations of `1/(k+rank)` with different
return types is a different thing, and pretending otherwise would be applying a rule past the
problem it was written for.

## What was rejected

- **Import `memory/`'s and delete ours.** Rejected: its return type cannot carry the evidence
  Task 1.4's acceptance requires, and it drags `bun:sqlite` and an ONNX runtime with it.
- **Widen `memory/`'s to n channels and have both use it.** Rejected: it modifies a live-wired
  package to serve one with no users, and `memory/` has two callers that would need re-proving
  for no benefit to them.
- **Extract a shared `rrf` package both import.** Rejected *for now*: a third package, its own
  lockfile and release, for four lines of arithmetic. Worth revisiting only if a third caller
  appears — that is the trigger.
- **Delete `memory/`'s and have it import `engine/`'s.** Rejected: it points a live, working
  component at an unproven one, and inverts the dependency the wrong way round.
- **Adopt weighted RRF now.** Rejected: there is no evaluation harness to fit weights against,
  and an unfittable weight is the exact structural problem the teardown found in Semantica,
  where `semantica/evals/__init__.py` is ten lines reading `__status__ = "coming_soon"`.

## What this constrains

- `engine/` does not import `memory/src/recall.ts`, and `memory/` is not modified by this build.
- A **third** RRF implementation in this monorepo is a defect. Any new caller uses one of these
  two, or the shared-package option above is taken deliberately with its own record.
- `RRF_K = 60` is a **declared placeholder** in both, and neither may be described as tuned
  until an evaluation harness has measured it. It is annotated as such at both definition sites.
- Our fusion must keep every channel's contribution. Collapsing to ids would make it the other
  implementation, at which point this record no longer justifies keeping two.

## How to reverse it

If a third caller appears, extract a shared package: move `engine/`'s implementation into it,
have `memory/` adopt it behind its existing two-channel signature so its callers do not change,
and re-run `memory/`'s suite as the proof. Assume a day, most of it spent re-proving the live
package rather than writing the fusion. Reversing toward "one implementation, `memory/`'s"
requires withdrawing Task 1.4's acceptance first, since the two cannot both hold.
