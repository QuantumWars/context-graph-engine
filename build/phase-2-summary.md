# PHASE 2 SUMMARY — Stage 2: interlink, one store, and the CLI — 2026-08-19

## 1. Verdict

**Phase closed.** There is one runnable thing to point at: `engine record` writes a decision and
it survives a restart, a purge removes a leaked credential from the file while the chain still
verifies, and a tampered log refuses to load.

```
$ bun run --cwd engine check
$ bun run typecheck && bun test
$ tsc --noEmit
 153 pass
 0 fail
 397 expect() calls
Ran 153 tests across 10 files. [714.00ms]
```

**The most useful thing in this phase is a bug the tests caught in my own design.** The first
`retract` closed the target's window by editing the record and recomputing its digest — which
broke every later record's `prev` on the first retraction. That was not a defect in the chain; it
was this phase violating `DEC-007`, which says records are immutable and a correction appends.
Details in §2. Retraction is now derived at read time and the log stays append-only.

No Stage 1 algorithm changed to make any of this work. That was the point of keeping them pure,
and it held.

---

## Task 2.1 — Build the store as one append-only log with rebuilt views

Acceptance: a test enumerates **every read path as an explicit list in the test file**, then
asserts that after write → save → reload each one returns the record, and after purge → save →
reload none of them does. A read path added to the store without being added to that list must
fail the test, and that failure is demonstrated by adding one.

**Met.** Ten read paths, enumerated in `test/store.test.ts` as `READ_PATHS`, each with its own
probe so all ten are genuinely exercised rather than counted.

```
$ bun test --cwd engine test/store.test.ts
 17 pass
 0 fail
 57 expect() calls
```

The list cannot silently fall out of date, because the test **parses the read-path section of
`store.ts`** and asserts the declared methods equal the list — structural, not a convention
anyone has to remember. Demonstrated by adding an eleventh read path and not listing it:

```
=== a new read path added to store.ts but NOT to READ_PATHS ===
    16 pass / 1 fail
       RED: the read-path list cannot silently fall out of date > every method in store.ts's read-path section is in READ_PATHS
       diff shows the unlisted method: yes
=== restored ===
    17 pass / 0 fail
```

Purge removes the content from the **file**, not merely from the reader, and the test proves the
secret was there first — otherwise "not found" would prove nothing:

```ts
expect(readFileSync(paths.log, 'utf8')).toContain('sk-live-9f2b7c41aa');
await a.purge('secret', 'leaked');
expect(readFileSync(paths.log, 'utf8')).not.toContain('sk-live-9f2b7c41aa');
```

Nothing derived reaches disk. Asserted by listing the directory rather than by inspection:

```ts
expect(readdirSync(paths.dir).sort()).toEqual(['.gitignore', 'log.jsonl']);
```

`DEC-002`'s workspace rule is enforced with no current-directory fallback — resolution throws
rather than guessing, because guessing is the mechanism that produced six separate stores under
one repository.

---

## Task 2.2 — Make the store and the chain unable to diverge

Acceptance: appending through the public API and then running `verifyChain` over the raw file
returns valid, with the entry count matching the number of mutations — asserted, not assumed.
Hand-editing one byte of content in the file on disk makes the next load report
`content_tampered` naming the record, and the load refuses rather than returning a partial
graph. Both are demonstrated against a real file.

**Met.** Every mutation goes through one `build()` path, so there is no second writer that could
skip the chain. This is also **the first live edge-store writer anywhere in this monorepo** — no
`edges.jsonl` existed on disk before it, and `memory/src/graph-store.ts` has producers but nothing
that persists.

A tampered file refuses to load, naming the record:

```
StoreError: chain_invalid: 1 problem(s) in .../log.jsonl; first is content_tampered at seq 1
(d1). Refusing to load — a partial graph from a tampered log would answer questions without
saying the record was altered.
```

**A fixture bug worth recording**, because it is the same failure mode as the mutation problems in
Phase 1. The first version of that test edited `d2.content.outcome` to `'yes'` — and `d2`'s outcome
was *already* `'yes'`. The "tampering" changed nothing, the load succeeded, and the test failed for
the right reason by accident. The test now asserts the fixture really changed before relying on it:

```ts
expect(target.content.outcome).toBe('no');   // the edit is not a no-op
target.content.outcome = 'yes';
```

---

## Task 2.3 — Wire the retrieval path and record every decision it makes

Acceptance: a served retrieval and an abstained retrieval are distinguishable **from the recorded
row alone**, without reading the code that produced them; both carry per-channel top score, floor
and margin; and a row claiming `served` while returning zero results is rejected as a contradiction
rather than written. Any floor introduced is annotated at its definition site as a declared
placeholder naming what would calibrate it.

**Met.**

```
$ bun test --cwd engine test/channels.test.ts
 23 pass
 0 fail
 53 expect() calls
```

The structural channel is real graph signal rather than a restatement of the lexical one — a
record sharing **no token** with the query still ranks if the graph says it sits next to things
that do, and the test asserts exactly that pairing.

Both outcomes carry margins, and an abstention distinguishes *"nothing matched"* from *"nothing
cleared the floor"*:

```
served     query cad6f0f7c2f4c1c2 (22 chars)
  lexical     considered=2   top=0.756   floor=0.01   margin=+0.746
  structural  considered=0   top=—       floor=1      margin=—

abstained  query 0c1a385875452612 (20 chars)
  lexical     considered=0   top=—       floor=0.01   margin=—
  reason: no_candidates: neither channel returned anything
```

The query text is **not** stored — a hash and a length only, per `DEC-005`, following
`memory/src/ledger.ts`. Asserted by scanning the serialised row for the query string.

`LEXICAL_FLOOR` and `STRUCTURAL_FLOOR` ship as **declared placeholders**, annotated at their
definition sites with what would calibrate them.

**One honest limitation.** In the end-to-end session the structural channel reports
`considered=0`, because the only edge joins two records the lexical channel had already matched,
and a seed does not score itself. That is correct behaviour on a four-record store and it means
the channel is under-exercised by that particular transcript. `channels.test.ts` covers the case
the transcript does not.

---

## Task 2.4 — Write the interlink register

Acceptance: every connection introduced in Tasks 2.1–2.3 appears with a named failure behaviour
and a reason code; every reason code in the table exists in the source, verified by a command
whose output is pasted; and no connection is listed whose failure behaviour is "cannot happen"
without saying what enforces that.

**Met.** Thirteen connections in `ARCHITECTURE.md` §4, each with what the caller needs, what
happens when the callee is absent, slow or wrong, and its reason code. Verified against source:

```
  reason codes in the register's code column: 23
    OK  already_purged          OK  malformed_line
    OK  ambiguous_timezone      OK  malformed_temporal_value
    OK  below_floor             OK  missing_id
    OK  chain_break             OK  no_candidates
    OK  chain_invalid           OK  not_found
    OK  content_tampered        OK  sequence_gap
    OK  contradictory_decision  OK  unknown_edge_type
    OK  digest_mismatch         OK  unknown_kind
    OK  duplicate_id            OK  workspace_mismatch
    OK  duplicate_id_in_channel OK  workspace_unresolved
    OK  invalid_k               OK  inverted_window
    OK  invalid_max_depth

  missing from source: none
```

The first version of that check reported six missing codes and **all six were false positives** —
it matched every backticked word in the row rather than the reason-code column, so identifiers
like `fuse` and `prev` were treated as codes. Rewritten to read only the code column. A check
that reports phantom failures is as useless as one that reports none.

**One code was deleted rather than documented.** `kind_mismatch` was declared in `StoreErrorCode`
and thrown nowhere:

```
  kind_mismatch            declared_refs=1   thrown=0
```

Adding a row for a code nothing emits is schema decoration on dead code, so it was removed
instead.

---

## Task 2.5 — Ship the CLI

Acceptance: a transcript, pasted, of a single session that records two decisions, links them,
retracts one, purges another, queries a point in time, walks the causal chain, retrieves a
precedent and verifies the chain — **against a real store directory that is deleted and rebuilt
by the test**, with the store's raw bytes shown at least once. `--help` exits 0 and an unknown
subcommand exits non-zero.

**Met.** Nine subcommands. `test/cli.test.ts` runs the real binary as a subprocess against a
temporary workspace it creates and removes.

```
$ bun test --cwd engine test/cli.test.ts
 6 pass
 0 fail
 49 expect() calls
```

The session, run against a real directory — each command a separate process, so everything below
survives a restart by construction:

```
$ engine record d-friday --kind decision --text "deploying on friday caused a production incident" --valid-from 2026-01-10T00:00:00Z
recorded decision d-friday  seq=1  digest=1c899ffdf601…
$ engine record d-gate --kind decision --text "added a deploy gate to the pipeline" --valid-from 2026-02-01T00:00:00Z
recorded decision d-gate  seq=2  digest=8208f1e968c2…
$ engine record d-leak --kind decision --text "rotate key sk-live-9f2b7c41aa before the demo" --valid-from 2026-02-05T00:00:00Z
recorded decision d-leak  seq=3  digest=4e7daf652996…
$ engine link d-friday d-gate --type CAUSED --weight 0.9
linked d-friday --CAUSED(0.9)--> d-gate  seq=4
```

The raw bytes on disk:

```
$ ls -la $W/.claude/graph-engine/
-rw-------  .gitignore
-rw-r--r--  log.jsonl
$ head -c 300 log.jsonl
{"content":{"text":"deploying on friday caused a production incident"},"contentDigest":"af702a05b1b693bec1c0c15b34dd6a67aa3f6b5fd905af06893ede21be309529","digest":"1c899ffdf6019c7c620bff8e7d4fe6854245de5e966cdea7b1e5a5505ea84ca6","id":"d-friday","kind":"decision","meta":{"recordedAt":"2026-08-19T14:
```

Keys are sorted and there is no whitespace — the canonical form from `DEC-007`, on disk.

```
$ engine retract d-friday --reason "policy replaced by the gate"
retracted d-friday at 2026-08-19T14:59:18Z  content kept; window closed
$ engine purge d-leak --reason "contained a live credential"
purged d-leak at 2026-08-19T14:59:18Z
  tombstone scope: this-store-only — this store only. Copies elsewhere are not reached.

$ grep -c "sk-live-9f2b7c41aa" log.jsonl
0
$ engine verify
✓ chain verifies — 6 record(s), 1 purged, 0 problems
```

That is the whole claim of this project in four lines: the credential is gone from the file, and
the tamper-evidence over everything else is intact.

```
$ engine at 2026-01-20T00:00:00Z
valid at 2026-01-20T00:00:00Z
  nodes: d-friday
$ engine at 2026-12-01T00:00:00Z
valid at 2026-12-01T00:00:00Z
  nodes: d-gate

$ engine why d-gate --direction upstream
d-gate → d-friday
  hops 1  band direct
  product  0.900  assumes independence — a lower bound
  weakest  0.900  assumption-free
  weakest link: d-friday --CAUSED(0.9)--> d-gate

$ engine log
seq  kind         id                        digest        content
1    decision     d-friday                  1c899ffdf601… {"text":"deploying on friday caused a
2    decision     d-gate                    8208f1e968c2… {"text":"added a deploy gate to the pi
3    decision     d-leak                    4e7daf652996… ⌀ purged
4    edge         d-friday->d-gate:CAUSED   832e1bcc4f16… {"note":""}
5    retraction   d-friday:retracted:2026-0 3a2223f9bfa6… {"reason":"policy replaced by the gate
6    tombstone    d-leak:purged:2026-08-19T 06fcdbcb0bfc… {"reason":"contained a live credential
```

A corrupt store reports its reason and never a stack trace, asserted rather than described:

```ts
expect(r.out).toContain('content_tampered');
expect(r.out).not.toContain('at <anonymous>');
expect(r.out).not.toContain('.ts:');
```

`--help` exits 0 and lists all nine; `engine frobnicate` exits non-zero naming the known set.

---

## Proven failure — every guard added in this phase

A guard is worth exactly what it fails on, so each was seen red against a named source change
before it was claimed.

```
--- load no longer verifies the chain                            -> 15 pass / 2 fail
       RED: hand-editing one byte on disk makes the next load REFUSE, naming the record
       RED: a deleted line is refused too, and reported as a chain break

--- purged records are no longer filtered out of read paths      -> 16 pass / 1 fail
       RED: after purge → save → reload, NO enumerated read path returns it

--- retractions no longer narrow the window at read time         -> 16 pass / 1 fail
       RED: a retracted record is gone from the present and present in the past

--- the workspace stamp is no longer enforced                    -> 16 pass / 1 fail
       RED: a writer stamped with a different workspace is refused

--- candidates below their floor still reach the fusion          -> 22 pass / 1 fail
       RED: a below-floor abstention says so, distinctly from having no candidates

--- the contradiction guard is disabled                          -> 22 pass / 1 fail
       RED: served with nothing served is rejected

--- an unlisted read path added to store.ts                      -> 16 pass / 1 fail
       RED: every method in store.ts's read-path section is in READ_PATHS
```

All reverted; the tree is clean and the suite is at 153 pass / 0 fail.

---

## 2. The characteristic failure of this phase

**I broke my own decision record and only the tests noticed.**

`DEC-007` says records are immutable and a correction appends. My first `retract` closed the
target's window by editing the record in place and recomputing its digest — which is exactly what
that clause forbids, and the consequence was immediate: every later record's `prev` still pointed
at the old digest, so **one retraction broke the entire chain**.

```
StoreError: chain_invalid: … first is chain_break at seq 2 (p:retracted:…)
```

It was not a subtle failure and it would not have survived review. What matters is *why it was
written at all*: the decision record was three days of context away, and "close the window" reads
like an edit. Nothing in the code stopped me — the type system was satisfied, the algorithm was
correct in isolation, and only an integration test over a real file caught it.

The fix was to derive the closure at read time via `effectiveValidUntil`, folding
`closingValidUntil` over every retraction filed against a record. The log stays append-only, the
chain is never rewritten, and two retractions cannot widen a window between them either.

**The rule that follows:** when a phase touches something a `DEC-` governs, re-read the DEC before
writing the code, not after the test fails. Added to `engine/CLAUDE.md`.

The same shape appeared twice more in smaller ways — a tamper fixture whose "edit" was a no-op,
and a verification script that reported six phantom missing reason codes. All three are the same
error: **a check that appeared to pass or fail for the reason I assumed, without that assumption
being tested.**

## 3. Still open

- **The structural channel is under-exercised by the CLI transcript** (`considered=0`), because a
  four-record store has no non-seed neighbours. Covered in `channels.test.ts`; worth a bigger
  fixture in Phase 3.
- **`LEXICAL_FLOOR`, `STRUCTURAL_FLOOR`, `RRF_K` and the distance bands remain uncalibrated**,
  declared as placeholders. The evaluation harness is still not scheduled.
- **The retrieval decision is returned but not yet persisted.** `RecordMeta` has a `retrieval`
  kind and nothing writes one. That is deliberate — `DEC-005` limits what may be stored and a
  retrieval row per firing needs its own decision about retention — but it is a gap between the
  record kind and reality, and Phase 3 should either wire it or remove the kind.
- **Purge rewrites the whole log.** Fine at this size, unmeasured at any other.
- **`definition-gate` still does not validate agent `skills:` references**, filed in Phase 0.

## 4. What Phase 3 depends on from this phase

A real store with a real CLI, so Stage 3's scenarios can be driven the way a user drives them
rather than through the API. The adversarial suite has a file to corrupt, the ugly-input suite has
a parser to feed, and the concurrency case has a lock to contend for.
