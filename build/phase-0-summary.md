# PHASE 0 SUMMARY — Context Graph Engine — 2026-08-19

## 1. Verdict

**GO.** The premise holds. All three recon claims this build rests on re-confirmed against
the real source, the toolchain runs, and the reuse boundary with `memory/` is settled rather
than deferred. Seven decision records are locked. `.claude/check.sh` exits 0 across seven
gates with one legitimate skip.

**The most useful thing found here is a defect in our own tooling, not in Semantica.**
`definition-gate` reported **0 failures and 0 warnings** over a tree in which four of six
agents named a skill that was not installed. It never validates an agent's `skills:`
frontmatter. A gate that cannot fail on a class of defect is decoration for that class, and
this one is the class the gate exists for. Filed in `.claude/BACKLOG.md`; not fixed here,
because fixing a gate without a fixture it goes red against would repeat the mistake.

**One correction to my own working assumption**, recorded because it changes what the numbers
mean: I expected the skill install to *reduce* a standing count of 8 warnings. Measured, the
tree had **0** warnings before the install and **2** after. Both new warnings were introduced
by the install and neither is a defect. The "8 warnings" figure in `CLAUDE.md:25` was stale
and has been corrected to what was measured this session.

---

## Task 0.1 — Stand up the `engine/` package and establish the test invocation

Acceptance: `bun --version` and a real `bun test` transcript from `engine/`, showing at least
1 pass and 0 fail, plus `tsc --noEmit` exiting clean; and the invocation is written down in
`engine/CLAUDE.md` as the command future sessions use.

**Met.** `engine/` created with `package.json` (`"type": "module"`, `"check": "bun run
typecheck && bun test"`) and a `tsconfig.json` mirroring `memory/tsconfig.json`'s strictness.

```
$ bun --version
1.3.14

$ bun run --cwd engine check
$ bun run typecheck && bun test
$ tsc --noEmit
bun test v1.3.14 (0d9b296a)

 3 pass
 0 fail
 12 expect() calls
Ran 3 tests across 1 file. [16.00ms]
```

The guard is not a smoke test. `test/toolchain.test.ts` asserts the seven strict compiler
flags and that `check` still runs both of its halves, with an anti-vacuity assertion that the
config parsed at all before anything is asserted over it — so a renamed or emptied
`tsconfig.json` fails loudly rather than asserting nothing.

**Proven failure.** Flipping `exactOptionalPropertyTypes` to `false` turns it red:

```
- Expected  - 1
+ Received  + 1

      at <anonymous> (/Users/doniel/.../engine/test/toolchain.test.ts:50:43)
(fail) toolchain > the strict flags memory/ relies on are all on [3.35ms]

 2 pass
 1 fail
```

Restored, and green again at `3 pass / 0 fail`.

**The invocation, and why `--cwd` rather than `cd`.** `graph-engine/CLAUDE.md` records that
workspace resolution consults filesystem indicators before the environment variable, so a
working-directory change can silently swap which store is read and written. The command is
`bun run --cwd engine check`, written into `engine/CLAUDE.md`. That flag is load-bearing, not
style — the same command without it, from `graph-engine/`:

```
$ bun run check
error: Script not found "check"

$ ls package.json
ls: package.json: No such file or directory
```

---

## Task 0.2 — Re-confirm the three recon claims this build is load-bearing on

Acceptance: three verdicts, each CONFIRMED or REFUTED, each with the command run this
session and its real output pasted. A refuted claim is a finding, not a failure — say so and
name what it changes in Phase 1.

**Met. Three of three CONFIRMED.** Nothing in Phase 1 changes as a result.

**Claim 1 — the RRF implementation. CONFIRMED**, and it is textbook: rank base 1, `k=60`,
flat sum, nothing normalised away.

```
$ sed -n '148,172p' semantica/semantica/vector_store/hybrid_search.py
    def reciprocal_rank_fusion(
        self, results: List[List[Dict[str, Any]]], k: int = 60
    ) -> List[Dict[str, Any]]:
        ...
        for result_list in results:
            for rank, result in enumerate(result_list, start=1):
                result_id = result.get("id", str(id(result)))
                score = 1.0 / (k + rank)
                scores[result_id] = scores.get(result_id, 0.0) + score
```

The defect the recon named is visible in the same excerpt: `result.get("id", str(id(result)))`
falls back to the Python object address, so a result carrying no id becomes its own key and
can never fuse across lists. Task 1.4 makes that a hard error with a reason code.

**Claim 2 — the shadow `_decisions` dict (finding A-2). CONFIRMED.** An AST query over the
real `ContextGraph` class, asking which methods mention the attribute:

```
$ python3 ast_decisions.py
class ContextGraph  (line 442)
method                            mentions _decisions
------------------------------------------------------
__init__                                        False
save_to_file                                    False
load_from_file                                  False
to_dict                                         False
from_dict                                       False
state_at                                        False
retract_node                                    False
purge_node                                      False
clear                                           False
record_decision                                  True
find_precedents_by_scenario                      True
```

Written by one pair of methods, read by neither the persistence pair nor the erasure pair.
This reproduces the recon's table exactly and is the direct justification for `DEC-006`'s
single-log format.

**Claim 3 — `_CAUSAL_EDGE_TYPES`. CONFIRMED**, at the cited line, with the distinction between
asserted and inferred relationships recorded at the definition site:

```
$ sed -n '435,440p' semantica/semantica/context/context_graph.py
#: Edge types that represent an explicitly recorded causal relationship between
#: two decisions. These are authoritative: they are what the caller asserted via
#: add_causal_relationship(), as opposed to relationships inferred from shared
#: entities and timestamps.
_CAUSAL_EDGE_TYPES = ("CAUSED", "INFLUENCED", "PRECEDENT_FOR")
```

Two further claims were checked because `DEC-003` cites them, and both hold:

```
$ command grep -n "Always-Active" semantica/semantica/context/context_graph.py
151:    Returns None on failure; callers must treat the node as Always-Active.
168:            "Malformed temporal value %r — treating node as Always-Active. (%s)", value, e
```

A malformed timestamp therefore makes a record *more* visible, not less — which is why
`DEC-003` rejects silent temporal coercion by name.

---

## Task 0.3 — Write the reuse register as DEC-001

Acceptance: `engine/build/DEC-001-reuse-boundary.md` exists, carries the
`_Decided YYYY-MM-DD · status: current_` line and a `## What was rejected` heading, and
classifies every primitive named above with no entry left unassigned.

**Met.** Seven primitives, seven verdicts, none unassigned: `lock.ts` **import**;
`recall.ts`'s RRF **reimplement**; `graph-store.ts` **pattern only**; `graph-traverse.ts`
**idea only**; `facts.ts` **practice only**; `ledger.ts` **shape only**; `embed.ts`
**ignore**.

The register is evidence-driven, not preference. Two measurements decided it:

```
$ command grep -an '^import' memory/src/lock.ts
49:import { open, rename, rm, stat } from 'node:fs/promises';

$ command grep -an '^import' memory/src/recall.ts
33:import { type MemoryIndex, type SearchHit } from './index-db';
34:import type { Memory } from './store';
35:import type { EmbeddingHit } from './embed';
```

`lock.ts` reaches only `node:fs/promises` — a clean import. `recall.ts` reaches `./index-db`
and `./embed`, so importing its fusion would pull `bun:sqlite` and an ONNX runtime into a
package that has deliberately chosen to have no model.

The second reason is contract, not weight. Its signature answers a different question:

```
$ sed -n '363,376p' memory/src/recall.ts
export function reciprocalRankFusion(
  lexical: readonly { id: string }[],
  embedding: readonly { id: string }[],
  k = RRF_K,
): string[] {
```

Two fixed channels, and a return of bare ids — no per-channel rank, no score. Task 1.4's
acceptance requires both. Calling that reuse would mean weakening the acceptance to fit the
code we already had, so `DEC-001` records it as a differing contract and leaves the survivor
question to Task 1.4's own record.

---

## Task 0.4 — Write `ARCHITECTURE.md` with the placeholders later phases fill

Acceptance: `engine/ARCHITECTURE.md` exists, names all five algorithms and the data the
engine stores, and every unfilled section is marked with a placeholder naming the phase that
fills it.

**Met.** 137 lines. It names the three questions the engine answers, the single-log store,
the shared record envelope, all five algorithms with their modules, an interlink diagram, and
the security model table. Six sections carry a placeholder, each naming its phase:

```
$ command grep -c 'TBD' engine/ARCHITECTURE.md
9
$ command grep -o 'TBD — [^]]*' engine/ARCHITECTURE.md
TBD — Phase 1, one task per algorithm
TBD — Phase 2.4
TBD — Phase 4
TBD — Phase 1
TBD — Phase 2.4
TBD — Phase 2.5
TBD — Phase 1.3
TBD — post-spine
```

Nine lines carry the marker and eight name a phase; the ninth is the sentence in the header
explaining that a placeholder is legitimate in this document and never in a phase summary.

The five algorithms and their modules, as recorded there:

```
1  Hash-chained provenance          src/provenance/chain.ts
2  Bitemporal windows and stateAt   src/temporal/window.ts
3  Retract and purge                src/temporal/retract.ts
4  Reciprocal Rank Fusion           src/retrieval/rrf.ts
5  Decision node and causal chain   src/decision/causal.ts
```

`engine/CLAUDE.md` (the *how*) and `engine/build/BUILD-PLAN.md` (the order and the running
status) were written alongside it, so the documentation trail exists from the first phase
rather than being retrofitted.

---

## Task 0.5 — Record the four security decisions that cannot wait for Phase 4

Acceptance: four decision records, `DEC-002` through `DEC-005`, each passing the gate's
decision-record checks, and each naming what it constrains and how it would be reversed.

**Met.**

```
$ ls engine/build/DEC-*.md
DEC-001-reuse-boundary.md
DEC-002-authorisation-model.md
DEC-003-trust-boundary.md
DEC-004-secret-handling.md
DEC-005-what-is-stored.md
DEC-006-storage-and-canonical-form.md
```

- **`DEC-002` authorisation** — one principal, the local OS user. No per-record access
  control, stated explicitly so no later code assumes one exists. The boundary that *is*
  enforced is the workspace stamp, because the realistic leak here is answering from the
  wrong project's store, and `memory/src/workspace.ts` records that six separate stores once
  existed under this one repository.
- **`DEC-003` trust boundary** — all content is hostile. The threat specific to a context
  engine is prompt injection *with persistence*: the store turns a one-session attack into a
  durable one. Content is data, never instructions; no dynamic dispatch on a stored string;
  validation once at ingest; malformed temporal input rejected with a reason code rather than
  silently becoming unbounded.
- **`DEC-004` secrets** — the engine holds none. The exposure runs the other way, a secret
  arriving *as content* into an append-only log designed to resist editing. No field is
  designated for a secret, purge is the remedy, and content scanning is rejected because
  partial detection teaches callers the store is safe for keys.
- **`DEC-005` what is stored** — explicit records and provenance only. Never raw prompts,
  transcripts or file contents; a retrieval query is stored as a hash and a length, following
  `memory/src/ledger.ts`:

```
$ command grep -n "textHash\|chars" memory/src/ledger.ts | head -3
26: * side effect of instrumentation. `textHash` covers what the recost actually
67:  chars?: number;
68:  textHash?: string;
```

A caught error worth recording, because it is the failure mode these records exist to
prevent: `DEC-005` was first written with its rejected-alternatives heading phrased as
"What was stored in the alternative, and why it was rejected". That is not the string the
gate matches, so the section that stops re-litigation would have been invisible to the check
that enforces it. Corrected before the gate ran.

---

## Task 0.6 — Decide the storage format and the exact bytes that get hashed, as DEC-006

Acceptance: `engine/build/DEC-006-storage-and-canonical-form.md` states the on-disk format
and the exact canonicalisation rule, names the ambiguity it closes, and rejects at least the
unseparated-concat alternative by name.

**Met.** One append-only `log.jsonl` as the only truth, records discriminated by `kind`,
every derived view rebuilt on load and never persisted. Chain fields `seq` (contiguous from
1), `prev`, and `digest`. The digest is `SHA-256` over canonical JSON of every field except
`digest` itself — keys sorted by UTF-16 code unit, no insignificant whitespace, `null`
explicit and absence distinct from it.

The ambiguity it closes, at the cited lines:

```
$ sed -n '74,80p' semantica/semantica/provenance/integrity.py
        data = (
            f"{entry.get('entity_type', '')}"
            f"{entry.get('activity_id', '')}"
            f"{entry.get('agent_id', '')}"
            f"{entry.get('agent_type', '')}"
            f"{entry.get('source_document', '')}"
            f"{entry.get('timestamp', '')}"
```

Sixteen fields joined with no separator, so the pair `("ab","c")` and the pair `("a","bc")`
produce an identical digest. The fix is not a better separator — any separator can occur
inside a value — but a serialisation that cannot lose a boundary. Seven alternatives are
rejected by name in the record, including a separator character, raw `JSON.stringify`,
per-kind files, a persisted index, and SQLite.

One deliberate divergence from Semantica, with its reasoning carried over rather than
silently dropped: `integrity.py:45-55` excludes the primary key from the hash because its
versioning archives a prior value under a new id, and hashing the id would turn a legitimate
rename into a permanent false chain break. We hash every field except `digest`, with no
exclusions, because we never relabel an id — records are immutable and a correction is a new
record. Having no exclusion is simpler to state and strictly stronger to verify.

---

## Task 0.7 — Install `algorithm-first-development` and correct the `CLAUDE.md` drift

Acceptance: the skill loads from `.claude/skills/`, `definition-gate --root .` still exits 0
with its failure count pasted, the README gains its missing row, and the two `CLAUDE.md`
citations state what is actually on disk — with the counts taken from a command run this
session, not from the old prose.

**Met, and it uncovered more than the task scoped.** The audit that preceded the install
found that four of six agents declared a skill that did not exist on disk:

```
build-phase-runner   skills: build-phase-machine, evidence-gate, guard-integrity
phase-auditor        skills: phase-zero-audit, evidence-gate
postmortem-scribe    skills: build-postmortem, decision-record
verification-runner  skills: verification-suite, evidence-gate
```

Of those, `build-phase-machine`, `phase-zero-audit`, `decision-record` and
`verification-suite` were all absent. Five skills were installed from `claude-sample/` — those
four plus `algorithm-first-development` — and every declared reference now resolves:

```
  OK      build-phase-runner -> build-phase-machine
  OK      build-phase-runner -> evidence-gate
  OK      build-phase-runner -> guard-integrity
  OK      phase-auditor -> phase-zero-audit
  OK      phase-auditor -> evidence-gate
  OK      postmortem-scribe -> build-postmortem
  OK      postmortem-scribe -> decision-record
  OK      verification-runner -> verification-suite
  OK      verification-runner -> evidence-gate
```

The `recon-*` family was deliberately **not** installed: the recon this directory needed is
finished and its output is `recon-semantica/`.

**The gate result, before and after, measured rather than assumed:**

```
=== BEFORE the install (9 skills) ===
  scanned 9 skill(s), 6 agent(s), 3 hook(s)
PASS: 0 failure(s), 0 warning(s)

=== AFTER the install (14 skills) ===
  scanned 14 skill(s), 6 agent(s), 3 hook(s)
PASS: 0 failure(s), 2 warning(s)
```

**This is the finding of the phase.** The "before" column is a tree in which four of six
agents pointed at skills that did not exist, and `definition-gate` called it clean on both
counts. Reading `lint.mjs`, its only use of the word is building the *search path* for
locating skill directories to scan (`lint.mjs:67-73`); nothing parses an agent's `skills:`
frontmatter and checks each entry resolves. It does perform exactly this check for scripts
and for hook commands, so the omission is an inconsistency rather than a design choice.
Filed to `.claude/BACKLOG.md` with the fix stated as a gate change plus a fixture it must be
seen red against — not fixed here, because shipping a check without a proven failure is the
mistake the backlog entry is about.

Both new warnings were triaged and neither is a defect. One is accurate — the installed
`algorithm-first-development` cross-references `repo-recon`, which is deliberately absent.
The other is a false positive on `build-phase-machine:99`, where the prose is *about*
placeholder markers rather than containing an unfilled one:

```
$ sed -n '98,101p' .claude/skills/build-phase-machine/SKILL.md
**It becomes an engineering exercise.** The repo is beautiful and the deliverable
is three paragraphs. The fix is to write the deliverable's skeleton with bracketed-TBD
placeholders at **phase 0**, not at the end. Every phase fills placeholders in. The
deliverable drives the build, not the reverse.
```

**Documentation corrected.** `.claude/skills/README.md` now exists — 88 lines indexing the
14 skills and 6 agents, the lifecycle they form, and which gate answers which question. It
states plainly that this tree is the installed subset and `claude-sample/skills/` is the
library. Four `CLAUDE.md` claims were corrected to what is on disk: the opening line (which
described two artifacts where there are now three), the README citation and the skills and
agents entries (which claimed 17 skills and 5 agents), and the stale "8 warnings" gate
measurement. Entries for `engine/`, `recon-semantica/` and `claude-sample/` were added,
since the structure section named none of them.

---

## Task 0.8 — Extend `.claude/check.sh` and return a GO/NO-GO verdict

Acceptance: `.claude/check.sh` exits 0 with both new steps visible in its output, the
existing `project-graphx` and fixture round-trip steps still run, and the phase closes with
an explicit GO or NO-GO for Phase 1.

**Met.**

```
$ bash .claude/check.sh
── definitions — will the skills, agents and hooks load and resolve? ──
  PASS  definition-gate: PASS: 0 failure(s), 2 warning(s)

── project-graphx — the plugin maintained here ──
  PASS  bun test:  89 pass

── engine — the context graph engine maintained here ──
  PASS  engine check (typecheck + suite):  3 pass

── build paperwork — did any phase close without pasted proof? ──
  PASS  evidence-gate: gate: PASS

── engine build paperwork — did any engine phase close without pasted proof? ──
  PASS  evidence-gate (engine): gate: PASS

── recon spec — is it true about the repository it describes? ──
  SKIP  no recon/ directory — no specification to check (not a pass)

── fixtures — has each gate been seen red? ──
  PASS  definition-gate goes red on its broken fixture
  PASS  evidence-gate goes red on its broken fixture

PASS — 7 gate(s) passed, 1 skipped
=== check.sh exit=0 ===
```

The engine suite step uses `bun run --cwd "$ROOT/engine" check` rather than a `cd`, for the
reason in Task 0.1. `project-graphx` still runs at 89 pass, and both fixture round-trips
still confirm each gate exits 1 against its own deliberately broken input.

**Proven failure, both new steps.** A guard is worth exactly what it fails on, so neither was
claimed until it had been seen red.

Suite step, with `strict` flipped to `false` in `engine/tsconfig.json`:

```
── engine — the context graph engine maintained here ──
        $ bun run typecheck && bun test
        $ tsc --noEmit
        tsconfig.json(14,5): error TS5052: Option 'exactOptionalPropertyTypes' cannot be
        specified without specifying option 'strictNullChecks'.
check.sh exit=1
```

Paperwork step, with a summary added that restates its Acceptance but pastes no proof:

```
── engine build paperwork — did any engine phase close without pasted proof? ──
        gate: .../engine/build/ — 9 doc(s), 1 prompt(s), 1 summary(ies)
        gate: FAIL — 1 problem(s)
check.sh exit=1
```

Both changes reverted; the tree is clean and `check.sh` exits 0 as pasted above.

The decision-record checks were proven red the same way, on a copy rather than on the real
records — the middle-dot status line replaced with a hyphen in one file, the rejected-section
heading renamed in another:

```
gate: FAIL — 2 problem(s)

  decprobe/DEC-002-authorisation-model.md
    no `_Decided YYYY-MM-DD · status: ...` line

  decprobe/DEC-003-trust-boundary.md
    no "What was rejected" section — this is the part that stops re-litigation

exit=1
```

---

## 2. Still open

- **`definition-gate` does not validate agent `skills:` references.** Filed in
  `.claude/BACKLOG.md`. Not fixed here.
- **Purge versus an unbroken hash chain** is a real unsolved tension between Algorithms 1 and
  3, not a detail. `DEC-004` names purge as the remedy for a leaked secret, which obliges
  Task 1.3's research step to produce a real answer rather than declaring erasure out of
  scope. A recorded limitation is an acceptable outcome; a quiet one is not.
- **Which RRF implementation survives** is deliberately left to Task 1.4's own decision
  record. `DEC-001` establishes only that the two contracts differ.
- **The `repo-recon` cross-reference warning** stays until either that skill is installed or
  the reference is scoped. It is accurate, so suppressing it would be the wrong fix.

## 3. What Phase 1 depends on from this phase

`DEC-006` fixes the record envelope and the canonical form, so Algorithm 1 can be built
without re-opening the format. `DEC-003` fixes that all content is data, so no algorithm may
dispatch on a stored string. `DEC-001` forbids `memory/` imports in Stage 1 files, and
`engine/src/store/` stays empty until Phase 2 — that is what keeps the scaffolding from
becoming load-bearing before the algorithms are proven.
