# PHASE 11 SUMMARY — What the Semantica comparison changed — 2026-08-20

**No pre-written prompt.** This phase was driven by the measured comparison in
`docs/research/10-measured-semanticas-merge.md` and the operator's instruction that every proposed
change be compared against `semantica` before being built. Each task below states the comparison
that justified it.

## 1. Verdict

**Phase closed.** Three changes, each with a measured comparison behind it.

```
$ bun run --cwd engine check
 383 pass
 0 fail
 1031 expect() calls
Ran 383 tests across 25 files. [4.32s]

$ node .claude/skills/constants-gate/scripts/gate.mjs --root engine
constants-gate: PASS — 12 constant(s) across 59 file(s), every one accounted for
```

| | |
|---|---|
| `suggest` default | **0.6 → 0.7**; precision 4.4% → 100% at unchanged recall |
| The 0.9 ceiling | shared with `semantica`, now named and guarded |
| Merged view | new; composes members' content, reports every disagreement |
| Found on the way | the old default was a **bare parameter**, invisible to `constants-gate` |

---

## Task 11.1 — Move `suggest`'s default, and put it under the gate

Acceptance: the default is a named constant under `constants-gate` with a provenance label the gate
accepts, and a test proves the old value chains records the new one does not — with the fixture's
own scores asserted first, so the chain is demonstrated rather than described.

**The comparison.** `semantica`'s `DuplicateDetector` defaults to `similarity_threshold = 0.7`
(`duplicate_detector.py:99`). Ours defaulted to **0.6** — below the port's own value, with nothing
recorded about why.

**The measurement**, on an 805-record fixture of company names from disjoint word pools with five
planted exact duplicates:

```
th=0.6  groups=114  pure=5  precision=  4.4%  recall=100%  biggestGroup=32
th=0.7  groups=  5  pure=5  precision=100.0%  recall=100%  biggestGroup=2
th=0.8  groups=  5  pure=5  precision=100.0%  recall=100%  biggestGroup=2
th=0.9  groups=  0  pure=0  precision=  0.0%  recall=  0%  biggestGroup=0
```

At the shipped default, **109 of 114 proposals mixed records with different names** and transitive
closure chained 32 unrelated companies into one group. Recall never moved.

**Met.** `SUGGEST_MIN_SCORE = 0.7` in `src/resolve/cluster.ts`, referenced by
`Store.suggest(minScore = SUGGEST_MIN_SCORE)`.

0.7 over 0.8 because they are indistinguishable on this fixture and 0.7 is what `semantica` itself
defaults to — the more permissive of two equal options is also the one with independent precedent.

The guard is a real chain, found by searching the fixture space rather than hand-tuned:

```ts
const A = co('a', 'Hooli Fisheries Incorporated');
const B = co('b', 'Northwind Fisheries Incorporated');
const C = co('c', 'Northwind Airlines Incorporated');
expect(similarity(A, B).total).toBeGreaterThanOrEqual(0.6);   // 0.6053
expect(similarity(B, C).total).toBeGreaterThanOrEqual(0.6);   // 0.6025
expect(similarity(A, C).total).toBeLessThan(0.5);             // 0.4178 — nothing alike
expect([...merged(cluster(ids, pairs, 0.6))[0]!.members].sort()).toEqual(['a', 'b', 'c']);
expect(merged(cluster(ids, pairs, SUGGEST_MIN_SCORE))).toEqual([]);
```

### The finding underneath the finding

**The old default was `suggest(minScore = 0.6)` — a bare default parameter, not a named constant.**
`constants-gate` scans for declared constants, so it never saw it, and Phase 8 shipped an
unprovenanced number in a function signature. That is precisely the hiding place the constants rule
exists to close, and the gate could not have caught it. A test now asserts the signature references
the constant.

**It is a declared placeholder, not a calibration**, and the gate made me say so: I first wrote
`PROVENANCE: **measured**` and it failed, because its vocabulary is calibrated / declared
placeholder / no provenance and I had invented a fourth category. One synthetic fixture establishes
that 0.6 is wrong and 0.7 is not. It does not calibrate anything.

**Changing the default broke no existing test.** Nothing pinned it.

---

## Task 11.2 — Name the score ceiling, because a threshold above it matches nothing

Acceptance: the ceiling is derived from `WEIGHTS` rather than written as a literal, a test asserts a
threshold above it matches nothing however identical the records are, and a second test shows the
ceiling lifts when both records genuinely carry props — so it is a consequence of absent evidence
and not a cap on the scorer.

**The comparison, measured by running their scorer:**

```
identical, no props   score=0.900000  {'string': 1.0, 'property': 1.0, 'relationship': 0.5}
different names       score=0.656374  {'string': 0.594, 'property': 1.0, 'relationship': 0.5}
```

**Both engines cap a perfect duplicate at 0.9.** Ours because a missing component scores 0 and
`name + type` is 0.9; theirs because absent relationships score a neutral 0.5 at full weight. Ours
lands at `0.8999999999999999`, so `>= 0.9` rejects two byte-identical records — the `th=0.9` row
above is that, not a tuning result.

The second row is the more interesting one and it **vindicates a Phase 7 decision**. Two entirely
unrelated companies score 0.656 there, because two *empty* property sets are scored `1.0` — absence
read as agreement — giving every pair a floor of 0.3 before a name is looked at. That is what
renormalising over "the components we happen to have" buys, and it is a large part of why their
merge produced 14 blobs. Our fixed denominator stays.

**Met.** `MAX_SCORE_WITHOUT_PROPS = WEIGHTS.name + WEIGHTS.type` — derived, not chosen — with the
comparison recorded at the definition site, and four assertions including that a threshold above the
ceiling matches nothing however identical the records are, and that the ceiling lifts when both
records genuinely carry props.

---

## Task 11.3 — Compose merged members, and report every disagreement

Acceptance: a merged read composes fields no single member has, the canonical wins every field it
holds, every disagreement is reported with the member ids behind each value, a purged member is
named rather than silently dropped, and the log is byte-identical across a call.

**The comparison.** `semantica`'s `MergeStrategyManager` merges properties across a group and
records unresolved disagreements in `MergeResult.conflicts` (`merge_strategy.py:395-446`). It offers
five strategies — `keep_first`, `keep_last`, `keep_most_complete`, `keep_highest_confidence`,
`merge_all` — plus per-property overrides, and produces a **new merged entity**.

**This is the one place their design does more than ours.** `DEC-012` made reads answer from the
canonical, so a detail recorded only on another member was invisible.

**Met.** `DEC-015` and `Store.mergedView(id, at?)`. What was taken and what was not:

- **Taken: conflict reporting.** Every field where members disagree is listed with each value and
  the member ids holding it. A disagreement is often the reason the merge was wrong.
- **Not taken: the strategy zoo.** One rule — the canonical wins. Five strategies is five ways for
  two callers to read one store and disagree, and the caller already chose which record is
  authoritative when they asserted the identity. `keep_highest_confidence` also needs a confidence
  on every record, which `DEC-013` refused to invent.
- **Not taken: producing a new entity.** Theirs has to live somewhere and be kept in step with its
  sources. Ours composes at read time, so purging a member changes it immediately — nothing to
  rewrite, nothing to miss.

```
$ engine view inc-b
inc-b  → inc-a via merge:inc-a+inc-b
  members: inc-a, inc-b
  {"text":"checkout outage"}
  conflict on text:
      "checkout outage"  from inc-a
      "the friday incident"  from inc-b

The canonical's value is the one shown. A conflict is often why a merge was wrong.

$ engine purge inc-b --reason "contained a customer name"
$ engine view inc-a
inc-a  → inc-a via merge:inc-a+inc-b
  members: inc-a, inc-b
  {"text":"checkout outage"}
  unavailable: inc-b (purged — their fields are absent above)
```

A retracted member still composes; a purged one is named in `unavailable`. Those are opposite cases
and easy to conflate, so both are pinned.

### The defect found while building it

The first version keyed the merge off `resolveId(id).via` — which is `null` for the **canonical
itself**, because the canonical is not redirected anywhere. So `view` on the canonical showed a view
of only itself: the one record whose composed view matters most. Fixed by finding the merge that
*contains* the record rather than the one that redirects it.

---

## 2. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| the new default | reverting `SUGGEST_MIN_SCORE` to 0.6 | red — 2 tests |
| canonical wins a conflict | letting a later member overwrite | red — 2 tests |
| purged members are named | dropping them silently | red |
| read-path enumeration | adding `mergedView` | red, unprompted |
| **constants-gate** | `PROVENANCE: **measured**` | red — rejected my invented category |

## 3. Two of my own errors, both caught

**A 2-minute timeout I reported as a result.** It was my random-number generator overflowing
`Number.MAX_SAFE_INTEGER` — 150 distinct values in 5000 draws — so the fixture loop never
terminated. Nothing to do with our clustering. Withdrawn as soon as measured.

**A miniature fixture that proved nothing.** Four `Abstergo Airlines *` names, asserted to chain at
0.6. They score 0.54–0.58 and produce no groups at all. Chaining is a *density* effect a four-record
fixture cannot show, so the guard now uses a real chain found by search.

Twenty-three and twenty-four.

## 4. Still open

- **`SUGGEST_MIN_SCORE` is one synthetic fixture away from being a guess.** Company names from
  disjoint word pools are not this store's data. A labelled set from a real store is what would
  calibrate it, and `eval/duplicates.ts` at 26 author-written records is not that.
- **Two records with identical text but different `kind` score exactly 0.7 and are proposed.**
  Observed in the CLI session above — `inc-a` (node) and `inc-c` (decision) with the same text land
  exactly on the boundary. Whether a node should ever be proposed as the same thing as a decision is
  undecided, and the new default made it visible rather than causing it.
- **`mergedView` does not deep-merge nested objects**, by decision. Field-level only.
- **No evaluation harness for linking** (carried from Phase 10), and none for extraction (Phase 9).
- Everything carried from Phase 10.
