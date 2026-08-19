# DEC-005 — Store the caller's explicit records and their provenance; never raw prompts, transcripts or file contents

_Decided 2026-08-19 · status: current_

The store holds exactly these kinds, and nothing else:

| Stored | Not stored |
|---|---|
| Node records: an explicit content string the caller passed, its kind, and its validity window | Raw prompt text or user messages |
| Edge records: source, target, typed relation, weight, validity window | Whole session transcripts |
| Decision records: scenario, reasoning, outcome, confidence — as node records, stored once | File contents ingested wholesale |
| Provenance entries: one per mutation, with the chain fields from Algorithm 1 | Credentials of any kind (DEC-004) |
| Retraction records and content-free tombstones | Anything the caller did not explicitly pass as a record |
| Retrieval decision records: what was considered, what was served, per-channel scores and margins | The query text of a retrieval — its hash and length only |

The store lives at `<workspace>/.claude/graph-engine/`, is created with a `.gitignore` that
excludes it entirely, and is never committed.

## Why

This is the cheapest security control available: data not held cannot be disclosed. A context
engine is under constant pressure to store more, because more context is always locally
useful, and each increment is individually defensible. Deciding the boundary once, in
advance, is the only version of this that holds.

The specific line — record what the caller *chose* to record, not everything that passed
through — is what keeps the store from becoming a transcript archive. A transcript archive
carries everything typed and read during a session, including anything pasted, and the global
convention in this repository already treats that as a different exposure class from ordinary
project data.

Storing the retrieval query as a hash and a length rather than as text follows
`memory/src/ledger.ts`, which does exactly this and is the only instrumentation in the
monorepo that survived contact with a live quarantine bypass. Confirm the practice with:

```
command grep -n "textHash\|chars" memory/src/ledger.ts
```

Chosen on judgement, following an existing in-repo practice. No measurement was taken.

## What was rejected

- **The full session transcript, so nothing is lost.** Rejected: it is the maximum-exposure
  option, it makes DEC-004's purge remedy unbounded in scope, and the monorepo constitution
  already forbids committing captured content for this reason.
- **Ingested file contents, so retrieval can quote exactly.** Rejected: it duplicates the
  working tree into an append-only log that resists deletion, and a file path plus a content
  hash answers the same question. Quoting exactly is a read from the file, not from the store.
- **The retrieval query text, because it is useful for tuning.** Rejected: query text carries
  whatever the user typed, including pasted secrets, and a hash plus length supports the
  tuning questions actually asked — repeat rate, length distribution, near-miss detection.
- **A second copy of decision content in a lookup dict, for fast precedent search.** Rejected
  by name: that is Semantica finding A-2, where the second copy is neither persisted nor
  purged, so a purged decision stays searchable by full text. One copy, always.
- **Deciding later, once usage shows what is needed.** Rejected: by then the records exist.

## What this constrains

- No record kind may be added without amending this table. A new kind that stores content the
  table excludes supersedes this record rather than extending it.
- Retrieval cannot return exact quotations of source documents from the store alone; it
  returns the caller's recorded content and a pointer. Any feature needing verbatim source
  text must read the source.
- Because DEC-002 leaves reads unrestricted, this table is the actual disclosure surface. The
  two records are load-bearing together.
- The store directory creation path must write the `.gitignore` in the same operation that
  creates the directory, so there is no window in which an uncommitted store is unprotected.

## How to reverse it

Widening the table is a one-line change to the code and an unbounded change to the exposure,
so it supersedes this record rather than amending it, and needs its own threat statement.
Narrowing it later does not retroactively remove what is already stored — that needs a purge
sweep across existing records, which is Algorithm 3 applied at scale and should be assumed to
cost a phase.
