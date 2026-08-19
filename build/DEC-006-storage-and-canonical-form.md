# DEC-006 — Store one append-only log and hash each record over canonical JSON, not over concatenated fields

_Decided 2026-08-19 · status: superseded by DEC-007_

> **Superseded the same day**, after Task 1.1's research step. The store format, the
> canonical form and every rejected alternative below still stand and are restated in
> `DEC-007`. The single clause that changed is *which fields the digest covers*: this
> record said every field except `digest`, which makes erasure impossible without
> breaking the chain. `DEC-007` hashes a salted commitment to the content instead.
> Nothing here was edited but this line and this note.

**Format.** One append-only file, `log.jsonl`, UTF-8, one JSON object per line, each line
terminated by `\n`. It is the only source of truth. Records are discriminated by a `kind`
field: node, edge, decision, retraction, tombstone, retrieval-decision. Every derived view —
the node table, the adjacency index, the decision lookup, any lexical index — is **rebuilt on
load and never persisted beside the log**.

**Chain fields.** Every record carries `seq`, contiguous from 1 in append order; `prev`, the
digest of the record before it, `null` for the first; and `digest`, its own.

**Canonical form.** `digest = SHA-256(canonicalJson(record minus digest))`, where
`canonicalJson` is:

- object keys sorted ascending by UTF-16 code unit
- no insignificant whitespace anywhere
- UTF-8 output, minimal JSON string escaping
- `null` written explicitly; an absent field **omitted entirely**, and omission is therefore
  distinct from `null` and must be stable across a write and a reload
- integers written plainly; non-integers written by one fixed documented rule, settled by
  Task 1.1's research step rather than asserted here

**Every field except `digest` is hashed**, including `seq` and `prev`, so the chain link sits
inside the digest rather than beside it.

## Why

**One log, because two stores for one fact is the defect this build exists to close.**
Semantica writes a decision twice — as a graph node and as a plain dict — and an AST query
run this session over `semantica/semantica/context/context_graph.py` reproduces the
consequence exactly:

```
method                            mentions _decisions
------------------------------------------------------
save_to_file                                    False
load_from_file                                  False
purge_node                                      False
clear                                           False
record_decision                                  True
find_precedents_by_scenario                      True
```

So a saved graph loses precedent search on reload, and a purged decision stays searchable by
full text. A single log with rebuilt views makes that class of bug structurally impossible
rather than merely avoided, and it gives the hash chain one sequence space instead of several.

**Canonical JSON, because concatenation is ambiguous.** Semantica hashes by joining sixteen
fields with no separator at `semantica/semantica/provenance/integrity.py:74-116`, so the
field pair `("ab", "c")` and the pair `("a", "bc")` produce identical digests. JSON is
self-delimiting: `{"a":"ab","b":"c"}` and `{"a":"a","b":"bc"}` cannot collide, and sorting
keys removes the only remaining freedom. The fix is not a better separator; it is a
serialisation that cannot lose a boundary.

**Every field hashed, with no exclusions.** Semantica deliberately excludes `entity_id`
because its versioning archives a prior value by copying it under a new id, and hashing the
id would turn a legitimate rename into a permanent chain break — the reasoning is recorded at
`integrity.py:45-55`, along with what it costs: a row whose id is swapped while its content
is kept is no longer caught by the checksum. We do not inherit either side of that trade,
because we never relabel an id: records are immutable and a correction is a new record.
Having no exclusion is simpler to state and strictly stronger to verify.

## What was rejected

- **Unseparated field concatenation, as in `integrity.py:74-116`.** Rejected by name: two
  different records can hash identically, so the chain attests to less than it appears to.
- **A separator character instead of structured serialisation.** Rejected: any separator can
  appear inside a field value, so it moves the ambiguity rather than removing it, and
  escaping the separator reinvents serialisation badly.
- **Hashing `JSON.stringify(record)` directly.** Rejected: key order follows insertion order,
  so the same record hashed on two paths can differ, and the failure appears as tampering.
- **Separate files per record kind — `nodes.jsonl`, `edges.jsonl`, `provenance.jsonl`.**
  Rejected: it splits the chain across several sequence spaces, and a purge would then have to
  succeed in all of them to be complete, which is the A-2 shape again with more files.
- **A persisted index alongside the log for read speed.** Rejected: a persisted derived copy
  is a second store, so purge must reach it, and DEC-004 depends on purge being complete.
  Rebuild on load until a measurement says the rebuild is too slow.
- **SQLite instead of JSONL.** Rejected for now: an append-only log is directly inspectable
  with `command grep -a`, diffable, and trivially append-locked, and the engine has no query
  workload yet that justifies a query engine. This is the alternative most likely to be
  proposed again, and the honest reason is that no measurement yet argues for it.
- **Excluding the record id from the hash, as Semantica does.** Rejected: the reason for the
  exclusion is a versioning scheme we are not adopting.

## What this constrains

- Nothing may write a derived view to disk. A cache that survives a process is a second store.
- Record content is immutable once appended. Corrections append; they do not edit.
- The canonical serialiser is one function with one test suite, and every digest in the system
  goes through it. A second serialisation path is a defect.
- Because absence and `null` are distinct in the canonical form, every record type must fix
  which optional fields are omitted versus written as `null`, and a reload must reproduce that
  choice exactly or the digest changes and reads as tampering.
- Append order defines `seq`, so concurrent writers must be serialised — which is why DEC-001
  imports `withFileLock` rather than reimplementing it.

## How to reverse it

Changing the canonical form invalidates every digest ever written, so it is not a change but a
migration: re-hash the whole log under the new rule and record that the old chain cannot be
verified against the new one. Moving off JSONL to SQLite is a store rewrite plus a reader
migration, and should be triggered by a measurement of rebuild time against a real log, not by
preference. Splitting the single log into per-kind files reintroduces the A-2 failure class and
should not be done.
