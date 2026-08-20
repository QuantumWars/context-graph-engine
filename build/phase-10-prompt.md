# Phase 10 — Entity linking: from a mention to a record — 2026-08-20

**Why this phase.** Phase 9's summary named its own largest gap: a proposal says what the text
states and **not which records those phrases refer to**, so a caller types both endpoint ids by
hand. This closes that.

`DEC-014` fixes the design before any code: **linking returns a ranked list with scores and the
margin between the top two; the only verdicts are threshold-free facts (`no_candidates`, `tie`,
`ranked`); no constant is introduced; linking proposes and never writes; and candidate generation
and ranking reuse `src/resolve/` rather than growing a second scorer.**

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

## Task 10.1 — Link a mention to ranked candidates, introducing no constant

`src/extract/link.ts`, Stage 1: pure functions over plain data. A mention and a set of candidate
records in, a ranked list out, each candidate carrying its score, plus the margin between the top
two and one of the three threshold-free verdicts. Candidate generation and ranking come from
`src/resolve/`.

Acceptance: a mention matching one record ranks it first; a mention matching nothing returns
`no_candidates`; two candidates scoring identically return `tie`. The margin is present whenever two
or more candidates exist and absent when fewer do. A test asserts the module declares **no numeric
constant**, and that test is shown red against a deliberately added threshold, so a future constant
cannot arrive quietly.

## Task 10.2 — Prove the port's defect is designed out

Finding: `entity_linker.py:444` decides `same_as` from set-Jaccard over split words, which ignores
word order, so `'the deploy caused the outage'` and `'the outage caused the deploy'` score exactly
1.0 and are declared the same entity.

Acceptance: a test transcribing the original's `_calculate_text_similarity` exactly, asserting it
scores that pair 1.0 — the defect demonstrated rather than described — and asserting this engine's
scorer separates them. The test states which is which, so nobody reads it as our behaviour. No code
path here emits a `same_as` or identity claim, asserted structurally.

## Task 10.3 — Offer links for what `extract` found

`Store.linkMention(text)` over the store's live records, and `propose` enriched so each proposal
carries candidate endpoints for its subject and object. **Still writes nothing.**

Acceptance: the log is byte-identical across a proposal-with-candidates run, and the run is shown to
have computed something. A proposal whose subject matches a record offers it as a candidate with its
score; one that matches nothing says `no_candidates` rather than offering a poor match. Confirming
still requires the caller to name both endpoints — asserted by a test that a proposal alone cannot
produce an edge.

## Task 10.4 — Reach it from the CLI and MCP

A `link` verb on both surfaces, and `extract` showing candidate endpoints alongside each proposal so
a caller can pick rather than type blind. The MCP description must say the ranking is advisory and
that no threshold decides anything, because the reader is a model that will otherwise treat rank 1
as the answer.

Acceptance: a pasted session against a real store — record two decisions and a note, extract, see
the proposals with candidate endpoints and scores, link a mention directly, confirm using a
suggested endpoint, and verify. Driven through the shipped surface, not the API.

## §T — what closes the phase

`bun run --cwd engine check` green, `evidence-gate --dir engine/build` at exit 0,
`constants-gate --root engine` at exit 0, `.claude/check.sh` at exit 0, the real-store session
pasted, every new guard seen red with the change that made it red named, and the work pushed as
feature branches.
