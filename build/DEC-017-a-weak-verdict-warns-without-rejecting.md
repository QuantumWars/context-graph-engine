# DEC-017 — Linking gains a `weak` verdict and one calibrated constant, and still never rejects a candidate

_Decided 2026-08-20 · status: current — amends `DEC-014`, which stays current in every other respect_

`DEC-014` said linking reports ranked candidates, never decides identity from a score, and
**introduces no constant**. It also named its own reversal condition:

> Any future NIL threshold arrives with the labelled set that calibrates it and supersedes this
> record; it may not be added as a default parameter.

Phase 12 built that set and measured the consequence of having no threshold: **the reject option
answered 1 of 7**. This record is that reversal, and it is narrower than `DEC-014` anticipated.

**A fourth verdict, `weak`,** when the top candidate scores below `LINK_WEAK_SCORE`.

**`LINK_WEAK_SCORE = 0.3`, calibrated** by `eval/link-sweep.ts` and recalibrated after any change to
the scorer.

**No candidate is ever dropped.** `weak` labels the result; the full ranked list is returned
unchanged. Linking still never rejects.

**Everything else in `DEC-014` stands** — reporting over deciding, the margin reported and never
thresholded, no identity claim from a score, and `no_candidates` and `tie` remaining threshold-free
facts.

## Why

**Because 1 of 7 is not a defensible reject option.** `no_candidates` only fires when blocking finds
nothing whatever, and blocking is generous by design, so almost every mention that refers to nothing
still got an answer. That is a worse failure than the one `DEC-014` was protecting against.

**Because the sweep says a threshold helps and cannot separate.** Twelve score cuts, six margin cuts
and six combinations:

```
none (today)   kept 15/17  nil 0/7  total 62.5%
score < 0.30   kept 13/17  nil 5/7  total 75.0%   <- best
score < 0.34   kept 11/17  nil 6/7  total 70.8%
margin < 0.05  kept 11/17  nil 5/7  total 66.7%   <- every margin rule is worse
```

A correct answer scores as low as **0.081** and a mention referring to nothing as high as **0.495**.
The populations overlap, so 0.30 is the best of a bad set and not a boundary between two things.

**Because that overlap is the whole argument for labelling instead of rejecting.** A hard cut at
0.30 would silence two correct answers — *"no friday releases"* at 0.081 and *"the follow the sun
rota"* at 0.293, both rewordings, both exactly the cases a linker exists to catch. Labelling costs
neither: measured, `weak` took NIL handling from **1/7 to 5/7 with Top-1 unchanged at 15/17**. The
two correct answers it also flags are reported as `weakButRight`, and the caller can still see and
take them.

**Because the margin stays a report.** It was the obvious candidate for this rule and the sweep says
it is worse than the top score at every setting. `DEC-014`'s decision to report it rather than
threshold it survives its own calibration.

## What was rejected

- **A hard reject below the threshold**, which is `semantica`'s rule (`entity_linker.py:128,404`,
  default 0.8, `similarity >= threshold` or the candidate is dropped). Rejected on measurement: it
  destroys two correct rewordings and still misses two NILs. Their 0.8 is defensible for their
  scorer, whose range is compressed — unrelated companies score 0.656 there — which is the whole
  reason a threshold cannot be copied between scorers.
- **A margin-based rule.** Rejected: every margin cut scored below every useful score cut.
- **Leaving it at 1/7 and calling it principled.** Rejected: `DEC-014` set a condition for
  revisiting, the condition was met, and declining to act would make the condition decoration.
- **Superseding `DEC-014` wholesale.** Rejected: only the no-constant clause needed to move. A
  record that gets replaced when one clause of it is wrong teaches the next session that decisions
  are disposable.

## What this constrains

- `weak` may never remove a candidate. A test asserts the candidate list is identical either side of
  the verdict.
- `LINK_WEAK_SCORE` is the only constant this feature may hold, and it carries a `PROVENANCE:
  calibrated` note naming the run. `constants-gate` enforces the note; a test enforces that it is
  the only one.
- Any change to `src/resolve/similarity.ts` invalidates it, exactly as a scoring change invalidated
  the retrieval floors twice. Re-run `eval/link-sweep.ts`.
- The MCP and CLI surfaces must present `weak` as a warning, not as an answer — a model reading
  `verdict: "weak"` beside a ranked list will otherwise take rank 1 regardless.

## How to reverse it

Cheap: nothing is stored and no candidate is dropped, so removing the verdict restores `DEC-014`'s
behaviour exactly, at the measured cost of returning to 1/7. Moving further — to a hard reject —
needs the two rewordings above answered for, and this record superseded rather than amended.
