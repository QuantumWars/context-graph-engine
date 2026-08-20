# BUILD-PLAN — Context Graph Engine

The order, and where development stands. **Updated at every phase close.** If you are a new
session or a new developer, this file plus the phase summaries beside it are the whole trail;
you should not have to ask anyone what happened.

## Status

**Phases 0–18 closed.** Phase 5 reopened the build for the item the post-mortem named as the
largest gap, and the harness rejected a shipped constant on its first run. Post-mortem: `POSTMORTEM.md`. The ten standing rules moved into
`engine/CLAUDE.md`.

Phase 8 wired entity resolution into the store, which was the last component with no caller.
Both defects it found were found by **running the CLI**, not by the suite — including one in the
error message of the guard the phase existed to build.

Phase 17 closed the abbreviation gap with Schwartz & Hearst's matching rule — every character of the
short form in order, the first beginning a word, characters allowed inside a word so the paper's own
`GNAT` case still works. Expansion is per record, so a short form cannot lift a record that does not
spell it out. No dictionary, no weight, no constant. `abbreviation` 1/2 → 2/2 and Top-1 → 94.1%, and
the re-sweep `DEC-018` requires left `LINK_WEAK_MARGIN` unchanged.

Phase 16 built the type awareness Phase 15 prescribed, and **the prescription was wrong**. Type
inference works and did not fix either target case, because both are *within-type* near-misses — a
team among teams, a quarter among quarters — and type matching raises confidence on exactly those.
What fixed them was the margin, which Phase 15 had dismissed after sweeping it as a hard reject and
then shipping a flag: measured in the form the code actually uses, the margin rule wins outright.
NIL 71.4% → 85.7%, soft cost halved, Top-1 unchanged.

Phase 15 executed `DEC-014`'s own reversal condition, two phases after it was set. The reject option
went from 1 of 7 to 5 of 7 **without losing a correct answer**, because the calibration showed a hard
cut would silence two true rewordings and still miss two NILs — so `weak` labels rather than filters.
The Phase 10 guard asserting the module held no constant turned red the moment one was added, which
is what forced `DEC-017` to be written before the code could ship.

Phase 14 fixed the polarity false positives Phase 13 measured — precision 66.7% → 100%, silence
61.5% → 100% — and is the first change here judged by a harness rather than by argument. Its first
implementation was a **no-op**: it scoped from the trigger span, which starts at the subject, so the
governing clause was always empty and no cue could fire. The eval numbers not moving is what exposed
it. A held-out set scored that version 6/10 against 100% on the set that motivated it.

Phase 13 closed the older harness gap. Extraction's A-8 defence is confirmed — texts naming many
entities with no stated relation are 100% silent — and recall is 100%, but **polarity is not handled
at all**: negation, hedging and embedded questions all emit false positives. Two families first
scored well for an accident of grammar (English uses the infinitive after "did"), and adding
past-tense rows dropped precision from 76.9% to 66.7%. A mutation that killed nothing then exposed
**NUL bytes in two source files**, one shipped in Phase 10, invisible to `grep` and harmless to the
suite; a guard now sweeps for them.

Phase 12 gave linking the harness Phases 9 and 10 both closed without. Candidate generation loses
nothing and ranking is 88.2%, but **the reject option scores 14.3%** and `nil-near` is 0 of 5 — the
largest known defect in linking, now with a number on it. `DEC-014`'s margin claim was tested and
survived: median margin 0.3154 when the top answer is right against 0.0048 when it is wrong.
`DEC-014`'s own reversal condition — a labelled set that could calibrate a NIL threshold — is now
met, and acting on it is an operator decision.

Phase 11 acted on the measured comparison with `semantica`: the `suggest` default moved from 0.6 to
0.7 (precision 4.4% → 100% at unchanged recall), the shared 0.9 score ceiling was named and guarded,
and `mergedView` was added because composing merged members is the one place their design did more
than ours. The old default was a bare parameter that `constants-gate` could not see.

Phase 10 closed the gap Phase 9 named as its own largest — a proposal could say what the text
stated but not which records the phrases referred to — and closed it without introducing a constant.
The port's defect is instructive: identity was decided by set-Jaccard over split words, which has no
order, so two statements with opposite causal direction score exactly 1.0. No threshold fixes that.

Phase 9 built extraction with span provenance, closing finding A-8 and finishing the recon's list.
Its design insight: because records are immutable, an offset into one is stable, so the quote the
W3C annotation model pairs with a position selector is **duplication rather than robustness** — and
copying it would have rebuilt the erasure hole `DEC-004` closed.


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
| 8 | — | Wire resolution into the store: suggest, merge, resolve reads | **closed 2026-08-20 — 313 tests; purging a merge canonical now refused** |
| 9 | — | Extraction with span provenance: spans, rules, propose/confirm | **closed 2026-08-20 — 347 tests; A-8 closed, the recon's list finished** |
| 10 | — | Entity linking: mention → ranked candidate records | **closed 2026-08-20 — 372 tests; closed with NO new constant** |
| 11 | — | What the Semantica comparison changed: threshold, ceiling, merged view | **closed 2026-08-20 — 383 tests; suggest default 0.6 → 0.7 on measurement** |
| 12 | — | Evaluation harness for entity linking | **closed 2026-08-20 — 397 tests; Top-1 88.2%, NIL 14.3%** |
| 13 | — | Evaluation harness for extraction | **closed 2026-08-20 — 415 tests; recall 100%, precision 66.7%** |
| 14 | — | Polarity: negation, hedging and counterfactuals | **closed 2026-08-20 — 431 tests; precision 66.7% → 100%, silence → 100%** |
| 15 | — | The linking reject option | **closed 2026-08-20 — 436 tests; NIL 14.3% → 71.4%, Top-1 unchanged** |
| 16 | — | Type awareness for nil-near | **closed 2026-08-20 — 438 tests; NIL → 85.7%; the Phase 15 diagnosis was refuted** |
| 17 | — | Abbreviations | **closed 2026-08-20 — 455 tests; abbreviation 1/2 → 2/2, Top-1 → 94.1%** |
| 18 | — | The remaining gaps, in one phase | **closed 2026-08-20 — 461 tests; extraction 100%, linking NIL 7/7** |

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
| `DEC-012` | A merge is an appended assertion about identity; a cluster is derived and never stored |
| `DEC-013` | A span is a pointer into an immutable record, never a copy; an extractor proposes and never writes |
| `DEC-014` | Linking reports ranked candidates and never decides identity from a score |
| `DEC-015` | A merged view is composed at read time, with one rule and every disagreement reported |
| `DEC-016` | A relation is emitted only when its clause asserts it; scope is a clause, not a window |
| `DEC-017` | Linking gains a `weak` verdict and one calibrated constant, and still never rejects — amends `DEC-014` |
| `DEC-018` | A mention's type comes from its head noun; `weak` is a margin, not a score — supersedes `DEC-017`'s constant |
| `DEC-019` | An acronym expands per record, and only against a record whose own name supports it |

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
