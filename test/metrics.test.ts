import { describe, expect, test } from 'bun:test';
import {
  aggregate, forbiddenHits, isFalseAbstain, isFalseServe, precisionAt, recallAt,
  reciprocalRank, score, type Cased,
} from '../eval/metrics';

/** Every expected value below is computed by hand in the comment beside it. */

describe('precision@k', () => {
  test('3 of the top 4 are relevant → 0.75', () => {
    expect(precisionAt({ returned: ['a', 'b', 'x', 'c'], relevant: ['a', 'b', 'c'] }, 4)).toBeCloseTo(0.75, 10);
  });
  test('k truncates before the miss: top 2 of the same list → 1.0', () => {
    expect(precisionAt({ returned: ['a', 'b', 'x', 'c'], relevant: ['a', 'b', 'c'] }, 2)).toBe(1);
  });
  test('returning nothing scores 0, not a division by zero', () => {
    expect(precisionAt({ returned: [], relevant: ['a'] }, 5)).toBe(0);
  });
});

describe('recall@k', () => {
  test('2 of 3 relevant found in the top 3 → 0.666…', () => {
    expect(recallAt({ returned: ['a', 'x', 'b'], relevant: ['a', 'b', 'c'] }, 3)).toBeCloseTo(2 / 3, 10);
  });
  test('the third arrives only at rank 5, so recall@3 misses it and recall@5 does not', () => {
    const j = { returned: ['a', 'x', 'b', 'y', 'c'], relevant: ['a', 'b', 'c'] };
    expect(recallAt(j, 3)).toBeCloseTo(2 / 3, 10);
    expect(recallAt(j, 5)).toBe(1);
  });
  test('nothing to find means nothing was missed → 1', () => {
    expect(recallAt({ returned: [], relevant: [] }, 5)).toBe(1);
  });
});

describe('reciprocal rank', () => {
  test('first relevant at rank 3 → 1/3', () => {
    expect(reciprocalRank({ returned: ['x', 'y', 'a'], relevant: ['a'] })).toBeCloseTo(1 / 3, 10);
  });
  test('first relevant at rank 1 → 1', () => {
    expect(reciprocalRank({ returned: ['a', 'x'], relevant: ['a'] })).toBe(1);
  });
  test('none returned → 0', () => {
    expect(reciprocalRank({ returned: ['x', 'y'], relevant: ['a'] })).toBe(0);
  });
});

describe('the two abstention failures are distinct', () => {
  test('served when it should have abstained', () => {
    const j = { returned: ['x'], relevant: [] };
    expect(isFalseServe(j)).toBe(true);
    expect(isFalseAbstain(j)).toBe(false);
  });
  test('abstained when something was there', () => {
    const j = { returned: [], relevant: ['a'] };
    expect(isFalseAbstain(j)).toBe(true);
    expect(isFalseServe(j)).toBe(false);
  });
  test('a correct abstention is neither', () => {
    const j = { returned: [], relevant: [] };
    expect(isFalseServe(j)).toBe(false);
    expect(isFalseAbstain(j)).toBe(false);
  });
});

describe('forbidden hits', () => {
  test('an explicitly-wrong id inside k is counted, outside k is not', () => {
    const j = { returned: ['a', 'bad', 'c'], relevant: ['a'] };
    expect(forbiddenHits(j, ['bad'], 3)).toEqual(['bad']);
    expect(forbiddenHits(j, ['bad'], 1)).toEqual([]);
  });
});

describe('aggregate — hand-computed over three cases', () => {
  // q1: returned [a,x], relevant [a,b]  → P@2 = 1/2, R@2 = 1/2, RR = 1
  // q2: returned [],    relevant [c]    → false abstain; excluded from P/R/MRR? No — it HAS
  //     a relevant set, so it counts: P@2 = 0, R@2 = 0, RR = 0
  // q3: returned [z],   relevant []     → false serve; excluded from P/R/MRR
  const cases: Cased[] = [
    { returned: ['a', 'x'], relevant: ['a', 'b'] },
    { returned: [], relevant: ['c'] },
    { returned: ['z'], relevant: [] },
  ];
  const r = aggregate(cases, 2);

  test('counts every query, but averages P/R/MRR over answerable ones only', () => {
    expect(r.queries).toBe(3);
    expect(r.precision).toBeCloseTo((0.5 + 0) / 2, 10);
    expect(r.recall).toBeCloseTo((0.5 + 0) / 2, 10);
    expect(r.mrr).toBeCloseTo((1 + 0) / 2, 10);
  });

  test('the abstention failures are counted separately, one of each', () => {
    expect(r.falseServe).toBe(1);
    expect(r.falseAbstain).toBe(1);
    expect(r.correctAbstain).toBe(0);
  });

  test('a correct abstention raises correctAbstain and neither failure', () => {
    const r2 = aggregate([{ returned: [], relevant: [] }], 2);
    expect(r2).toMatchObject({ falseServe: 0, falseAbstain: 0, correctAbstain: 1 });
  });

  test('averaging an abstain-query into precision would misreport — it does not', () => {
    // If q3 (correctly abstaining, precision 0) were averaged in, precision would drop to
    // 0.1666. That would score a CORRECT decision as a failure, which is the conflation these
    // metrics exist to avoid.
    const wrongWay = (0.5 + 0 + 0) / 3;
    expect(r.precision).not.toBeCloseTo(wrongWay, 6);
    expect(r.precision).toBeCloseTo(0.25, 10);
  });
});

describe('score', () => {
  test('perfect retrieval with no abstention errors → 1', () => {
    expect(score({ queries: 1, precision: 1, recall: 1, mrr: 1, falseServe: 0, falseAbstain: 0, forbidden: 0, correctAbstain: 0 })).toBe(1);
  });
  test('a false serve costs twice a false abstain — stated, and asserted', () => {
    const base = { queries: 1, precision: 1, recall: 1, mrr: 1, forbidden: 0, correctAbstain: 0 };
    const serve = score({ ...base, falseServe: 1, falseAbstain: 0 });
    const abstain = score({ ...base, falseServe: 0, falseAbstain: 1 });
    expect(1 - serve).toBeCloseTo(2 * (1 - abstain), 10);
  });
  test('zero precision and recall does not divide by zero', () => {
    expect(score({ queries: 1, precision: 0, recall: 0, mrr: 0, falseServe: 0, falseAbstain: 0, forbidden: 0, correctAbstain: 0 })).toBe(0);
  });
});
