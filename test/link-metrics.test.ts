import { describe, expect, test } from 'bun:test';
import { byFamily, judge, marginSplit, scoreLinking, type Judged } from '../eval/link-metrics';
import { MENTIONS, IN_STORE, NIL, RECORDS } from '../eval/linking';
import { link } from '../src/extract/link';
import type { LinkResult } from '../src/extract/link';

/** Phase 12. Every number here is hand-computed, so the metric is checked and not just executed. */

const res = (
  verdict: LinkResult['verdict'],
  candidates: { id: string; score: number }[],
  margin: number | null,
): LinkResult => ({
  mention: 'm', verdict, margin,
  candidates: candidates.map((c) => ({ id: c.id, name: c.id, score: c.score })),
});

describe('judge — facts about one result, decided by nothing', () => {
  test('the gold record`s rank is 1-based, and null when it is not a candidate at all', () => {
    const r = res('ranked', [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.5 }], 0.4);
    expect(judge('m', 'a', 'exact', r).goldRank).toBe(1);
    expect(judge('m', 'b', 'exact', r).goldRank).toBe(2);
    expect(judge('m', 'zzz', 'exact', r).goldRank).toBeNull();
  });

  test('a NIL mention has no rank, and carries the verdict that decides whether it was right', () => {
    const j = judge('m', null, 'nil-far', res('no_candidates', [], null));
    expect(j.goldRank).toBeNull();
    expect(j.verdict).toBe('no_candidates');
    expect(j.top).toBeNull();
  });
});

describe('scoreLinking — hand-computed', () => {
  const judged: Judged[] = [
    // gold at rank 1
    { mention: 'a', gold: 'x', family: 'exact', verdict: 'ranked', goldRank: 1, top: 'x', topScore: 0.9, margin: 0.5 },
    // gold at rank 2 — inside k=3, not top-1
    { mention: 'b', gold: 'y', family: 'partial', verdict: 'ranked', goldRank: 2, top: 'z', topScore: 0.8, margin: 0.1 },
    // gold at rank 5 — reachable, outside k=3
    { mention: 'c', gold: 'w', family: 'partial', verdict: 'ranked', goldRank: 5, top: 'z', topScore: 0.8, margin: 0.2 },
    // gold not a candidate — lost by the generator
    { mention: 'd', gold: 'v', family: 'reworded', verdict: 'ranked', goldRank: null, top: 'z', topScore: 0.4, margin: 0.1 },
    // NIL, answered correctly
    { mention: 'e', gold: null, family: 'nil-far', verdict: 'no_candidates', goldRank: null, top: null, topScore: null, margin: null },
    // NIL, answered wrongly
    { mention: 'f', gold: null, family: 'nil-near', verdict: 'ranked', goldRank: null, top: 'z', topScore: 0.3, margin: 0.05 },
  ];

  test('every count is what a person gets counting by hand', () => {
    const s = scoreLinking(judged, 3);
    expect(s).toEqual({
      inStore: 4,          // a, b, c, d
      recallAtAny: 3,      // a, b, c — d's gold is not a candidate
      recallAtK: 2,        // a (rank 1), b (rank 2); c is rank 5
      k: 3,
      top1: 1,             // a only
      nil: 2,              // e, f
      nilCorrect: 1,       // e only — f is 'ranked', neither no_candidates nor weak
      weakButRight: 0,     // no row here is both correct and weak
      missed: ['d'],
    });
  });

  test('recallAtAny and top1 are separate, because one is unrecoverable and the other is not', () => {
    const s = scoreLinking(judged, 3);
    // b's gold is reachable but mis-ranked — a better scorer fixes it.
    // d's gold was never a candidate — nothing downstream can fix it.
    expect(s.recallAtAny).toBeGreaterThan(s.top1);
    expect(s.missed).toEqual(['d']);
  });

  test('an empty set scores zero rather than dividing by zero', () => {
    expect(scoreLinking([], 3)).toEqual({
      inStore: 0, recallAtAny: 0, recallAtK: 0, k: 3, top1: 0, nil: 0, nilCorrect: 0,
      weakButRight: 0, missed: [],
    });
  });
});

describe('marginSplit — the measurement DEC-014 rests on', () => {
  test('separation is the median margin when right minus when wrong, hand-computed', () => {
    const judged: Judged[] = [
      { mention: '1', gold: 'x', family: 'e', verdict: 'ranked', goldRank: 1, top: 'x', topScore: 0.9, margin: 0.40 },
      { mention: '2', gold: 'x', family: 'e', verdict: 'ranked', goldRank: 1, top: 'x', topScore: 0.9, margin: 0.20 },
      { mention: '3', gold: 'x', family: 'e', verdict: 'ranked', goldRank: 1, top: 'x', topScore: 0.9, margin: 0.60 },
      { mention: '4', gold: 'y', family: 'e', verdict: 'ranked', goldRank: 2, top: 'z', topScore: 0.9, margin: 0.05 },
      { mention: '5', gold: 'y', family: 'e', verdict: 'ranked', goldRank: 2, top: 'z', topScore: 0.9, margin: 0.15 },
    ];
    const m = marginSplit(judged);
    expect(m.correctCount).toBe(3);
    expect(m.wrongCount).toBe(2);
    expect(m.medianWhenCorrect).toBe(0.40);          // median of [0.20, 0.40, 0.60]
    expect(m.medianWhenWrong).toBeCloseTo(0.10, 10); // mean of [0.05, 0.15]
    expect(m.separation).toBeCloseTo(0.30, 10);
  });

  test('separation is null when one side has no cases, rather than a misleading zero', () => {
    const onlyRight: Judged[] = [
      { mention: '1', gold: 'x', family: 'e', verdict: 'ranked', goldRank: 1, top: 'x', topScore: 0.9, margin: 0.4 },
    ];
    expect(marginSplit(onlyRight).separation).toBeNull();
    expect(marginSplit([]).separation).toBeNull();
  });

  test('NIL mentions are excluded — they have no gold to be right or wrong about', () => {
    const judged: Judged[] = [
      { mention: 'n', gold: null, family: 'nil-far', verdict: 'ranked', goldRank: null, top: 'z', topScore: 0.3, margin: 0.9 },
    ];
    expect(marginSplit(judged).correctCount).toBe(0);
    expect(marginSplit(judged).wrongCount).toBe(0);
  });
});

describe('byFamily — a single number cannot hide which kind of mention fails', () => {
  test('counts top-1 for gold-bearing families and no_candidates for NIL families', () => {
    const judged: Judged[] = [
      { mention: 'a', gold: 'x', family: 'exact', verdict: 'ranked', goldRank: 1, top: 'x', topScore: 0.9, margin: 0.5 },
      { mention: 'b', gold: 'y', family: 'exact', verdict: 'ranked', goldRank: 3, top: 'z', topScore: 0.9, margin: 0.5 },
      { mention: 'c', gold: null, family: 'nil-near', verdict: 'no_candidates', goldRank: null, top: null, topScore: null, margin: null },
      { mention: 'd', gold: null, family: 'nil-near', verdict: 'ranked', goldRank: null, top: 'z', topScore: 0.2, margin: 0.1 },
    ];
    const f = byFamily(judged);
    expect(f.get('exact')).toEqual({ total: 2, top1: 1, nilCorrect: 0 });
    expect(f.get('nil-near')).toEqual({ total: 2, top1: 0, nilCorrect: 1 });
  });
});

describe('the labelled set itself', () => {
  test('every gold id exists in RECORDS, so no label can be unreachable by construction', () => {
    const ids = new Set(RECORDS.map((r) => r.id));
    const dangling = MENTIONS.filter((m) => m.gold !== null && !ids.has(m.gold));
    expect(dangling).toEqual([]);
  });

  test('the set has real NIL coverage — without it, only the easy half is measured', () => {
    // A linker that always answers something scores perfectly on a set with no NIL mentions.
    expect(NIL.length).toBeGreaterThanOrEqual(5);
    expect(NIL.length / MENTIONS.length).toBeGreaterThan(0.2);
    expect(IN_STORE.length + NIL.length).toBe(MENTIONS.length);
  });

  test('no two mentions are the same string, so no row is counted twice', () => {
    expect(new Set(MENTIONS.map((m) => m.mention)).size).toBe(MENTIONS.length);
  });

  test('the nil-near family really is near — each one DOES draw candidates', () => {
    // "Near" has to be measured by the mechanism that generates candidates, not by eye. A first
    // version compared whitespace-split words and failed on "the deploy freeze policy", because the
    // records say "pre-deploy" as one token while the blocker splits hyphens — the test was stricter
    // than the thing it was describing. What makes a nil-near mention a trap is that it produces
    // candidates and still has no referent, so that is what is asserted.
    for (const m of MENTIONS.filter((x) => x.family === 'nil-near')) {
      const got = link(m.mention, RECORDS).candidates.length;
      expect({ mention: m.mention, drawsCandidates: got > 0 }).toEqual({ mention: m.mention, drawsCandidates: true });
    }
  });

  test('the harness runs end to end and the headline numbers hold', () => {
    // A regression guard on the measurement itself, not a target. If these move, something changed
    // in the linker and the phase summary's figures are stale.
    const judged = MENTIONS.map((m) => judge(m.mention, m.gold, m.family, link(m.mention, RECORDS)));
    const s = scoreLinking(judged, 3);
    expect(s.inStore).toBe(17);
    expect(s.nil).toBe(7);
    expect(s.recallAtAny).toBe(17);           // candidate generation loses nothing
    expect(s.top1).toBe(16);       // Phase 17: acronym expansion recovered "the SLO doc"
    // Phase 15 took this from 1/7 to 5/7 with a score threshold; Phase 16 switched to a margin
    // and reached 6/7 while halving the soft cost. Neither dropped a candidate.
    expect(s.nilCorrect).toBe(6);
    expect(s.weakButRight).toBe(1);           // the soft cost, and it is recoverable
    expect(marginSplit(judged).separation).toBeGreaterThan(0);
  });
});
