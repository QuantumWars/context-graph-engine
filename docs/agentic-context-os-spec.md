# Context Management for Agentic Orchestration — build spec

**The roadmap.** One phase at a time, in this order. Each is a discrete build unit closed the way
every engine phase is: port from what exists → research the shape → lock a `DEC` → build with a test
that fails if the property regresses → paste the evidence → push a branch.

Read `agentic-context-os.md` first — it is the *what*. This is the *order*, and the *done* line for
each step.

**Legend.** 🛑 = a `STOP`: lands in production data, a schema, a stack, or a trust boundary — the
operator signs off before it is written. ⏸ = gated on a measurement, not built until the gate opens.

**Scope, revised 2026-08-20:** transcript capture (Phase 4) is **deferred** — the operator's call
that the current system handles context well enough without it, and that keeping `DEC-005` intact is
worth more than the extra recall. That removes the `DEC-005` supersession, the retention question and
one `STOP` entirely. The path to first value is **0 → 1 → 2 → 6**; Phases 3, 5, 7 enrich it; 4 and 8
are out of the current pass.

**The one locked decision** (operator, 2026-08-20), formalised in Phase 0:
1. One store per project; shared schema and tools; `project-graphx` is the global layer — `DEC-002`
   survives. *(Transcripts are NOT captured in this pass, so `DEC-005` stands unchanged.)*

---

## Phase 0 — Lock the decisions, resolve what blocks Phase 1 🛑

**Goal.** Turn the architecture doc's choices into `DEC` records, and settle the two open questions
that Phase 1 cannot start without.

**Deliverables.** (Transcripts deferred, so the `DEC-005` supersession is dropped — two records, not
three.)
- `DEC` for the node-type model: **re-scannable vs attested**, and whether re-scannable nodes live
  in `log.jsonl` or a sibling `derived.jsonl`. *(§11, open question 3.)*
- `DEC` for the `author` identity field — its shape and allowed values.

**Done when.** Two `DEC` records exist and pass `evidence-gate`'s decision-record checks. No code.

**Why first.** Phases 1–7 all read the node-type split and the `author` field. Deciding them once,
in the open, is what stops two later phases building incompatible schemas.

---

## Phase 1 — The node-type schema and the `author` field 🛑

**Goal.** Extend `RecordMeta` so a node declares whether it is re-scannable or attested, and who
wrote it.

**Depends on.** Phase 0.

**Deliverables.**
- `nodeClass: 're-scannable' | 'attested'` on the record envelope, defaulting to `attested` so every
  existing record is unchanged.
- `author` on `RecordMeta`.
- The store loads a mixed log: attested records are chain-verified; re-scannable records are
  identified by their source object id and skipped by the chain check without breaking contiguity.

**Done when.** The full existing suite still passes; a test proves a re-scannable record does not
participate in the hash chain yet a tampered attested record beside it is still caught; the 38
current records load unchanged with `nodeClass: 'attested'`.

**Note.** This is the one irreversible step — it changes the on-disk envelope. Everything after it is
additive.

---

## Phase 2 — Git ingest: the spine

**Goal.** Walk `git log` and materialise each commit as a re-scannable `commit` node with
`commit —TOUCHED→ file` edges.

**Depends on.** Phase 1.

**Deliverables.**
- A `commit` node per commit: hash, subject, body, author, author-time → `validFrom`, commit-time →
  `recordedAt`.
- `TOUCHED` edges to file nodes.
- Idempotent by commit hash — re-running ingests only new commits.
- CLI `ingest-git` and an MCP tool.

**Done when.** Ingesting this repo's 61 commits produces 61 `commit` nodes and their file edges;
re-running adds zero; the chain still verifies (re-scannable nodes do not disturb it); a `find` over
commit subjects returns them.

**Why here.** It is the largest recall win for the least judgement — 61 sessions of deliberate
history, already on disk, become queryable.

---

## Phase 3 — Session events: the episodic layer

**Goal.** Promote `.claude/sessions/<id>/events.jsonl` (already recorded, today discarded) to a
`session` node.

**Depends on.** Phase 2 (so sessions can link to the commits they produced).

**Deliverables.**
- A `session` node: id, start, end, tool counts, failures, mode.
- `session —TOUCHED→ file` and `session —PRODUCED→ commit` edges.
- The `close.mjs` findings (churn, flail, blind writes) carried onto the node instead of left on
  disk.

**Done when.** A recorded session becomes a node with its file and commit edges; a query returns
"what did session X do, and did it thrash".

---

## Phase 4 — Transcript as a spanned source, and the purge test 🛑 ⏸ DEFERRED

**DEFERRED 2026-08-20** — the operator judged the current system handles context well enough without
raw transcripts, and that keeping `DEC-005` intact is worth more than the recall. Revisit only if the
reads (Phase 6) prove insufficient without conversation context. The design below stands for when it
is picked up.

**Goal.** Store the session transcript as a source the graph points into, never copies — and prove
purge erases it.

**Depends on.** Phase 3. Resolves §11 open questions 1 (format/provenance) and 2 (retention/expiry).

**Deliverables.**
- A transcript stored once per session as a spannable source (`DEC-013`'s `Span` machinery reused
  verbatim).
- A decision or insight node may carry a `span` into the transcript.
- A retention/expiry policy for transcripts, locked in a `DEC`.
- `DEC` fixing where the transcript comes from (Claude Code writes to
  `~/.claude/projects/<encoded-cwd>/`; copy in, reference in place, or receive via hook).

**Done when.** The Phase 9 purge test, pointed at a transcript: plant a secret in the transcript,
purge the source, grep the **whole store** for the secret and find zero, and confirm every span into
it reports `source_purged`. This is the guard that keeps the transcript decision honest.

---

## Phase 5 — Type the `.claude` and doc nodes via graphx's table

**Goal.** A file at `.claude/skills/foo/SKILL.md` is a `skill` node, not a generic `file` — reusing
`project-graphx`'s `claude-infra.json` type table rather than restating it.

**Depends on.** Phase 2 (file nodes exist) and Phase 1 (re-scannable class).

**Deliverables.**
- Typed re-scannable nodes for skills, agents, commands, hooks, CLAUDE.md, docs.
- Ids in graphx's exact shape — `<repo>:skill:<name>` — for the Phase 7 join.

**Done when.** This repo's `.claude/` tree types correctly; the ids match what graphx emits for the
same files.

---

## Phase 6 — The reads: `find --recent` and the progress query

**Goal.** Answer the three questions the goal names, not just the relevance one.

**Depends on.** Phases 2–3.

**Deliverables.**
- `find --recent` — a recency-ordered read for "what was I last doing", the query today's
  relevance ranker answers wrongly.
- A progress query — "what shipped for X" (commits touching X) versus "what is open" (decisions not
  yet in a commit).

**Done when.** A restart query returns the last session's work in recency order; the progress query
distinguishes shipped from open on a worked example.

---

## Phase 7 — Federate with graphx on shared ids

**Goal.** Let a query cross from the per-project engine to the global graphx catalogue without either
importing the other.

**Depends on.** Phase 5 (shared-id typed nodes).

**Deliverables.**
- A read path that, given a `skill` node here, resolves its graphx id and returns "used by these N
  other projects".
- No merge: graphx stays global and re-scannable, the engine stays per-project.

**Done when.** From "this decision was made in a commit that touched this skill" (engine) a query
reaches "this skill is used by 12 other projects" (graphx), measured on a real skill.

---

## Phase 8 — Local embedding channel ⏸

**Goal.** Add semantic retrieval as a **third RRF channel**, not a replacement for lexical.

**Gate.** Not built until a measurement on the real, post-ingest corpus shows lexical failing
natural-language queries. One abstained query is not that; a recall gap on `eval/sweep.ts` is.

**Two non-negotiable constraints** (from the operator's own decisions):
- **Local model only.** An API embedding ships transcript and secret content to a third party; the
  store's whole posture forbids it.
- **Purge must reach the index.** The vector store is derived and rebuilt from the log, or purge
  cannot erase what a vector encodes. Guarded by a plant-secret → embed → purge → prove-gone test.

**Done when.** The embedding channel beats lexical-alone on natural-language queries in the harness,
`RRF_K` is finally measurable because the channels now overlap, and the purge test passes. This
supersedes `d-no-model` with evidence.

---

## Cross-cutting, tracked but not a phase

- **Multi-agent write contention.** Two agents in one repo at once is real. The file lock is
  per-file and holds locally, not over a network share. Revisit if a shared-filesystem case appears.
- **The explorer surfaces the new node types.** The web and desktop viewers currently draw decisions
  and edges; commit, session and skill nodes want colours and panels. A small follow-on per phase,
  not a phase of its own.

---

## The one-line order

Current pass: **0** lock 2 decisions → **1** schema 🛑 → **2** git spine → **6** the reads → then
**3** sessions → **5** type `.claude` → **7** federate graphx.
Deferred: **4** transcripts, **8** embeddings ⏸.
