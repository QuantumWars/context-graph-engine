# PHASE 6 SUMMARY — Reachable by a real session, and fed real data — 2026-08-19

## 1. Verdict

**Phase closed.** The engine is now reachable over MCP, packaged as a plugin, and has been fed a
corpus that is not synthetic — its own build history. And the question Phase 5 deferred is
answered on real data.

```
$ bun run --cwd engine check
 252 pass
 0 fail
 654 expect() calls
Ran 252 tests across 18 files. [3.08s]

$ bash .claude/check.sh
check.sh exit=0
```

Four findings, and three of them are about instruments rather than the engine.

| # | Finding | Where |
|---|---|---|
| 1 | **`verify` cannot be called without an explicit `arguments: {}`** — a real wiring defect only a subprocess test could find | 6.2 |
| 2 | **The secret scanner only sees git-tracked files**, so a new file's fixture passed locally and failed on a fresh clone | 6.4 |
| 3 | **`RRF_K` still cannot discriminate on a real graph at 5× the density.** The trigger fired; the answer is *rename* | 6.5 |
| 4 | **A symlinked `node_modules` is not equivalent to an install for a build check** — the branch harness reported a false bundle failure | §T |

---

## Task 6.1 — Decide the dependency boundary, as a decision record

Acceptance: a `DEC-` record naming the boundary and what it costs; `test/security.test.ts` updated
so it still fails if `src/` gains an external import, and separately asserts the allowed layer is
the *only* place one appears. The updated test is demonstrated red against an external import added
to `src/`, and that demonstration is pasted.

**Met.** `DEC-011`: third-party code lives only in `engine/mcp/`; `src/` stays dependency-free.

The property being protected — threat 14, *mitigated by construction, because there is no
third-party code to compromise* — was free, and a transport is not. Adding the SDK to the core
would have traded the strongest security claim in the project for a protocol, and **the deletion of
the test is the part that makes that irreversible**: nobody re-derives a property that no longer has
a guard. So the claim narrowed precisely instead, and the threat model row was rewritten in the same
change rather than later.

Three assertions replace the old one: `src/` has no external import (unchanged, load-bearing);
`mcp/` is the **only** directory with one; and the declared dependencies are pinned by name, so a
new one is a decision rather than an accident.

**Proven failure, twice:**

```
--- an external import sneaks into src/
(fail) the CORE ships zero runtime dependencies — src/ imports nothing external
(fail) mcp/ is the ONLY directory permitted an external import — DEC-011
 19 pass / 2 fail

--- an external import in eval/, outside the allowed layer
(fail) mcp/ is the ONLY directory permitted an external import — DEC-011
 20 pass / 1 fail
```

The second is the one that matters: it is what stops the boundary eroding one convenience at a time.

---

## Task 6.2 — Expose the engine over MCP

Acceptance: a server that lists its tools and answers a real `tools/call` for each verb, proven by
driving it over stdio as a subprocess rather than by importing it in-process.

**Met.** Nine tools, one per CLI verb. `engine/mcp/server.ts` contains no algorithm and no storage
logic, per `DEC-011` — it parses, dispatches to code that already exists, and serialises.

```
tools/list -> at, find, link, log, purge, record, retract, verify, why
```

**The subprocess requirement earned itself immediately.** An in-process test would have proved the
functions work, which 241 other tests already establish. Driving the real server over stdio found
that **`verify` cannot be called with `arguments` omitted**:

```
MCP error -32602: Invalid arguments for tool verify: expected object, received undefined
```

`inputSchema: {}` compiles to a zod object, and an absent `arguments` is `undefined`, not `{}`. The
published plugin in this workspace declares three no-argument tools the same way and never calls one
without `arguments`, so it shares the constraint untested. Whether a real client omits the field is
**UNVERIFIED**; settle it by installing the plugin and calling it from a session:

```
bun run --cwd engine bundle && claude --mcp-config engine/.mcp.json
```

Pinned by a test either way, so it is a known constraint rather than a surprise.

**A second instrument failure, mine.** The first version of the stdio client wrote every request at
once and read the responses at the end. Three tests failed — and the responses came back **out of
order**, which is what gave it away. MCP handles requests concurrently; the store's lock makes that
safe, which Phase 3 established with real processes. What was wrong was the client assuming a
sequencing the protocol does not promise. A real client that needs read-after-write awaits its
response, and so does this one now.

---

## Task 6.3 — Package it as a plugin

Acceptance: the manifest validates, the bundle builds and is byte-reproducible from a clean
rebuild, and `.mcp.json` launches the bundle rather than the source. A test asserts the bundle is
current with its source.

**Met.**

```
$ bun run bundle
  server.bundle.mjs  1.0 MB  (entry point)

  forbidden fields present: none
  required present: ['name', 'version', 'description']
```

No `agents` and no `hooks` field — `../CLAUDE.md` records that the validator rejects both and that
they load by convention. Not added for symmetry, and a test asserts their absence so a future
session cannot add them back for tidiness.

Byte-reproducibility is asserted rather than assumed, because `.mcp.json` launches the **bundle**,
not the source — a committed artifact that has drifted is a different program wearing the code's
name:

```
  committed bundle is byte-identical to a clean rebuild
```

---

## Task 6.4 — §T: reach it from a clean environment

Acceptance: a fresh clone into an empty directory, `env -i`, install, bundle, then a real
`tools/list` and at least three `tools/call` round trips over stdio against a store the clean
environment creates. Anything unreachable there is reported **not shipped**.

**Met, and it caught something the working tree could not.**

```
=== T1. fresh clone into an empty directory ===
  files: 90   node_modules: no   bundle committed: yes

=== T2. install + typecheck + suite, no inherited environment ===
97 packages installed [1209.00ms]
$ tsc --noEmit
 252 pass / 0 fail
```

The first clean run was **251 pass / 1 fail**. The secret scanner flagged a fixture in the new MCP
test — and it had passed locally minutes earlier. The cause is a real limit worth knowing: **the
scanner reads `git ls-files`, so an untracked file is invisible to it.** The fixture was renamed to
something not key-shaped and the limitation is now recorded at the scanner itself. Scanning the
filesystem instead would drag in `node_modules` and every build artifact; the honest position is
that a commit is what makes a file real, and §T checks after the commit. **This is precisely the gap
a clean-environment run exists to close**, and the clearest demonstration so far of why §T runs
against a clone rather than a working tree.

The round trip, driven sequentially against the clean clone's bundle under `env -i`:

```
  tools/list -> at, find, link, log, purge, record, retract, verify, why
  record  -> { "recorded": "inc", "kind": "decision", "seq": 1, "digest": "a9b48bbd8c207c19" }
  record  -> { "recorded": "gate", "kind": "decision", "seq": 2, "digest": "d89d156b8e70d12f" }
  link    -> { "linked": "inc --CAUSED(0.9)--> gate", "seq": 3 }
  why     -> [ { "path": [ "inc", "gate" ], "hops": 1, "band": "direct",
                 "productConfidence": 0.9, "weakestConfidence": 0.9, "weakestLink": { ... } } ]
  find    -> { "outcome": "served", "channels": [ { "channel": "lexical", "considered": 1,
                 "topScore": 1.2247448713915892, "floor": 0.4, ... } ] }
  verify  -> { "valid": true, "total": 4, "purged": 0, "problems": [] }

  store on disk: 4 records, written by a subprocess in a clean environment
```

Nothing is reported as not shipped.

---

## Task 6.5 — Feed it real data, and re-ask the deferred question

Acceptance: a store built from this repository's own build history, with node and edge counts
pasted and its chain verifying. Then an explicit answer to the question Phase 5 deferred: **on a
real graph, does `RRF_K` discriminate?**

**Met.** `scripts/seed-from-build.ts` loads eleven `DEC-` records, seven phase summaries, six
research notes and three future-work pages, with edges read from the text — supersession as
`CAUSED`, citation as `INFLUENCED`:

```
  records : 25  (17 decisions)
  edges   : 52  (3 CAUSED from supersession, 49 INFLUENCED from citation)
  total   : 77 log entries
  chain   : verifies — 77 entries, 0 problems
```

**52 edges over 25 records is roughly five times the edge density of the eval corpus** — exactly the
condition Phase 5 said was missing. The answer:

```
  overlap in the pair that is FUSED      : 0     (8 real queries)
  distinct orderings across k=1,5,60,300 : 1     (per query)
```

**Still zero, and now the reason is exact.** The disjointness is structural, not an artefact of a
thin corpus: `structuralChannel` scores a node only when it is *not* a lexical seed, and
`retrieve()` fuses the **floored** lexical list, which is precisely the seed set. The two inputs to
`fuse()` cannot intersect at any density.

**A third instrument failure, and the most instructive one.** The first probe reported **14
overlaps** and briefly looked like a reversal of Phase 5's finding. It was measuring the
*unfiltered* lexical list against the structural one — a pair that genuinely can overlap, because a
document below `LEXICAL_FLOOR` is not a seed and may score structurally — but that pair is **never
fused**. Re-measured against the pair `fuse()` actually receives: zero.

Phase 5's conclusion stands, with a sharper statement of why. The trigger written into
`docs/future-work/README.md` has fired and **the answer is: rename.** Not executed here, on the
operator's instruction and because renaming is unrelated to this phase's job — but there is no
longer an open question behind it, only work.

---

## 2. The characteristic failure of this phase

**A fourth, found while verifying this very phase.** The per-branch check reported the bundle test
red on three branches. The bundle was fine: since Phase 1 that harness has **symlinked**
`node_modules` into each worktree for speed, and a symlinked module tree is equivalent for *running*
tests and not for *building* — a rebuild through it differed from a normal checkout by 9,540 bytes.
A real `bun install` per worktree, and all four branches are green.

The failing check was right that something was wrong and wrong about what. Worth noting the order
of operations that saved it: the loop verifies **before** it pushes, a discipline added after
Phase 4 pushed a red branch. Had the two been the other way round this would have shipped.

**Three of the three findings above were instruments, not code.** A concurrent client assuming
sequential responses. A scanner that cannot see untracked files. A probe comparing the wrong pair
of lists and nearly overturning a correct conclusion.

That is now the eleventh through fourteenth instances of this build's characteristic failure —
a check that appeared to work — and the pattern has not weakened with practice. What has changed is
that each was caught within minutes, because rule 1 is now reflex: the probe reported 14 overlaps,
the prediction was 0, and the disagreement made the *probe* the suspect rather than the finding.

Worth stating plainly: **rule 1 has never once been wrong about which side to suspect.**

## 3. Still open

- **The rename.** Answered, not executed. `docs/future-work/README.md`.
- **Whether a real client omits `arguments` for a no-argument tool.** UNVERIFIED; the command that
  settles it is in the test.
- **The eval labels are still author-written.** Phase 6 produced a real *corpus* but no real
  *queries with judgements*. Real usage still has not happened — the engine is now reachable, and
  has not yet been reached by anyone but a test.
- Everything carried from Phase 4 H9: truncation, downstream erasure propagation, O(n) append,
  causal bands, contention.

## 4. What a next phase depends on from this one

An installable plugin, so the engine can be used by a session rather than by a test — which is the
only thing that produces real queries, and therefore the only thing that closes the label gap the
harness was honest about from the day it was built.
