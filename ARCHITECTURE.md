# Context Graph Engine — architecture

**What this document is.** The *what*: the data the engine stores, the five algorithms, the
boundaries between them, and the security model. The *how* — layout, conventions, the
commands — is `engine/CLAUDE.md`. The *order* is `engine/build/BUILD-PLAN.md`.

Sections marked `[TBD]` name the phase that fills them. A `[TBD]` is legitimate here, in the
deliverable skeleton. It is never legitimate in a phase summary, where it fails the gate.

**Status:** Phases 0-2 complete. Five algorithms built and wired; one append-only store on disk; a CLI. 153 tests.

---

## 1. What the engine is for

An agent needs to answer three questions about its own history, and a transcript answers none
of them:

1. **What did we know at time T?** — a point-in-time view that is internally coherent.
2. **Why was this decided?** — a decision, its reasoning, and what caused it.
3. **What precedent applies here?** — retrieval across more than one ranking channel.

And one question about the record itself: **has this been tampered with?**

The engine is a library plus a CLI. It has no network surface and calls no model.

## 2. The store

One append-only file. `DEC-006` fixes the format; this is the summary.

```
<workspace>/.claude/graph-engine/
  log.jsonl      the only source of truth, one JSON object per line
  .gitignore     excludes the whole directory, written at creation
```

Everything else — the node table, the adjacency index, the decision lookup, any lexical
index — is **rebuilt on load and never persisted**. A persisted derived copy would be a second
store, and a second store for one fact is Semantica finding A-2, the defect that loses
precedent search on reload and leaves purged content searchable.

### Record kinds

All records share the envelope. `kind` discriminates the body.

| Field | Meaning |
|---|---|
| `kind` | one of `node`, `edge`, `decision`, `retraction`, `tombstone`, `retrieval` |
| `id` | content-addressed, immutable |
| `seq` | contiguous from 1, in append order |
| `prev` | digest of the preceding record, `null` for the first |
| `digest` | SHA-256 over canonical JSON of every field except `digest` itself |
| `workspace` | the resolved workspace root, plus how it was resolved (`DEC-002`) |
| `validFrom` / `validUntil` | validity window; `null` means unbounded |

Field-level schemas per kind: `src/store/records.ts`. The temporal fields live inside `meta`, so they are inside the digest and therefore attested — a validity window cannot be edited without the chain noticing.

## 3. The five algorithms

Stage 1 builds each as **pure functions over plain data**: no I/O, no store, no config, no
framework, and no imports from `memory/`. `src/store/` stays empty until Phase 2. That is what
stops the scaffolding from becoming load-bearing before the algorithm is proven.

| # | Algorithm | Module | Answers |
|---|---|---|---|
| 1 | Hash-chained provenance | `src/provenance/chain.ts` | has this been tampered with? |
| 2 | Bitemporal windows and `stateAt` | `src/temporal/window.ts` | what did we know at time T? |
| 3 | Retract and purge | `src/temporal/retract.ts` | this is no longer true / this should never have been captured |
| 4 | Reciprocal Rank Fusion | `src/retrieval/rrf.ts` | which candidate wins across channels? |
| 5 | Decision node and causal chain | `src/decision/causal.ts` | why was this decided, and how strong is the chain? |

### The three rules carried over from the teardown

Each closes a named Semantica finding rather than being a preference.

- **One store per fact.** A decision is a node and that is the only copy. Closes A-2.
- **Never normalise per source before fusing.** Min–max makes the best result within a source
  `1.0` whether it is excellent or the least-bad of three poor ones, and no downstream weight
  recovers the lost signal. Closes A-6.
- **An edge is written only when something supports its predicate.** Proximity is not support.
  Closes A-8.

## 4. How the parts connect

Phase 1 builds these as five islands, deliberately unconnected. The interlink is Phase 2, and
the closing question there is, for every connection, *what does A need from B, and what
happens when B is absent, slow, or wrong* — with a reason code on every guard and no silent
returns.

```
                      ┌──────────────┐
   append ──────────► │  log.jsonl   │ ◄──── rebuilt views (never persisted)
                      └──────┬───────┘
                             │ every mutation appends a provenance entry (1)
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   stateAt (2)        retract / purge (3)   decision nodes (5)
        │                    │                    │
        └──────────┬─────────┘                    │
                   ▼                              ▼
          lexical channel  ─┐              causal chain,
          structural channel┴──► RRF (4) ──► decay + weakest link
                                    │
                                    ▼
                        retrieval decision record
                     (served | abstained | error, with margins)
```

### The interlink register

Every connection made in Phase 2, what the caller needs from the callee, and **what happens when
the callee is absent, slow or wrong**. That last column is the whole of Stage 2: an interlink
that assumes its neighbour always works is the defect that ships.

| Caller → callee | What it needs | When it fails | Reason code |
|---|---|---|---|
| `Store.open` → `readLog` | every line parsed into a record | a malformed line **aborts the load**; it is never skipped, because skipping silently shortens the chain and turns a corrupt log into a shorter valid-looking one | `malformed_line`, `unknown_kind` |
| `Store.open` → `verifyChain` | a verdict over the whole log | an invalid chain **refuses the load**. No partial graph is returned — answering from an altered record without saying so is the failure this design exists to prevent | `chain_invalid` (wrapping `content_tampered`, `digest_mismatch`, `chain_break`, `sequence_gap`) |
| `appendLog` → `withFileLock` | serialised writes | append order defines `seq`, so a concurrent unlocked write would produce a duplicate sequence and a broken chain. The lock is imported from `memory/src/lock.ts` — the single cross-package import, confined to `src/store/` | — (the lock throws its own) |
| `appendLog` → workspace stamp | writer and store agree on the root | a mismatch is **refused**, naming both roots and both resolution methods. `DEC-002` makes this the one enforced boundary | `workspace_mismatch` |
| `resolveWorkspace` → environment | an explicit root | nothing to go on **throws**. There is deliberately no current-directory fallback: `DEC-002` rejects it by name, because a directory change would silently swap which store is read | `workspace_unresolved` |
| `Store.append` → `appendEntry` | a linked, hashed record | a duplicate id is refused rather than shadowing the first record | `duplicate_id` |
| `Store.retract` → `closingValidUntil` | a narrowed window | applied at **read time**, not by editing the record — an in-place edit breaks every later `prev`. Retraction can only narrow | — (total function) |
| `Store.purge` → `purgeContent` | content and salt removed together | purging twice is refused; a record not in the store is refused | `already_purged`, `not_found` |
| `Store.stateAt` → `stateAt` | a coherent snapshot | a record with an unusable bound is **excluded and named** in `rejected`, never treated as unbounded | `malformed_temporal_value`, `ambiguous_timezone`, `inverted_window` |
| `Store.why` → `findChains` | causal paths | an unknown edge type is refused at write time, so traversal never sees one; a cycle terminates per-path | `unknown_edge_type`, `invalid_max_depth` |
| `retrieve` → `fuse` | ranked channels | a candidate with no id is a hard error, never silently unfusable; a channel listing an id twice is refused | `missing_id`, `duplicate_id_in_channel`, `invalid_k` |
| `retrieve` → the decision row | served vs abstained, distinguishably | a row claiming `served` with nothing served is **rejected, not written** — that combination is a bug in whatever built it, and recording it would put a lie in the audit trail | `contradictory_decision`, and the row's own `no_candidates` / `below_floor` |
| `cli` → `Store` | a usable error | a `StoreError` or `WorkspaceError` prints its reason and exits 1. A stack trace is never shown, because it tells a user nothing they can act on | (passes through the codes above) |

**No connection in this table has a failure behaviour of "cannot happen".** Where one is close —
`closingValidUntil` is total and cannot fail — the reason is stated rather than left blank.

## 5. Security model

Fixed in Phase 0 because retrofitting any of it is a rewrite. Full reasoning in the records.

| Question | Answer | Record |
|---|---|---|
| Who is allowed to do what? | One principal: the local OS user. No per-record authorisation. The enforced boundary is the **workspace stamp** — a writer whose resolved root disagrees is diverted, not accepted. | `DEC-002` |
| Which inputs are hostile? | **All content is.** It originates from model output, tool results and web pages. It is data, never instructions: no dynamic dispatch on stored strings, validation once at the ingest boundary, malformed temporal input rejected with a reason code rather than silently becoming unbounded. | `DEC-003` |
| How are secrets handled? | The engine holds none. The exposure is a secret arriving *as content*; no field is designated for one, purge is the remedy, and the store is never committed. | `DEC-004` |
| What is stored at all? | The caller's explicit records and their provenance. Never raw prompts, transcripts, or file contents; a retrieval query is stored as a hash and a length. | `DEC-005` |

The hash chain is a **detection** control, not a prevention control. Nothing in this
repository may claim otherwise.

Threat model, boundary validation inventory, dependency audit: `[TBD — Phase 4]`.

## 6. What this document does not yet cover

- Per-kind field schemas — `[TBD — Phase 1]`
- The interlink register and failure behaviours — `[TBD — Phase 2.4]`
- ~~The CLI surface~~ — shipped in Phase 2.5: `record`, `link`, `retract`, `purge`, `at`, `why`, `find`, `verify`, `log`
- Whether purge can be made compatible with an unbroken hash chain, or whether the engine
  ships a recorded limitation instead. This is a genuine open tension between algorithms 1
  and 3, and Task 1.3's research step is scoped to settle it — `[TBD — Phase 1.3]`
- Any embedding channel. The engine is lexical plus structural by decision; an embedding
  channel would sit behind the same interface — `[TBD — post-spine]`
