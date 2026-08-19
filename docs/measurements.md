# Measured costs

Numbers, and the command that produced them. Re-run it to check they still hold.

```
bun --cwd engine scripts/measure.ts
```

**Measured 2026-08-19**, bun 1.3.14, darwin/arm64, local SSD. Each row is a fresh store built
from empty.

```
  n      append/rec   load(total)  load/rec   purge      file
  --------------------------------------------------------------
  100    0.4ms        0.7ms        0.0ms      1.0ms      58KB
  500    0.6ms        2.6ms        0.0ms      2.8ms      288KB
  2000   1.3ms        9.2ms        0.0ms      9.8ms      1154KB
```

- **load** = read every line, verify the whole chain, rebuild every derived view.
- **purge** = read, rewrite the entire file, append a tombstone — all under one lock.

## What these settle

**`DEC-007`'s rebuild-on-load is not a problem at these sizes.** It said "rebuild on load until a
measurement says the rebuild is too slow", and the measurement says it is not: a full read, a full
chain verification and a full view rebuild over 2000 records costs **9.2ms**. The same record
listed the SQLite alternative and said the trigger should be a measurement rather than a
preference. This is that measurement, and it does not trigger it.

**Purge at these sizes is a non-issue.** 9.8ms at 2000 records, and it rewrites the entire file.

## What they reveal, which was not the question asked

**Append is O(n) per record, so building a store is O(n²).** 0.4ms at n=100, 1.3ms at n=2000 —
the per-record cost grows with the store. The cause is not the file write; it is that
`withLoggedMutation` re-reads the **whole log inside the lock** to find the true chain head, which
is exactly the fix Phase 3 made for the concurrency bug. Correctness was bought with a linear read.

Extrapolating from a three-point measurement is not evidence, so: **UNKNOWN** above 2000. What is
known is the shape, and the shape is quadratic. Settle it with

```
bun --cwd engine scripts/measure.ts      # after adding larger sizes to SIZES
```

**The fix, when it is needed, is not to undo the lock.** The head is the only thing the read is
for — the last record's `digest` and `seq`. A small head file written inside the same lock would
make append O(1) while keeping the critical section intact. It is not built, because at 2000
records a 1.3ms append is not a problem worth adding a second file and a consistency question for.
It becomes worth it when a store routinely exceeds a few thousand records, and the trigger is a
measurement, not a hunch.

## What is still unmeasured

- **Concurrency under real contention.** `test/ugly-input.test.ts` proves two processes interleave
  correctly for 16 records. Throughput under contention, and the behaviour of the 30s stale-lock
  timeout when a holder is genuinely slow, are both **UNKNOWN**. The vendored lock's own header
  states the stale-lock trade honestly and does not claim to have measured it either.
- **Retrieval cost.** The lexical channel scans every document per query. Unmeasured at any size.
- **Anything on a filesystem other than local disk.** The vendored lock states it is unreliable
  over NFS; nothing here tests that, and nothing should claim otherwise.
