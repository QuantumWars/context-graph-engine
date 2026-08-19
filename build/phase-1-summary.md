# PHASE 1 SUMMARY — Stage 1: the five algorithms — 2026-08-19

## 1. Verdict

**Phase closed.** Five algorithms built as pure functions, 107 tests passing, and every guard
seen red against a named source change before it was claimed.

```
$ bun run --cwd engine check
$ bun run typecheck && bun test
$ tsc --noEmit
 107 pass
 0 fail
 238 expect() calls
Ran 107 tests across 7 files. [27.00ms]
```

| Task | Module | Lines | Tests |
|---|---|---|---|
| 1.1 | `src/provenance/canonical.ts` + `chain.ts` | 137 + 236 | 9 + 17 |
| 1.2 | `src/temporal/window.ts` | 221 | 17 |
| 1.3 | `src/temporal/retract.ts` | 219 | 22 |
| 1.4 | `src/retrieval/rrf.ts` | 136 | 15 |
| 1.5 | `src/decision/causal.ts` | 268 | 24 |

**The research step earned its place, and not marginally.** It changed the design of Algorithm
1 outright — and by consequence Algorithm 3 — after finding that the erasure-versus-append-only
tension flagged as this build's main open risk is a studied problem with a converged answer we
were not going to reach on our own. `DEC-006` was superseded the same day it was written.

**Two of my own mutation tests were wrong before they were right**, both in the same way: they
appeared to prove a guard and proved nothing. Recorded in §2, because a mutation that fails to
kill is indistinguishable from a guard that works, and that is the failure this project exists
to catch.

**Stage rules held.** No Stage 1 file imports from `memory/`, and `src/store/` is still empty:

```
$ command grep -rhn "^import" engine/src/ | sort -u
38:import type { Json } from '../provenance/canonical';
39:import { parseInstant, type ParseReason } from './window';
42:import { createHash } from 'node:crypto';
43:import { canonicalJson, type Json } from './canonical';

$ ls -A engine/src/store/
$ echo "empty"
empty
```

---

## Task 1.1 — Port the hash-chained provenance record

Acceptance: a chain of N entries verifies clean; editing any entry's content in place is
reported as a checksum mismatch on that entry; deleting any entry is reported as a chain break
on its successor **and** as a sequence gap; two records that differ only in where a field
boundary falls produce different digests; and removing each of the three checks individually
turns exactly one test red, demonstrated and pasted.

**Met, and the design changed under it.** The research (`docs/research/01-provenance-chain.md`)
found three things. Canonical form: the rule `DEC-006` had reasoned out is the **JSON
Canonicalization Scheme, RFC 8785** — changed nothing, gave it a specification to name.
Structure: Crosby & Wallach's history tree (SIGIR 2009, adopted by Certificate Transparency)
buys logarithmic proofs *to a party that does not hold the log*, and `DEC-002` gives us no such
party — so the flat chain stays, with the reversing trigger named. Erasure: this one changed
the design.

Semantica hashes content directly, so erasing content breaks the chain — yet `DEC-004` had
already committed to purge being the remedy for a leaked secret. The two records were in
conflict. The converged answer in the literature is neither of the options we had: keep the
payload out of the hashed material and **commit** to it instead.

```
contentDigest = SHA-256(salt ‖ canonicalJson(content))
digest        = SHA-256(canonicalJson(record minus digest, content, salt))
```

`contentDigest` is inside `digest`; `content` and `salt` are not. Purge deletes both and the
chain still verifies. `DEC-007` records it and supersedes `DEC-006`; `DEC-006` keeps its
rejected-alternatives list and carries a note saying which single clause moved.

**Acceptance, clause by clause.** The clause said "three checks"; splitting the payload out of
the digest makes it **four**, so the extra one is proven too.

```
$ bun test --cwd engine test/chain.test.ts
 17 pass
 0 fail
 50 expect() calls
```

The boundary-collision clause is asserted against the original's actual behaviour, not merely
against ours — the test first proves Semantica's unseparated concatenation really does collide
on that input, so a pass means "fixed" rather than "the fixture is toothless":

```
    expect(semanticaStyle('ab', 'c')).toBe(semanticaStyle('a', 'bc'));   // the defect is real
    expect(one.contentDigest).not.toBe(two.contentDigest);                // and we do not have it
```

**Proven failure — each of the four checks disabled in turn:**

```
--- check 1 content_tampered disabled -> 15 pass / 2 fail
      RED: editing an entry content in place is reported as content_tampered on that entry
      RED: half a purge — salt removed but content kept — is content_tampered, not purged

--- check 2 digest_mismatch disabled -> 15 pass / 2 fail
      RED: editing an attested field is reported as digest_mismatch
      RED: a purge still cannot hide a real break elsewhere

--- check 3 chain_break disabled -> 15 pass / 2 fail
      RED: deleting an entry is reported as BOTH chain_break and sequence_gap on its successor
      RED: a forged prev pointing at a real earlier digest is still caught

--- check 4 sequence_gap disabled -> 16 pass / 1 fail
      RED: deleting an entry is reported as BOTH chain_break and sequence_gap on its successor
```

One honest note on that table: "reordering two entries is detected" stays green under all four,
because reordering trips both the link and the sequence check and disabling one leaves the
other. It asserts the union deliberately and is not evidence for any single check.

---

## Task 1.2 — Port bitemporal validity windows and `stateAt`

Acceptance: an edge whose own window is open but whose target is retracted is absent from the
snapshot; the test asserts that **no** snapshot edge has an endpoint outside the snapshot's
node set, computed from the result rather than hardcoded; boundary instants are inclusive at
both ends; a malformed bound is rejected with a named reason code rather than silently becoming
unbounded; and deleting the endpoint check turns the dangling-edge test red, demonstrated and
pasted.

**Met, plus one addition the research argued for.** SQL:2011 separates *valid time*
(application-supplied) from *transaction time* (system-supplied), and bitemporal means both.
Semantica's comments call its windows bitemporal but it carries only valid time. We get the
second axis nearly free, because Algorithm 1's append-only log already orders records by
insertion — `recordedAt` is transaction time and `asOf` truncates the input. `DEC-008` records
it, including the rule that transaction time is applied **before** valid time, so a record
written in June cannot influence a snapshot of what was believed in March.

```
$ bun test --cwd engine test/window.test.ts
 17 pass
 0 fail
 41 expect() calls
```

The dangling-edge clause is asserted the way it was written — computed from the result, so a
new way to leak one fails without anyone remembering to add a case:

```
    const ids = new Set(s.nodes.map((n) => n.id));
    expect(s.edges.length).toBeGreaterThan(0);   // anti-vacuity
    for (const e of s.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
```

**Failing closed rather than open.** `_parse_iso_dt` returns `None` on an unparseable value and
`is_active` then imposes no bound at all — verified in Phase 0 at `context_graph.py:151` and
`:168`, "treating node as Always-Active". The consequence runs backwards: a corrupted timestamp
makes a record *more* visible. Here an unusable bound excludes the record and names it in
`rejected`. Two further tightenings follow from the same rule: a date-time with no offset is
`ambiguous_timezone` rather than assumed UTC, and an inverted window is reported rather than
being merely invisible.

**Proven failure:**

```
--- endpoint rule removed (edge admitted without checking its endpoints)
    -> 15 pass / 2 fail
       RED: an edge whose own window is open is EXCLUDED when its target is not active
       RED: NO snapshot edge ever has an endpoint outside the snapshot node set

--- fail-closed removed (malformed bound becomes unbounded, as Semantica does)
    -> 14 pass / 3 fail
       RED: a record with a malformed bound is EXCLUDED and named, never always-active
       RED: an ambiguous-timezone bound is rejected with its own reason code
       RED: an edge with a bad bound is excluded even when both endpoints are fine

--- inclusive upper bound made exclusive
    -> 16 pass / 1 fail
       RED: bounds are inclusive at BOTH ends
```

---

## Task 1.3 — Port retract and purge as two distinct operations

Acceptance: after a retract, a point-in-time query before the retraction still returns the
record and a current query does not; after a purge neither does, and a scan of the serialised
tombstone for **every field value** of the purged content finds none of them; a retraction
against a window that already closed earlier leaves the earlier bound unchanged; and the state
of chain verification after a purge is stated explicitly and asserted, not assumed.

**Met.** The chain half was already settled by Task 1.1's research and locked as `DEC-007`, and
it is asserted rather than assumed — `chain.test.ts` carries "a purged entry still verifies,
and the chain stays valid" **and** "a purge still cannot hide a real break elsewhere", the
second being the one that matters, since a purge that suppressed real breaks would be worse
than no purge.

```
$ bun test --cwd engine test/retract.test.ts
 22 pass
 0 fail
 40 expect() calls
```

The tombstone clause is tested as written — every value, not a sample — and the scan is itself
proven capable of finding a value when one is present, so a pass means "absent" rather than
"the scan is broken":

```
    for (const v of values) expect(serialised).not.toContain(v);
    expect(JSON.stringify({ ...tombstone, leak: SECRET })).toContain(values[0] as string);
```

**What the research added.** GDPR Art. 17 reaches every copy, and a controller must inform
downstream holders, who are then independently responsible. Semantica's `purge_node` docstring
already scopes itself honestly — "one step of an erasure workflow, not the whole of it",
verified at `context_graph.py:1734`. The research says that posture is correct, so it is carried
over and made machine-visible rather than left in prose: every tombstone carries
`scope: 'this-store-only'`. Without it, a future session reporting to a user that data "has
been erased" would be overstating what this store can discharge alone.

**Proven failure:**

```
--- narrowing rule removed (retraction now widens a window)
    -> 19 pass / 2 fail
       RED: an EARLIER existing bound is kept — this is the whole rule
       RED: a retraction against an already-earlier-closed window leaves the earlier bound

--- tombstone leaks the purged content
    -> 20 pass / 1 fail
       RED: the serialised tombstone contains NO field value of the purged content

--- purge no longer clears the salt (commitment stays invertible)
    -> 20 pass / 1 fail
       RED: neither a past nor a present query returns the content
```

**A guard that was not a guard, and what fixed it.** A fourth mutation — the cascade consulting
a live skip set instead of a pre-loop snapshot — produced `21 pass / 0 fail`. The guard proved
nothing, because the test used two edges with **distinct** ids and the bug only manifests when
two edges share one. Semantica's edge ids are content-derived and can collide, which is exactly
why its own comment insists on the pre-loop snapshot. A test was added around two edges sharing
an id, and only then did the mutation kill:

```
=== baseline (guard intact) ===
    22 pass / 0 fail
=== skip set made LIVE (the real bug reintroduced) ===
    21 pass / 1 fail
       RED: two edges sharing an id are BOTH closed — the pre-loop snapshot is what allows it
```

---

## Task 1.4 — Port Reciprocal Rank Fusion, then decide which implementation survives

Acceptance: closes finding A-6. Given one channel whose candidates are all poor and one whose
top candidate is excellent, the excellent candidate ranks first — and the same fixture scored
by per-channel min–max normalisation is asserted **in the same test** to rank them wrongly, so
the test fails against a min–max implementation. Every fused item carries its per-channel rank
and its original per-channel score. An item with no id is a hard error carrying a reason code,
never a silent unfusable. A decision record names which implementation survives and why.

**Met.** The port is faithful to Cormack, Clarke & Buettcher (SIGIR 2009) — and worth saying
plainly, `hybrid_search.py:148-186` is one of the things Semantica gets right. The three defects
fixed are in the surrounding handling, not the arithmetic.

```
$ bun test --cwd engine test/rrf.test.ts
 15 pass
 0 fail
 27 expect() calls
```

A-6 is closed with the rejected algorithm implemented **in the test file** so the defect is
proven real before ours is credited with avoiding it:

```
    const bad = minMaxFuse(channels);
    expect(bad[0]!.score).toBe(1);
    expect(bad.filter((r) => r.score === 1).map((r) => r.id).sort())
      .toEqual(['excellent', 'junk-a']);        // the junk channel's best ties the excellent one

    const good = fuse(channels);
    expect(good[0]!.id).toBe('excellent');       // and under RRF it does not
```

`RRF_K = 60` ships as a **declared placeholder** at its definition site: the paper's default,
adopted and not calibrated against any query distribution of ours, because none exists yet.
Weighted RRF was considered and rejected on the same ground — fitting a weight with no harness
to fit it against is precisely the disease the teardown found, where
`semantica/evals/__init__.py` is ten lines reading `__status__ = "coming_soon"`.

**The decision: `DEC-009` keeps both, and names the boundary.** The two answer different
questions. `memory/src/recall.ts:363` takes exactly two channels and returns `string[]`, which
cannot carry the per-channel rank and original score this acceptance requires; adopting it would
mean weakening the acceptance to fit code we already had. Widening `memory/`'s instead would
modify a **live-wired** package to serve one with no users. The honest framing is that this is
duplication of an *algorithm* — four lines of arithmetic from a 2009 paper — not of a
*component*, which is what `DEC-001`'s concern was about. A third implementation would be a
defect, and the trigger for extracting a shared package is named.

**Proven failure:**

```
--- ranks made 0-based (paper says 1-based)          -> 12 pass / 3 fail
--- missing id falls back silently, as the original  -> 13 pass / 2 fail
--- per-channel score overwritten by fused value     -> 13 pass / 2 fail
--- contributions collapsed to last-wins             -> 11 pass / 4 fail
--- max() instead of sum — agreement not rewarded    -> 12 pass / 3 fail
       RED: agreement across channels beats a single first place
       RED: the fused score is exactly the sum of its contributions
```

---

## Task 1.5 — Port the decision node, typed causal edges and the causal chain

Acceptance: a chain report names its own weakest hop; an edge weighted `0.0` yields a decay of
`0.0` rather than `1.0`; a diamond-shaped graph returns both branches, proving per-path rather
than global cycle detection; a cycle terminates rather than looping; and a decision node carries
no second copy of its content anywhere, asserted structurally rather than by inspection.

**Met.**

```
$ bun test --cwd engine test/causal.test.ts
 24 pass
 0 fail
 49 expect() calls
```

**Stored once, which is the whole of A-2's fix.** A decision is a node; `decisionContent` reads
from the node and there is nowhere else to look. The structural assertion is that the module
exports nothing stateful that could hold a second copy, plus a test that editing the node is the
only thing that changes what a read returns — the A-2 symptom is precisely that it would not be.

**The casing trap is fixed at the boundary.** `record_decision` writes `"decision"` and
`add_decision` writes `"Decision"`, and two of Semantica's readers compare exactly, so decisions
created one way are invisible to them. Here one canonical form is normalised once and no reader
compares a raw string.

**Two numbers, not one.** The research (`docs/research/05-causal-chains.md`) came back **thin**,
and that is recorded rather than papered over: no direct comparison of product, minimum and
noisy-OR for path composition was found, and the design rests on structural reasoning marked as
such at both the note and the definition site. Noisy-OR is the wrong operator here by its own
definition — it combines several causes of one effect, which is parallel evidence, not serial
composition. Between product and minimum, the honest position is that the hop weights are
uncalibrated, so collapsing them into one figure is false precision. `productConfidence`
(independence assumed, read as a lower bound) and `weakestConfidence` (assumption-free) are
reported separately, alongside the weakest hop by name.

Semantica's interpretation string and its 0.7 / 0.4 thresholds were **not ported** — unmeasured
constants turned into a confident English sentence, which is more dangerous than the raw number
because it reads as a conclusion. The distance bands *were* ported, carrying a declared
placeholder note, because they classify an exact integer rather than a confidence.

**Proven failure:**

```
--- zero weight coerced to the 1.0 default    -> 23 pass / 1 fail
       RED: a 0.0 weight yields a product of 0.0, NOT 1.0
--- kind compared exactly, not normalised     -> 23 pass / 1 fail
       RED: every casing Semantica produces normalises to the one canonical kind
--- weakest link picks the STRONGEST hop      -> 22 pass / 2 fail
       RED: it names its own weakest hop
--- unknown edge type accepted silently       -> 23 pass / 1 fail
       RED: an unknown type is a named error, not a silently created edge
```

**The second guard that was not a guard.** The per-path-cycle-detection mutation first produced
`24 pass / 0 fail`. The mutation was wrong, not the guard: reassigning the path set inside the
loop still let the diamond's second branch through, so it never simulated a global visited set.
Rewritten as a real one — a single set for the whole traversal, marked as each node is reached —
it kills:

```
=== baseline (per-path cycle detection) ===
    24 pass / 0 fail
=== GLOBAL visited set (the bug Semantica's comment warns about) ===
    23 pass / 1 fail
       RED: a diamond returns BOTH branches
```

---

## 2. The characteristic failure of this phase

**Two mutation tests were wrong in the same way, and both looked like passes.** In Task 1.3 the
cascade mutation left the suite green because the fixture used distinct edge ids; in Task 1.5
the cycle-detection mutation left it green because the mutation did not actually build a global
visited set.

Both were caught only because the expectation was written down first — *this change should make
that test red* — and the result contradicted it. Had the mutation been run without a prediction,
green would have read as confirmation. The rule that follows: **a mutation that fails to kill is
a finding about the test or the mutation, never a fact about the code**, and it must be resolved
before the guard is claimed. It is now in `engine/CLAUDE.md`.

## 3. Still open

- **`RRF_K = 60`, the distance bands (1/3/6), and every hop weight are uncalibrated**, declared
  as placeholders at their definition sites. Calibrating them needs an evaluation harness, which
  is post-spine work and not yet scheduled.
- **`docs/research/05-causal-chains.md` rests on reasoning, not on a cited comparison.** If the
  comparative literature on path-confidence composition is found, that note is the thing to
  revise.
- **The engine still does nothing end to end.** Five islands, deliberately: `src/store/` is
  empty and no algorithm calls another beyond a shared type import. That is Phase 2.
- **`definition-gate` still does not validate agent `skills:` references**, filed in Phase 0 and
  untouched here.

## 3b. Added after the phase closed, at the operator's request

Two artifacts, neither of which changes any algorithm or any test result above.

**`engine/demo.ts` — a verification harness.** In-memory only: reads no store, writes no file,
and `src/store/` is still empty, so the Stage 1 rule holds. It exists because a test asserts
what the author expected, while watching the code run shows what actually happens, and those
are different kinds of evidence. Six scenarios:

```
$ bun --cwd engine demo.ts
  chain     tamper-evidence — edit a record, delete a record, watch it get caught
  purge     erasure — delete a leaked secret, and the chain still verifies
  retract   retract vs purge — "no longer true" is not "should never have existed"
  time      two time axes — what was true then, vs what we believed then
  fuse      rank fusion — why per-source normalisation throws away the answer
  causal    causal chains — why a decision happened, and how much to trust the link
  all       run every scenario
```

Verified: all six run clean, an unknown scenario exits 2 rather than 0, and `demo.ts` was added
to `tsconfig.json`'s `include` so it is typechecked rather than being unchecked code beside a
checked package.

```
$ for s in chain purge retract time fuse causal; do bun --cwd engine demo.ts "$s" >/dev/null 2>&1 && echo "  OK   $s" || echo "  FAIL $s"; done
  OK   chain
  OK   purge
  OK   retract
  OK   time
  OK   fuse
  OK   causal
$ bun --cwd engine demo.ts nonsense >/dev/null 2>&1; echo "exit=$?"
exit=2
```

**`engine/docs/future-work/`** — what is deliberately not built, and what would trigger
building it. `01-erasure-and-the-hash-chain.md` writes up the purge-versus-chain solution in
full: the problem, why the two systems we studied avoid rather than solve it, the salted
commitment design, why deleting the salt is the load-bearing half, what it costs, and six open
items. The largest is **downstream propagation** — this store can clear its own copy and says
so in every tombstone via `scope: 'this-store-only'`, but it cannot reach a copy something else
made, and no export ledger exists yet to know where copies went.

## 4. What Phase 2 depends on from this phase

`DEC-007` fixes the record envelope, so the store can be built without reopening the format.
`DEC-008` requires `recordedAt` on every record with no nullable path. `DEC-009` forbids a third
RRF. And the five modules are pure, so wiring them is a matter of adding callers rather than
untangling them — which was the point of keeping `src/store/` empty.
