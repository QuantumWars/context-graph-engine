# Phase 3 — Stage 3: real-world test cases — 2026-08-19

**What closes this phase:** a suite drawn from what will actually arrive rather than from what is
convenient to write, every guard in it seen red against a named source change, and a `guard-audit`
that finds nothing vacuous in the whole tree.

Scope: `engine/test/`, plus whatever product code the suite proves is wrong. **This phase expects
to find bugs.** A Stage 3 that finds none has either a perfect system or a toothless suite, and the
second is far more likely. A bug found here is the deliverable, not an interruption.

```
⛔ HARD RULES

1. Read before write; cite file:line.
2. One PR per phase. The PR body pastes real output — a query result, a
   captured row, a screenshot, a terminal transcript. No evidence, no merge.
3. Tests assert positive outcomes on real artifacts. "No error" is not
   evidence, and neither is "tests pass".
4. No silent returns. Every guard logs a reason code.
5. Never fabricate. Unverifiable ⇒ write UNVERIFIED and the exact query or
   command that would settle it.
6. An assertion that fails three times ⇒ STOP and report. Do not keep trying.
```

## Stage rules, from `algorithm-first-development`

> Not "does the function run". Cases drawn from what will actually arrive: malformed input, the
> wrong encoding, an empty set, a huge set, a duplicate, a slow dependency, two things happening at
> once.

Every test gets a **proven failure** — break the thing on purpose, watch it go red, record it. A
test you have not seen fail is a hope. The stage closes when the suite has been seen red for each
guard and `guard-inspector` finds nothing vacuous.

Carried in from Phase 2's open list, and each must be resolved rather than restated:

- The **structural retrieval channel is under-exercised** — a four-record store has no non-seed
  neighbours, so the CLI transcript reports `considered=0`.
- The **`retrieval` record kind exists and nothing writes one.** Wire it or delete it; a kind with
  no writer is schema decoration on dead code.
- **Purge rewrites the whole log**, and that cost is unmeasured at any size.

## Task 3.1 — The multi-day agent session

One scenario test that drives the engine the way a real session does, over simulated days: record
decisions, link them causally, supersede one, retract another, purge a third, query what was true
on day 2 **and** what was believed on day 2, retrieve a precedent, and verify the chain across
several save-and-reload cycles.

It must run through the **CLI**, not the API, because that is the surface a user has and the only
one that proves the pieces are reachable from outside.

Acceptance: a single test drives at least 12 CLI invocations across at least 3 simulated days,
asserts on the **content** of what comes back rather than exit codes, and ends with a chain that
verifies. The store is created and destroyed by the test. At least one assertion must distinguish
"what was true then" from "what we believed then" and fail if the two axes were collapsed.

## Task 3.2 — The adversarial suite

Every way someone with write access to the file could try to rewrite history. For each: the attack,
the expected reason code, and the assertion that it is caught.

At minimum — edit a record's content; edit an attested field; delete a record; reorder two records;
**replay** a record (append a duplicate of an existing one); **forge** a `prev` to point at a real
earlier digest; truncate the file mid-line; and **purge-as-cover**, where a record is emptied to
try to hide a break elsewhere.

Acceptance: closes with a table of attack → reason code → test name, every row backed by a test
that fails when the corresponding check is removed. Any attack that is **not** caught is reported
as a finding with the reason it is out of reach, not quietly dropped from the table.

## Task 3.3 — The ugly-input suite

What actually arrives, not what is convenient: an empty store; a store of one record; a large store;
duplicate ids; unicode content including combining characters and right-to-left text; a content
value that is a very long string; deeply nested content; timestamps at boundaries — leap day, the
epoch, a far-future date, and the same instant twice; and **two writers at once** on the same file.

The concurrency case is the one that matters most, because it is the only one where the lock this
engine vendored is load-bearing.

Acceptance: two concurrent writers produce a log whose chain verifies and which contains **both**
records — asserted by running real concurrent processes, not by simulating them in one process. A
large store's rebuild-on-load and purge cost are **measured** and the figures written down, so
`DEC-007`'s unmeasured note can be replaced with a number.

## Task 3.4 — Resolve Phase 2's open list

Three items, each ending in a resolution rather than a restatement.

Give the structural channel a fixture with real non-seed neighbours, so it is exercised rather than
merely present. Decide the `retrieval` record kind — wire a writer for it under `DEC-005`'s limits,
or delete the kind. And record the purge and load measurements from 3.3 at the definition sites that
currently say the cost is unknown.

Acceptance: the structural channel is proven to contribute a candidate the lexical channel did not
find, in a store with real graph depth. The `retrieval` kind either has a writer with a test, or is
gone from `RECORD_KINDS` — and whichever it is, `DEC-005`'s stored-data table matches. Every
"unmeasured" note that 3.3 measured now carries the figure and how it was obtained.

## Task 3.5 — The guard audit

Run `guard-inspector`'s question over the whole suite: **for each test, what change to the source
would make this go red?** Any test where no such change exists is a candidate for deletion or repair.

Acceptance: a verdict per test file — LIVE, PLAUSIBLE, UNREACHABLE or VACUOUS — with the naming
change for each LIVE one. Every VACUOUS test is repaired or deleted in this phase, and the repair is
demonstrated red. A count of tests audited that matches the suite's real count, so nothing was
skipped silently.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`.claude/check.sh` at exit 0, every guard added here seen red and pasted, and the work pushed as
feature branches on `QuantumWars/context-graph-engine`.
