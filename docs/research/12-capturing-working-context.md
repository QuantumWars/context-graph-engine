# Research — capturing working context, not just decisions

**Ran:** 2026-08-20, after Phase 21. **Method:** built-in `WebSearch`, plus reading `semantica` and
`project-graphx` directly.

> **Evidence caveat.** The web material is one hop from source through a summarisation layer. Good
> enough to design from, not good enough to quote. What was read in `semantica/` and
> `project-graphx/` was read directly and is cited by file and line.

## The question

Phase 21 captures decisions a session **wrote down**. It does not restore what a session was
*working on*. Its own summary says so:

> It captures decisions, not context. A session that decided nothing captures nothing. This serves
> *"why did we do that"* on restart; it does not restore what the session was working on.

## What the field converged on

The literature reports a three-tier taxonomy that the agent ecosystem settled on over 2025–26,
mirroring cognitive science:

| Tier | Holds | Retrieval semantics |
|---|---|---|
| **Semantic** | durable facts and knowledge | relevance |
| **Episodic** | what happened, in sequence | **temporal proximity** |
| **Procedural** | how to do things — skills, tools | availability |

The retrieval column is the part usually missed. One framework separates *memory layer* (historical
interactions, retrieved by temporal proximity), *knowledge layer* (domain facts, by semantic
relevance) and *working memory* (current state, by freshness) — **three different query semantics**,
not one index with three labels.

**Consolidation** is the named process for deciding *when and what* to commit from a transient
buffer to durable storage. It is treated as a first-class design question, not a background detail.

## The mapping that makes this easy

Laid against what already exists on this machine:

| Tier | What we have | State |
|---|---|---|
| Semantic | `engine` — decisions, causal edges, evidence, chained | **built** |
| Procedural | `project-graphx` — 590 nodes, 2,288 edges over skills, agents, commands, 40 projects | **built, separately** |
| Episodic | `.claude/sessions/<id>/events.jsonl` — 828 events, 59 files, 11 failures | **captured, discarded** |

**Two of the three tiers already exist as separate systems, and the third is already being recorded
and thrown away.** `close.mjs` computes churn, flail and blind writes into `findings.md` and leaves
it on disk where nothing can query it.

## What a handoff actually needs

The session-resume tools converge on four fields, and it is a short list:

- the prior **goal**
- what is **already done**
- what is still **open**
- the **next action**

Two of those are mechanical from the event log — done (files written, commands that succeeded) and
a proxy for open (files edited repeatedly without a passing run). Two are not: the goal and the next
action are statements, not counts.

Also reported: checkpoints are commonly treated as **stale after 24 hours**, and the failure modes
named for existing coding agents are *sessions that cannot resume from a checkpoint* and *state that
resets, losing decisions*.

## What `semantica` does, read directly

`AgentMemory.store(content, metadata, entities, relationships)`
(`semantica/context/agent_memory.py:300`) is the single capture entry point. Measured: every call
site outside that file is a **docstring example**. There are no hooks and no `.claude/hooks/`
directory. **Its capture is caller-driven, exactly like ours.**

What it has that we do not:

- **Two tiers.** `short_term_limit = 10` (`:205`), a pruned buffer, with write-through to long-term
  and search across both (`:457`).
- **Raw content storage**, embedded into a vector store.
- **Structure at capture time** — entities and relationships passed in alongside the text.

**The tiering is worth taking. The rest is not.** Raw content behind an embedding index is a second
copy that `purge` cannot reach — the same objection `DEC-007` makes and the same shape as finding
A-2.

## The design this points at

**A working tier that never enters the chain.**

- **Durable tier** — today's log. Decisions, edges, evidence. Chained, attested, purgeable.
- **Working tier** — session facts. Files touched, failure counts, branch, sequence. Cheap,
  expiring, **outside the hash chain**.

Three consequences follow, and each is a decision rather than a detail:

**1. Retrieval semantics differ per tier.** `find` today is relevance-only (lexical + structural
fused). A restart question — *"what was I last doing"* — is a **recency** query, and answering it
with a relevance ranker is answering the wrong question. The literature is explicit that these are
different semantics.

**2. Consolidation is the rule that promotes.** Phase 21's hook is already one: *a `DEC-*.md` file
was written → record a decision node.* That is consolidation with a mechanical trigger, and it is
the pattern to extend rather than replace.

**3. Expiry is what keeps the working tier honest.** A durable record is forever by design; a
working record that never expires is just a slower durable one. The reported convention is 24 hours,
and whatever is chosen has to be stated rather than inherited.

## What this does NOT solve

- **The goal and the next action are not mechanical.** They are statements. Capturing them means
  either an artifact that states them — a branch name, a phase prompt, a commit message — or
  reading prose, which `DEC-022` refuses.
- **A working tier is a second store.** `DEC-007`'s objection applies to it as much as to an
  embedding index. The defence is that it holds **counts and paths, never content**, and that it
  expires — but that has to be true by construction and tested, not asserted.
- **Nothing here addresses multi-agent identity.** `RecordMeta` still has no field for who wrote a
  record, and a shared store between Claude and other agents needs one before any of this matters at
  scale.

## Sources

One hop from source; spot-check before quoting.

- [Multi-Layered Memory Architectures for LLM Agents](https://arxiv.org/html/2603.29194v1)
- [Episodic-Semantic Memory Architecture for Long-Horizon Scientific Agents](https://arxiv.org/pdf/2605.17625)
- [Memory in the Age of AI Agents: A Survey — paper list](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)
- [AI Agent Memory Architectures: From Context Windows to Persistent Knowledge](https://zylos.ai/research/2026-04-05-ai-agent-memory-architectures-persistent-knowledge/)
- [Engineering Pitfalls in AI Coding Tools: Bugs in Claude Code, Codex, and Gemini CLI](https://arxiv.org/pdf/2603.20847)
- [agent-session-resume — cross-agent session resume skill](https://github.com/hacktivist123/agent-session-resume)
- [Microsoft Agent Framework Workflows — Checkpoints](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints)
