import { describe, expect, test } from 'bun:test';
import { CORPUS, EDGES, QUERIES } from '../eval/dataset';
import { engineArm, lexicalOnlyArm, returnAllArm, runArm } from '../eval/harness';

/**
 * The dataset is data, and data rots silently. A typo in a labelled id turns a hit into a miss
 * and lowers the score for a reason nobody will look for.
 */

describe('the labelled set is internally consistent', () => {
  const ids = new Set(CORPUS.map((r) => r.id));

  test('every corpus id is unique', () => {
    expect(ids.size).toBe(CORPUS.length);
  });

  test('every labelled relevant id exists in the corpus', () => {
    const missing = QUERIES.flatMap((q) => q.relevant.filter((id) => !ids.has(id)).map((id) => `${q.id}:${id}`));
    expect(missing).toEqual([]);
  });

  test('every labelled irrelevant id exists in the corpus', () => {
    const missing = QUERIES.flatMap((q) => (q.irrelevant ?? []).filter((id) => !ids.has(id)).map((id) => `${q.id}:${id}`));
    expect(missing).toEqual([]);
  });

  test('every edge endpoint exists in the corpus', () => {
    const bad = EDGES.filter((e) => !ids.has(e.source) || !ids.has(e.target));
    expect(bad).toEqual([]);
  });

  test('no query labels an id as both relevant and irrelevant', () => {
    const contradictions = QUERIES.filter((q) => (q.irrelevant ?? []).some((id) => q.relevant.includes(id)));
    expect(contradictions.map((q) => q.id)).toEqual([]);
  });

  test('the set is big enough to mean anything, and every query carries its reasoning', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(30);
    expect(QUERIES.length).toBeGreaterThanOrEqual(15);
    for (const q of QUERIES) expect(q.note.length).toBeGreaterThan(20);
  });

  test('at least three queries expect nothing — abstention is graded, not assumed', () => {
    expect(QUERIES.filter((q) => q.relevant.length === 0).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the harness discriminates between arms', () => {
  // If every arm scored the same, the harness would be measuring nothing.
  const engine = runArm(engineArm, { k: 10 });
  const lexical = runArm(lexicalOnlyArm, { k: 10 });
  const all = runArm(returnAllArm, { k: 10 });

  test('the deliberately terrible baseline scores worst, by a wide margin', () => {
    expect(all.score).toBeLessThan(lexical.score);
    expect(all.score).toBeLessThan(engine.score);
    expect(engine.score - all.score).toBeGreaterThan(0.3);
  });

  test('the engine beats the single-channel baseline', () => {
    // If this ever goes red, the structural channel and the fusion are costing complexity for
    // nothing. That is a finding about the engine, not a reason to weaken the baseline.
    expect(engine.score).toBeGreaterThan(lexical.score);
  });

  test('the engine abstains on every query that should return nothing', () => {
    const shouldAbstain = engine.perQuery.filter(({ query }) => query.relevant.length === 0);
    expect(shouldAbstain.length).toBeGreaterThanOrEqual(3);
    for (const { query, returned } of shouldAbstain) {
      expect({ q: query.id, returned }).toEqual({ q: query.id, returned: [] });
    }
  });

  test('the calibrated floor is locked in — a regression to the old value fails here', () => {
    // LEXICAL_FLOOR was 0.01 and scored 0.509. It is 0.4 and scores 0.819. This pins the gain
    // so a future change that quietly reinstates the old behaviour cannot pass unnoticed.
    expect(engine.score).toBeGreaterThan(0.75);
    expect(engine.report.falseServe).toBe(0);
    expect(engine.report.precision).toBeGreaterThan(0.7);
  });
});
