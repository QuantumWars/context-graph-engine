# Post-mortem — Context Graph Engine, phases 0–4

Written 2026-08-19 by the session that did the work, after it was done.

## H0 — What shipped

| Phase | What | Evidence |
|---|---|---|
| 0 | Toolchain, seven decision records, three recon claims re-confirmed | `phase-0-summary.md` |
| 1 | Five algorithms as pure functions, 107 tests | `phase-1-summary.md` |
| 2 | One append-only store, retrieval path, nine-command CLI, 153 tests | `phase-2-summary.md` |
| 3 | Adversarial, ugly-input and scenario suites; **three real bugs**; 190 tests | `phase-3-summary.md` |
| 4 | Threat model, boundary proofs, clean-environment §T, 210 tests | `phase-4-summary.md` |

Zero runtime dependencies. 16 feature branches on `QuantumWars/context-graph-engine`, each
verified green at an arbitrary path.

## H1 — The characteristic failure of this build

**Every significant mistake was a check that appeared to work.**

Not a bug in the product — the product's bugs were found. The repeated failure was in the
*instruments*: a test, a mutation, a grep, a verification script producing a result I read as
confirmation, without first confirming the instrument could have produced the other result.

| Phase | The instrument | What it actually did |
|---|---|---|
| 0 | "warnings went 8 → 2, so the install helped" | The tree had **0** before. The 8 was stale prose I repeated instead of measuring. |
| 0 | A pasted `grep` transcript in a summary | I had not run it. Real output was 9, not 8, in a different order. |
| 1 | Mutation: cascade with a live skip set | `22 pass / 0 fail`. The fixture used **distinct** edge ids; the bug needs two sharing one. |
| 1 | Mutation: global visited set | `24 pass / 0 fail`. My mutation never built a global set. |
| 2 | Tamper fixture setting `outcome = 'yes'` | The value was **already** `'yes'`. The "tampering" changed nothing. |
| 2 | Reason-code verification script | Reported 6 missing codes. **All 6 were false positives** — it matched every backticked word. |
| 3 | Guard-audit sweep | Reported 3 files as unkilled. One was my regex: `\w` does not match the hyphen in `ugly-input`. |
| 3 | A limitation test I wrote | `expect(claim).toBe(claim)` — a string equalling itself. |
| 4 | A branch-verification loop | Printed **ALL GREEN** while a branch failed: `ok=0` was set inside a command substitution. |

Nine instances. The product bugs were all found by instruments; the instruments were wrong nine
times, and every one was caught only because a *prediction* had been written down first — "this
change should turn that test red", "this grep should return 8". Where no prediction existed, the
result was believed.

**The rule that comes out of it is H10-1, and it is the most important line in this document.**

## H2 — What broke: the algorithms

Almost nothing, and that is the interesting part. Five algorithms were built in Phase 1 and **none
of them changed** to be wired in Phase 2 or hardened in Phase 3. The Stage-1 rule — pure functions,
no I/O, no neighbours — paid for itself exactly as advertised.

The one design that changed did so because of research, not defect: hashing content directly makes
erasure impossible, so `DEC-006` was superseded by `DEC-007` on the day it was written.

## H3 — What broke: the store

Three defects, all in the seam between an algorithm and its caller.

1. **`retract` edited a record in place** (Phase 2). Broke every later `prev` on the first
   retraction. A direct violation of `DEC-007`, written two phases after that record.
2. **The lock was in the wrong place** (Phase 3). It covered the write but not the read that
   decides `seq` and `prev`, so two processes could both claim `seq 1`. Seven of sixteen records
   lost.
3. **`retract` had no `at`** (Phase 3). The original takes it; the port dropped it. Only
   expressible retraction was "it stops being true now".

All three share a shape: **the algorithm was right and complete; the caller used a fraction of
it.** `retract.ts` has an `at` parameter and tests it. The store never passed one, and no test
above the algorithm noticed, because every one of them used the default.

## H4 — What broke: temporal handling

`2026-02-29` was accepted and silently became `2026-03-01`. `Date.parse` rolls a date that does not
exist into one that does. Phases 1 and 2 had thorough temporal tests and not one of them used an
impossible date.

## H5 — What broke: the cross-package import

`DEC-001` decided to import the file lock from a sibling package rather than copy it, on two
correct measurements. It anticipated a reversal and **named the wrong trigger**: it expected the
sibling to be restructured. What actually broke it was **relocation** — four of eleven branches
failed typecheck in a worktree, and a clone anywhere else would not build.

Relocation is a far more ordinary event than restructuring, and it is exactly what publishing is.

## H6 — What did not break

Worth recording, because a post-mortem listing only failures misrepresents the work.

The chain design held through eleven adversarial attacks. The canonical form never needed revising.
`stateAt`'s endpoint rule, ported unchanged, is still the reason no snapshot has ever contained a
dangling edge. The three-way `served`/`abstained`/`error` split, taken from the sibling package, is
the reason an abstention has never been confused with a crash. Zero runtime dependencies meant the
supply-chain question answered itself.

## H7 — What broke in the process, not the code

The gates caught less than they appeared to. `definition-gate` reported **0 failures and 0
warnings** on a tree where four of six agents referenced skills that did not exist — it never
validates agent `skills:` frontmatter. Filed in Phase 0, still open, still unfixed, because fixing
a gate without a fixture it goes red against would repeat the mistake the gate is about.

## H8 — Where I wasted the operator's time

1. **Fabricated a grep transcript in the Phase 0 summary.** I wrote output I had not produced. It
   was wrong in both the count and the ordering. Cost: a correction the operator had to read, and a
   dent in every other pasted transcript's credibility. **The correct move:** run it, paste it,
   never type what a command "would" say.
2. **Four mutation rounds that proved nothing**, spread across Phases 1 and 3. Each looked like
   evidence and was not. **The correct move:** predict which test dies *before* running the
   mutation, every time — the discipline exists, I applied it inconsistently.
3. **Built the engine on a cross-package import that could not survive publication.** The decision
   record even predicted the reversal. Cost: rebuilding four commits and re-verifying eleven
   branches. **The correct move:** at the moment of writing "if X restructures, this breaks", ask
   what *else* could break it — the answer, `mv`, was one word away.
4. **A branch-verification loop that printed ALL GREEN while a branch was red.** The operator saw a
   pass claim I had to retract in the next message. **The correct move:** the same rule as
   everything else — check that the checker can fail.

## H9 — Still open

- **Truncation and wholesale rewrite are undetectable.** Every fix conflicts with an existing
  decision. `future-work/02`.
- **No evaluation harness.** `RRF_K`, both retrieval floors and the causal distance bands are
  adopted, not measured. This is the oldest open item and the largest single gap.
- **Append is O(n) per record**, measured to 2000 and UNKNOWN beyond.
- **Downstream erasure propagation.** We clear our copy and say so; we cannot reach copies that
  left. An export ledger should land before any export feature does.
- **`definition-gate` does not validate agent skill references.**
- **Concurrency under contention, and the 30s stale-lock window**, both unmeasured.

## H10 — Rules that came out of this build

Ten, each traceable to a failure above. **All ten are now in `engine/CLAUDE.md`** — a rule that
stays in the post-mortem stops applying the moment this document scrolls out of context.

1. **Before running a check, predict its result. If the result disagrees, the check is the suspect
   until proven otherwise.** A mutation that fails to kill, a grep that finds nothing, a script
   reporting all-clear — none is evidence until you have seen it produce the other answer. (H1, all
   nine instances.)
2. **Never write output you have not run.** Not a summary, not an example, not "it would print".
   (H8-1.)
3. **A fixture must be shown to change something.** Assert the pre-state before asserting the
   post-state, or the edit may be a no-op. (H1, Phase 2 tamper fixture.)
4. **A test that drives a component through its caller must vary what the caller defaults**, or it
   only proves the default works. (H3, all three store defects.)
5. **Re-read the `DEC-` before writing code it governs, not after the test fails.** The decision you
   contradict is the one made two phases ago. (H3-1.)
6. **When a decision names its own reversal trigger, ask what else could trigger it.** "If X is
   restructured" missed "if this is moved". (H5.)
7. **Concurrency is only tested by real processes.** A single process serialises itself, so a
   single-process concurrency test proves nothing. (H3-2.)
8. **Boundary values include impossible ones.** Not just the epoch and the far future — the date
   that does not exist. (H4.)
9. **State the limitation in the same table as the mitigation.** An adversarial suite listing only
   the attacks it defeats is marketing. (H2, `future-work/02`.)
10. **Measure before optimising, and publish the number with the command that produced it** — then
    accept what it says, including when it moves the question somewhere else. (H9, `measurements.md`.)
