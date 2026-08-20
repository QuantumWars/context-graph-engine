# PHASE 14 SUMMARY — Polarity: a clause must assert what its verb names — 2026-08-20

**No pre-written prompt**; acceptance clauses are stated per task.

## 1. Verdict

**Phase closed.** The false positives Phase 13 measured are gone, and this is the first change in
this build that an evaluation harness judged rather than an argument.

```
$ bun run --cwd engine check
 431 pass
 0 fail
 1195 expect() calls
Ran 431 tests across 28 files. [4.31s]

$ bun run --cwd engine eval:extract
    precision  100.0%   14/14 emitted were correct
    recall      93.3%   14/15 gold relations found
    F1          96.6%
    silent on  100.0%   18/18 texts that state no relation
```

| | Phase 13 | Phase 14 |
|---|---|---|
| Precision | 66.7% | **100%** |
| Silence | 61.5% | **100%** |
| False positives | 5 | **0** |
| Recall | 100% | 93.3% — one known gap, and not a polarity one |

---

## Task 14.1 — Suppress a match whose clause does not assert it

Acceptance: negation, hedging, counterfactual and questioned claims all emit nothing; a cue after
the verb, or governing a different clause, does not suppress; and no numeric constant is introduced.

**The comparison: there was nothing to port.** Measured 2026-08-20 — `negat`, `polarity`, `hedge`
and `speculat` appear **zero times** anywhere in `semantica/semantica/semantic_extract/`. Its
dependency extractor reads `acl`, `nsubj`, `dobj`, `conj` and `prep` from a spaCy parse and never
reads `neg`, so it ignores negation **with a full parse in hand**.

The research supplied the design instead: NegEx is trigger terms, pseudo-negation terms, termination
terms and a five-to-six-token scope, and its documented weakness is that fixed window.

**Met, and the window was designed out.** Measured:

```
EMIT                   "The friday deploy caused a checkout outage."
suppress [never]       "The friday deploy never caused the checkout outage."
suppress [may]         "The deploy may have caused the outage."
suppress [had]         "Had the deploy caused the outage, we would have rolled back."
suppress [whether]     "The report questions whether the migration caused the timeout."
EMIT                   "The deploy caused the outage, which was not detected for an hour."
EMIT                   "It is not raining and the deploy caused the outage."
```

The last two rows are the ones that matter: a cue **after** the verb, and a cue governing the
**other** clause, both leave the assertion standing.

The rule that matched reports the exact offset of the
verb, so scope is the clause the verb sits in — from the nearest boundary before it, up to it. No
token count, so **no constant**. Termination terms became clause boundaries; `DEC-016` records it.

---

## Task 14.2 — Prove it on cases the cue list was not built from

Acceptance: a held-out set that could refute the design, scored before promotion, with the result
reported whatever it is.

**Met, and it refuted the first version.** Ten sentences, none used to build the cue list:

```
held-out: 6/10          ← first version
held-out: 9/10          ← after pseudo-negation and the missing cues
```

**100% on the set that motivated the change was the result to distrust**, and the held-out score is
why. The four first-version failures split cleanly:

- **Two were pseudo-negation** — *"No one disputes that the deploy caused the outage"* asserts, and a
  cue list alone reads the leading "no". The research names these terms as part of the algorithm and
  the first version skipped them.
- **Two were missing cues** — `nothing`, and `had` for the counterfactual.

All ten are now promoted into `eval/extraction.ts` under `HELD_OUT`, so they guard against
regression, with a comment recording that they were held out at the time of measurement — otherwise
a later reader sees 10/10 and draws the wrong conclusion.

---

## Task 14.3 — Separate subject extent from polarity scope

Acceptance: both questions answered correctly by the same code, with a test that fails if one list
is used for both.

**Met.** Promoting the held-out cases exposed a second defect the emit-or-silent probe was too
lenient to see: the **strict** harness scored `pseudo-negation` at 0% precision *and* 0% recall,
because the emitted triple was wrong even though emitting was right.

```
emitted, not stated  CAUSED  "raining and the deploy" → "the outage"
emitted, not stated  CAUSED  "disputes that the deploy" → "the outage"
```

The subject pattern takes up to four words backwards with no notion of where the sentence changes
subject. `trimmedSubjectStart` cuts it at its own clause.

**The two boundary lists cannot be one list**, and this was measured rather than reasoned: `that`
must bound a *subject* — the subject of `caused` is `the deploy`, not `disputes that the deploy` —
and must **not** bound *polarity scope*, because a denial in the main clause does govern its
complement: *"Nobody believes that the deploy caused the outage"* is a denial. With one shared list,
whichever way it was written, one of the two broke. Both directions are asserted in one test.

---

## 2. The defect that made the whole thing a no-op

The first implementation scoped from the trigger span's start — and **the trigger span is the whole
match, which starts at the subject.** So the governing clause was always the empty string, no cue
could ever be found, and every polarity case still emitted.

```
"The friday deploy never caused the checkout outage."
  trigger starts at 0
  governingClause  = ""
  assertsRelation  = {"asserted":true,"cue":null}
```

The eval numbers did not move by a single point, which is what exposed it. Had the harness not
existed, a passing suite and a plausible module would have shipped a check that could not fire.
Worse, `never` was being captured *inside the subject*.

Fixed by giving every rule a `verb` named group, which is now required — `DEC-016` says a rule
without one degrades the check to always-assert, silently.

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| the polarity check | forcing `asserted: true` | red — 4 tests |
| two boundary lists | using `CLAUSE_BOUNDARY` for both | red — 2 tests |
| pseudo-negation | removing the strip | red — 3 tests |
| word-boundary cue matching | (covered by the `notice`/`verify` test) | asserted |

## 4. Still open

- **The parenthetical subject.** *"The audit, if thorough, informed the rewrite."* emits nothing —
  measured as **0 relations and 0 suppressed**, so the rule never matched and polarity is innocent;
  asked directly, `assertsRelation` returns true. It is the single recall miss, labelled
  `stated-parenthetical`, and it is a rule-coverage gap.
- **The cue lists are declared placeholders.** Hand-written in the families NegEx names, extended by
  the cases in the set. What would calibrate them is a labelled corpus of causal sentences with
  polarity annotations, which does not exist here.
- **`PSEUDO_CUES` is a hole in the negation check by construction.** Eight phrases today; every
  addition costs precision, which is why `DEC-016` requires each to be justified.
- **Precision 100% on 14 relations** is a small number, and the set is author-written. The held-out
  exercise is the strongest evidence here, and it is 9/10 rather than perfect.
- **Linking's reject option is still 14.3%** (Phase 12), and `DEC-014`'s reversal condition remains
  met and unacted on.
- Everything carried from Phase 13.
