# PHASE 8 SUMMARY — Wire resolution into the store — 2026-08-20

## 1. Verdict

**Phase closed.** `src/resolve/` is no longer an island: `suggest` and `merge` are reachable from
the CLI and from MCP, and every content read path resolves through merges.

```
$ bun run --cwd engine check
 313 pass
 0 fail
 818 expect() calls
Ran 313 tests across 21 files. [3.50s]
```

Two real defects were found by **running the thing**, not by the suite — one of them in the guard
this phase was written to build, and one of them in the error message that guard prints.

| | |
|---|---|
| Uncomfortable case (8.4) | resolved: purging a canonical is **refused**, with the remedy named |
| Defect found by CLI use | the named remedy **did not work** when followed — fixed |
| Real-store `suggest` | 18 candidates, **145 pairs scored**, top score 0.375, nothing proposed |
| Unexpected measurement | blocking's reduction ratio fell from **92.6% to 5.2%** on this store |

---

## Task 8.1 — Propose clusters from the real store, without writing anything

Acceptance: a test proves the log is byte-identical before and after a suggestion run, and that a
suggestion names its weakest link. A run against the real store is pasted, whatever it finds —
including if it finds nothing, which on 18 hand-ided records is a plausible and reportable outcome.

**Met.** `Store.suggest(minScore = 0.6)` reads the log, builds candidates from live `node` and
`decision` records carrying a usable name, and returns clusters with their weakest link. It writes
nothing, and the test asserts that by hashing the log rather than by trusting the code:

```ts
const before = readFileSync(paths.log, 'utf8');
const proposals = s.suggest(0.5);
expect(readFileSync(paths.log, 'utf8')).toBe(before);
expect(proposals.length).toBeGreaterThan(0);   // anti-vacuity: it really did compute something
```

The real store, at the default and below it:

```
$ bun --cwd engine src/cli.ts --workspace /Users/doniel/code/Personal/context-management suggest
nothing looks duplicated above that score

$ … suggest --min 0.45
nothing looks duplicated above that score
```

### "Nothing found" is only a result if something was compared

A zero from an empty candidate set is not a finding, so the run was instrumented before being
reported:

```
  live node/decision records with a usable name: 18
  blocks: 439  pairs actually scored: 145  all-pairs would be: 153
  top scoring pairs:
    0.375  f-fake-example ~ f-near-fabrication
    0.348  d-mark-examples ~ f-fake-example
    0.348  d-no-model ~ f-rrf-disjoint
```

145 pairs were scored and the best reached 0.375, so **nothing was proposed because nothing was
similar enough** — not because nothing was looked at. The top pair is two records about the same
episode which are genuinely not the same record, and not merging them is correct.

### The finding: blocking barely blocks when names are sentences

`RR = 1 − 145/153 = 5.2%`, against **92.6%** measured on the Phase 7 eval set. The eval set's names
are entity-shaped (`oleary`, `j-smith`); this store's are whole sentences, and sentences share
common tokens, so nearly every record lands in a block with nearly every other.

This is not a defect — blocking is still correct, and at 18 records the cost of 145 comparisons is
nothing. It is a **calibration limit stated rather than discovered later**: the Phase 7 reduction
figure was measured on entity-shaped names and does not transfer to prose. Filed in §4.

---

## Task 8.2 — Append a merge, and resolve reads through it

Acceptance: after merging B into A, a read for B answers from A **and names the merge that
redirected it**. The merge record contains no field value of either member's content, asserted by
scanning it the way the tombstone test does. The chain verifies after the merge.

**Met.** `RECORD_KINDS` gains `'merge'`; `contentOf` resolves through merges; `resolveId(id, at?)`
returns `{requested, canonical, via}` so an answer can always say why it came from elsewhere.

```ts
expect(re.contentOf('B')).toEqual({ text: 'checkout outage after friday deploy' });
expect(re.resolveId('B')).toEqual({ requested: 'B', canonical: 'A', via: m.id });
```

Nothing is rewritten, asserted structurally rather than by inspection — both members keep their
bytes **and their digests**:

```ts
expect(after).toEqual(before);   // id, digest and content of A and B, across a reload
```

The content scan follows the tombstone test's shape, **including proving the scan works**:

```ts
for (const v of [...]) expect(serialised).not.toContain(v);
expect(JSON.stringify({ ...m, leak: 'checkout outage after friday deploy' }))
  .toContain('checkout outage after friday deploy');    // the scan can find a value when present
```

Four refusals, each with a reason code: `merge_too_small`, `canonical_not_a_member`, `not_found`,
and `member_already_merged`. The last one matters — two competing identity claims would make
resolution order-dependent, and an identity that depends on read order is not an identity.

---

## Task 8.3 — Retract a merge, and prove the un-merge

Acceptance: after retracting the merge, a read for B answers from B again. A point-in-time query
before the retraction still resolves through the merge, and after it does not — so the un-merge is
visible on the valid-time axis rather than being a silent revert.

**Met.** There is no `unmerge` method, and a test asserts its absence so a second undo path cannot
appear quietly:

```ts
expect((s as unknown as Record<string, unknown>)['unmerge']).toBeUndefined();
```

The un-merge is on the time axis, not a revert:

```ts
expect(re.resolveId('B', mergedAt).via).toBe(m.id);                 // in force when it was made
expect(re.resolveId('B', '2026-12-01T00:00:00Z').via).toBeNull();   // and not today
```

---

## Task 8.4 — The interactions nothing has thought through

Acceptance: each interaction has a test asserting a named outcome and a reason code where it
refuses. Any case whose right answer is genuinely unclear is reported as an open question with the
options, not resolved by whatever the code happens to do.

**Met.** All five interactions are pinned. The uncomfortable one was resolved rather than reported
open, because measurement made the answer clear.

### The uncomfortable case, measured before it was decided

Purging the canonical of an active merge, with no guard in place:

```
before purge: contentOf(B) -> {"text":"canonical record with a secret"}
after purge : contentOf(B) -> null
but B's own content is still on disk: {"text":"the same thing, other wording"}
```

**B reads as erased and is not.** That is the worst state available to an erasure feature: someone
purging a leaked credential sees `null`, reasonably concludes it is gone, and it is sitting in
`log.jsonl`. `DEC-004` exists to prevent exactly that impression being false.

Three options were weighed:

| Option | Rejected because |
|---|---|
| Cascade the purge to every member | an implicit destructive action across records the caller never named |
| Fall back to the member's own content | trades "looks purged, isn't" for "you asked to erase it and part is still readable" — worse for the case purge exists for |
| **Refuse, and name the remedy** | **chosen** — makes the caller say which records they mean |

```ts
expect(err?.code).toBe('canonical_of_active_merge');
expect(err?.message).toContain('Retract the merge first');
expect(err?.message).toContain('A, B');
```

Retracting the **canonical** (as opposed to purging it) is also pinned, and needs no guard: reads
still resolve to it, because a retraction says the claim stopped being true rather than that the
record is gone, and its content stays readable — which is what makes "what did we believe in March"
answerable at all.

The other four: purging a **non-canonical** member is allowed and reads still resolve; retracting a
member does **not** un-merge it (a claim stopping being true says nothing about what it names); a
purged member leaves the merge record intact, because it holds no content; and the merge record
itself verifies in the chain throughout.

---

## Task 8.5 — Reach it from the CLI and MCP

Acceptance: a pasted session against a real store — suggest, merge, read through it, verify,
retract, read again. Driven through the shipped surface, not the API.

**Met.** Two verbs on both surfaces, `merge` requiring explicit `--canonical`. A full session,
through the CLI, against a real store on disk:

```
--- suggest ---
inc-a  inc-b
  weakest link 0.500  inc-a ~ inc-b
  to accept: engine merge inc-a inc-b --canonical inc-a

These are suggestions and nothing was written. Similarity is not transitive —
check the weakest link before accepting a group of more than two.

--- merge ---
merged inc-a + inc-b → inc-a  seq=4
  nothing was rewritten; reads for the others now answer from inc-a and name merge:inc-a+inc-b.

--- purge the canonical: refused ---
error: canonical_of_active_merge: "inc-a" is the canonical record of merge "merge:inc-a+inc-b",
so purging it would make every member read as empty while their own content remains on disk.
Retract the merge first, or purge each member: inc-a, inc-b.

--- retract the merge, then purge immediately: the named remedy ---
purged inc-a at 2026-08-19T18:54:21Z
  tombstone scope: this-store-only — this store only. Copies elsewhere are not reached.

✓ chain verifies — 6 record(s), 1 purged, 0 problems
```

---

## 2. The defect the suite could not have found

**The remedy the error message named did not work when followed.** The refusal says *"Retract the
merge first"*; doing exactly that and purging immediately was refused **again**.

`now()` has one-second resolution, and Algorithm 2's windows are inclusive at both ends, so a merge
retracted at T is still in force *at* T. The whole exchange happened inside one second.

This did not appear in any test, because the tests used an advancing clock — which is the realistic
choice for a bitemporal engine and is exactly why it hid the bug. It appeared the first time the
CLI was driven by hand.

The fix splits the question rather than weakening the guard, because the two callers genuinely want
different answers at the closing instant:

- a **read** asks *is this merge in force at T* — inclusive, per Algorithm 2
- the **purge guard** asks *will this merge redirect any FUTURE read* — and one closing at T will not

```ts
return bound === 'after' ? a.ms < e.ms : a.ms <= e.ms;
```

Both directions are pinned, against a **frozen** clock that reproduces the original failure exactly:

```ts
test('the remedy the refusal names WORKS when followed immediately', …)
test('but a merge still open at that instant is STILL refused — the guard was narrowed, not removed', …)
```

**An error that instructs an action and then rejects it is worse than no message**, because it
spends the reader's trust as well as their time.

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| every `RECORD_KIND` has a writer | adding `'merge'` with no writer in the scenario | red, unprompted — it caught the new kind before I did |
| bundle is current with its source | editing `store.ts` after bundling | red twice, both times correctly |
| **CLI/MCP verb parity** | adding an `export` verb to the CLI only | red — `- "export"` |
| read-path enumeration | `resolveId` added without a marker | red (Phase 8, before this summary) |

The parity guard **had to be rewritten to be worth anything**. It compared against a hardcoded list
of nine verb names, so it went red merely because the surface had changed — it could not have
noticed a CLI verb with no MCP tool, which is the thing it is named for. It now parses `known` out
of `src/cli.ts` and compares, with an anti-vacuity check on the parse.

That is the sixth shape from `guard-integrity` again: a check that ran, answered confidently, and
was measuring something other than its name.

## 4. Still open

- **The `suggest` default of 0.6 is untested against prose-shaped records.** This store's best pair
  scores 0.375; the Phase 7 eval set's duplicates sit near 0.5. `0.6` remains a declared placeholder
  and no run has produced a true positive on real data. Do not describe it as calibrated.
- **Blocking's 92.6% reduction does not transfer to sentence-shaped names** — measured 5.2% here.
  Harmless at 18 records; the trigger to revisit is a store where all-pairs is genuinely expensive.
- **`resolveId` is not consulted by the causal walk.** `why` traverses edges by literal id, so a
  merged record's edges are not folded into the canonical's chain. Whether they should be is a real
  question and not a defect — folding them would make a chain report contain hops the source never
  asserted, which is the A-8 shape. Left as an open question deliberately.
- **`live()` filters on content and kind, not on validity.** Measured this phase while checking the
  retracted-canonical case: a retracted record is still in `searchable()`. That is the existing
  design — retraction is a fact on the time axis, applied by `stateAt`, and `live()` only excludes
  purged and bookkeeping records. It is recorded here because the name invites the other reading,
  and a future session will predict wrongly as this one did.
- Everything carried from Phase 7.
