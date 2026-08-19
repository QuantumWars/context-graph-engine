# Phase 1 — Stage 1: the five algorithms, in minimal code — 2026-08-19

**What closes this phase:** five algorithms that are right on inputs chosen to catch them out,
each with a proven failure, and none of them wired to anything.

Scope: `engine/src/` and `engine/test/`. `semantica/` and `memory/` are **read-only**.

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

## Stage rules, from `algorithm-first-development`

- **Pure functions over plain data.** No I/O, no store, no config, no framework, no error
  handling for conditions that cannot occur yet.
- **No imports from `memory/`.** `DEC-001` defers every reuse to Phase 2. A Stage 1 algorithm
  that needs a neighbour is a signal it is not yet minimal.
- **`engine/src/store/` stays empty.** It opens in Phase 2.
- **Order per feature, and it is not negotiable:** port from Semantica → research for a better
  solution → decide and record → then build. The port comes first because researching first
  loses whatever was good about the original.
- A Stage 1 file is allowed to be ugly. It is not allowed to be wrong.

## Task 1.1 — Port the hash-chained provenance record

Build `engine/src/provenance/chain.ts`. Port `semantica/semantica/provenance/integrity.py`
and `manager.py:1415-1485`: a per-entry SHA-256; `prev` assigned **before** hashing so the
link sits inside the digest; `seq` contiguous from 1; and `verifyChain()`'s three checks in
order — self-digest, then chain link, then sequence contiguity — with state advancing from
each entry's own stored fields so one corrupt row does not cascade into a false report about
its successors.

Canonical form is fixed by `DEC-006`: SHA-256 over canonical JSON of every field except
`digest`, keys sorted by UTF-16 code unit, no insignificant whitespace, `null` explicit and
absence distinct from it. Carry over the reasoning comment at `integrity.py:45-55` about
excluding the primary key from the hash, **and** record why we do not inherit that exclusion.

Research the tamper-evident log literature and JSON canonicalisation before finalising the
digest rule. Record what it changes, or that it changed nothing, in `docs/research/`.

Acceptance: a chain of N entries verifies clean; editing any entry's content in place is
reported as a checksum mismatch on that entry; deleting any entry is reported as a chain break
on its successor **and** as a sequence gap; two records that differ only in where a field
boundary falls produce different digests; and removing each of the three checks individually
turns exactly one test red, demonstrated and pasted.

## Task 1.2 — Port bitemporal validity windows and `stateAt`

Build `engine/src/temporal/window.ts`. Port `semantica/semantica/context/context_graph.py:2590-2631`.
The rule worth having: an edge is admitted to a snapshot only when its own window is open
**and both of its endpoints are active**. Bounds inclusive at both ends; a null bound means
unbounded.

Semantica treats a malformed temporal value as no bound at all and logs "treating node as
Always-Active" (`context_graph.py:151`, `:168`), so a corrupt timestamp makes a record *more*
visible. `DEC-003` forbids that: a malformed bound is a rejected input with a reason code.

Research SQL:2011 application-time versus system-versioned tables and decide whether the
engine carries transaction time as well as valid time.

Acceptance: an edge whose own window is open but whose target is retracted is absent from the
snapshot; the test asserts that **no** snapshot edge has an endpoint outside the snapshot's
node set, computed from the result rather than hardcoded; boundary instants are inclusive at
both ends; a malformed bound is rejected with a named reason code rather than silently
becoming unbounded; and deleting the endpoint check turns the dangling-edge test red,
demonstrated and pasted.

## Task 1.3 — Port retract and purge as two distinct operations

Build `engine/src/temporal/retract.ts`. Port `context_graph.py:1556-1919`. A retraction closes
the validity window and files a record that keeps the content answerable in history; a purge
removes the content and leaves a tombstone that **deliberately holds none of it**; a purge
supersedes and removes any prior retraction for the same entity. Window narrowing is
`min(existingEnd, at)` — a retraction never widens one.

This is where `DEC-004` comes due. It names purge as the remedy for a secret that reached the
store, and the store is an append-only hash chain, so the research step must produce a real
answer about what purge does to chain verification rather than declaring erasure out of scope.
A recorded limitation is an acceptable outcome. A quiet one is not.

Acceptance: after a retract, a point-in-time query before the retraction still returns the
record and a current query does not; after a purge neither does, and a scan of the serialised
tombstone for **every field value** of the purged content finds none of them; a retraction
against a window that already closed earlier leaves the earlier bound unchanged; and the state
of chain verification after a purge is stated explicitly and asserted, not assumed.

## Task 1.4 — Port Reciprocal Rank Fusion, then decide which implementation survives

Build `engine/src/retrieval/rrf.ts`. Port `semantica/semantica/vector_store/hybrid_search.py:148-186`:
`score(d) = Σ 1/(k+rank)`, ranks 1-based, `k = 60`, flat sum across channels, nothing
normalised. Fix the three defects confirmed in Phase 0: an id-less result falls back to its
object address and can never fuse; reconstruction is last-list-wins; the per-channel score is
destroyed by the fused score.

Then compare against `memory/src/recall.ts:363`, which already implements RRF here with a
different contract, and record the outcome as a decision record. Two live implementations of
one algorithm in one monorepo is the duplication this build exists to avoid.

Acceptance: closes finding A-6. Given one channel whose candidates are all poor and one whose
top candidate is excellent, the excellent candidate ranks first — and the same fixture scored
by per-channel min–max normalisation is asserted **in the same test** to rank them wrongly, so
the test fails against a min–max implementation. Every fused item carries its per-channel rank
and its original per-channel score. An item with no id is a hard error carrying a reason code,
never a silent unfusable. A decision record names which implementation survives and why.

## Task 1.5 — Port the decision node, typed causal edges and the causal chain

Build `engine/src/decision/causal.ts`. Port `context_graph.py:2734-2772` (`CAUSED`,
`INFLUENCED`, `PRECEDENT_FOR`) and `:3938-3974` (confidence decay as the product of edge
weights, weakest link as the argmin, distance bands). Keep the **per-path** cycle detection
rather than a global visited set — Semantica's own comment says a global set silently loses
valid chains on branching graphs.

Fix two traps confirmed in the teardown: `record_decision` writes `node_type="decision"` while
`add_decision` writes `"Decision"`, and two consumers compare exactly, so decisions created one
way are invisible to the other. One canonical form, validated at the boundary. And a stored
weight of `0.0` is meaningful and must not coerce to the `1.0` default.

**Stored once.** A decision is a node and that is the only copy. This is the whole of finding
A-2's fix and it holds from the first line.

Research how confidence should compose along a path — product, minimum, or noisy-OR — and
whether a product of uncalibrated weights carries any meaning worth reporting.

Acceptance: a chain report names its own weakest hop; an edge weighted `0.0` yields a decay of
`0.0` rather than `1.0`; a diamond-shaped graph returns both branches, proving per-path rather
than global cycle detection; a cycle terminates rather than looping; and a decision node
carries no second copy of its content anywhere, asserted structurally rather than by
inspection.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0, and
`.claude/check.sh` at exit 0. Every guard named above has been seen red and the transcript is
in the summary.
