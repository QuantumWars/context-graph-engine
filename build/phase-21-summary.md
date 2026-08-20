# PHASE 21 SUMMARY — Auto-capture at session end — 2026-08-20

## 1. Verdict

**Phase closed.** A `SessionEnd` hook records the decisions a session **wrote down**, into the
context graph. It never opens the transcript, and `DEC-005` survives unchanged.

```
$ bun run --cwd engine check
 489 pass
 0 fail
 1380 expect() calls
Ran 489 tests across 32 files. [4.88s]

$ echo '{"session_id":"s1"}' | node .claude/hooks/capture-decisions.mjs
context graph: captured 1 decision(s) — DEC-099

$ engine log
1    decision     DEC-099    ab79c46d996f…  {"text":"Ship the capture hook, becaus…
```

---

## Task 21.1 — Capture without reading the transcript

Acceptance: decisions land in the store automatically; `DEC-005` is not superseded; the mechanism is
a transition a script can be right or wrong about, not a judgement.

**Met.** The obvious implementation reads `transcript_path` and extracts decisions from prose. This
one reads the **event log** `record.mjs` already writes, finds `Write`/`Edit` events whose target
matches `DEC-*.md`, and takes the file's own title line.

**Why that keeps `DEC-005` intact:** writing a decision record *is* an explicit act by the caller.
Recording that the act happened captures an artifact, not a conversation.

**And it matches the discipline already in these hooks.** `close.mjs` says: *"Everything below is a
COUNT or a TRANSITION — something a script can be right or wrong about... The moment a number here
needed an opinion to produce, it would belong in `session-forensics` instead."* Detecting a file
write is a transition. Deciding what counts as a decision in prose is an opinion.

**The failure it refuses to industrialise is already in the store.** `f-fake-example`: an invented
example in a document read as a real decision, with a decision record nearly written for an incident
that never happened. A hook that summarises prose would do that unattended, on every session.

```
DECISION DEC-022   engine/build/DEC-022-the-hook-captures-artifacts-not-prose.md
ignored            engine/build/phase-20-summary.md
ignored            engine/src/store/store.ts
ignored            notes/DECISIONS.md
```

The captured id is the **number alone**, so renaming a slug is not a second decision. One decision
edited five times is captured once. A `Read` or a `Bash` that merely names the path captures
nothing.

---

## Task 21.2 — Never block, never guess

Acceptance: idempotent; silent on every failure; no summarisation.

**Met.** Measured:

```
first run     : context graph: captured 1 decision(s) — DEC-099   → 1 record(s)
second run    : ''   ← silent, already captured                   → 1 record(s)
file w/o title: ''   ← captured nothing                           → 1 record(s)
corrupt log   : exit 0   ← never blocks
```

**The fixture for the third row was wrong the first time**, and the run said so: a file containing
`# no heading marker` *is* a heading, and it was captured with the title "no heading marker". The
hook was right and the probe was wrong. Redone with a file that genuinely has none.

A decision already in the store is skipped. A missing `bun`, a missing engine, an
unreadable log — all exit silently, following `close.mjs`: *"A recorder that can stop a session from
ending is a recorder that gets deleted the first time it is wrong."*

A file with no `# ` heading captures **nothing** rather than guessing, and a test asserts the body
of a decision record never reaches the captured text.

---

## 2. The guard that failed on its own comment

The first version of `the transcript is never opened` read the whole file and failed — on the
hook's **own comment** saying *"`transcript_path` appears nowhere in this file"*. A claim of absence
that created the presence.

Fixed by stripping comments before the check, the same way the `link.ts` constants guard does. The
comment now states the rule and the test checks the code.

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| the transcript is never opened | adding a `transcript_path` read | red |
| only `DEC-*.md` is a decision | matching any `.md` | red — 3 tests |
| only a write captures | adding `Read` and `Bash` to the writer set | red |

## 4. Still open

- **It captures decisions, not context.** A session that decided nothing captures nothing. This
  serves *"why did we do that"* on restart; it does not restore what the session was working on.
- **No agent identity.** A captured record looks the same as a typed one apart from its id shape.
  For a store shared between Claude and other agents, `RecordMeta` has no field for who wrote it.
- **It shells out to `bun`.** Fine on a development machine, and the reason it exits silently when
  `bun` is absent.
- **Only this repository's convention.** `DEC-*.md` is how decisions are written *here*. Another
  project with a different convention captures nothing, and would need the pattern changed.
