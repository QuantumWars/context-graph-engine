# DEC-019 — An acronym is expanded per record, and only against a record whose own name supports it

_Decided 2026-08-20 · status: current_

Phase 12 measured `abbreviation` at 1 of 2: *"the SLO doc"* ranked `svc-search` first while the gold
`doc-slo` — *"the service level objective document"* — sat at rank 2. Trigram similarity cannot
relate `SLO` to those three words, which is what trigrams are for and why they cannot do this.

**A short form is expanded against one record at a time**, using that record's own name as the long
form. It expands for records that support it and stays unexpanded for every other.

**Support is Schwartz & Hearst's matching rule**: every character of the short form appears in the
long form in order, and the first character begins a word. Matching a character *inside* a word is
kept, because that is what makes `GNAT` match *Gcn5-related N-acetyltransferase*.

**An acronym is an all-capital token of two or more characters.** No upper bound.

**No constant is introduced.**

## Why

**Because per-record expansion is what stops a short form lifting everything.** A global expansion —
resolve `SLO` once, then score every record against the expanded mention — would raise the score of
records that have nothing to do with it, which is the same manufacturing-agreement failure that
`DEC-018` rejected for types and finding A-8 is about for edges. Measured: with per-record
expansion, `svc-search` scores below 0.3 for *"the SLO doc"* exactly as it did before.

**Because the matching half of Schwartz & Hearst transfers and the extraction half does not.** Their
algorithm finds `long form (SHORT)` pairs in running text, reporting 96% precision with no training
data. We have no such pattern: the short form is in a mention and the long form is in a record, in
two different places. What transfers is the test for whether a candidate long form supports a short
one.

**Because nothing was available to port.** Measured 2026-08-20: `acronym`, `abbreviat`, `initialism`
and `alias` appear nowhere in `semantica`'s linker or similarity calculator, and every `alias` hit
elsewhere in that repository is a method alias in a docstring.

**Because the alternative needs a dictionary nobody has.** An acronym table would be a maintained
list that goes stale, would not cover a store's own coinages, and would need provenance for every
entry. The records already contain the expansions; the rule just has to find them.

## What was rejected

- **A global expansion**, resolved once and applied to every candidate. Rejected: it lifts records
  the short form has nothing to do with.
- **An acronym dictionary.** Rejected: it goes stale, misses local coinages, and each entry would
  need its own provenance. The store already holds the long forms.
- **A similarity bonus for an acronym match**, added to the score. Rejected: it needs a weight, and
  a weight needs calibration. Expanding the text instead lets the existing trigram scorer do the
  work with no new number.
- **Treating any capitalised word as a short form.** Rejected: `The` and `Acme` are not acronyms,
  and a mention beginning a sentence would be expanded against anything.
- **Initials-only matching**, without the inside-a-word rule. Rejected: it loses the paper's own
  worked example, and a literal occurrence of the short form stops matching itself.

## What this constrains

- Expansion is per record. A helper that expands a mention once, outside the candidate loop,
  reintroduces the rejected design.
- The scorer changed, so `LINK_WEAK_MARGIN` was recalibrated — `margin < 0.10` remained best. Any
  further change to scoring requires the same, per `DEC-018`.
- A record with no supporting long form must score exactly as it did before the mention contained an
  acronym at all. A test asserts this.

## How to reverse it

Cheap. Nothing is stored; removing the call restores the Phase 16 behaviour, at the measured cost of
Top-1 falling from 16/17 to 15/17 and `abbreviation` from 2/2 to 1/2.
