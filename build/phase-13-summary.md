# PHASE 13 SUMMARY — An evaluation harness for extraction — 2026-08-20

**No pre-written prompt**, as in Phases 11 and 12; the acceptance clauses are stated per task.

## 1. Verdict

**Phase closed.** Extraction now has a labelled set, strict-matching metrics and a runner. The
older of the two harness gaps is closed.

```
$ bun run --cwd engine check
 415 pass
 0 fail
 1142 expect() calls
Ran 415 tests across 27 files. [4.29s]

$ bun run --cwd engine eval:extract
    precision   66.7%   10/15 emitted were correct
    recall     100.0%   10/10 gold relations found
    F1          80.0%
    silent on   61.5%   8/13 texts that state no relation
```

| | |
|---|---|
| A-8 defence | **confirmed** — `negative-cooccurrence` is 100% silent |
| Recall | **100%** — every stated relation found |
| Polarity | **not handled at all** — negation, hedging and embedded questions all fire |
| Found mid-phase | **two NUL bytes in source**, one of them shipped in Phase 10 |

---

## Task 13.1 — A labelled set where most texts should produce nothing

Acceptance: the labelling rule and its author stated at the top of the file; negatives outnumber
positives; and the hard negative families are proven hard rather than asserted to be.

**The comparison.** `semantica` has no labelled extraction set. Measured 2026-08-20: the single test
asserting `relations == []` is `test_empty_llm_response_returns_empty`, which feeds the parser
`{"relations": []}` — empty in, empty out. **It is a parser test, not a silence test. Nothing in
that repository asks an extractor to stay silent on text that states no relation**, which is
precisely the blind spot finding A-8 lives in: co-occurrence emits 45 edges from ten entities and no
test would notice.

The research says the same thing from the other direction: in standard sentence-level sets the
negative class is around four fifths of the data and is excluded from the headline micro-F1, so a
system is not rewarded for predicting it.

**Met.** `eval/extraction.ts`: 21 texts, **13 of them negative**, 10 gold relations. The rule fixes
the hard cases before any code runs — a negated statement, a hedged statement, a question and a
reported-then-rejected claim all state nothing, and direction is part of the claim.

Negatives contribute to **precision only**: no true positive, no false negative, and a cost if the
extractor fires. Silence is reported separately, because one number that rewarded silence would make
an extractor emitting nothing at all look excellent — asserted directly:

```ts
const mute = TEXTS.map((t) => judgeText(t.id, t.family, t.gold, []));
expect(scoreExtraction(mute).silenceRate).toBe(1);
expect(scoreExtraction(mute).f1).toBe(0);
```

---

## Task 13.2 — Strict matching, hand-computed

Acceptance: a triple counts only when predicate, subject and object all match; a reversed relation
scores zero rather than partial credit; duplicate emissions cannot inflate recall; every count in
the tests worked out by hand.

**Met.** `eval/extract-metrics.ts`, with the counts asserted against a five-row fixture:

```ts
expect(s.gold).toBe(3); expect(s.emitted).toBe(4);
expect(s.truePositives).toBe(2); expect(s.falsePositives).toBe(2); expect(s.falseNegatives).toBe(1);
```

A reversed relation is a false positive **and** a false negative — a graph with a backwards causal
edge is worse than one missing it. Shown red by making `relKey` order-insensitive.

---

## Task 13.3 — Measure the rules, and report what is actually wrong

Acceptance: run the real extractor over the set; report per-family so one number cannot hide which
kind of text fails; and where a family passes, establish that it passes for the reason claimed.

**Met, and the last clause changed the set.**

```
negative-cooccurrence  silence 100.0%
negative-narrative     silence 100.0%
negative-hedged        silence   0.0%  2 false positive(s)
negative-negated       silence  33.3%  2 false positive(s)
negative-question      silence  50.0%  1 false positive(s)
stated-*               recall 100.0%  precision 100.0%   (all four families)
```

### The families that passed for the wrong reason

The first run scored `negative-question` at 100% and `negative-negated` at 50%. Predicting *why*
before believing it, and then measuring:

```
0  "Did the friday deploy cause the checkout outage?"
1  "Did the friday deploy caused the checkout outage?"
0  "The friday deploy did not cause the checkout outage."
1  "The friday deploy never caused the checkout outage."
1  "The deploy may have caused the outage."
```

**Those texts pass because English puts the verb in the infinitive after "did" — nothing to do with
polarity.** The rules match `caused`, not `cause`. Change the verb form and the extractor fires
happily on a negation.

Two rows were added so the set measures the real thing rather than crediting an accident of grammar
— `"never caused"` and `"Whether the deploy caused the outage is still open."` **Precision fell from
76.9% to 66.7% and silence from 72.7% to 61.5%.** The extractor did not get worse; the set stopped
flattering it. A test now asserts the past-tense trap is present, so it cannot be removed quietly.

**The engine has no notion of polarity, mood or hedging.** It matches a trigger word wherever it
appears. That is the honest state of Phase 9's rules, now with a number on it.

---

## 2. The defect found by a mutation that killed nothing

A mutation making `relKey` order-insensitive should have turned the reversed-relation test red. **It
turned nothing red.** Rule 1 says the check is then the suspect, so the mutation was re-run with an
assertion that the edit had landed — and it had not: the pattern was not in the file.

```
NUL at byte 1437; context: `${r.predicate}\x00${r.subject}\x00${r.object}`;
```

**The two spaces inside a template literal were NUL bytes.** `grep` reports the file as
`Binary file … matches` and prints nothing; `file` calls it `data`; and the whole suite passes
throughout, because NUL is a valid character in a JavaScript string and works fine as a separator.

A sweep then found a second one, **shipped in Phase 10**: `src/extract/link.ts` had
`{ id: '\x00mention' }` where a leading space was intended. Functionally inert — the probe's id is
never compared — but it made that file invisible to `grep` too. It is now a named constant,
`MENTION_PROBE_ID = '(mention)'`, because a word is readable where whitespace is not.

**I do not know how the NULs were introduced.** They appeared in files this session edited through
shell heredocs, and I have not reproduced the mechanism. Saying so is better than inventing a cause.

A guard now sweeps every `.ts` file, and was shown red against an injected NUL, naming the file. The
monorepo constitution already documents this hazard for the memory store — records are NUL-joined,
so text tools classify them as binary and skip them silently. **Nobody had ever checked source.**

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| strict direction | `relKey` made order-insensitive | red — 2 tests |
| negatives affect precision only | letting silence count toward recall | red |
| the past-tense trap is present | deleting the two rows that carry it | red — 2 tests |
| **no NUL bytes in source** | injecting one NUL into a real file | red, naming the file |

## 4. Still open

- **Polarity, above.** Negation, hedging and embedded questions all produce false positives. This is
  the largest measured defect in extraction. Fixing it means either a negation-aware rule layer or a
  parser, and both are decisions rather than tweaks.
- **The `stated-*` families are at 100%**, which says more about rules written by the same session
  that wrote the sentences than about the rules. 10 gold relations is small.
- **Labels compare resolved quotes, not raw offsets.** Two different spans could in principle resolve
  to the same string; on these sentences they do not, and the file says so.
- **The set is synthetic and author-written**, the same weakness `eval/dataset.ts`,
  `eval/duplicates.ts` and `eval/linking.ts` all carry and all state.
- Everything carried from Phase 12, including linking's reject option at 14.3%.
