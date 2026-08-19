# Future work

Things that are **known, deliberately deferred, and not built**. Each entry says what exists
today, what does not, and what would trigger doing it.

This directory is not a wish list. An item earns a place here only if leaving it undocumented
would let a future session mistake a partial solution for a complete one, or re-decide
something that was already decided. Anything already settled lives in `engine/build/DEC-*.md`;
anything already researched lives in `engine/docs/research/`.

| # | Item | Built today | Trigger to do the rest |
|---|---|---|---|
| [01](./01-erasure-and-the-hash-chain.md) | **Erasure versus the hash chain** | The core is built: a salted commitment keeps the chain verifiable across a purge. | Downstream propagation is the real gap — see §5.1. An export ledger should land before any export feature does. |
| [02](./02-what-the-chain-cannot-detect.md) | **Truncation and wholesale rewrite** | Nothing. Both are undetectable, and Phase 3's adversarial suite asserts the gap rather than hiding it. | The first time something that does not hold the log must be convinced of its consistency. Every fix conflicts with a decision already made. |

## Not yet written up, but known

Listed so they are not lost. Each needs its own page before it is worked on.

- **~~An evaluation harness~~ — built in Phase 5.** `eval/` carries 34 records, 11 edges and 19
  labelled queries; `eval/run.ts` compares the engine against two baselines; `eval/sweep.ts`
  calibrates a constant or reports that it cannot; `scripts/lint-constants.mjs` fails on a
  threshold with no provenance and is wired into `.claude/check.sh`. It earned itself immediately:
  `LEXICAL_FLOOR` was **40× too low**, and fixing it took precision@10 from 39.6% to 78.8% and
  correct abstentions from 1 of 3 to 3 of 3. Full record: `docs/constants-ledger.md`.
  **Still open:** the labels were written by the author of the code, which is the largest
  uncertainty in every number it produced.
- **The engine is not doing rank fusion — decide whether to rename it or change it.** *Deferred
  deliberately, 2026-08-19, not forgotten.* Phase 5 measured **zero cross-channel overlap across
  all 19 queries**: `structuralChannel` excludes every lexical seed by construction, so no
  document is ever in both channels, RRF's score reduces to `1/(k+rank)`, and its ordering is
  independent of `k`. What the engine does is rank-interleaving of two disjoint lists.

  **Two options, and the measurement supports neither urgently:**

  1. **Rename to what it is.** `rrf.ts` and `RRF_K` overstate the mechanism. Honest, roughly an
     afternoon, and purely cosmetic to behaviour — no output changes.
  2. **Make the channels able to overlap**, so agreement can be rewarded. Measured: it does create
     overlap (18 at the calibrated floor) and scores **0.819 — identical**.

  **Why it is deferred rather than done:** neither changes a single retrieved result today, and
  the corpus that produced the finding is 34 records with 11 edges. Whether option 2 pays off on a
  denser, real graph is unknown, and renaming first would have to be undone if it does. Real usage
  settles which — so this waits behind it.

  **What would settle it:** run the sweep against a real store with real graph density. If `RRF_K`
  still cannot discriminate there, take option 1. If it can, option 2 was right all along and the
  name was correct.

  There is **no prior art to copy**: `docs/research/06-how-semantica-uses-rrf.md` establishes that
  the system this was ported from never faced the question, because its fusion is unreachable from
  any shipped entry point and its "channels" are corpora rather than methods.
- **A labelled set of causal questions.** The distance bands (1/3/6) are still placeholders and
  need "is a three-hop chain still useful evidence?" labels, which `eval/dataset.ts` does not
  contain. The sweep infrastructure already exists to consume such a set.
- **An embedding retrieval channel.** The engine is lexical plus structural by decision, so
  every algorithm test is deterministic and offline. An embedding channel would sit behind the
  same `Channel` interface `src/retrieval/rrf.ts` already takes — the fusion is n-channel
  precisely so this does not require reopening it.
- **Weighted RRF.** Rejected in `docs/research/04-rank-fusion.md` for want of a harness. The
  harness now exists — but Phase 5 found the channels never overlap, so weighting them differently
  cannot change an ordering either. Blocked on the same finding as `RRF_K`.
- **A shared RRF package.** `DEC-009` keeps two implementations — this engine's and
  `memory/src/recall.ts`'s — because they answer different questions. The named trigger for
  extracting a shared package is a **third** caller appearing.
- **A runbook for restoring this store.** Referenced by [01](./01-erasure-and-the-hash-chain.md)
  §5.2 and does not exist. A purge does not reach a backup taken before it, and nothing today
  says what to do about that.
- **~~Performance measurement~~ — done, and it moved the question.** Load and purge are measured
  in [`../measurements.md`](../measurements.md): a full read, chain verification and view rebuild
  over 2000 records is **9.2ms**, so `DEC-007`'s rebuild-on-load is not the problem it was flagged
  as. What the measurement *did* reveal is that **append is O(n) per record** — the price of
  reading the chain head inside the lock, which is what fixed Phase 3's concurrency bug. A small
  head file would make it O(1) without touching the lock. Not built: at 2000 records a 1.3ms
  append is not worth a second file and a consistency question. Behaviour above 2000 is
  **UNKNOWN** — extend `SIZES` in `scripts/measure.ts` to settle it.
