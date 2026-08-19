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
- **Performance measurement.** `DEC-007` rebuilds every derived index on load rather than
  persisting it, and that cost is **unmeasured**. The same is true of purge-at-scale. Both need
  a realistically sized log before either can be argued about, and neither should be optimised
  before it is measured.
