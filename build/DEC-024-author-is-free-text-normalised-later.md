# DEC-024 — A record carries an `author`, as free text, normalised later if drift demands it

_Decided 2026-08-20 · status: current_

The context-OS is a store shared between agents — Claude, and others such as Codex — and read by
all of them. "Who decided this" must be answerable, and the engine's `RecordMeta` has no field for
it today. Git supplies exactly this on every commit, and adding it is what lets a query separate
*what Codex decided* from *what Claude decided*.

**`RecordMeta` gains `author`, an optional free-text string.**

- On a **re-scannable** node ingested from git, `author` is the git author verbatim —
  `subha <subhapattnaik@theboringpeople.in>`.
- On an **attested** node an agent records, `author` is the agent's own identifier — `claude-opus`,
  `codex`, or whatever the writer supplies.
- It is **optional**: the 38 records already on disk have none, and absence is recorded as absence,
  never guessed.

**No fixed vocabulary is enforced now.** A later phase may normalise the field to a canonical set if
drift becomes a real problem, and that normalisation is a derived view over the free-text values,
never a rewrite of the records.

## Why

**Because the set of agents that will write here is not yet known.** A fixed enum has to enumerate
every writer before it writes, and a new agent is blocked until the list is updated. Free text lets
Codex, a future agent, or a human write without a schema change — which is the point of a shared
store.

**Because git authors do not fit an enum.** A commit's author is one of many real people and
identities. Forcing them into a short allowed-list would either reject real git history or flatten
every human to a single bucket. The git author string drops into free text unchanged.

**Because drift is a reporting problem, not a storage problem.** `claude` versus `Claude` versus
`claude-opus-4` is a real risk, and the honest place to fix it is a normalisation view computed at
read time — the same derived-and-never-stored pattern the whole engine uses (`DEC-012`, `DEC-013`).
Baking a canonical vocabulary into the write path now would lock in a guess about which agents exist
before any of them has written a record.

**Because absence must stay distinguishable from a value.** The existing records genuinely have no
author. Defaulting them to `unknown` or `legacy` would manufacture a claim about who wrote them. An
absent field says "not recorded", which is true, and is what an honest read reports.

## What was rejected

- **A fixed enum** — `claude | codex | human | git-import`. Rejected: it blocks a new agent until the
  list is edited, and git authors do not fit it. The operator chose free text for exactly this.
- **A required field with a default** for existing records. Rejected: it invents an author for 38
  records that have none, which is the fabrication `DEC`-level honesty forbids.
- **Normalising on write** — coercing `Claude` to `claude` as records land. Rejected: it is a lossy
  rewrite of what the writer actually said, and a read-time view achieves the same result without
  discarding the original.
- **A structured author object** (name, kind, version). Rejected as premature: nothing queries those
  sub-fields yet, and a string that a later view can parse is enough. Adding structure is a later
  decision if a query needs it.

## What this constrains

- `author` is never required and never defaulted. A record without one is valid, and a read that
  needs it reports its absence rather than a placeholder.
- No write path may coerce or reject an `author` value. Validation of the field is that it is a
  string; its content is the writer's to state.
- Any future canonical vocabulary is a **derived view** over the free-text values. It may not rewrite
  a record's stored `author`, for the same reason a merge does not rewrite its members (`DEC-012`).
- The field is inside `meta`, so it is inside the digest on an attested record and therefore
  attested — a claim about who wrote a decision cannot be altered without the chain noticing.

## How to reverse it

Additive and optional, so removing it affects no existing record and no guarantee. Moving to a fixed
vocabulary later is the expected evolution and needs only a superseding record plus the normalisation
view; it does not touch data already written, because the raw free-text value is retained and the
vocabulary sits above it.
