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

- **An evaluation harness, before any constant is tuned.** `RRF_K = 60`, the causal distance
  bands (1 / 3 / 6) and every hop weight ship as **declared placeholders** — annotated at their
  definition sites, adopted rather than measured. Nothing here can calibrate them because there
  is no labelled query set and no baseline arm. This is the single most load-bearing gap in the
  engine, because it is the one that turns every other number from a guess into a measurement.
  It is also exactly what Semantica never built: `semantica/evals/__init__.py` is ten lines
  reading `__status__ = "coming_soon"`, which is why every threshold in that system is
  uncalibrated by construction.
- **An embedding retrieval channel.** The engine is lexical plus structural by decision, so
  every algorithm test is deterministic and offline. An embedding channel would sit behind the
  same `Channel` interface `src/retrieval/rrf.ts` already takes — the fusion is n-channel
  precisely so this does not require reopening it.
- **Weighted RRF.** Considered and rejected in `docs/research/04-rank-fusion.md` for a specific
  reason: there is nothing to fit weights against until the harness above exists. Adding an
  unfittable weight would import the disease along with the cure.
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
