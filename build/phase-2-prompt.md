# Phase 2 — Stage 2: interlink, one store, and the CLI — 2026-08-19

**What closes this phase:** one runnable thing you can point at. `engine/src/cli.ts` records a
decision, links it, retracts one, purges one, answers a point-in-time query, retrieves a
precedent and verifies the chain — against a real store on disk that survives a restart.

Scope: `engine/src/store/`, `engine/src/retrieval/channels.ts`, `engine/src/cli.ts`,
`engine/ARCHITECTURE.md`. The five Stage 1 algorithm modules are **closed** — this phase adds
callers, it does not change them. If an algorithm has to change to be wired, that is a finding
about Stage 1 and gets reported, not patched quietly.

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

Stage 2 connects features **along the dependencies that actually exist**, not by drawing a
diagram of what looks tidy. For each connection, answer *before* writing code:

> **What does A need from B, and what happens when B is absent, slow, or wrong?**

That last question is the whole stage. An interlink that assumes its neighbour always works is
the defect that ships. The stage closes when every connection is named, its failure behaviour
is stated, and **no guard returns silently — every one logs a reason code.**

Decisions already binding here: `DEC-001` (import `memory/src/lock.ts`, reimplement the rest),
`DEC-002` (workspace stamp is the enforced boundary), `DEC-003` (all content is data, validated
once at ingest), `DEC-005` (what may be stored at all), `DEC-007` (record envelope, canonical
form, four checks), `DEC-008` (both time axes, `recordedAt` never null).

## Task 2.1 — Build the store as one append-only log with rebuilt views

Build `engine/src/store/`. One file, `log.jsonl`, one canonical-JSON record per line. Reading
rebuilds every derived view — node table, edge adjacency, decision lookup — in memory. Nothing
derived is ever written to disk.

Writes go through `withFileLock` imported from `memory/src/lock.ts` by relative path, per
`DEC-001`. That import is confined to `engine/src/store/` so the cross-package coupling has
exactly one site and is greppable.

Every record carries the workspace stamp `DEC-002` requires, and a writer whose resolved
workspace disagrees with the store's own must not write into it.

Acceptance: a test enumerates **every read path as an explicit list in the test file**, then
asserts that after write → save → reload each one returns the record, and after purge → save →
reload none of them does. A read path added to the store without being added to that list must
fail the test, and that failure is demonstrated by adding one.

## Task 2.2 — Make the store and the chain unable to diverge

Every mutation appends to the same log the chain verifies, so there is no second write path
that could skip it. Loading a store whose chain does not verify is a named, reported condition
— never a silent load of a tampered log.

This is the first live writer for an edge store anywhere in this monorepo: no `edges.jsonl`
exists on disk today, and `memory/src/graph-store.ts` has producers but nothing that persists.

Acceptance: appending through the public API and then running `verifyChain` over the raw file
returns valid, with the entry count matching the number of mutations — asserted, not assumed.
Hand-editing one byte of content in the file on disk makes the next load report
`content_tampered` naming the record, and the load refuses rather than returning a partial
graph. Both are demonstrated against a real file.

## Task 2.3 — Wire the retrieval path and record every decision it makes

Build `engine/src/retrieval/channels.ts`: a **lexical** channel and a **structural** channel,
both pure and offline, feeding `fuse()` from Task 1.4. Then record the outcome using
`memory/src/ledger.ts`'s three-way shape — `served`, `abstained`, `error`.

Every firing records what was considered, what was served, and for each channel its top score,
its floor, and the margin between them — on served decisions **as well as** abstentions. An
abstention with no recorded margin is indistinguishable from a crash.

Acceptance: a served retrieval and an abstained retrieval are distinguishable **from the
recorded row alone**, without reading the code that produced them; both carry per-channel top
score, floor and margin; and a row claiming `served` while returning zero results is rejected
as a contradiction rather than written. Any floor introduced is annotated at its definition
site as a declared placeholder naming what would calibrate it.

## Task 2.4 — Write the interlink register

In `ARCHITECTURE.md`, replace the Phase 2 placeholder with a table: every connection made in
this phase, what the caller needs from the callee, what happens when the callee is absent, slow
or wrong, and the reason code that gets logged when it is.

Acceptance: every connection introduced in Tasks 2.1–2.3 appears with a named failure behaviour
and a reason code; every reason code in the table exists in the source, verified by a command
whose output is pasted; and no connection is listed whose failure behaviour is "cannot happen"
without saying what enforces that.

## Task 2.5 — Ship the CLI

`engine/src/cli.ts`, wired through `package.json`. Subcommands: `record`, `link`, `retract`,
`purge`, `at` (point-in-time), `why` (causal chain), `find` (retrieval), `verify`, `log`.

It is the thing a person points at, so it must be usable without reading the source: `--help`
lists the subcommands, an unknown subcommand exits non-zero with a reason, and a broken store
reports what is wrong rather than a stack trace.

Acceptance: a transcript, pasted, of a single session that records two decisions, links them,
retracts one, purges another, queries a point in time, walks the causal chain, retrieves a
precedent and verifies the chain — **against a real store directory that is deleted and rebuilt
by the test**, with the store's raw bytes shown at least once. `--help` exits 0 and an unknown
subcommand exits non-zero.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`.claude/check.sh` at exit 0, and every guard added in this phase seen red against a named
source change, pasted.
