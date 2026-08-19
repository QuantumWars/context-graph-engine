# Context Graph Engine

A context store for agentic systems: **what an agent knew, decided and derived** — on a record
that can prove it has not been altered, and can still forget something on request.

```
$ engine purge d-leak --reason "contained a live credential"
purged d-leak
  tombstone scope: this-store-only — copies elsewhere are not reached.

$ grep -c "sk-live-9f2b7c41aa" log.jsonl
0
$ engine verify
✓ chain verifies — 6 record(s), 1 purged, 0 problems
```

Those four lines are the whole claim: the credential is gone from the file, and the
tamper-evidence over everything else is intact. Most append-only designs cannot do both.

## What it answers

- **What did we know at time T?** — and separately, *what did we believe at time T*, which is the
  question that explains a past decision.
- **Why was this decided?** — the causal chain, and where it is weakest.
- **What precedent applies?** — two ranking channels, fused without pretending their scores compare.
- **Has this record been altered?** — four checks, each with a reason code.

## Run it

```bash
bun install
bun run check                 # typecheck + suite
bun demo.ts all               # watch every algorithm work, in memory

bun src/cli.ts --help --workspace /path/to/project
```

Full explanation of every algorithm, with diagrams: **`docs/algorithms.html`** — a single
self-contained file, open it directly in a browser.

## How it was built

From a read-only teardown of [`semantica-agi/semantica`](https://github.com/semantica-agi/semantica)
v0.6.5 — 181,785 lines studied, twelve defects recorded with the query that established each, four
things found sound and taken close to verbatim. The verdict was *do not rebuild it; rebuild five
ideas out of it*.

The method, per feature: **port from the original → research for a better solution → record the
decision → then build.** The port comes first deliberately — researching first loses whatever was
good about the original. In one case the research changed the design outright: hashing a *salted
commitment* rather than the content is what lets a purge and an unbroken chain coexist at all.

| Where | What |
|---|---|
| `build/DEC-*.md` | Locked decisions. Each has a *What was rejected* section — the next idea is usually already in it. |
| `build/phase-N-summary.md` | What each phase did, with evidence pasted and every guard's proven failure. |
| `docs/research/` | The research step per algorithm, with sources and a one-hop-from-source caveat. |
| `docs/future-work/` | What is deliberately **not** built. Start with the erasure page. |

## The rule underneath it

**A guard is worth exactly what it fails on.** Before any test here was claimed to work, a specific
source change was named that should turn it red — and that change was made and watched. Three times
across the build the mutation left the suite green, and every time the *test* was wrong, not the
code. Green had read as confirmation.

Every uncalibrated constant says so at its definition site. There is no evaluation harness yet, and
nothing here pretends a number was measured when it was adopted.

## Status

Phases 0–2 complete. 153 tests. Not published, not stable, no API guarantees.
