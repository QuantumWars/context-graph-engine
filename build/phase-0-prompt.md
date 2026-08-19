# Phase 0 — Context Graph Engine: feasibility, skeleton, and the decisions that cannot wait — 2026-08-19

**Premise under test:** *"the five spine algorithms can be built here as pure TypeScript,
the recon findings they rest on are true, and the reuse boundary with `memory/` is
decidable before any algorithm is written."*

Scope: `graph-engine/engine/` (new), `graph-engine/.claude/` (skill install, one drift fix).
`semantica/` and `memory/` are **read-only** this phase. No algorithm is implemented here.

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

## Task 0.1 — Stand up the `engine/` package and establish the test invocation

Create `engine/package.json` (`"type": "module"`, `"check": "bun run typecheck && bun test"`)
and `engine/tsconfig.json` mirroring `memory/tsconfig.json`'s strictness
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`). Add one
trivial passing test so the runner is proven, not assumed.

Establish the exact invocation that runs the suite **without a casual `cd`**. `CLAUDE.md`
records that workspace resolution consults filesystem indicators before the environment
variable, so a working-directory change can silently swap which store is read and written.

Acceptance: `bun --version` and a real `bun test` transcript from `engine/`, showing at least
1 pass and 0 fail, plus `tsc --noEmit` exiting clean; and the invocation is written down in
`engine/CLAUDE.md` as the command future sessions use.

## Task 0.2 — Re-confirm the three recon claims this build is load-bearing on

The recon executed nothing — every claim in `recon-semantica/` is an AST fact or a
transcription. Three of them are load-bearing for Phase 1 and must be re-confirmed against
the real source before anything is built on them:

1. The Reciprocal Rank Fusion implementation at
   `semantica/vector_store/hybrid_search.py:148` — formula, `k`, rank base.
2. The shadow `_decisions` dict (finding A-2) in `semantica/context/context_graph.py` —
   specifically that `save_to_file`, `load_from_file`, `purge_node` and `clear` do not
   mention it while `record_decision` and `find_precedents_by_scenario` do.
3. `_CAUSAL_EDGE_TYPES` at `semantica/context/context_graph.py:435`.

Read-only. Confirm or refute each with quoted code and a command whose output is pasted.

Acceptance: three verdicts, each CONFIRMED or REFUTED, each with the command run this
session and its real output pasted. A refuted claim is a finding, not a failure — say so and
name what it changes in Phase 1.

## Task 0.3 — Write the reuse register as DEC-001

`memory/` already holds `reciprocalRankFusion` (`src/recall.ts`), a typed edge store
(`src/graph-store.ts`), BFS traversal (`src/graph-traverse.ts`), bitemporal facts
(`src/facts.ts`), file locking (`src/lock.ts`) and a served/abstained ledger
(`src/ledger.ts`). This monorepo already carries four stale copies of one skill-graph; a
fifth copy of tested primitives is the failure mode to avoid.

For each primitive, record: **import**, **reimplement**, or **ignore** — with the reason.
State the cost of relative-path imports across packages that have separate `bun.lock` files
and no workspace root, and name what would reverse the decision.

Acceptance: `engine/build/DEC-001-reuse-boundary.md` exists, carries the
`_Decided YYYY-MM-DD · status: current_` line and a `## What was rejected` heading, and
classifies every primitive named above with no entry left unassigned.

## Task 0.4 — Write `ARCHITECTURE.md` with the placeholders later phases fill

The **what**: the record schema, the five algorithms and their boundaries, the store
layout, and the security model section that Task 0.5 fills. Placeholders are `[TBD]` and
belong here, in the deliverable skeleton — never in a phase summary, where they fail the gate.

Acceptance: `engine/ARCHITECTURE.md` exists, names all five algorithms and the data the
engine stores, and every unfilled section is marked `[TBD]` with the phase that fills it.

## Task 0.5 — Record the four security decisions that cannot wait for Phase 4

Per `algorithm-first-development`, four decisions are architecture rather than review, and
retrofitting any of them is a rewrite: the authorisation model; the trust boundary (which
inputs are hostile); secret handling; and **what data is stored at all** — the sharpest one
here, because a context store holds everything an agent read.

Acceptance: four decision records, `DEC-002` through `DEC-005`, each passing the gate's
decision-record checks, and each naming what it constrains and how it would be reversed.

## Task 0.6 — Decide the storage format and the exact bytes that get hashed, as DEC-006

Semantica concatenates 16 fields with no separator (`semantica/provenance/integrity.py:74-116`),
so `("ab","c")` and `("a","bc")` hash identically. A rebuild must not inherit that. Decide
the log format and the canonical serialisation the SHA-256 is taken over.

Acceptance: `engine/build/DEC-006-storage-and-canonical-form.md` states the on-disk format
and the exact canonicalisation rule, names the ambiguity it closes, and rejects at least the
unseparated-concat alternative by name.

## Task 0.7 — Install `algorithm-first-development` and correct the `CLAUDE.md` drift

`claude-sample/skills/algorithm-first-development/SKILL.md` is the four-stage method this
whole build follows. It is absent from the live `.claude/skills/` tree, so the sessions that
must follow it cannot load it. It is also the one skill with no row in
`claude-sample/skills/README.md`'s own index.

Separately, `graph-engine/CLAUDE.md:7` and `:19` cite `.claude/skills/README.md` as "the
index of the 17 skills and 5 agents here". That file does not exist and the live tree holds
9 skills and 6 agents. A build that cites a missing index teaches the next session to cite it.

Acceptance: the skill loads from `.claude/skills/`, `definition-gate --root .` still exits 0
with its failure count pasted, the README gains its missing row, and the two `CLAUDE.md`
citations state what is actually on disk — with the counts taken from a command run this
session, not from the old prose.

## Task 0.8 — Extend `.claude/check.sh` and return a GO/NO-GO verdict

Add two steps to the one command that is the answer: `bun run check` in `engine/`, and
`evidence-gate --dir engine/build`. A gate whose input is absent reports SKIP with its
reason — never PASS, and exit 2 is not a pass.

Acceptance: `.claude/check.sh` exits 0 with both new steps visible in its output, the
existing `project-graphx` and fixture round-trip steps still run, and the phase closes with
an explicit GO or NO-GO for Phase 1.
