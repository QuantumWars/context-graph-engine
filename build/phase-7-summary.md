# PHASE 7 SUMMARY — Entity resolution: blocking before pairwise comparison — 2026-08-19

## 1. Verdict

**Phase closed. The recon's take list is now complete** — seven of seven, the last of them the one
it rated highest.

```
$ bun run --cwd engine check
 290 pass
 0 fail
 764 expect() calls
Ran 290 tests across 20 files. [3.13s]
```

Both defects that travel with the original are designed out and proven red. And the measurement
produced a finding about **the measurement**, which is the part worth reading.

| | |
|---|---|
| Blocking recall (PC) | **100%** with phonetic keys, 66.7% without |
| Comparisons avoided (RR) | **92.6%** — 24 pairs instead of 325 |
| Candidate precision (PQ) | 25%, against 1.8% for all-pairs |
| **But** | one of the two phonetic recoveries is an **accidental code collision**, not the mechanism working |

---

## Task 7.1 — Port blocking, with one strategy and no legacy default

Acceptance: two records whose names share a token produce a candidate pair; two that share nothing
produce none; an entity with no name is not silently made a candidate for every other nameless one
without that being a stated, tested choice. Blocking is proven to reduce comparisons against the
all-pairs baseline on a fixture, with the reduction stated as a number.

**Met.** `src/resolve/blocking.ts`. **There is no strategy option and no `legacy` mode.**

Finding A-11 is that the original reads `options.get("candidate_strategy", "legacy")` and `legacy`
blocks on `name[0]` — first-letter bucketing — so the advertised "blocking + semantic
deduplication" is first-letter bucketing for anyone using the documented Python API. A default that
silently degrades the advertised behaviour is the defect, not a feature to preserve.

The test asserts the absence, and proves its own fixture first:

```ts
const rs = [c('a', 'checkout outage'), c('b', 'cafeteria menu')];
expect([...blockKeys(rs[0]!)].filter((k) => blockKeys(rs[1]!).has(k))).toEqual([]);
expect(rs[0]!.name[0]).toBe(rs[1]!.name[0] as string);   // the first letters really do match
```

The nameless case is a stated choice rather than an accident: nameless records share one block, so
they become mutual candidates — cheap while they are few, quadratic if they are many, and written
down either way.

**Reduction, as a number:** 325 all-pairs comparisons become 24.

---

## Task 7.2 — Cap by similarity, never by index

Acceptance: a fixture where the true match sits at a high index and the cap is smaller than the
candidate count. Under an index-ordered cap the true match is dropped; under a similarity-ordered
cap it survives. **Both assertions in the same test**, so it fails against the ported behaviour.

**Met.** The original's `sorted(neighbors)[:max_candidates]` keeps the lowest **indices** — that is
insertion order, which carries no information about similarity at all. A true match loaded late is
dropped in favour of an unrelated record loaded early, and nothing reports it.

**The first fixture proved nothing, and that is worth recording.** It was a star: one target with
four candidates. Each spoke had exactly one edge, kept it, and the union-of-per-entity-keeps rule
preserved everything regardless of ordering. The test passed the wrong way round.

Rebuilt as a **clique** where the true pair sorts last from both ends, so an index-ordered cap
sheds it from both sides and the union cannot rescue it:

```
--- cap restored to index order (the ported behaviour)
(fail) the cap keeps the most similar, not the lowest-indexed > similarity-ordered capping KEEPS it
 29 pass / 1 fail
```

The cap is deliberately **not** a hard degree bound — a pair survives if either endpoint keeps it —
and that is stated at the function rather than discovered: dropping a pair the other side ranked
first would lose a match to a bound that was only meant to limit work.

---

## Task 7.3 — Score similarity, with the weights stated once

Acceptance: the weights exist in exactly one place, sum to a stated total, and a test fails if a
weight is changed without the total being restated. Every weight carries a `PROVENANCE:` note, so
`constants-gate` passes.

**Met.** Finding A-12 is that the original's docstring names `0.4 / 0.3 / 0.2 / 0.1` while its
signature uses `0.0 / 0.6 / 0.2 / 0.2` — so the documentation presents embedding similarity as the
largest term while it is switched off entirely.

The defence is structural rather than editorial: one `WEIGHTS` object, a `WEIGHT_TOTAL` asserted
against its sum, and nothing restating them in prose. **A comment cannot drift from a value it does
not contain.**

```
$ node .claude/skills/constants-gate/scripts/gate.mjs --root engine
constants-gate: PASS — 11 constant(s) across 47 file(s), every one accounted for
```

One design choice worth naming: **a missing component scores 0 rather than being dropped from the
denominator.** Renormalising over "the components we happen to have" is how a record carrying only
a name scores 1.0 against anything similarly named — the same shape as finding A-6's per-source
normalisation, which promotes a source's best candidate however poor it is.

---

## Task 7.4 — Cluster, and say what transitivity costs

Acceptance: connected components over the accepted pairs, with the transitivity risk
**demonstrated** — a fixture of three records where A~B and B~C but A is plainly not C, showing
what the closure does, and the chosen policy stated with its cost. No silent merge.

**Met, and demonstrated rather than described:**

```ts
// jon-smith ~ j-smith ~ jane-smith
expect(similarity(c('jon-smith', 'jon smith'), c('jane-smith', 'jane smith')).total)
  .toBeLessThan(0.6);                       // the two ends genuinely are not alike
expect(merged(cluster(ids, pairs, 0.65))[0]!.members)
  .toEqual(['j-smith', 'jane-smith', 'jon-smith']);   // and all three merge anyway
```

**No threshold makes transitivity safe** — raising it only moves where the chain breaks, and there
is a test for that too. So the policy is the one Algorithm 5 already uses for causal chains: form
the component, and **report the weakest link holding it together**. A cluster whose weakest edge is
0.42 is a different claim from one whose weakest edge is 0.95, and the caller gets both instead of
a merged blob.

---

## Task 7.5 — Measure it with the standard metrics

Acceptance: a labelled duplicate set in `eval/`, with the labelling rule and its author stated as
`eval/dataset.ts` does. PC, PQ and RR computed as pure functions with hand-computed tests, reported
for the real blocker and for an all-pairs baseline.

**Met.** 26 records, 6 labelled duplicate pairs, 3 named non-duplicates. The labelling rule is at
the top of the file and was written before any blocking parameter was looked at, and it states —
as `eval/dataset.ts` does — that the same session wrote the labels and the blocker, which is the
weakest thing about it.

```
  configuration         PC     PQ     RR  compared  missed
  all-pairs         100.0%   1.8%   0.0%       325       0
  token only         66.7%  19.0%  93.5%        21       2
      lost: per-5a per-5b · hard-9a hard-9b
  + type-scoped      66.7%  19.0%  93.5%        21       2
  + phonetic        100.0%  25.0%  92.6%        24       0
  token+type+phon   100.0%  25.0%  92.6%        24       0
  + cap 3           100.0%  25.0%  92.6%        24       0
```

Type scoping changed nothing here — it is a precision tool and this set's duplicates already share
a type. Recorded rather than dropped, because "it made no difference" is a result.

### The finding: PC is 100% and one recovery is luck

Phonetic keys recovered both missing pairs. Only one of them is the mechanism working.

- `per-5a`/`per-5b` — `oleary` and `olery` both encode `O460`. A real variant, right reason.
- `hard-9a`/`hard-9b` — *"p1 checkout unavailable forty minutes"* and *"the friday outage"* share
  **no tokens at all**. They collide because **`forty` and `friday` both encode `F630`.**

I predicted phonetic keys could not reach a pair sharing no tokens. They did. Rule 9 says the
disagreement makes the *check* the suspect, so I looked, and the check was right — my
*interpretation* would have been wrong. Reading `PC = 100%` as "phonetic handles name variants"
overstates it by exactly one pair.

Both are pinned in the suite, so the distinction cannot quietly become "phonetic blocking works":

```ts
expect([...withoutPho.missed].sort()).toEqual(['hard-9a hard-9b', 'per-5a per-5b']);
expect(soundex('forty')).toBe(soundex('friday'));
```

**This is not a defect.** Soundex is a deliberately coarse hash; over-collision is the mechanism.
Blocking's job is to be generous and the scorer's is to be strict.

### And a second wrong belief of mine, corrected by the suite

I asserted `catherine` and `katherine` collide. They do not: Soundex keeps the initial letter
literally, so they are `C365` and `K365`. That is Soundex as specified. The labelled pair is
recovered by its **surname**, and there is now a test asserting the non-collision so nobody "fixes"
the code expecting the forenames to match.

---

## 2. The characteristic failure of this phase

**Three of my own claims were wrong, and the suite caught all three within minutes:** a fixture
that could not exercise the behaviour it named, a prediction about phonetic reach, and a factual
claim about Soundex.

That is the sixteenth, seventeenth and eighteenth instances of this build's characteristic failure.
The pattern has not weakened. What has changed is that the doctrine is now written into
`guard-integrity` as shape 6 and rule 9, so the next session inherits it without reading six phase
summaries to find out why.

Worth noting the direction each time: rule 9 says suspect the check, and in all three cases the
check was right and **I** was wrong. The rule does not say the check is correct — it says stop
believing the confident answer until you know which side is at fault.

## 3. Still open

- **Resolution is not wired to the store.** `src/resolve/` is a Stage 1 island by design; nothing
  calls it yet. A `resolve` CLI verb and a merge record kind are the interlink step.
- **What a merge *means* in an append-only log is undecided.** Merging two records cannot rewrite
  them, so it has to be a new record asserting the identity — which then interacts with retraction
  and purge in ways nothing has thought through.
- **24 labelled pairs is a small set**, and the labels are author-written. The sweep is deliberately
  not run against it to pick winners.
- **Type scoping is unexercised** by this data.
- Everything carried from Phase 6.

## 4. What the recon has left

With this phase the take list is complete. What remains from `recon-semantica` is:

- **Task 3.2, extraction with span provenance** — no extractor exists, so every edge is asserted by
  hand. The rule "an edge is written only when the text supports its predicate" is satisfied
  trivially because nothing is extracted at all.
- **`semantica/reasoning/`'s Rete and Datalog engines** — real implementations, unreachable from any
  shipped entry point, and the recon was explicit that deciding their fate needs a behaviour pass it
  never ran. Under this repository's own rule, refuted and untested are not the same thing.
