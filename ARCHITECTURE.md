# Context Graph Engine — architecture

**What this document is.** The *what*: the data the engine stores, the eight algorithms, the
boundaries between them, and the security model. The *how* — layout, conventions, the commands —
is `engine/CLAUDE.md`. The *order and status* is `engine/build/BUILD-PLAN.md`. What the build cost
and what it got wrong is `engine/build/POSTMORTEM.md`.

**Status, 2026-08-20.** Phases 0–17 closed. Eight algorithms, all reachable from the CLI and the
MCP surface; one append-only store on disk; sixteen CLI verbs; three evaluation harnesses.
**455 tests**, nineteen decision records, nine gates.

> Every number in this document came from a command run on 2026-08-20. Nothing here is carried
> forward from an earlier draft — the previous version of this file described the system as it
> stood at Phase 2 and was fifteen phases stale, which is the specific failure it now exists to
> avoid.

---

## 1. What the engine is for

An agent needs to answer three questions about its own history, and a transcript answers none of
them:

1. **What did we know at time T?** — a point-in-time view that is internally coherent.
2. **Why was this decided?** — a decision, its reasoning, and what caused it.
3. **What precedent applies here?** — retrieval across more than one ranking channel.

And one question about the record itself: **has this been tampered with?**

Three more arrived with the build, each because the store fragments without them:

5. **Are these two records the same thing?** — resolution and merge.
6. **What in the text supports this edge?** — extraction with span provenance.
7. **Which record does this phrase refer to?** — entity linking.

The engine is a library, a CLI, an MCP server and — since Phase 19 — a **read-only** explorer.
It calls no model. Its one network surface is the explorer's API, which binds to `127.0.0.1` by
default, serves `GET` only, and fails closed anywhere else (`DEC-020`).

## 2. The store

One append-only file. `DEC-006` fixes the format; this is the summary.

```
<workspace>/.claude/graph-engine/
  log.jsonl      the only source of truth, one JSON object per line
  .gitignore     excludes the whole directory, written at creation
```

Everything else — the node table, the adjacency index, the decision lookup, the lexical index,
resolution clusters, merged views — is **rebuilt on load or computed on read, and never
persisted**. A persisted derived copy would be a second store, and a second store for one fact is
Semantica finding A-2, the defect that loses precedent search on reload and leaves purged content
searchable.

### Record kinds

All records share the envelope. `kind` discriminates the body.

| Field | Meaning |
|---|---|
| `kind` | one of `node`, `edge`, `decision`, `retraction`, `tombstone`, `retrieval`, `merge` |
| `id` | caller-supplied, unique, immutable |
| `seq` | contiguous from 1, in append order |
| `prev` | digest of the preceding record, `null` for the first |
| `digest` | SHA-256 over canonical JSON of every field except `digest`, `content` and `salt` |
| `contentDigest` | SHA-256 over `salt ‖ canonicalJson(content)` — the commitment that survives a purge |
| `workspace` | the resolved workspace root, plus how it was resolved (`DEC-002`) |
| `validFrom` / `validUntil` | validity window; `null` means unbounded |
| `recordedAt` | transaction time, never null (`DEC-008`) |

Field-level schemas per kind: `src/store/records.ts`. The temporal fields live inside `meta`, so
they are inside the digest and therefore attested — a validity window cannot be edited without the
chain noticing.

**`merge` carries ids and never content** (`DEC-012`), so purging a member needs no purge here.
**Edge records may carry span provenance** — `rule`, `subjectSpan`, `objectSpan`, `triggerSpan` —
which are offsets into another record and never its text (`DEC-013`).

## 3. The eight algorithms

Stage 1 builds each as **pure functions over plain data**: no I/O, no store, no config, no
framework. That is what stops the scaffolding from becoming load-bearing before the algorithm is
proven; none of the first five changed when they were wired.

| # | Algorithm | Module | Answers |
|---|---|---|---|
| 1 | Hash-chained provenance | `src/provenance/chain.ts` | has this been tampered with? |
| 2 | Bitemporal windows and `stateAt` | `src/temporal/window.ts` | what did we know at time T? |
| 3 | Retract and purge | `src/temporal/retract.ts` | this is no longer true / this should never have been captured |
| 4 | Reciprocal Rank Fusion | `src/retrieval/rrf.ts` | which candidate wins across channels? |
| 5 | Decision node and causal chain | `src/decision/causal.ts` | why was this decided, and how strong is the chain? |
| 6 | Blocking, similarity, clustering | `src/resolve/` | which records look like the same thing? |
| 7 | Spans and rule-based extraction | `src/extract/span.ts`, `rules.ts`, `polarity.ts` | what does this text actually state? |
| 8 | Entity linking | `src/extract/link.ts`, `acronym.ts` | which record does this phrase refer to? |

`explorer/` is a React + sigma/graphology view over the same `Store` API the CLI uses. It has **no
mutating route**: an assertion into this store needs a caller who names it, and a browser button is
not one (`DEC-020`). `semantica`'s explorer has 34 mutating routes against 44 read routes; ours has
zero against five.

### The rules carried over from the teardown

Each closes a named Semantica finding rather than being a preference.

- **One store per fact.** A decision is a node and that is the only copy. Closes A-2.
- **Never normalise per source before fusing.** Min–max makes the best result within a source
  `1.0` whether it is excellent or the least-bad of three poor ones. Closes A-6.
- **An edge is written only when the text states it.** Proximity is not support, and neither is a
  trigger word inside a denial. Closes A-8, and Phase 14 extended it to polarity.
- **Blocking has one strategy and it is the good one.** Closes A-11, where the documented API path
  silently degrades to first-letter bucketing.
- **The weights live in one place and nothing restates them.** Closes A-12, where a docstring and a
  signature disagreed about which component dominated.

### What proposes, and what asserts

Three mechanisms produce candidates and **none of them writes**. This is the same decision three
times, and it is the spine of the design:

| Derived, never stored | Asserted by a caller |
|---|---|
| `suggest` — records that look alike (`DEC-012`) | `merge` — these *are* one thing |
| `propose` — relations the text states (`DEC-013`) | `confirm` — with both endpoints named |
| `linkMention` — records a phrase might mean (`DEC-014`) | nothing; linking never asserts |
| `mergedView` — composed content and conflicts (`DEC-015`) | — |

## 4. How the parts connect

```
                      ┌──────────────┐
   append ──────────► │  log.jsonl   │ ◄──── rebuilt views (never persisted)
                      └──────┬───────┘
                             │ every mutation appends a provenance entry (1)
    ┌───────────┬────────────┼────────────┬──────────────┐
    ▼           ▼            ▼            ▼              ▼
 stateAt(2)  retract/     decision     resolve(6)     extract(7)
             purge(3)     nodes(5)         │              │
    │           │            │         suggest ──►     propose ──► confirm
    └─────┬─────┘            │        (derived)        (derived)      │
          ▼                  ▼             │              │           ▼
   lexical + structural   causal chain,    ▼              ▼      edge + spans
          └──► RRF(4) ──► decay + weakest  merge      linkMention(8)   │
                  │        link            │          (derived)        ▼
                  ▼                        ▼                       evidenceFor
        retrieval decision           mergedView                   (resolves now,
     (served | abstained | error)   (composed, conflicts)         never copied)
```

### The interlink register

Every connection, what the caller needs from the callee, and **what happens when the callee is
absent or wrong**. That last column is the whole of Stage 2: an interlink that assumes its
neighbour always works is the defect that ships.

| Caller → callee | What it needs | When it fails | Reason code |
|---|---|---|---|
| `Store.open` → `readLog` | every line parsed into a record | a malformed line **aborts the load**; skipping silently shortens the chain and turns a corrupt log into a shorter valid-looking one | `malformed_line`, `unknown_kind` |
| `Store.open` → `verifyChain` | a verdict over the whole log | an invalid chain **refuses the load**. Answering from an altered record without saying so is the failure this design exists to prevent | `chain_invalid` (wrapping `content_tampered`, `digest_mismatch`, `chain_break`, `sequence_gap`) |
| `appendLog` → `withFileLock` | serialised read-decide-write | append order defines `seq`; an unlocked concurrent write produces a duplicate sequence and a broken chain. Measured in Phase 3: 7 of 16 records lost | — (the lock throws its own) |
| `appendLog` → workspace stamp | writer and store agree on the root | a mismatch is **refused**, naming both roots and both resolution methods | `workspace_mismatch` |
| `resolveWorkspace` → environment | an explicit root | nothing to go on **throws**. No current-directory fallback: a directory change would silently swap which store is read | `workspace_unresolved` |
| `Store.append` → `appendEntry` | a linked, hashed record | a duplicate id is refused rather than shadowing the first | `duplicate_id` |
| `Store.retract` → `closingValidUntil` | a narrowed window | applied at **read time**, not by editing the record — an in-place edit breaks every later `prev`. Retraction can only narrow | — (total function) |
| `Store.purge` → `purgeContent` | content and salt removed together | purging twice is refused; **purging the canonical of an active merge is refused**, because members would read as empty while their own content remained on disk | `already_purged`, `not_found`, `canonical_of_active_merge` |
| `Store.stateAt` → `stateAt` | a coherent snapshot | a record with an unusable bound is **excluded and named**, never treated as unbounded | `malformed_temporal_value`, `ambiguous_timezone`, `inverted_window` |
| `Store.why` → `findChains` | causal paths | an unknown edge type is refused at write time; a cycle terminates per-path | `unknown_edge_type`, `invalid_max_depth` |
| `retrieve` → `fuse` | ranked channels | a candidate with no id is a hard error, never silently unfusable | `missing_id`, `duplicate_id_in_channel`, `invalid_k` |
| `retrieve` → the decision row | served vs abstained, distinguishably | a row claiming `served` with nothing served is **rejected, not written** — recording it would put a lie in the audit trail | `contradictory_decision`, `no_candidates`, `below_floor` |
| `Store.merge` → `activeMergesIn` | one identity claim per record | a record already in an active merge cannot join a second; an identity that depends on read order is not an identity | `merge_too_small`, `canonical_not_a_member`, `member_already_merged`, `not_found` |
| `Store.confirm` → `resolveSpan` | evidence that resolves **now** | an endpoint that is not a live record is refused; a span that already points at nothing is refused, because recording it would make the edge look supported | `endpoint_not_found`, `span_unresolvable` |
| `evidenceFor` → `resolveSpan` | the text behind an edge | a purged source reports `source_purged` — correct, not a fault: the evidence is genuinely gone | `source_not_found`, `source_purged`, `source_has_no_text`, `span_out_of_bounds`, `span_inverted`, `span_not_integral` |
| `cli` → `Store` | a usable error | a `StoreError` or `WorkspaceError` prints its reason and exits 1; a stack trace is never shown | (passes the codes above) |

**No connection has a failure behaviour of "cannot happen".** Where one is close —
`closingValidUntil` is total — the reason is stated rather than left blank.

### The read paths

Fifteen, enumerated in `test/store.test.ts` and enforced structurally: a read path added to
`store.ts` without being added to that list fails the suite.

```
contentOf  resolveId  getNode  listNodes  getDecision  listDecisions  getEdge  listEdges
stateAt  why  searchable  propose  linkMention  mergedView  evidenceFor
```

The test asserts every one returns a record after write → save → reload, and **none** returns it
after a purge.

## 5. Security model

Fixed in Phase 0 because retrofitting any of it is a rewrite.

| Question | Answer | Record |
|---|---|---|
| Who is allowed to do what? | One principal: the local OS user. No per-record authorisation. The enforced boundary is the **workspace stamp** — a writer whose resolved root disagrees is refused. | `DEC-002` |
| Which inputs are hostile? | **All content is.** It originates from model output, tool results and web pages. It is data, never instructions: no dynamic dispatch on stored strings, and malformed temporal input is rejected with a reason code rather than silently becoming unbounded. | `DEC-003` |
| How are secrets handled? | The engine holds none. The exposure is a secret arriving *as content*; no field is designated for one, purge is the remedy, and the store is never committed. | `DEC-004` |
| What is stored at all? | The caller's explicit records and their provenance. Never raw prompts, transcripts or file contents; a retrieval query is stored as a hash and a length. | `DEC-005` |

Threat model, boundary validation inventory and dependency audit: `docs/security/threat-model.md`
(Phase 4). Third-party code is confined to `mcp/`; `src/` has no dependencies (`DEC-011`).

### What the engine does not claim

Say these plainly, in this wording, wherever the subject comes up.

- **The chain proves the records present have not been altered and are in the order written. It
  does not prove that all records ever written are still present.** End-truncation and wholesale
  rewrite are undetectable — `docs/future-work/02-what-the-chain-cannot-detect.md`.
- **The hash chain is a detection control, not a prevention control.**
- **The engine guarantees stored content is never executed by the engine. It cannot guarantee it is
  never acted on by a reader.**
- **A purge clears this store and cannot reach a copy something else made.** Every tombstone
  carries `scope: 'this-store-only'`.

## 6. Constants, and what each is worth

Thirteen, every one carrying a provenance label that `constants-gate` enforces: **four
calibrated, nine declared placeholders, none unprovenanced.** The distinction is load-bearing and
must never be blurred in prose.

| Calibrated | By |
|---|---|
| `LEXICAL_FLOOR` | `eval/sweep.ts`, three times — recalibrated twice after the scoring function changed |
| `STRUCTURAL_FLOOR` | the same sweep |
| `WEIGHT_TOTAL` | by construction, asserted equal to the sum of `WEIGHTS` |
| `LINK_WEAK_MARGIN` | `eval/link-sweep.ts`; moved from a score to a margin when the scorer changed |

`RRF_K = 60` is **adopted, not measured**, and provably cannot be measured while the retrieval
channels stay disjoint — `docs/future-work/` carries the trigger. The causal distance bands are
adopted. `TYPE_NOUNS`, `POLARITY_CUES` and `PSEUDO_CUES` are hand-written vocabularies that no
corpus calibrates.

**Re-sweep any calibrated constant after a change to what it thresholds.** That rule has fired
three times and moved a constant twice.

## 7. What is measured, and what it is worth

Three harnesses. Every set is **author-written by the session that wrote the code**, which is the
ceiling on all of it and is stated in each file rather than in a footnote.

| Harness | Reports | Latest |
|---|---|---|
| `eval:run` / `eval:sweep` | retrieval, and the floors | `LEXICAL_FLOOR` calibrated 3× |
| `eval:extract` | precision, recall, F1, silence | precision 100%, recall 93.3%, silence 100% |
| `eval:link` / `eval:link-sweep` | Recall@k, Top-1, NIL, margin split | Recall@any 100%, Top-1 94.1%, NIL 85.7% |

## 8. What is deliberately not built

- **No embedding channel.** Lexical plus structural by decision; an embedding channel would sit
  behind the same interface.
- **No entity recognition.** `propose` says what the text states and not which records the phrases
  refer to; `linkMention` ranks candidates and a caller names the endpoints.
- **No rule inference.** Judged rather than assumed — `docs/research/11-judging-the-reasoning-engines.md`
  runs Semantica's two engines and finds Datalog sound and Rete refuted. If inference is ever
  wanted, `DEC-012` and `DEC-013` require it to be derived at read time and never written.
- **No export.** An export ledger is named in `docs/future-work/` as the precondition.
- **Known gaps, all measured and small:** one parenthetical subject the extractor cannot reach;
  one ambiguous mention and one `nil-near` the linker gets wrong.
