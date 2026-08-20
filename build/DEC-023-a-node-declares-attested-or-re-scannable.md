# DEC-023 — Every node declares whether it is attested or re-scannable, and the two live in different files

_Decided 2026-08-20 · status: current_

The context-OS build (`docs/agentic-context-os.md`) unites the two graph models this monorepo runs
separately: the engine's attested log, and `project-graphx`'s re-scannable catalogue. Uniting them
means each node must say which it is, because the machinery treats them oppositely.

**Every record carries `nodeClass: 'attested' | 're-scannable'`.** It defaults to `attested`, so
every one of the 38 records already on disk is unchanged and correct without being rewritten.

- **Attested** — a decision, an insight, a causal link, a retrieval. Not re-derivable from anywhere
  else, so the hash chain is the only thing that proves its integrity. Stays chained, stays verified.
- **Re-scannable** — a git commit, a file version, a session, a skill. Git or the filesystem is its
  source of truth, so it can be deleted and rebuilt exactly. It carries the id of that source (a
  commit hash, a path) and is **not** on the hash chain.

**Attested and re-scannable records live in different files.**

```
<workspace>/.claude/graph-engine/
  log.jsonl       attested only — decisions, edges, retrievals. Chained. Small. Verifies fast.
  derived.jsonl   re-scannable — git commits, files, sessions. Rebuilt on ingest. Not chained.
```

`log.jsonl` keeps exactly the shape and the guarantees it has today. `derived.jsonl` is a new,
separate store that `ingest` rebuilds and that `verify` does not walk.

## Why

**Because chaining re-derivable data attests something git already attests.** A commit hash *is* a
tamper-evident content address. Putting a commit on the engine's hash chain would be a second,
weaker attestation of data that git already proves — the exact redundancy the engine was careful to
avoid (`DEC-006`), pointed the wrong way.

**Because the split is the whole architecture, not a detail.** The system the operator asked for is
the union of graphx (re-scannable, global) and the engine (attested, per-project). They have been
two systems *because* these are two node types. A node that declares its class is what lets one
graph hold both and treat each correctly: an edge may still join them — *decision X was made in
commit Y* — which is what makes progress re-evaluable.

**Because a sibling file keeps the thing that must be trustworthy small.** Git ingest will add 61
commit nodes and their file edges today, and far more over a project's life. Interleaving that with
the attested log would make `verify` walk past thousands of un-chained rows to check a few hundred
chained ones, and would mix data whose integrity has one source (the chain) with data whose
integrity has another (git). Two files keep `log.jsonl` lean, keep `verify` fast, and keep every
guarantee the engine ships today operating over attested data alone.

**Because purge stays confined to where it matters.** Purge is an attested-store operation — it
erases content whose only copy is in `log.jsonl`. A re-scannable node holds no content that is not
already in git, so purge never needs to reach `derived.jsonl`, and the erasure guarantee is
unchanged.

## What was rejected

- **One file for both classes**, with `verify` skipping re-scannable rows. Rejected: the log balloons
  with git and file data, `verify` walks past it all to check a fraction, and the store that must be
  trustworthy is mixed with re-derivable rows. The operator chose the sibling file for exactly these
  reasons.
- **No class field — everything attested, git included.** Rejected: it chains data git already
  attests, bloats the chain irreversibly, and makes a re-ingest (which re-writes commit nodes) look
  like tampering to `verify`.
- **A wholly separate database for re-scannable data.** Rejected as premature: a sibling JSONL file
  in the same directory reuses the store's existing path resolution and workspace stamp, and adds no
  dependency. If scale ever demands an index, that is a later decision with its own record.
- **Making `nodeClass` default to `re-scannable`.** Rejected: it would silently reclassify the 38
  existing attested records and drop them off the chain. Defaulting to `attested` is what makes this
  change additive and the existing data correct untouched.

## What this constrains

- `log.jsonl` never holds a `re-scannable` record, and `derived.jsonl` never holds an `attested` one.
  A test asserts both directions.
- `verify` reads `log.jsonl` only. A re-scannable node can be added, changed by re-ingest, or removed
  without affecting the chain verdict, and a test proves a tampered *attested* record beside a
  re-scannable one is still caught.
- A re-scannable node must carry the source id it is rebuilt from (commit hash, file path), so
  re-ingest is idempotent and a stale node can be replaced.
- Purge operates on `log.jsonl` only. It is an error, not a silent no-op, to purge a re-scannable
  node — the remedy for re-scannable data is to change git, not to purge.

## How to reverse it

The field is additive and defaulted, so removing the *distinction* is cheap — every record reverts
to attested and re-scannable ingest is simply not run. Reversing the *file split* after
`derived.jsonl` holds data means re-homing it into `log.jsonl`, which is the same one-file design
this record rejected and would need superseding. The class field itself is the load-bearing part and
is meant to stand.
