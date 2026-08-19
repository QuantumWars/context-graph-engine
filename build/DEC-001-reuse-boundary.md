# DEC-001 — Import `memory/`'s file-locking primitive; reimplement everything else, with a reason per item

_Decided 2026-08-19 · status: current_

Stage 1 algorithms are written standalone and pure, with **no imports from `memory/`**.
Reuse is a Stage 2 (interlink) decision, and it is settled per primitive, not in bulk:

| `memory/` primitive | Verdict | Reason |
|---|---|---|
| `src/lock.ts` — `withFileLock`, `atomicWrite` | **import** | Its only import is `node:fs/promises` (`memory/src/lock.ts:49`). Zero coupling to `memory/`'s heavy dependency set, and concurrency correctness is expensive to re-derive. |
| `src/recall.ts` — `reciprocalRankFusion`, `RRF_K` | **reimplement** | Different contract, not a copy. It takes exactly two channels and returns `string[]` (`memory/src/recall.ts:363-376`), discarding per-channel rank and score, which Phase 1 Task 1.4's acceptance requires. It also transitively imports `./index-db` and `./embed`, so importing it would pull `bun:sqlite` and `@huggingface/transformers` into a package that has chosen to have no model. |
| `src/graph-store.ts` — `GraphStore`, `GraphIndex`, `edgeId`, `EdgeKind` | **reimplement the pattern, not the code** | Take the two good ideas — an edge id hashed only over `(from,to,kind)` so re-assertion is idempotent (`:90`), and JSONL-as-truth with the index rebuilt on load (`:149`, `:192`). Do not take the type: `EdgeKind` is `'dep'\|'overrides'\|'contradicts'\|'evidence'\|'sem'\|'alt'` (`:47`), which carries no causal types and no validity window. Extending it would change `memory/`'s on-disk format for a product that does not need the change. |
| `src/graph-traverse.ts` | **ignore the code, take the anchoring idea** | It traverses Facts as subject-predicate-object triples (`traverseFromSubject`, `:153`), not our node/edge model. `isAnchored()` (`:126`) — recompute the content hash and drop any record whose stored id disagrees with its own content — is the idea worth carrying into Algorithm 1. |
| `src/facts.ts` — bitemporal fields, `FACT_STATUSES` | **ignore the code, take one practice** | It is deliberately erasure-free ("nothing is deleted, only invalidated"), and Algorithm 3 exists precisely to add purge. The practice worth taking is that its id excludes every mutable field, so invalidation does not fork an identity. |
| `src/ledger.ts` — `FiringOutcome` | **reimplement the shape** | `'served' \| 'abstained' \| 'error'` (`memory/src/ledger.ts:47`) is the right three-way split and Phase 2.3 adopts it. A cross-package import for a three-member string union is coupling with no payoff. |
| `src/embed.ts` — `EmbeddingStore` | **ignore** | The operator chose lexical plus structural channels with no model. Revisit only when an embedding channel is actually added. |

## Why

This monorepo has already made the duplication mistake once. Four copies of one
skill-catalogue graph exist: `graph-engine/project-graphx/`, `graph-plugin/` (a dead v0.1.0
ancestor), `coding-os/graph-mcp-server/`, and the loose `coding-os/*.py` and `*.js`
originals. A register that decides per item, with the reason at the decision site, is what
stops a fifth from being written by accident.

The split above is not "reuse where convenient". It follows one test: **does the existing
code have the contract we need?** `lock.ts` does. `recall.ts` does not — it answers a
two-channel, ids-only question, and Phase 1 needs an n-channel, score-carrying one. Calling
that reuse would mean weakening the acceptance to fit the code we already had.

Measured this session, not assumed: `command grep -an '^import' memory/src/recall.ts`
returns three module imports; `memory/src/lock.ts:49` returns one.

## What was rejected

- **Import everything generic from `memory/`.** Rejected: `reciprocalRankFusion` reaches
  `./index-db` and `./embed`, so the "generic" import lands `bun:sqlite` and an ONNX runtime
  in a package that deliberately has no model.
- **Build the engine inside `memory/` instead.** Rejected by the operator this session: the
  engine would stop being its own product, inherit a 51-file package's dependency set and
  test suite, and lose its own release cycle. Recorded because it is the strongest rejected
  alternative and will be proposed again.
- **Standalone with no imports at all.** Rejected: it makes a fifth copy of primitives this
  repository has already tested, which is the named failure mode above.
- **Extend `memory/src/graph-store.ts`'s `EdgeKind` with causal types.** Rejected: it
  changes the on-disk edge format of a live-wired package to serve a different product.
- **A workspace root `package.json` to make imports clean.** Rejected for now: it changes
  dependency resolution for `memory/`, `infra-mem/`, `studio-plugin/` and `project-graphx/`
  at once, which is a far larger blast radius than one relative import.

## What this constrains

- Phase 1 files may not import from `memory/`. A Stage 1 algorithm that needs a neighbour
  is a signal the algorithm is not yet minimal.
- Only `engine/src/store/` may hold the relative import of `memory/src/lock.ts`, so the
  cross-package coupling has exactly one site and is greppable.
- Because there is no workspace root `package.json` and each package carries its own
  `bun.lock`, that import is a relative path across package boundaries. If `memory/`
  restructures `src/`, this breaks at typecheck rather than at runtime — which is the
  reason to keep it to one site.
- Task 1.4 closes the RRF question with its own decision record naming which implementation
  survives. This record does not pre-empt it; it records only that the two contracts differ.

## How to reverse it

Reversing the `lock.ts` import means vendoring roughly 150 lines with its own tests — cheap,
perhaps an hour. Reversing the "reimplement RRF" verdict means widening `memory/`'s function
to n channels and a score-carrying return, then re-running `memory/`'s own suite to prove the
two live callers are unaffected — that is a change to a live-wired package and needs its own
decision record. Reversing "build separately" once Phase 2 has landed means moving the store
and its tests into `memory/` and reconciling two on-disk formats; assume a full phase.
