# BUILD-PLAN — Context Graph Engine

The order, and where development stands. **Updated at every phase close.** If you are a new
session or a new developer, this file plus the phase summaries beside it are the whole trail;
you should not have to ask anyone what happened.

## Status

**Phases 0–5 closed.** Phase 5 reopened the build for the item the post-mortem named as the
largest gap, and the harness rejected a shipped constant on its first run. Post-mortem: `POSTMORTEM.md`. The ten standing rules moved into
`engine/CLAUDE.md`.


| Phase | Stage | What | Status |
|---|---|---|---|
| 0 | — | Feasibility, skeleton, and the decisions that cannot wait | **closed 2026-08-19 — GO** |
| 1 | 1 | The five algorithms, minimal code, algorithm tests only | **closed 2026-08-19 — 107 tests, every guard seen red** |
| 2 | 2 | Interlink by real interconnectivity; one store; the CLI | **closed 2026-08-19 — 153 tests, CLI shipped** |
| 3 | 3 | Real-world, adversarial and ugly-input test suites | **closed 2026-08-19 — 190 tests, 3 real bugs found** |
| 4 | 4 | Security pass and the §T shipped-artifact check | **closed 2026-08-19 — 210 tests, 16 threats, clean-env §T green** |
| 5 | — | The evaluation harness | **closed 2026-08-19 — 241 tests; LEXICAL_FLOOR recalibrated 0.01 → 0.4** |
| 6 | — | MCP surface, plugin packaging, first real corpus | **closed 2026-08-19 — 252 tests; RRF question answered on real data** |
| 7 | — | Entity resolution: blocking, similarity, clustering | **closed 2026-08-19 — 290 tests; the recon's take list is complete** |

## The method

`algorithm-first-development`: algorithm → interlink → real-world tests → security, with
documentation written as you go, and a stage that does not start until the one before it
closed. Per feature: port from Semantica, then research for a better solution, then decide and
record, then build.

Its one amendment to security-last: four decisions are architecture, not review — the
authorisation model, the trust boundary, secret handling, and what data is stored at all.
Those are `DEC-002` through `DEC-005` and they were made in Phase 0.

## Decisions locked

| Record | Decision |
|---|---|
| `DEC-001` | Import `memory/`'s file lock; reimplement everything else, with a reason per item |
| `DEC-002` | One local principal; enforce the workspace boundary instead of per-record authorisation |
| `DEC-003` | All content entering the store is hostile data, never instructions |
| `DEC-004` | Hold no secrets; a secret reaching the store is an incident purge answers |
| `DEC-005` | Store explicit records and provenance; never raw prompts, transcripts or file contents |
| `DEC-006` | One append-only log; hash over canonical JSON — *superseded by DEC-007* |
| `DEC-007` | Hash a salted **commitment** to the content, so purge and an unbroken chain coexist |
| `DEC-008` | Carry both time axes: valid time on the record, transaction time from the log |
| `DEC-009` | Keep both RRF implementations; they answer different questions. A third is a defect |
| `DEC-010` | Vendor the file lock — a standalone repo has no sibling to import from |
| `DEC-011` | Third-party code lives only in `mcp/`; `src/` stays dependency-free |

## Phase 1 — the five algorithms

Each is one task, and each runs the same four steps in order: port, research, decide, test.

| Task | Algorithm | Novelty here |
|---|---|---|
| 1.1 | Hash-chained provenance record | genuinely new — `memory/` content-addresses but has no chain |
| 1.2 | Bitemporal windows and `stateAt` | partly new — facts have valid-time; the graph has no snapshot |
| 1.3 | Retract and purge | purge is new — `memory/src/facts.ts` invalidates and never erases |
| 1.4 | Reciprocal Rank Fusion | exists in `memory/src/recall.ts` with a different contract; 1.4 ends in a decision record naming which survives |
| 1.5 | Decision node, typed causal edges, causal chain | mostly new |

## The open question this build may not solve

**Purge versus an unbroken hash chain.** Erasing a record's content breaks the digest of the
record that chained from it. Semantica sidesteps this by scoping purge to one graph and saying
so; `memory/src/facts.ts` sidesteps it by never erasing at all. Task 1.3's research step is
scoped to settle it, and a recorded limitation is an acceptable outcome. A quiet one is not.

## Gates

All three exit **0 pass, 1 fail, 2 could not run**. Exit 2 is not a pass.

```
bun run --cwd engine check
node .claude/skills/evidence-gate/scripts/gate.mjs --dir engine/build
node .claude/skills/definition-gate/scripts/lint.mjs --root .
.claude/check.sh
```
