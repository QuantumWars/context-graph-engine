# PHASE 3 SUMMARY — Stage 3: real-world test cases — 2026-08-19

## 1. Verdict

**Phase closed, and it did what a Stage 3 is for: it found three real bugs in the product.**

```
$ bun run --cwd engine check
$ bun run typecheck && bun test
$ tsc --noEmit
 190 pass
 0 fail
 491 expect() calls
Ran 190 tests across 14 files. [2.24s]
```

| # | Bug | Found by | Severity |
|---|---|---|---|
| 1 | **Two processes could both claim `seq 1`** — the lock protected the write but not the read that decides `seq` and `prev` | 3.3, two real subprocesses | serious — silent chain corruption |
| 2 | `2026-02-29` was accepted and silently became `2026-03-01` | 3.3, boundary timestamps | real — a date that does not exist, answered as one that does |
| 3 | **`retract` had no `at` parameter**, so the only expressible retraction was "it stops being true *now*" | 3.1, a session replaying three days | real — the port dropped a parameter the original has |

Plus a **vacuous test I wrote myself** and caught before the audit did, and **two limitations that
are not fixable here** and are now documented rather than hidden.

Bug 1 is the one that matters. It is invisible to any single-process test, because the promise
queue serialises those anyway — the suite had a concurrency guard in Phase 2 and it tested the
*workspace* boundary, not concurrency. It took two real `bun` processes to see it.

---

## Task 3.1 — The multi-day agent session

Acceptance: a single test drives at least 12 CLI invocations across at least 3 simulated days,
asserts on the **content** of what comes back rather than exit codes, and ends with a chain that
verifies. The store is created and destroyed by the test. At least one assertion must distinguish
"what was true then" from "what we believed then" and fail if the two axes were collapsed.

**Met — and it found bug 3 immediately.**

`test/scenario.test.ts` drives 15 CLI invocations across three simulated days: an incident, a
deploy freeze, a causal link, a runbook containing a pasted credential, then a gate that supersedes
the freeze, then the credential being noticed and purged.

The two-axis assertion is real rather than decorative. `now()` has one-second resolution, so the
test crosses a **real second boundary** with `Bun.sleep(1100)` rather than faking a clock:

```ts
const beforeDay2 = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
await Bun.sleep(1100);
// ... day 2 records the gate ...
const believedThen = R('at', '2026-06-01T00:00:00Z', '--as-of', beforeDay2).out;
expect(believedThen).not.toContain('gate');   // not yet recorded, so not yet believed
expect(trueNow).toContain('gate');            // but true, once we knew
```

A seam letting a caller set `recordedAt` would be a seam letting them lie about it, so there is
none — the test works with real transaction time.

**The bug it found.** Retracting the freeze did not remove it from a June query:

```
Expected to not contain: "freeze"
Received: "valid at 2026-06-01T00:00:00Z\n  nodes: incident, freeze, gate\n ..."
```

The code was right and the model was wrong. `Store.retract` closed the window at
`this.deps.now()` — the real clock — so a session replaying March could only ever say "this stops
being true today". The original takes the instant as a parameter, and the port dropped it:

```
$ command grep -n "def retract_node" -A 4 semantica/semantica/context/context_graph.py
1556:    def retract_node(
        self, node_id: str, reason: Optional[str] = None,
        at: Optional[Union[str, datetime]] = None,
```

Fixed by separating the two instants explicitly, which is what `DEC-008` was already about:
`closedAt` is **valid time** — when the fact stopped being true, which the caller knows and the
engine does not — and `recordedAt` is **transaction time**, engine-supplied and not settable.
`effectiveValidUntil` now folds on the retraction's `validFrom`, not on when we were told.

**Proven failure:**

```
--- retraction folds on the wrong time axis
(fail) a multi-day agent session > three days of work, ending in a chain that verifies
 0 pass / 1 fail
```

---

## Task 3.2 — The adversarial suite

Acceptance: closes with a table of attack → reason code → test name, every row backed by a test
that fails when the corresponding check is removed. Any attack that is **not** caught is reported
as a finding with the reason it is out of reach, not quietly dropped from the table.

**Met.** Eleven attacks caught, **two not caught and reported**.

| Attack | Result | Reason code |
|---|---|---|
| Edit a record's content | caught | `content_tampered` |
| Edit an attested field (backdate `recordedAt`) | caught | `digest_mismatch` |
| Swap two records' content, keeping both digests | caught, both flagged | `content_tampered` ×2 |
| Delete a record | caught, two signals | `chain_break` + `sequence_gap` |
| Reorder two records | caught | `chain_break` / `sequence_gap` |
| Replay — append a duplicate of an existing record | caught | `chain_break` + `sequence_gap` |
| Forge `prev` to a real earlier digest | caught | `digest_mismatch` |
| Renumber `seq` to close a gap after deleting | caught | `digest_mismatch` |
| Truncate the file mid-line | caught | `malformed_line` |
| Inject valid JSON that is not a record | caught | `unknown_kind` |
| Purge-as-cover for a break elsewhere | caught, exactly one flag | `content_tampered` |
| **Truncate whole records off the end** | **NOT CAUGHT** | — |
| **Wholesale rewrite by someone holding the code** | **NOT CAUGHT** | — |

The renumbering row is worth reading. Renumbering defeats the sequence check completely, and the
**link** is what survives to catch it — which is the concrete answer to why the verifier checks
both, a question Phase 1 answered only by quoting the original.

**The two gaps are asserted, not hidden.** They have tests that pass *because* the attack succeeds:

```
✓ LIMITATION: truncating whole records off the END is not detected
✓ LIMITATION: a wholesale rewrite by someone holding the code is not detected
```

Both are what an unanchored hash chain *is*, not implementation defects. A chain proves ordering
and integrity of what is present; it cannot prove completeness. `docs/future-work/02-what-the-chain-cannot-detect.md`
writes up both, the three possible anchors, and why **each one conflicts with a decision already
made** — a signed head needs a key `DEC-004` says we do not hold, an external witness needs a
network `DEC-002` says we do not have, and a head file beside the log is theatre against an
attacker who can rewrite the log.

The standing phrasing that every document here must now use:

> The chain proves that the records present have not been altered and are in the order they were
> written. It does not prove that all the records ever written are still present.

**A vacuous test, caught while writing this task.** The first version of the limitations test was
`expect(claim).toBe(claim)` — a string equalling itself. It would have passed against a deleted
engine. Replaced with one that reads the future-work document and fails if the limitation stops
being documented.

---

## Task 3.3 — The ugly-input suite

Acceptance: two concurrent writers produce a log whose chain verifies and which contains **both**
records — asserted by running real concurrent processes, not by simulating them in one process. A
large store's rebuild-on-load and purge cost are **measured** and the figures written down.

**Met, and this is where bug 1 was found.**

Two real `bun` subprocesses, each appending 8 records:

```
StoreError: chain_invalid: 2 problem(s); first is chain_break at seq 1 (B-0)
--- records written: 9 (of 16)
```

**The lock was real and in the wrong place.** `Store.open()` read the log into memory; `append()`
computed `seq` and `prev` from that snapshot; only then did `appendLog` take the lock. Two
processes could both open an empty store, both compute `seq = 1`, and both write it. Seven records
were lost.

The fix is structural: `seq` and `prev` are decided *from* the file's current state, so the
decision belongs **inside** the critical section, not before it. `withLoggedMutation` now owns
read → decide → write as one locked unit, and `append`, `retract` and `purge` all go through it.

```
$ bun test test/ugly-input.test.ts
✓ two REAL processes appending concurrently both land, and the chain verifies
```

with `seq` asserted as a contiguous 1…16 and both writers' 8 records present — the property the
lock actually buys.

**Bug 2, same task.** `2026-02-29` does not exist. `Date.parse` rolls it over, so the engine
accepted it and answered about 1 March. `DEC-003` forbids exactly that silent temporal coercion.
`parseInstant` now validates the written calendar date before trusting the parse.

Also covered: an empty store answering every read path without throwing; a one-record store;
purging the only record; unicode including combining characters, RTL and ZWJ emoji round-tripping
byte-for-byte; decomposed and precomposed forms staying **distinct** rather than being normalised
into a collision; a 200,000-character value; 400-deep nesting; content that impersonates a record
envelope; a duplicate id leaving nothing behind; and leap-day, epoch and far-future instants.

**Proven failure, both fixes:**

```
--- read moved back outside the lock
(fail) two REAL processes appending concurrently both land, and the chain verifies
--- calendar check disabled
(fail) a non-leap-year 29 February is rejected, not silently rolled to 1 March
```

---

## Task 3.4 — Resolve Phase 2's open list

Acceptance: the structural channel is proven to contribute a candidate the lexical channel did not
find, in a store with real graph depth. The `retrieval` kind either has a writer with a test, or is
gone from `RECORD_KINDS` — and whichever it is, `DEC-005`'s stored-data table matches. Every
"unmeasured" note that 3.3 measured now carries the figure and how it was obtained.

**Met, all three.**

**The structural channel is now exercised.** Phase 2's transcript showed `considered=0` because a
four-record store has no neighbour that is not itself a lexical seed. On a six-record graph with
real depth, `hiring` — which shares no token with the query — is surfaced purely by the graph, and
carries exactly one contribution naming that channel. `menu`, which matches nothing and connects
to nothing, stays out.

**The `retrieval` kind has a writer.** `DEC-005`'s table already listed retrieval decisions as
stored, and nothing wrote one — a kind with no writer is schema decoration on dead code. Wired
rather than deleted, because the alternative is a system that claims to record every decision and
records none of them durably.

**The consequence is stated rather than hidden: a query now mutates the store.** `find` appends.
The log grows with reads, not only writes. That is the price of the ledger being true rather than
aspirational, and `--no-record` exists for a pure query. Retrieval rows are excluded from the
search corpus, so a query cannot match earlier queries.

The guard that keeps this honest asserts the set of declared kinds equals the set actually
produced:

```
--- a record kind is declared with no writer
  kills: adversarial, interlink  (2 tests)
```

**The measurements are recorded** in `docs/measurements.md`, with the command that produced them:

```
  n      append/rec   load(total)  load/rec   purge      file
  100    0.4ms        0.7ms        0.0ms      1.0ms      58KB
  500    0.6ms        2.6ms        0.0ms      2.8ms      288KB
  2000   1.3ms        9.2ms        0.0ms      9.8ms      1154KB
```

They settle `DEC-007`'s open question and raise a different one. Rebuild-on-load is **9.2ms at
2000 records** — not the problem it was flagged as, and not a trigger for the SQLite alternative
that record named. But **append is O(n) per record**, so building a store is O(n²): the cost of
reading the chain head inside the lock, which is what fixed bug 1. Correctness was bought with a
linear read.

Behaviour above 2000 records is **UNKNOWN** — three points do not establish a curve. Extend
`SIZES` in `scripts/measure.ts` to settle it. The fix, when needed, is a small head file written
inside the same lock, which makes append O(1) without touching the critical section. Not built: at
2000 records a 1.3ms append does not justify a second file and a consistency question.

The figures went into `docs/measurements.md` and the mutable future-work index, **not** into
`DEC-007` — a decision record states its date and does not change, and editing one to add a number
it did not have would falsify what was known when it was made.

---

## Task 3.5 — The guard audit

Acceptance: a verdict per test file — LIVE, PLAUSIBLE, UNREACHABLE or VACUOUS — with the naming
change for each LIVE one. Every VACUOUS test is repaired or deleted in this phase, and the repair is
demonstrated red. A count of tests audited that matches the suite's real count.

**Met. 190 audited, 190 in the suite — nothing skipped.**

```
  adversarial.test.ts  15    canonical.test.ts     9    causal.test.ts       24
  chain.test.ts        17    channels.test.ts     23    cli.test.ts           6
  interlink.test.ts     7    retract.test.ts      22    rrf.test.ts          15
  scenario.test.ts      1    store.test.ts        17    toolchain.test.ts     3
  ugly-input.test.ts   14    window.test.ts       17
  ------------------------------------------------------------------------
  TOTAL               190    suite reports:      190
```

Twenty-two mutations were applied across every source module, and every test file has at least one
that kills it. **Verdict: all fourteen LIVE. No VACUOUS, no UNREACHABLE.**

| Test file | Killed by, for example |
|---|---|
| `adversarial` | self-digest check off · content check off · a kind with no writer |
| `canonical` | key sorting removed |
| `causal` | kind not normalised · weakest link becomes strongest |
| `chain` | self-digest check off · content check off |
| `channels` | contradiction guard off · floor filter removed · structural channel emptied |
| `cli` | unknown command exits 0 · chain not verified on load · endpoint rule removed |
| `interlink` | structural channel emptied · retrieval rows leak into the corpus · a kind with no writer |
| `retract` | narrowing rule removed |
| `rrf` | sum becomes max · missing-id guard off |
| `scenario` | endpoint rule removed · retraction folds on the wrong axis |
| `store` | purged records not filtered · chain not verified on load · cwd fallback added |
| `toolchain` | a strict compiler flag loosened |
| `ugly-input` | read moved outside the lock · calendar check off |
| `window` | endpoint rule removed |

**One reporting artifact, corrected rather than left standing.** The first sweep reported
`interlink`, `toolchain` and `ugly-input` as killed by nothing. Two of those were true and one was
my own regex: `[\w]+` does not match the hyphen in `ugly-input`, so its kills were being filed
under `input`. The two genuine gaps were closed by four targeted mutations, and the regex was
fixed. A sweep that mis-parses its own output is the same class of error as a check that reports
phantom failures — Phase 2 had one of those too.

**The one VACUOUS test found was mine**, in this phase's own adversarial suite, and it was repaired
before the audit reached it. Recorded because catching it required no tooling — only asking the
question the audit asks, of a test I had just written.

---

## 2. The characteristic failure of this phase

**Every bug found this phase lived in a seam that a passing test had already crossed.**

- Phase 2 had a concurrency test. It tested the **workspace** boundary — two stores, one process —
  and passed while two processes could corrupt the chain.
- Phase 1 and 2 had thorough temporal tests. None used a date that does not exist.
- Phase 1's `retract.ts` **has** an `at` parameter and tests it. The store dropped it, and no test
  above the algorithm noticed, because every test above it used the default.

The pattern: **a well-tested component behind a caller that uses one narrow path through it.** The
algorithm was right every time. The wiring used a fraction of it, and the fraction it used was the
fraction that was tested.

That is the same shape as this project's founding observation — a green suite over a dead feature —
in a subtler form: a green suite over a *live* feature, exercising the part that works.

**The rule that follows:** a test that drives a component through its caller must vary the
parameters the caller defaults, or it only proves the default works. Added to `engine/CLAUDE.md`.

## 3. Still open

- **Truncation and wholesale rewrite remain undetectable.** Documented in
  `docs/future-work/02-what-the-chain-cannot-detect.md` with three possible anchors, each in
  conflict with an existing decision. Not built.
- **Append is O(n) per record**, measured to 2000 and UNKNOWN beyond. The head-file fix is
  described and not built.
- **Concurrency throughput under real contention is unmeasured**, as is the vendored lock's 30s
  stale timeout when a holder is genuinely slow. The lock's own header does not claim otherwise.
- **`RRF_K`, both retrieval floors and the causal distance bands remain uncalibrated.** No
  evaluation harness. This is now the oldest item on the list and the largest single gap.
- **A query mutates the store.** New this phase, deliberate, and worth revisiting if retrieval rows
  come to dominate the log.

## 4. What Phase 4 depends on from this phase

A suite that has been shown to fail, so a security pass can distinguish "no finding" from "no
detector". The adversarial suite is the starting point for the threat model, and the two
undetectable attacks are already the most interesting entries in it.
