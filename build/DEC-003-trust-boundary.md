# DEC-003 — Treat everything that enters the store as hostile data, never as instructions

_Decided 2026-08-19 · status: current_

Content reaching this engine originates from model output, tool results, and documents an
agent read on the open web. **All of it is untrusted**, and the engine treats it as data at
every point:

1. **The engine never interprets stored content as a directive.** No stored string selects a
   code path, names a method, or alters control flow. Dispatch happens on typed, closed
   vocabularies the engine defines — never on a caller-supplied string.
2. **Anything rendered back to an agent is framed as retrieved data**, attributed to its
   source, and never emitted in a way that presents it as an instruction from the system.
3. **Validation happens once, at the ingest boundary**, in a single function per record kind
   — not scattered across read paths, where a new read path silently skips it.
4. **The store files themselves are semi-trusted.** Anything on the machine can edit them.
   That is what the Algorithm 1 hash chain is for: detection, not prevention.
5. **Temporal input is untrusted.** A malformed timestamp is a rejected input with a reason
   code. It must never silently become an unbounded window.

## Why

The threat that is specific to a context engine is not SQL injection; it is **prompt
injection with persistence**. An agent reads a hostile web page, records what it read, and a
later session retrieves it as trusted context. The store converts a one-session attack into a
durable one. Nothing in Phase 4 can retrofit a fix, because by then hostile content and
trusted content share a representation.

Item 5 is not hypothetical. `semantica/semantica/context/context_graph.py`'s `_parse_iso_dt`
returns `None` on an unparseable bound, and both `ContextNode.is_active` and
`ContextEdge.is_active` then impose no bound at all — the code logs a warning and, in its own
words, treats the node as always-active. So a malformed timestamp makes a record *more*
visible, not less. Verify with:

```
command grep -n "Always-Active" semantica/semantica/context/context_graph.py
```

Item 1 is the rule Semantica breaks in a smaller way at
`semantica/semantica/ingest/methods.py`, where a caller-supplied name selects an
implementation from a registry and a failure silently falls through to a different one
(finding A-10), leaving the result carrying no marker of which produced it.

Chosen on judgement from the threat shape. No measurement was taken.

## What was rejected

- **Trusting content the agent itself wrote.** Rejected: an agent's output is a function of
  its input, and its input included the hostile page. Provenance records where content came
  from; it does not make it safe.
- **Sanitising content on the way in by stripping instruction-like text.** Rejected: it is
  undecidable, it corrupts legitimate content — an engineering note may quote an instruction
  — and a partial strip produces false confidence. Frame at the boundary instead.
- **Validating on read rather than on write.** Rejected: read paths multiply, and Phase 2.1's
  acceptance already requires enumerating them. One ingest boundary is checkable.
- **Coercing a malformed timestamp to "now" or to unbounded.** Rejected: both are silent
  returns, which HARD RULE 4 forbids, and the unbounded variant is the Semantica bug above.

## What this constrains

- No `eval`, no dynamic dispatch on stored strings, and no registry lookup keyed by
  caller-supplied text. Edge types, node kinds and record kinds are closed unions validated at
  the boundary.
- Every ingest function returns either a valid record or a named rejection reason. There is no
  third outcome and no silent coercion.
- Retrieval output must carry its source, so a consumer can tell stored content from engine
  output.
- The hash chain is a **detection** control. No claim may be made anywhere in this repository
  that it prevents tampering.

## How to reverse it

This one is not really reversible. Loosening it means a released store already contains
content admitted under the loose rule, and no later pass can retroactively distinguish those
records from safe ones. Narrowing it further — for example, quarantining content by source
until promoted — is additive and cheap, and is the direction any future change should take.
