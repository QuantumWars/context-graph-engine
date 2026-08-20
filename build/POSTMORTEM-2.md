# Post-mortem — Context Graph Engine, phases 5–17

Written 2026-08-20 by the session that did the work, after it was done.

`POSTMORTEM.md` covers phases 0–4 and its ten rules moved into `engine/CLAUDE.md`, where they have
governed every phase since. This is the second half. It does not repeat those rules; it reports
where they held, where they were not enough, and the four new ones.

## H0 — What shipped

| | Phase 4 | Phase 17 |
|---|---|---|
| Algorithms | 5 | **8** |
| Tests | 210 | **455** |
| CLI verbs | 9 | **16** |
| Decision records | 11 | **19** |
| Constants | 8, none unprovenanced | **13, four calibrated** |
| Evaluation harnesses | 0 | **3** |

Eight algorithms, all reachable. Entity resolution wired to the store as an appended assertion.
Extraction with span provenance that points rather than copies. Entity linking that reports and
never decides. Three harnesses that produce numbers nobody has to take on trust.

The recon's take list is complete and its one deferred question — the fate of Semantica's Rete and
Datalog engines — is answered.

## H1 — The characteristic failure, and how it changed

Phases 0–4 had one: **an instrument that reported success it had not established.** Eighteen
instances by Phase 7.

It did not stop. Phases 5–17 added six more of the same kind, and the count is not the point — the
*shape* changed once the harnesses existed, and that change is the most useful thing in this
document.

**Before harnesses, a wrong claim was caught by a guard or not at all.** After them, a wrong claim
was caught by a number that did not move.

The clearest case is Phase 14. The polarity check's first implementation scoped from the trigger
span, which begins at the subject, so the governing clause was always empty and **no cue could ever
fire**. The suite was green. The module read correctly. The design was sound. The only thing that
said otherwise was that `eval:extract` did not move by a single point. Without the harness, a check
that could never fire would have shipped looking like a feature.

The second clearest is Phase 13, where a mutation that should have turned a test red turned nothing
red — and the reason was that the file it edited contained NUL bytes, so the pattern was not there.
`grep` reported the file as binary and showed nothing; `file` called it data; the suite passed
throughout. A second NUL was then found in `src/extract/link.ts`, **shipped in Phase 10**.

## H2 — What broke: the store and its interactions

1. **Purging the canonical of an active merge made every member read as empty** while their own
   content sat untouched on disk (Phase 8). The worst state available to an erasure feature: it
   reads as gone and is not. Now refused, with the remedy named.
2. **And the remedy it named did not work.** Retract the merge, purge immediately, and the purge was
   refused again — `now()` has one-second resolution and Algorithm 2's windows are inclusive at both
   ends. Found by driving the CLI by hand; the tests used an advancing clock, which is the realistic
   choice and is exactly why it hid.
3. **`mergedView` on the canonical showed only itself** (Phase 11). It keyed off `resolveId().via`,
   which is `null` for the canonical — the one record whose composed view matters most.

## H3 — What broke: extraction

4. **The extractor had no notion of polarity** (Phase 13, measured; Phase 14, fixed). Five of
   fifteen emitted relations were false positives and every one was a denial, a hedge or a question.
5. **Two of its negative families passed for an accident of English grammar.** `did not cause` and
   `Did … cause?` were missed because English uses the infinitive there — nothing to do with
   polarity. Adding past-tense rows dropped precision from 76.9% to 66.7%. The extractor did not get
   worse; the set stopped flattering it.
6. **The subject capture spanned clause boundaries**, producing `"disputes that the deploy"` where
   the subject was `"the deploy"`. Found only because the strict harness scored a triple wrong that
   an emit-or-silent probe called right.

## H4 — What broke: linking, and the three phases it took

7. **The reject option answered 1 of 7** (Phase 12). `no_candidates` only fires when blocking finds
   nothing whatever, and blocking is generous by design.
8. **The type component was dead** (Phase 16). `link` built its probe with `type: opts.type ?? ''`,
   which can never equal a record's kind, so a fifth of the scoring weight contributed **zero to
   every linking call ever made**. A perfect name match capped at 0.700 and nobody had asked why.
9. **A name collision produced an unreachable `case` in a switch**, a duplicated entry in the verb
   list, and two MCP tools under one name (Phase 10). Neither `tsc` nor the linter said anything
   about any of the three; seven MCP tests failed with symptoms pointing nowhere near the cause.

## H5 — What did not break

- **The stage rule held again.** Algorithms 6, 7 and 8 were built pure and none changed to be
  wired.
- **No decision record was contradicted by code.** Nineteen now, and where one had to move it was
  amended (`DEC-017` → `DEC-018`) with the clause that changed named.
- **The chain never broke.** Across merge, purge, extraction provenance and every adversarial test,
  `verify()` has never returned invalid on a store this engine wrote.
- **`constants-gate` never let an unprovenanced number through** — and in Phase 15 it rejected my
  attempt to invent a fourth provenance category (`**measured**`) to flatter a single fixture.

## H6 — What broke in the process, not the code

10. **A summary sentence became the next phase's premise.** Phase 15 wrote that two mentions "need
    the linker to know that a team and a service are different kinds of thing, which is
    type-awareness and not a better number." That reads like a finding. It was a guess. Phase 16
    built it and found both mentions are *within-type* near-misses, where type matching makes the
    wrong answer more confident.
11. **A sweep measured a design the code does not use.** Phase 15 swept every NIL rule as a hard
    reject, concluded "every margin rule is worse", and shipped a flag. As a flag the margin rule
    drops nothing and wins outright. Same rule, same data, opposite conclusion.
12. **I published a claim about a third-party repository from reading alone**, and it was wrong.
    "1000 entities in, 980 missing from the output" was refuted by running it: 0 missing. What
    running it *did* find was worse — 990 distinct companies merged into 14 groups at the tool's own
    default.

## H7 — Where I wasted the operator's time

1. **Three phases on one feature.** Phases 15, 16 and 17 were all linking, each fixing one measured
   miss on a 24-mention set I labelled myself. The operator named the pattern before I did. The
   Semantica reference had stopped catching it because all three found nothing to port — that repo
   has none of those mechanisms — and I did not notice the reference had gone quiet.
2. **A two-minute timeout reported as a result.** It was my own random-number generator overflowing
   `Number.MAX_SAFE_INTEGER` — 150 distinct values in 5000 draws — so a fixture loop never
   terminated. Nothing to do with the code under test.
3. **A four-record fixture asserted to demonstrate chaining.** Chaining is a density effect; four
   records cannot show it. The guard had to be rebuilt from a real chain found by search.
4. **`ARCHITECTURE.md` went fifteen phases stale** and I did not notice until asked whether the
   system was finished. It described five algorithms and 153 tests while the tree held eight and
   455.

## H8 — Still open

- **Every evaluation set is author-written by the session that wrote the code.** This is the ceiling
  on every number in this project and it is stated in each set rather than in a footnote.
- **Known functional gaps, all measured and small:** one parenthetical subject the extractor cannot
  reach; one ambiguous mention and one `nil-near` the linker gets wrong.
- **`TYPE_NOUNS`, `POLARITY_CUES`, `PSEUDO_CUES`** are hand-written vocabularies no corpus
  calibrates. `PSEUDO_CUES` is a deliberate hole in the negation check, so every entry costs
  precision.
- **`RRF_K` cannot be measured** while the retrieval channels stay disjoint.
- **No entity recognition, no rule inference, no export.** Each is named in `docs/future-work/` with
  what would trigger it.

## H9 — Four rules, added to the ten

These join the ten in `engine/CLAUDE.md`. They are numbered from 11 and each traces to a specific
failure above.

11. **A number that does not move is evidence.** When a change should shift a measurement and the
    measurement is identical, the change did not happen — check that before believing the code. Two
    no-op implementations shipped green suites and were caught only this way (H1).

12. **Measure the rule in the form you will ship it.** A sweep of hard rejects says nothing about a
    flag. Phase 15 reached the opposite of the right conclusion from its own data because the
    harness was asked the wrong question (H6.11).

13. **A plausible sentence in a summary becomes the next session's premise.** Write a diagnosis as a
    diagnosis and a guess as a guess. "This needs type-awareness" cost a phase (H6.10).

14. **When the reference goes quiet, say so.** Three phases in a row found nothing to port and I
    kept going as though the comparison were still steering. A port that yields nothing is a signal
    that the feature has left the reference behind, and that the next check has to come from
    somewhere else (H7.1).
