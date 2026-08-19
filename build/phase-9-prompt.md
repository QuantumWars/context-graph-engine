# Phase 9 — Extraction with span provenance — 2026-08-20

**Why this phase.** It is the last item on the recon's list that nothing here has built. Task 3.2
says *an edge is written only when something in the source text supports its predicate; proximity
is not support* — and this engine satisfies that trivially, because nothing extracts anything and
every edge is typed in by hand.

`DEC-013` fixes the design before any code: **a span is `{ source, start, end }` pointing into an
immutable record and never a copy of the text; offsets are UTF-16 code units; an extractor emits
only what a rule matched, carrying a trigger span; extraction proposes and never writes; and no
confidence float is invented.**

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

## Task 9.1 — Define a span, and resolve it against the store

`src/extract/span.ts`, Stage 1: pure functions over plain data. A span is `{ source, start, end }`
with offsets in UTF-16 code units, and the unit is stated at the definition site rather than
implied. Resolution reads the source record and returns the quoted text; a span whose source was
purged, or whose bounds fall outside the text, resolves to nothing with a reason code.

Acceptance: a span resolves to exactly the quoted substring; an out-of-bounds span, a reversed
span, and a span into a purged record each return a distinct named reason code rather than an empty
string or a throw. A test proves a stored span contains **no field value** of its source's content,
scanned the way the tombstone test scans, and proves the scan can find a value when one is present.

## Task 9.2 — Extract only what a rule matched

`src/extract/rules.ts`. Named rules with subject, object and trigger capture, run over a record's
text, emitting one relation per match with all three spans. Port the shape of Semantica's
`extract_relations_regex` (`semantica/semantica/semantic_extract/methods.py`) and design away its
two defects: the unprovenanced `confidence=0.75`, and the last-wins `entity_map` that silently
collapses two entities sharing a surface form.

Acceptance: closes A-8. A paragraph naming ten entities with no stated relation between them emits
**zero** relations, and the same fixture is asserted to contain ten findable entity mentions, so the
zero is a result rather than an empty input. A sentence stating one relation emits exactly one, with
the trigger span resolving to the words that stated it. Two entities sharing a surface form are
both reachable, asserted against the ported last-wins behaviour in the same test.

## Task 9.3 — Prove the offset unit, with a character that can tell the difference

The unit is the defect this task exists for. Python indexes by code point and TypeScript by UTF-16
code unit, so an ASCII fixture passes under either and says nothing.

Acceptance: a fixture whose text contains an astral character before the span — an emoji is enough
— and a test asserting the resolved quote is exactly right. The test is shown red against
code-point offsets, with the wrong quote pasted, so the fixture is proven able to tell the two
apart. A second test asserts the documented unit matches what the code does, by measuring rather
than by restating the comment.

## Task 9.4 — Propose, then let a caller dispose

`Store.propose(recordId, rules?)` returns proposals and **writes nothing**. A caller confirms one,
and the resulting edge carries the spans it was read from. `DEC-013` and `DEC-012` agree here: an
automatic assertion into a trusted log is unreviewable.

Acceptance: the log is byte-identical before and after a proposal run, and the run is shown to have
computed something so "wrote nothing" is not "did nothing". A confirmed proposal appends exactly one
edge, that edge's span provenance resolves back to the trigger text, and the chain verifies. There
is no path that writes an edge without a caller naming it, asserted structurally.

## Task 9.5 — Reach it from the CLI and MCP

An `extract` verb on both surfaces that proposes, and a way to confirm a proposal that requires the
caller to name it. The MCP tool description must say plainly that extraction proposes and does not
write, because the reader is a model that will otherwise assume it wrote.

Acceptance: a pasted session against a real store — record a text, extract, see the proposals with
their trigger quotes, confirm one, see the edge, verify the chain, and see `why` walk it. Driven
through the shipped surface, not the API.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`constants-gate --root engine` at exit 0, `.claude/check.sh` at exit 0, the real-store session
pasted, every new guard seen red with the change that made it red named, and the work pushed as
feature branches.
