# Research — Algorithm 2, bitemporal windows and `stateAt`

**Ran:** 2026-08-19, Phase 1 Task 1.2, after the port and before the design was fixed.
**Method:** built-in `WebSearch`.

> **Evidence caveat.** Came through a search-result summarisation layer — one hop from the
> source, not zero. Good enough to design from, not good enough to quote. Nothing below is
> presented as a verbatim quotation; spot-check against the URL before quoting elsewhere.

## The question

Semantica's `ContextNode` and `ContextEdge` carry `valid_from` and `valid_until`, and the
surrounding comments describe the result as bitemporal. Is it, and if not, does the second
axis pay for itself here?

## What the standard actually separates

**SQL:2011** defines two independent time dimensions and gives each its own table type:

- **Valid time** — the period during which a row correctly reflects reality. Supplied by the
  application. SQL:2011 calls these *application-time period tables*.
- **Transaction time** — the period during which a row was recorded in the database.
  Supplied by the system. SQL:2011 calls these *system-versioned tables*.

**Bitemporal means both.** A table with only one of them is temporal, not bitemporal.

By that definition Semantica's windows are **valid time only**: `valid_from` and
`valid_until` are caller-supplied, and nothing records when the graph learned a fact. The
description in its comments is a misnomer, not a defect — the code does what it does
correctly, it is just one axis short of the word.

## Why the second axis is worth having here specifically

The two axes answer different questions, and for a context engine the difference is the
whole product:

- *What was true at time T?* — valid time.
- *What did the store believe at time T?* — transaction time.

An agent explaining a past decision needs the second one. A decision made in March on the
information available in March is not wrong because April corrected the record, and a
snapshot that silently applies April's knowledge to March's decision makes every past
decision look better or worse than it was. Retrieval of precedent has the same shape: the
precedent that should have been found is the one that existed at the time.

## Why it is nearly free

Algorithm 1 already gives us the axis. The append-only log orders records by insertion, so a
`recordedAt` on each record is transaction time, and `asOf` truncates the input to what had
been recorded by that instant before any valid-time filter runs. No second store, no history
table, no versioning scheme — the structure built for tamper evidence turns out to carry the
transaction axis as a side effect.

The one rule this imposes: **transaction time is applied before valid time.** Reversed, a
record written in June could influence a snapshot of what was believed in March.

## Carried over unchanged, because it was right

**The endpoint rule.** `context_graph.py:2596-2601` admits an edge only when its own window
is open *and* both endpoints are active. This is the rule that makes a snapshot a view of
something rather than a filtered list: without it a snapshot can contain an edge pointing at
a node that is not in the snapshot.

**Inclusive bounds, unbounded on null.** As in `context_graph.py:333-350`.

## Changed — failing closed rather than open

`_parse_iso_dt` returns `None` on an unparseable value (`context_graph.py:142-170`), and
`is_active` then imposes no bound at all, logging that it is "treating node as
Always-Active". The consequence is backwards: a corrupted timestamp makes a record **more**
visible, and a record that should have expired never does.

`DEC-003` already forbids silent temporal coercion, so this port fails closed — an unusable
bound excludes the record and appends a reason code to `rejected`. Excluded *and named*, not
excluded silently, because an invisible record with no explanation is its own bug.

Two further tightenings, both consequences of the same rule:

- A date-time with **no offset** is rejected as `ambiguous_timezone` rather than read as UTC.
  Reading a local timestamp as UTC shifts a record by hours, which is a wrong answer wearing
  the shape of a right one. A date-only value is still accepted, as UTC midnight, because
  that is a stated convention rather than a guess.
- An **inverted window** — start after end — is reported. Semantica does not check it. Such a
  record can never be active, so it is a defect in whatever wrote it, and the difference
  between a record that is invisible and a record that is invisible *for a reason someone can
  read* is the whole of `HARD RULE 4`.

## Sources

One hop from source; spot-check before quoting.

- [Temporal features in SQL:2011 (Kulkarni & Michels)](https://cs.ulb.ac.be/public/_media/teaching/infoh415/tempfeaturessql2011.pdf)
- [Bitemporal modeling — overview](https://grokipedia.com/page/Bitemporal_modeling)
- [Bitemporal Modeling — Software Patterns Lexicon](https://softwarepatternslexicon.com/bitemporal-modeling/temporal-data-patterns/bitemporal-modeling/)
