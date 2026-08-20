# DEC-015 — A merged view is composed at read time, with one rule and every disagreement reported

_Decided 2026-08-20 · status: current_

`DEC-012` made a merge an assertion that several records name one thing, and made reads resolve to
the canonical. That left a gap the comparison with `semantica` exposed: **the other members'
content is invisible.** If two records describe the same incident and each carries a detail the
other lacks, a read gets only the canonical's.

**`mergedView(id)` composes the members' content and is never stored.** It resolves the merge,
reads every live member, and returns one composed object together with the disagreements.

**One composition rule, stated once: the canonical wins.** A field present on the canonical takes
the canonical's value. A field absent there is taken from the other members. There is no strategy
option.

**Every disagreement is reported, not silently resolved.** A field where members hold different
values appears in `conflicts` with each value and the member ids holding it — *and* the composed
object still carries the canonical's value, so a caller who ignores conflicts gets a defined answer
rather than a hole.

**A purged member contributes nothing and is named.** It appears in `unavailable`, so a thin view is
distinguishable from a complete one.

## Why

**Because the alternative is a second store.** Semantica's `MergeStrategyManager` produces a *new
merged entity*, which then has to live somewhere and be kept in step with its sources. `DEC-007`
forbids a persisted derived copy for exactly this reason, and `DEC-012` already applied it to
clusters. Composing at read time means purging a member changes the view immediately, with nothing
to rewrite and nothing to miss.

**Because one rule beats five strategies here.** `semantica` offers `keep_first`, `keep_last`,
`keep_most_complete`, `keep_highest_confidence` and `merge_all`, plus per-property overrides. That
is five behaviours to test and five ways for two callers to read the same store and disagree. This
engine's merge already names a canonical — the caller chose which record is authoritative when they
asserted the identity, and re-litigating that per field at read time would make the answer depend on
configuration rather than on what was recorded.

**Because a merge is an identity claim, not a confidence score.** `keep_highest_confidence` needs a
confidence on every record, and `DEC-013` refused to invent one.

**Because reporting the conflict is the whole value.** Two records disagreeing about the same field
is a fact worth surfacing — it is often the reason the merge was wrong. Semantica records conflicts
too, and that is the part worth taking.

## What was rejected

- **Storing the composed entity.** Rejected: it is a derived copy, `DEC-007`'s core objection, and
  purge would have to reach it.
- **A strategy option** (`keep_most_complete` and friends). Rejected: the canonical is already the
  caller's answer to "which one is authoritative", and a per-read strategy makes one store give two
  answers.
- **Silently resolving conflicts by recency or completeness.** Rejected: the disagreement is
  information, and resolving it quietly is how a wrong merge stops being visible.
- **Omitting a conflicted field from the composed object.** Rejected: a caller who does not read
  `conflicts` would get a hole where the canonical had a perfectly good value.
- **Deep-merging nested objects.** Rejected for now: field-level composition is defined and testable,
  and a deep merge invents a policy for arrays that nothing here needs yet.
- **Composing across a retracted member.** Not rejected — a retraction says the claim stopped being
  true, not that the record is gone, so its content still composes. Stated because it is the
  opposite of the purge case and the two are easy to conflate.

## What this constrains

- `mergedView` writes nothing. A test asserts the log is byte-identical across a call.
- The composed object may never be appended to the store by any path.
- A record with no merge returns its own content and an empty conflict list, so callers need no
  special case.
- Every conflict names the member ids holding each value; a conflict without provenance is useless
  for deciding whether the merge was right.

## How to reverse it

Cheap. Nothing is stored, so removing or changing the composition rule affects no data on disk and
invalidates no digest. Adding a strategy option later is additive, though it would need this
record superseded and would reintroduce the two-callers-two-answers problem it was rejected for.
