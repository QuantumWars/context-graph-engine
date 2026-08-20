# Context Management for Agentic Orchestration — architecture

**Status:** proposal, 2026-08-20. This is the *what* for the next major version of the engine. It is
written before any code, and the two decisions that fork it were made by the operator on 2026-08-20
and are recorded in §2. `engine/ARCHITECTURE.md` describes the system as it stands today (Phases
0–21); this describes where it goes.

> Every claim here is grounded in something read or run this session. Where a mechanism already
> exists it is named by file. Where a decision is the operator's and not yet locked in a `DEC`
> record, it says so.

---

## 1. The goal

A project is built across many sessions, by more than one agent — Claude, and others such as Codex.
Each session starts cold. Today it re-reads the code, re-derives what was decided, sometimes
re-decides it differently, and occasionally hallucinates state that never existed.

The system captures **how a project developed, across every session**, so that any agent can:

1. **be fed the relevant context at the start of a session** — what was decided, what was tried,
   what failed, what is open;
2. **re-evaluate progress** — what actually shipped versus what was planned;
3. **avoid looping and hallucination** — because the record of what happened is queryable, not
   reconstructed from guesswork.

It is not a document store and not a chat log. It is a **queryable memory of the development
itself**, keyed to one project.

## 2. The two decisions that shape everything

Both were made by the operator on 2026-08-20. They will be locked in `DEC` records when the build
phases open; they are stated here because the rest of the document follows from them.

### 2.1 Transcripts are captured — this supersedes `DEC-005`

`DEC-005` said: *store the caller's explicit records and their provenance; never raw prompts,
transcripts or file contents.* The operator has decided the opposite for this system: **the full
session — prompts, model reasoning, tool input and output — is captured.**

The cost is real and the design must pay it, not hide it:

- **A leaked secret is now anywhere in the prose**, not only in a named field.
- **Purge stops being theoretical and becomes load-bearing.** It must be able to reach transcript
  content, or the erasure guarantee is a lie.
- **The store grows with conversation**, not only with decisions.

The design's answer to all three is in §5: transcripts are stored the way extraction sources
already are, so purge reaches them by the mechanism `DEC-013` already ships and tests.

### 2.2 One store per project; shared schema and tools; graphx is the global layer

- **The store is per-project.** `<repo>/.claude/graph-engine/log.jsonl`, exactly as today. Git is
  per-repository, and this system is anchored to git (§3), so the store must be too. `DEC-002`'s
  workspace boundary **survives** — it remains the one enforced trust boundary.
- **The schema, the CLI verbs and the MCP tools are shared.** One agent, working in one project,
  reads and writes that project's store.
- **Cross-project correlation is `project-graphx`**, which already exists: a global catalogue at
  `~/.claude/graph` of the skills, agents, commands and CLAUDE.md files across 40 projects, with
  2,288 edges between them. It is the layer *above* the per-project stores, not a replacement for
  them.

---

## 3. Git is the spine

Measured this session: a single git commit already carries what a session's capture needs.

```
d1955b7  "Research how to capture working context, and find two of three tiers already built"
  author time  2026-08-20 14:47   ← when the work was done
  commit time  2026-08-20 14:47   ← when it entered the record
  author       subha <…>          ← who did it
  files        docs/research/12-capturing-working-context.md
```

`61 commits on main`, each subject line a session's key development, **written deliberately, already
structured, already on disk**. This is not context to capture. It is context to **ingest**.

And it aligns with the engine's existing model on two axes at once:

| Engine (today) | Git |
|---|---|
| `validFrom` — when the fact became true | **author-time** — when the work was done |
| `recordedAt` — when it was written down | **commit-time** — when it was committed |
| *(no field)* | **author** — who did it |

The two time axes the engine already carries (`DEC-008`) are the two git carries. The one thing git
has that the engine does not is **author**, and that is exactly the multi-agent identity the goal
requires (§6). Git does not extend the engine; it *fills its remaining gap*.

So the spine of the system is: **ingest git history into the graph, and hang everything else off
commits.** Because `.claude/` files and docs are files *inside* those commits, their entire
evolution is captured for free — no separate capture path for them.

---

## 4. Node types, and the one distinction that matters

The graph holds two kinds of node, and telling them apart is the whole design.

### Re-scannable nodes — derived, not attested

A **commit**, a **file version**, a **skill**, an **agent**, a **doc** — all of these can be deleted
and re-derived exactly, because git and the filesystem are their source of truth. They are like
`project-graphx`, which rebuilds itself from disk on every scan.

**They do not need the hash chain.** Git already attests them: a commit hash *is* a tamper-evident
content address. Chaining them would be attesting data that is already attested elsewhere, which is
the redundancy the engine was careful to avoid.

### Attested nodes — recorded, not re-derivable

A **decision**, an **insight**, a **causal link**, a **retrieval** — nobody can re-derive "we chose
this because that failed." These are the engine's existing records, and they **must** stay on the
hash chain, because their integrity has no other source.

### Why this is the architecture, not a detail

The system the operator wants is the **union of the two models this monorepo already runs
separately** — graphx's re-scannable catalogue and the engine's attested log. They have been two
systems precisely because these are two node types. Uniting them means **each node declares its
type**, and the machinery treats it accordingly:

- a re-scannable node carries its git object id and is rebuilt on ingest;
- an attested node carries its digest and prev, and is verified on load;
- an edge may join the two — *decision X was made in commit Y* — which is what makes progress
  re-evaluable.

This is a `DEC` record waiting to be written. It is the first one the build phase must lock.

---

## 5. The four capture paths

### 5.1 Git ingest — the spine

A `git log` walk turns each commit into a re-scannable `commit` node: hash, subject, body, author,
both timestamps, and the files it changed as `commit —TOUCHED→ file` edges. Idempotent by commit
hash, so re-running ingests only what is new. This is bulk, mechanical, and re-runnable — the graphx
model, not the append model.

**What it gives the goal directly:** "what shipped" is now a query, not a reconstruction.

### 5.2 Session events — the episodic layer

`.claude/sessions/<id>/events.jsonl` already records every tool call — 828 in one session, with
files touched and failures. `close.mjs` already computes churn, flail and blind writes into
`findings.md` and then leaves it on disk where nothing can read it. This path promotes that to a
`session` node with `session —TOUCHED→ file` and `session —PRODUCED→ commit` edges.

**What it gives the goal directly:** "what was I doing, and did it thrash" is answerable on restart.

### 5.3 Transcript — the conversation, stored like an extraction source

This is the path §2.1 forces, and the design that makes it safe is the one `DEC-013` already ships.

**A transcript is stored as a source that the graph points into, never copies.** The full session
transcript is written once, per session, as a spannable source. A decision or insight node that came
out of the conversation carries a **span** — `{source, start, end}` — into that transcript, exactly
as an extracted edge carries a span into the note it was read from.

Three properties fall out, and each is already built and tested:

- **The graph stays lean.** It holds pointers, not prose. The transcript sits in its own store.
- **Purge reaches it.** Purge the transcript source and every span into it reports `source_purged`
  — the mechanism in `src/extract/span.ts`, verified since Phase 9. The leaked-secret problem
  §2.1 named is solved by erasing the source, and the pointers honestly report the evidence is gone
  rather than dangling.
- **Attestation is optional per span.** A decision node stays on the chain; the transcript it points
  at need not be, because it is bulky and re-reading it changes nothing that the decision already
  attested.

**What it gives the goal directly:** an agent can ask *why* and get the decision **and** the passage
of conversation it came from — and that passage vanishes cleanly when purged.

### 5.4 `.claude/` and docs — free, via git

Because `.claude/skills/`, `.claude/agents/`, `CLAUDE.md` and `docs/` are files in the git history,
§5.1 already versions them. The only addition is *typing* those file nodes — a file at
`.claude/skills/foo/SKILL.md` is a `skill` node, not a generic `file` — which is exactly what
`project-graphx`'s `claude-infra.json` table already does. This path **reuses graphx's type table
rather than restating it**, closing the loop between the two systems.

---

## 6. Identity — the field the engine is missing

For a store shared between Claude and Codex, "who decided this" must be answerable. Git supplies it
(§3), and the engine's `RecordMeta` has no field for it today. The build adds one: **`author`**, set
from the git author on ingested nodes and from the agent identity on recorded ones.

This is a schema change that lands in production data, so it is a `DEC` record and a `STOP` — the
operator confirms the field and its shape before it is written, because a schema change to the log
is not reversible.

---

## 7. How it is read — the three questions the goal names

Retrieval is not one query. The research (`docs/research/12`) is explicit that the tiers have
**different retrieval semantics**, and the goal names three distinct reads:

| The goal's need | The query | Semantics |
|---|---|---|
| Feed a new session | "what is the state of X" | **relevance** — today's `find`, lexical + structural + RRF |
| Re-evaluate progress | "what shipped for X, and what is still open" | **git-derived** — commits touching X, decisions not yet in a commit |
| Avoid re-deciding | "have we decided X before" | **causal + temporal** — `why`, and `at` a point in time |

The first exists. The second is new and is mostly a git-ingest query. The third exists as `why` and
`at` and needs only the git join to be complete. **A restart read is a recency query**, and answering
it with today's relevance ranker answers the wrong question — a `find --recent` is a small, named
addition.

---

## 8. Security model — what changes and what holds

| Question | Today | Under this system |
|---|---|---|
| Trust boundary | workspace stamp (`DEC-002`) | **unchanged** — per-project store keeps it |
| What is stored | explicit records only (`DEC-005`) | **transcripts too** — `DEC-005` superseded (§2.1) |
| Erasure | purge + salted commitment | **extended to transcripts via spans** (§5.3) |
| Who wrote it | not recorded | **`author` field** (§6) |
| Network surface | read-only explorer on loopback (`DEC-020`) | unchanged |

The one hardening the transcript decision demands: **purge must be tested against transcript
content, not only against a named field.** A test that plants a secret in a transcript, purges the
source, and greps the whole store for it — the Phase 9 test, pointed at a transcript — is the guard
that keeps §2.1 honest.

---

## 9. The join to graphx — federate, do not merge

`project-graphx` stays a separate system. It is re-scannable by nature (it rebuilds from disk), it is
global by design (40 projects), and it is already built and shipping. Merging it into the per-project
attested log would be forcing a re-scannable global catalogue into an attested per-project chain —
the exact mismatch §4 warns against.

Instead they **federate on a shared id scheme.** A `skill` node in the engine (from §5.4) uses the
same id graphx uses — `<repo>:skill:<name>` — so a query can cross from *"this decision was made in
a commit that touched this skill"* (engine) to *"this skill is used by these 12 other projects"*
(graphx) without either system importing the other. graphx already emits exactly this id shape,
measured this session: `context-management:agent:a11y-architect`.

---

## 10. What exists, and the phase order

| Capability | State | Phase |
|---|---|---|
| Attested decisions, causal links, evidence, purge | **built** (0–21) | — |
| Session-end decision capture from artifacts | **built** (21) | — |
| graphx global `.claude` catalogue | **built, separate** | — |
| Node-type distinction (re-scannable vs attested) | design | **first — it is the schema** |
| `author` identity field | design | with the schema |
| Git ingest → `commit` nodes and `TOUCHED` edges | design | the spine |
| Session-event → `session` nodes | design | episodic |
| Transcript-as-span source + purge test | design | the conversation |
| `.claude`/doc typing via graphx's table | design | the loop |
| `find --recent` and the progress query | design | the reads |
| graphx federation on shared ids | design | the join |

Each is a phase built the way the engine already was: port from what exists here or in graphx,
research the shape, lock a `DEC`, then build with a test that fails if the property regresses.

## 11. What is deliberately not decided yet

- **Transcript format and where the session transcript actually comes from.** Claude Code writes
  transcripts to `~/.claude/projects/<encoded-cwd>/`; whether the hook copies them into the store,
  references them in place, or receives them another way is a phase-0 decision, not this document's.
- **Retention and expiry of transcripts.** They are bulky and the research reports a 24-hour
  staleness convention for working state. Whether transcripts expire, and how that interacts with a
  decision that points into one, is unresolved and load-bearing.
- **Whether re-scannable nodes live in the same `log.jsonl` or a sibling file.** Putting
  re-derivable git nodes in the attested log bloats the chain; a sibling `derived.jsonl` keeps the
  chain lean but adds a second file. This is the `DEC` the node-type phase must settle.
- **Multi-agent write contention.** Two agents in one repo at once is real. The file lock is
  per-file and holds locally; it does not hold over a network share, and nothing here assumes it
  does.
