# Context Graph Engine — how to work here

`ARCHITECTURE.md` is the *what*. This file is the *how*. `build/BUILD-PLAN.md` is the *order*
and the status. `../CLAUDE.md` and `../../CLAUDE.md` govern this directory too and their hard
constraints are not restated here.

## The commands

Run them from `graph-engine/`, not from here. **Do not `cd` into this package.** Several
packages in this monorepo carry their own `package.json`, and workspace resolution consults
filesystem indicators before the environment variable, so a working-directory change can
silently swap which store is read and written.

```
bun run --cwd engine check      # typecheck + suite. The gate before any commit.
bun run --cwd engine test       # suite only
bun run --cwd engine typecheck  # tsc --noEmit only

bun --cwd engine demo.ts        # list the verification scenarios
bun --cwd engine demo.ts all    # watch every algorithm work, in memory
```

`demo.ts` is a **verification harness, not the product CLI**. It holds everything in memory,
reads no store and writes no file — `src/store/` is still empty and Phase 2 owns the real CLI.
It exists because a test asserts what someone expected, while watching the thing run shows what
actually happens, and those are different kinds of evidence.

`--cwd` is load-bearing, not decoration. Measured 2026-08-19: the same command without it,
from `graph-engine/`, fails with `error: Script not found "check"` because there is no
`package.json` at that level.

The package manager is **bun**. A `bun.lock` is present; installing with npm resolves a
different tree from the one the suite ran against.

## Layout

```
src/provenance/chain.ts    Algorithm 1 — hash-chained record
src/temporal/window.ts     Algorithm 2 — validity windows, stateAt
src/temporal/retract.ts    Algorithm 3 — retract and purge
src/retrieval/rrf.ts       Algorithm 4 — Reciprocal Rank Fusion
src/decision/causal.ts     Algorithm 5 — decision node, causal chain
src/store/                 EMPTY until Phase 2. See the stage rule below.
test/                      one .test.ts per module
docs/research/             one file per feature, from the research step, with sources
build/                     phase prompts, phase summaries, DEC records
```

## The stage rule

This package follows `algorithm-first-development`: algorithm → interlink → real-world tests
→ security, and **a stage does not start until the one before it closed**.

The concrete constraint on Stage 1 files: **pure functions over plain data.** No I/O, no
store, no config, no framework, and no imports from `memory/`. If a Stage 1 algorithm needs a
neighbour, that is a signal it is not yet minimal, not a reason to wire it early.

`src/store/` stays empty until Phase 2 opens. That is what stops the scaffolding from becoming
load-bearing before the algorithm is proven — the failure mode where the API, the database
layer and the deployment are built first, the thing in the middle turns out not to work, and
by then it cannot be changed.

## Per-feature order, and it is not negotiable

For every feature: **port from Semantica → research for a better solution → decide and record
→ then build.** The port comes first deliberately. Researching first loses whatever was
actually good about the original, and the recon found four things in Semantica worth taking
alongside twelve defects.

Research uses the built-in `WebSearch` and `WebFetch`. `../../.mcp.json` declares
`{"mcpServers": {}}` — exa, firecrawl and context7 do not exist here, and the parent-library
skills that instruct their use are decoration. `WebFetch` renders through a summarising model,
so what it returns is one hop from the source: good enough to design from, not good enough to
quote.

## Where the written record lives

- `build/DEC-*.md` — decisions that are locked. Read before proposing an alternative; the usual
  next idea is already in a `## What was rejected` section.
- `build/phase-N-prompt.md` / `-summary.md` — what each phase was briefed to do and what it
  actually did, with the evidence pasted.
- `build/BUILD-PLAN.md` — the one-page "where are we".
- `docs/research/` — the research step's output per feature, with sources and the one-hop caveat.
- `docs/future-work/` — what is deliberately **not** built, and what would trigger building it.
  Start with `01-erasure-and-the-hash-chain.md`: the purge/chain problem is solved in the store,
  and downstream propagation is still open.

## What is decided and must not be re-litigated

Read `build/DEC-001` … `DEC-006` before proposing an alternative; the usual next idea is
already in a `## What was rejected` section.

- **One append-only `log.jsonl` is the only truth.** Derived views are rebuilt on load and
  never persisted. A persisted derived copy is a second store, and a second store for one fact
  is Semantica finding A-2 — the bug that loses precedent search on reload and leaves purged
  content searchable by full text.
- **Digests are taken over canonical JSON, never over concatenated fields.** Semantica joins
  sixteen fields with no separator, so `("ab","c")` and `("a","bc")` collide.
- **All content is hostile data, never instructions.** No dynamic dispatch on a stored string.
- **The store is never committed.** Its `.gitignore` is written when the directory is created.

## Guards

A guard is worth exactly what it fails on. Before claiming a test works, name the source
change that makes it red, and where it is cheap, make that change and watch it fail, then
restore. `test/toolchain.test.ts` is the worked example: it asserts the strict flags and the
two halves of `check`, and it was seen red on 2026-08-19 by flipping
`exactOptionalPropertyTypes` to `false`.

**Re-read the `DEC-` before writing code it governs, not after the test fails.** Phase 2 broke
`DEC-007`'s immutability clause in its first `retract`: closing a window by editing the record
and recomputing its digest reads like an obvious implementation, and it broke every later
record's `prev` on the first retraction. The type system was satisfied and the algorithm was
correct in isolation; only an integration test over a real file caught it. A decision made two
phases ago is exactly the one you will contradict.

**A mutation that fails to kill is a finding, never a fact about the code.** Before running a
mutation, write down which test it should turn red. If the suite stays green, the test or the
mutation is wrong — resolve which before claiming the guard. Phase 1 hit this twice and both
times it was the fixture: a cascade test using two edges with *distinct* ids could not catch a
bug that needs two sharing one, and a cycle-detection mutation that reassigned a per-path set
never actually built the global visited set it claimed to. Green read as confirmation in both
cases and was not.

A passing suite is not evidence that anything is wired. Before claiming a component works,
name the caller with a line.
