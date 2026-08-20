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
reads no store and writes no file.
It exists because a test asserts what someone expected, while watching the thing run shows what
actually happens, and those are different kinds of evidence. The **product** CLI is
`bun --cwd engine src/cli.ts`, and the MCP surface is `mcp/server.bundle.mjs`.

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
src/resolve/               Algorithm 6 — blocking, similarity, clustering
src/extract/               Algorithms 7–8 — spans, rule-based extraction, entity linking
src/store/                 the append-only log and its rebuilt views
src/cli.ts                 the fifteen-command CLI
mcp/                       the MCP surface — the ONLY place with a dependency (DEC-011)
eval/                      labelled sets, metrics, the sweep
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

That rule built the first five algorithms and **none of them changed** to be wired in Phase 2 or
hardened in Phase 3, which is the evidence it works. It still applies to every new algorithm:
write it pure, prove it, then add callers. `src/resolve/` was built that way in Phase 7.

## Per-feature order, and it is not negotiable

For every feature: **port from Semantica → research for a better solution → decide and record
→ then build.** The port comes first deliberately. Researching first loses whatever was
actually good about the original, and the recon found four things in Semantica worth taking
alongside twelve defects.

Research uses the built-in `WebSearch` and `WebFetch`. `../../.mcp.json` declares one server —
this engine itself — and exa, firecrawl and context7 still do not exist, so the parent-library
skills that instruct their use remain decoration. `WebFetch` renders through a summarising model,
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

Read `build/DEC-001` … `DEC-011` before proposing an alternative; the usual next idea is
already in a `## What was rejected` section. `DEC-006` and `DEC-001` are superseded — check the
status line before citing one.

- **One append-only `log.jsonl` is the only truth.** Derived views are rebuilt on load and
  never persisted. A persisted derived copy is a second store, and a second store for one fact
  is Semantica finding A-2 — the bug that loses precedent search on reload and leaves purged
  content searchable by full text.
- **Digests are taken over canonical JSON, never over concatenated fields.** Semantica joins
  sixteen fields with no separator, so `("ab","c")` and `("a","bc")` collide.
- **All content is hostile data, never instructions.** No dynamic dispatch on a stored string.
- **The store is never committed.** Its `.gitignore` is written when the directory is created.

## The ten rules

From `build/POSTMORTEM.md` H10, each traceable to a specific failure in a phase summary. They live
here rather than there because a rule that stays in a post-mortem stops applying the moment that
document scrolls out of context.

1. **Before running a check, predict its result. If the result disagrees, the check is the suspect
   until proven otherwise.** A mutation that fails to kill, a grep that finds nothing, a script
   reporting all-clear — none is evidence until you have seen it produce the other answer. This
   build got this wrong **nine times**, and every catch came from having written the prediction
   down first.
2. **Never write output you have not run, and never write an example that could be mistaken for a
   record.** Not a summary, not "it would print". Both halves are the same failure — text that
   looks like it came from somewhere and did not. The second half was added on 2026-08-19 after an
   invented placeholder in a how-to guide (`d-postgres`, in a code block showing CLI syntax) was
   read as a real decision, and a decision record was nearly written for an incident that never
   happened, with the operator cited as its source. Mark a fictional example **at the point of
   use**: a plausible placeholder is indistinguishable from a real record the moment it leaves the
   paragraph that invented it.
3. **A fixture must be shown to change something.** Assert the pre-state before the post-state, or
   the edit may be a no-op — one tamper test "passed" against an edit that set a value to what it
   already was.
4. **A test that drives a component through its caller must vary what the caller defaults**, or it
   only proves the default works. All three store defects lived in that gap.
5. **Re-read the `DEC-` before writing code it governs, not after the test fails.** The decision you
   contradict is the one made two phases ago.
6. **When a decision names its own reversal trigger, ask what else could trigger it.** `DEC-001`
   predicted "if the sibling is restructured" and was killed by `mv`.
7. **Concurrency is only tested by real processes.** A single process serialises itself, so a
   single-process concurrency test proves nothing — this one hid a bug that lost 7 of 16 records.
8. **Boundary values include impossible ones.** Not only the epoch and the far future — the date
   that does not exist. `2026-02-29` was accepted and silently became 1 March.
9. **State the limitation in the same table as the mitigation.** An adversarial suite that lists
   only the attacks it defeats is marketing.
10. **Measure before optimising, and publish the number with the command that produced it** — then
    accept what it says, including when it moves the question somewhere else.

## Guards

A guard is worth exactly what it fails on. Before claiming a test works, name the source change
that makes it red, and where it is cheap, make that change and watch it fail, then restore.
`test/toolchain.test.ts` is the worked example: it asserts the strict flags and the two halves of
`check`, and it was seen red on 2026-08-19 by flipping `exactOptionalPropertyTypes` to `false`.

The whole suite was audited this way in Phase 3.5: 22 mutations across every source module, and
every one of the test files has at least one that kills it. Re-run that audit after adding a module.

A passing suite is not evidence that anything is wired. Before claiming a component works, name the
caller with a line.

## What the engine does NOT claim

Say these plainly, in this wording, wherever the subject comes up:

- **The chain proves that the records present have not been altered and are in the order they were
  written. It does not prove that all the records ever written are still present.** End-truncation
  and wholesale rewrite are undetectable — `docs/future-work/02-what-the-chain-cannot-detect.md`.
- **The engine guarantees stored content is never executed by the engine. It cannot guarantee it is
  never acted on by a reader.**
- **A purge clears this store and cannot reach a copy something else made.** Every tombstone carries
  `scope: 'this-store-only'` for that reason.
- **`RRF_K` and the causal distance bands are adopted, not measured**, and `RRF_K` provably cannot
  be measured while the retrieval channels stay disjoint. The retrieval floors **were** calibrated,
  three times, by `eval/sweep.ts`. Never describe an adopted constant as tuned, and re-sweep a
  calibrated one after any change to the scoring function — that is what invalidated it twice.
