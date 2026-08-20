# PHASE 17 SUMMARY — Abbreviations — 2026-08-20

**No pre-written prompt**; acceptance clauses are stated per task.

## 1. Verdict

**Phase closed.** `abbreviation` is 2 of 2, Top-1 rose, and nothing regressed.

```
$ bun run --cwd engine check
 455 pass
 0 fail
 1248 expect() calls
Ran 455 tests across 29 files. [4.94s]

$ bun run --cwd engine eval:link
  ranking            Top-1        94.1%   16/17    (was 88.2%)
  the reject option  NIL flagged  85.7%    6/7     (unchanged)
  abbreviation       2/2 100.0%                    (was 1/2)
```

| | before | after |
|---|---|---|
| `abbreviation` | 1/2 | **2/2** |
| Top-1 | 15/17 · 88.2% | **16/17 · 94.1%** |
| NIL flagged | 6/7 | 6/7 — unchanged |
| Soft cost | 1 | 1 — unchanged |

---

## Task 17.1 — Decide whether a long form supports a short one

Acceptance: a rule with no dictionary and no constant; the negative case — a record that does *not*
support the acronym — asserted as firmly as the positive.

**The comparison: nothing to port, again.** Measured 2026-08-20 — `acronym`, `abbreviat`,
`initialism` and `alias` appear nowhere in `semantica`'s `entity_linker.py` or its
`similarity_calculator.py`. Every `alias` hit elsewhere in that repository is a **method alias in a
docstring** (`"Simple search (alias for retrieve)"`), checked rather than assumed.

**The research supplied the rule.** Schwartz & Hearst (2003) find `long form (SHORT)` pairs in
running text at 96% precision with no training data. **Only the matching half transfers**: we have
no such pattern, because the short form is in a mention and the long form is in a record, in two
different places. What transfers is their test for whether a candidate long form supports a short
one — every character in order, the first beginning a word, and characters may be matched *inside* a
word.

**Met.** `src/extract/acronym.ts`:

```
  SLO   vs "the service level objective document"     -> ["service","level","objective"]
  SLO   vs "the search indexer"                       -> null
  SLO   vs "the second quarter reliability review"    -> null
  CDN   vs "the CDN provider contract"                -> ["cdn"]
  GNAT  vs "Gcn5-related N-acetyltransferase"         -> ["gcn5","related"]
```

The last row is the paper's own hard case, and it is why the inside-a-word rule is kept: dropping it
turns that test red **and** stops a literal occurrence matching itself.

No constant. A short form is two or more characters — structural rather than tunable, since a
one-letter acronym is not one — and there is deliberately no upper bound.

---

## Task 17.2 — Expand per record, never globally

Acceptance: a record that does not support the acronym must score exactly as it would have without
it, asserted directly.

**Met.** `expandAgainst(mention, record.name)` runs inside the candidate loop:

```
expandAgainst("the SLO doc", "the service level objective document")
   "the service level objective doc"
expandAgainst("the SLO doc", "the search indexer")
   "the SLO doc"
```

A global expansion — resolve `SLO` once, then score every record against the expanded text — would
lift records the short form has nothing to do with. That is the same manufacturing-agreement failure
`DEC-018` rejected for types and finding A-8 is about for edges, and `DEC-019` records it as the
rejected alternative. Shown red: making `expandAgainst` fall back to the record's whole name turns
three tests red.

**No weight, no bonus, no dictionary.** Expanding the text lets the existing trigram scorer do the
work, which is why this phase introduces no constant to calibrate.

---

## Task 17.3 — Recalibrate, because the scorer changed

Acceptance: `DEC-018` requires a re-sweep after any scoring change; run it and report the result
whether or not it moves.

**Met, and it did not move:**

```
  none                nil 1/7  top-1 16/17  soft 0
  score < 0.30        nil 4/7  top-1 16/17  soft 1
  margin < 0.10       nil 6/7  top-1 16/17  soft 1   ◀ best
  margin < 0.15       nil 6/7  top-1 16/17  soft 3
```

`LINK_WEAK_MARGIN = 0.1` stands. Worth stating plainly because Phase 16 ran the same rule and the
answer *did* move — a constant surviving its recalibration is a result, not a formality.

---

## 2. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| per-record expansion | falling back to the record's whole name | red — 3 tests |
| the inside-a-word rule | matching initials only | red — 2 tests, including the paper's case |
| what counts as an acronym | treating any capitalised word as one | red |

## 3. Still open

- **`ambiguous` is 1/2**, now the only remaining ranking miss: *"the checkout problem"* ranks
  `proj-checkout-rewrite` above the gold `i-checkout`. Three records share the word and the phrase
  does not say which kind of thing it means — `problem` is not in `TYPE_NOUNS`, and adding it would
  not help, because no record is typed `problem` either.
- **`nil-near` is 4/5.** *"the search rewrite"* still reads confident.
- **The acronym rule has no negative-evidence test at scale.** It is asserted on hand-picked pairs;
  what would measure it is a labelled set of mentions containing short forms, which
  `eval/linking.ts` has exactly two of.
- **`TYPE_NOUNS` remains a hand-written vocabulary** (Phase 16).
- **The extraction parenthetical gap** (Phase 14) is untouched.
