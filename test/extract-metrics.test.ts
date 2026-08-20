import { describe, expect, test } from 'bun:test';
import { byFamily, judgeText, relKey, scoreExtraction, type EmittedRelation, type TextOutcome } from '../eval/extract-metrics';
import { ALL, GOLD_COUNT, NEGATIVE, POSITIVE } from '../eval/extraction';
import { extract } from '../src/extract/rules';
import { resolveSpan, type Span } from '../src/extract/span';
import type { GoldRelation } from '../eval/extraction';

/** Phase 13. Every count here is worked out by hand, so the metric is checked and not just run. */

const g = (predicate: GoldRelation['predicate'], subject: string, object: string): GoldRelation =>
  ({ predicate, subject, object });
const e = (predicate: string, subject: string, object: string): EmittedRelation =>
  ({ predicate, subject, object });

describe('judgeText — strict triple matching, hand-computed', () => {
  test('a triple counts only when predicate, subject AND object all match', () => {
    const gold = [g('CAUSED', 'the deploy', 'the outage')];
    expect(judgeText('t', 'f', gold, [e('CAUSED', 'the deploy', 'the outage')]).truePositives).toBe(1);
    // wrong predicate
    expect(judgeText('t', 'f', gold, [e('INFLUENCED', 'the deploy', 'the outage')]).truePositives).toBe(0);
    // wrong subject span
    expect(judgeText('t', 'f', gold, [e('CAUSED', 'deploy', 'the outage')]).truePositives).toBe(0);
    // wrong object span
    expect(judgeText('t', 'f', gold, [e('CAUSED', 'the deploy', 'outage')]).truePositives).toBe(0);
  });

  test('a REVERSED relation is wrong, not half right', () => {
    // A graph with a backwards causal edge is worse than one missing it, so there is no credit.
    const gold = [g('CAUSED', 'the deploy', 'the outage')];
    const o = judgeText('t', 'f', gold, [e('CAUSED', 'the outage', 'the deploy')]);
    expect(o.truePositives).toBe(0);
    expect(o.falsePositives).toHaveLength(1);
    expect(o.falseNegatives).toHaveLength(1);
  });

  test('emitting the same triple twice cannot inflate recall', () => {
    const gold = [g('CAUSED', 'a', 'b')];
    const o = judgeText('t', 'f', gold, [e('CAUSED', 'a', 'b'), e('CAUSED', 'a', 'b')]);
    expect(o.truePositives).toBe(1);
    expect(o.falsePositives).toHaveLength(1);      // the duplicate is a false positive
    expect(o.falseNegatives).toHaveLength(0);
  });

  test('silence is only credited where silence was correct', () => {
    expect(judgeText('t', 'f', [], []).silent).toBe(true);
    expect(judgeText('t', 'f', [], [e('CAUSED', 'a', 'b')]).silent).toBe(false);
    // A positive text that emitted nothing is NOT "silent" — it is a miss.
    const missed = judgeText('t', 'f', [g('CAUSED', 'a', 'b')], []);
    expect(missed.silent).toBe(false);
    expect(missed.falseNegatives).toHaveLength(1);
  });

  test('relKey distinguishes the three fields it is built from', () => {
    expect(relKey(g('CAUSED', 'a', 'b'))).not.toBe(relKey(g('CAUSED', 'b', 'a')));
    expect(relKey(g('CAUSED', 'a', 'b'))).not.toBe(relKey(g('INFLUENCED', 'a', 'b')));
  });
});

describe('scoreExtraction — hand-computed', () => {
  const outcomes: TextOutcome[] = [
    // one gold, found
    judgeText('a', 'stated', [g('CAUSED', 'x', 'y')], [e('CAUSED', 'x', 'y')]),
    // one gold, missed
    judgeText('b', 'stated', [g('CAUSED', 'p', 'q')], []),
    // one gold, found, plus one spurious
    judgeText('c', 'stated', [g('CAUSED', 'm', 'n')], [e('CAUSED', 'm', 'n'), e('CAUSED', 'm', 'z')]),
    // negative, silent — correct
    judgeText('d', 'negative', [], []),
    // negative, fired — costs precision only
    judgeText('e', 'negative', [], [e('CAUSED', 'r', 's')]),
  ];

  test('the counts are what a person gets counting by hand', () => {
    const s = scoreExtraction(outcomes);
    expect(s.gold).toBe(3);              // a, b, c
    expect(s.emitted).toBe(4);           // a:1 + c:2 + e:1
    expect(s.truePositives).toBe(2);     // a, c
    expect(s.falsePositives).toBe(2);    // c's spurious, e's
    expect(s.falseNegatives).toBe(1);    // b
    expect(s.precision).toBeCloseTo(2 / 4, 10);
    expect(s.recall).toBeCloseTo(2 / 3, 10);
    expect(s.f1).toBeCloseTo((2 * 0.5 * (2 / 3)) / (0.5 + 2 / 3), 10);
  });

  test('a negative text contributes to precision and NOT to recall', () => {
    // Removing the firing negative must raise precision and leave recall untouched. That is the
    // whole reason negatives are treated this way, so it is asserted rather than assumed.
    const without = scoreExtraction(outcomes.filter((o) => o.id !== 'e'));
    const with_ = scoreExtraction(outcomes);
    expect(without.precision).toBeGreaterThan(with_.precision);
    expect(without.recall).toBe(with_.recall);
  });

  test('silence is reported apart, so an extractor that emits nothing cannot look good', () => {
    const s = scoreExtraction(outcomes);
    expect(s.negatives).toBe(2);
    expect(s.silent).toBe(1);
    expect(s.silenceRate).toBeCloseTo(0.5, 10);

    // The point of keeping it separate: emitting nothing at all gives perfect silence and zero F1.
    const mute = ALL.map((t) => judgeText(t.id, t.family, t.gold, []));
    const m = scoreExtraction(mute);
    expect(m.silenceRate).toBe(1);
    expect(m.f1).toBe(0);
  });

  test('empty input scores zero rather than NaN', () => {
    const s = scoreExtraction([]);
    expect(s.precision).toBe(0);
    expect(s.recall).toBe(0);
    expect(s.f1).toBe(0);
    expect(Number.isNaN(s.f1)).toBe(false);
  });
});

describe('byFamily — one number cannot hide which kind of text fails', () => {
  test('families are scored independently', () => {
    const outcomes = [
      judgeText('a', 'stated', [g('CAUSED', 'x', 'y')], [e('CAUSED', 'x', 'y')]),
      judgeText('b', 'negative', [], [e('CAUSED', 'r', 's')]),
    ];
    const f = byFamily(outcomes);
    expect(f.get('stated')!.recall).toBe(1);
    expect(f.get('negative')!.silenceRate).toBe(0);
    expect(f.get('negative')!.falsePositives).toBe(1);
  });
});

describe('the labelled set itself', () => {
  test('most of it is negative, because a positive-only set cannot see finding A-8', () => {
    // An extractor that fires on everything scores 100% recall on a set with no negatives.
    expect(NEGATIVE.length).toBeGreaterThan(POSITIVE.length);
    expect(POSITIVE.length + NEGATIVE.length).toBe(ALL.length);
    expect(GOLD_COUNT).toBeGreaterThan(0);
  });

  test('no two texts are the same string, and every id is unique', () => {
    expect(new Set(ALL.map((t) => t.text)).size).toBe(ALL.length);
    expect(new Set(ALL.map((t) => t.id)).size).toBe(ALL.length);
  });

  test('every gold subject and object is a literal substring of its text', () => {
    // Otherwise a label could never be matched, and recall would be capped by the set, not the code.
    for (const t of ALL) {
      for (const rel of t.gold) {
        expect({ id: t.id, subjectPresent: t.text.includes(rel.subject) })
          .toEqual({ id: t.id, subjectPresent: true });
        expect({ id: t.id, objectPresent: t.text.includes(rel.object) })
          .toEqual({ id: t.id, objectPresent: true });
      }
    }
  });

  test('the negated and question families contain a PAST-TENSE trigger, not only an infinitive', () => {
    // Measured 2026-08-20: "did not cause" and "Did ... cause?" are missed because English puts the
    // verb in the infinitive there, which has nothing to do with polarity. Without a past-tense row
    // those families would be credited for an accident of grammar. This asserts the trap is present.
    const polarity = ALL.filter((t) => t.family === 'negative-negated' || t.family === 'negative-question');
    const pastTense = polarity.filter((t) => /\bcaused\b/i.test(t.text));
    expect(pastTense.length).toBeGreaterThanOrEqual(2);
  });

  test('the harness runs end to end and the headline numbers hold', () => {
    // A regression guard on the measurement. If these move, the extractor changed and the phase
    // summary's figures are stale.
    const quote = (span: Span, text: string): string => {
      const r = resolveSpan(span, { content: { text } });
      return r.ok ? r.quote : `<${r.reason}>`;
    };
    const outcomes = ALL.map((t) => judgeText(t.id, t.family, t.gold,
      extract(t.id, t.text).map((x) => ({
        predicate: x.predicate, subject: quote(x.subject, t.text), object: quote(x.object, t.text),
      }))));
    const s = scoreExtraction(outcomes);
    // Phase 14 moved these. Polarity took false positives to zero and silence to complete; the one
    // remaining miss is the parenthetical subject, which is a rule-coverage gap and not a polarity
    // one — measured as 0 relations AND 0 suppressed.
    expect(s.falsePositives).toBe(0);
    expect(s.silent).toBe(18);
    expect(s.negatives).toBe(18);
    expect(s.silenceRate).toBe(1);
    expect(s.truePositives).toBe(14);
    expect(s.recall).toBeCloseTo(14 / 15, 10);
    expect(s.precision).toBe(1);
  });
});
