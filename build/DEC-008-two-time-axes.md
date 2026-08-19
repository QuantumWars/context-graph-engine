# DEC-008 — Carry both time axes: valid time on the record, transaction time from the log

_Decided 2026-08-19 · status: current_

Every record carries **three** temporal fields, not two:

| Field | Axis | Supplied by | Nullable |
|---|---|---|---|
| `validFrom` | valid time, inclusive lower bound | the caller | yes — unbounded |
| `validUntil` | valid time, inclusive upper bound | the caller | yes — unbounded |
| `recordedAt` | transaction time | the engine, at append | **no** |

`stateAt` takes a point on each axis: `validAt` (required) and `asOf` (optional). **Transaction
time is applied first**, then valid time, then the endpoint rule.

A malformed or ambiguous bound **excludes** the record and appends a reason code to the
snapshot's `rejected` list. It never widens a window.

## Why

SQL:2011 separates *valid time* — when a fact holds in the world, application-supplied — from
*transaction time* — when the store recorded it, system-supplied. Bitemporal means both.
Semantica's comments describe its windows as bitemporal but it carries only valid time, so the
question "what did the store believe in March?" has no answer there.

For a context engine that is the more important of the two questions. A decision made in March
on March's information is not wrong because April corrected the record, and a snapshot that
applies April's knowledge to a March decision misrepresents every past decision it explains.
Precedent retrieval has the same shape: the precedent that should have been found is the one
that existed at the time.

The second axis is nearly free. Algorithm 1's append-only log already orders records by
insertion, so `recordedAt` is transaction time and `asOf` is a truncation of the input. No
second store, no history table, no versioning scheme — the structure built for tamper evidence
carries the transaction axis as a side effect.

The ordering rule is not cosmetic: applying valid time first would let a record written in June
influence a snapshot of what was believed in March.

Chosen from the standard's definition, cross-checked against the questions in
`ARCHITECTURE.md` §1. Full sources and the evidence caveat: `engine/docs/research/02-temporal-windows.md`.

## What was rejected

- **Valid time only, as Semantica has it.** Rejected: it cannot answer what the store believed
  at a past instant, which is the question that explains a past decision.
- **Treating a malformed bound as no bound**, which is what `context_graph.py:142-170` does
  while logging "treating node as Always-Active". Rejected, and it is the reason this record
  exists: the consequence runs backwards, since a corrupted timestamp makes a record *more*
  visible and a record that should have expired never does.
- **Reading a date-time with no offset as UTC.** Rejected as `ambiguous_timezone`: if the value
  was local, the record silently moves by hours. A date-only value is still accepted as UTC
  midnight, because that is a stated convention rather than a guess.
- **Ignoring an inverted window.** Rejected: such a record can never be active, so it is a
  defect in whatever wrote it, and an invisible record with no stated reason is its own bug.
- **A separate history table for transaction time**, as SQL:2011 system-versioning implies.
  Rejected: the log already is one, and a second copy would violate `DEC-005`'s single-store
  rule and give purge a second place to reach.
- **Making `asOf` required.** Rejected: the common query is "what is true now", and forcing
  every caller to name a belief instant would make the ordinary case awkward to serve the rare
  one.

## What this constrains

- No record may be appended without a `recordedAt`. There is no nullable path, because a
  record with no transaction time is invisible to every `asOf` query and would silently reduce
  the second axis to decoration.
- `stateAt` must apply transaction time before valid time. A reordering is a correctness bug,
  not a refactor.
- An unusable `validAt` or `asOf` argument is an error, never an empty snapshot — an empty
  result reads as "nothing was active then", which is a different and false statement.
- The endpoint rule stands: an edge is admitted only when its own window is open and both
  endpoints are active. Nothing may return a snapshot containing a dangling edge.

## How to reverse it

Dropping transaction time means every `asOf` query loses its meaning and every stored
`recordedAt` becomes dead weight — cheap in code, but it discards history that cannot be
reconstructed afterwards, so it is effectively one-way. Adding a third axis, such as decision
time, is additive and would be a new record rather than an amendment to this one.
