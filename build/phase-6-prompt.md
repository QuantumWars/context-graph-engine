# Phase 6 — Reachable by a real session, and fed real data — 2026-08-19

**Why this phase.** The engine is tested, verified on a clean machine, and **used by nothing**. No
real data has ever gone into it. That is not a cosmetic gap: it is the wall every remaining open
item sits behind. The eval labels are synthetic because there is no real query log. The constants
cannot be properly calibrated because there is no real distribution. Concurrency is unmeasured
under contention because there is no contention. The RRF question is deferred pending a graph
denser than 34 records and 11 edges.

This project's own repeated lesson is that defects hide in the seam between a component and its
caller, and that a passing suite is not evidence anything is wired. **The engine has never had a
real caller.**

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

## The constraint this phase must not quietly break

**The engine ships zero runtime dependencies**, and `docs/security/threat-model.md` threat 14 rests
on it: the supply-chain question answers itself because there is no third-party code to compromise.
An MCP server needs the protocol SDK. Adding it to the core would trade the strongest security
property in the project for a transport.

So the boundary is a decision, not an implementation detail, and it is Task 6.1.

## Task 6.1 — Decide the dependency boundary, as a decision record

Where third-party code is allowed to live, what is trusted for what, and what the security test
must assert afterwards so the property is enforced rather than remembered.

Acceptance: a `DEC-` record naming the boundary and what it costs; `test/security.test.ts` updated
so it still fails if `src/` gains an external import, and separately asserts the allowed layer is
the *only* place one appears. The updated test is demonstrated red against an external import added
to `src/`, and that demonstration is pasted.

## Task 6.2 — Expose the engine over MCP

One tool per CLI verb — record, link, retract, purge, at, why, find, verify, log — with schemas
that reject bad input at the boundary the same way the CLI does. `DEC-003` still holds: no stored
string selects a code path, and a tool argument is untrusted input.

Acceptance: a server that lists its tools and answers a real `tools/call` for each verb, proven by
driving it over stdio as a subprocess rather than by importing it in-process — the in-process test
would prove the functions work, which is already known, and not that the server wires them.

## Task 6.3 — Package it as a plugin

`.claude-plugin/plugin.json`, an `.mcp.json` that launches the server, and a bundle so an install
does not need `node_modules` at the install site. Follow `project-graphx/` as the worked example.

Per `../CLAUDE.md`, the plugin validator **rejects** an explicit `agents` field and an explicit
`hooks` field in the manifest — both load by convention. Do not add either for symmetry.

Acceptance: the manifest validates, the bundle builds and is byte-reproducible from a clean
rebuild, and `.mcp.json` launches the bundle rather than the source. A test asserts the bundle is
current with its source, so a stale committed artifact fails the build rather than shipping.

## Task 6.4 — §T: reach it from a clean environment

`verification-suite`'s rule — the artifact you ship, not the one in your workspace.

Acceptance: a fresh clone into an empty directory, `env -i`, install, bundle, then a real
`tools/list` and at least three `tools/call` round trips over stdio against a store the clean
environment creates. Every result pasted. Anything unreachable there is reported **not shipped**.

## Task 6.5 — Feed it real data, and re-ask the deferred question

The payoff. This build has produced a real decision history — eleven `DEC-` records, six phase
summaries, real supersessions (`DEC-007` supersedes `DEC-006`; `DEC-010` supersedes `DEC-001`) and
real causal links between decisions and the findings that forced them.

Load it into a real store through the shipped surface, then re-run the sweep against it.

Acceptance: a store built from this repository's own build history, with node and edge counts
pasted and its chain verifying. Then `eval/sweep.ts` re-run against that graph, and an explicit
answer to the question Phase 5 deferred: **on a real graph, does `RRF_K` discriminate?** If it
does, the channels should overlap and the name was right. If it does not, the rename is the answer.
Either way the deferred item in `docs/future-work/README.md` is resolved with the run recorded, or
states plainly why the real graph still could not settle it.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`.claude/check.sh` at exit 0, the clean-environment MCP round trip pasted, and the work pushed as
feature branches on `QuantumWars/context-graph-engine`.
