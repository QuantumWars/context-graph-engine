import { describe, expect, test } from 'bun:test';
import { fuse, FusionError, RRF_K, type Candidate, type Channel } from '../src/retrieval/rrf';

/**
 * The REJECTED algorithm, implemented here and nowhere in src/, so the test can prove the
 * defect is real rather than merely absent. This is `_rank_and_merge`'s core from
 * semantica/semantica/context/context_retriever.py: normalise each source to [0,1] on its own
 * min and max, then combine.
 */
function minMaxFuse(channels: readonly Channel[]): { id: string; score: number }[] {
  const acc = new Map<string, number>();
  for (const ch of channels) {
    const scores = ch.results.map((r) => r.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    for (const r of ch.results) {
      const norm = max === min ? 1 : (r.score - min) / (max - min);
      acc.set(r.id, Math.max(acc.get(r.id) ?? 0, norm));
    }
  }
  return [...acc.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

const c = (id: string, score: number): Candidate => ({ id, score });

describe('fuse — the paper, faithfully', () => {
  test('score is the sum of 1/(k+rank) with 1-based ranks', () => {
    const out = fuse([{ name: 'a', results: [c('x', 9), c('y', 8)] }]);
    expect(out[0]!.fusedScore).toBeCloseTo(1 / (RRF_K + 1), 12);
    expect(out[1]!.fusedScore).toBeCloseTo(1 / (RRF_K + 2), 12);
  });

  test('agreement across channels beats a single first place', () => {
    // The property k exists to produce: a candidate ranked 2nd twice outscores one ranked
    // 1st once, because coordinated support beats one outstanding vote.
    const out = fuse([
      { name: 'lex', results: [c('solo', 1), c('both', 1)] },
      { name: 'struct', results: [c('other', 1), c('both', 1)] },
    ]);
    expect(out[0]!.id).toBe('both');
  });

  test('k is the documented default and is applied when omitted', () => {
    expect(RRF_K).toBe(60);
    const withDefault = fuse([{ name: 'a', results: [c('x', 1)] }]);
    const explicit = fuse([{ name: 'a', results: [c('x', 1)] }], 60);
    expect(withDefault[0]!.fusedScore).toBe(explicit[0]!.fusedScore);
  });

  test('an empty input fuses to an empty result rather than throwing', () => {
    expect(fuse([])).toEqual([]);
    expect(fuse([{ name: 'a', results: [] }])).toEqual([]);
  });

  test('ordering is total and reproducible — ties break by id', () => {
    const ch: Channel[] = [{ name: 'a', results: [c('b', 1)] }, { name: 'z', results: [c('a', 1)] }];
    expect(fuse(ch).map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('fuse — closes A-6: absolute quality survives', () => {
  test('an excellent candidate beats the best of a uniformly poor channel', () => {
    // One channel found nothing useful; the other found something excellent. Under RRF the
    // excellent one wins. Under per-source min-max the poor channel's best is promoted to
    // 1.0 and ties it — which is exactly what A-6 describes.
    const channels: Channel[] = [
      { name: 'poor', results: [c('junk-a', 0.02), c('junk-b', 0.01)] },
      { name: 'good', results: [c('excellent', 0.98), c('ok', 0.40)] },
    ];

    // Anti-vacuity FIRST: prove the rejected algorithm really does get this wrong on this
    // exact input, so a pass means "we fixed it" rather than "the fixture is toothless".
    const bad = minMaxFuse(channels);
    expect(bad[0]!.score).toBe(1);
    expect(bad.filter((r) => r.score === 1).map((r) => r.id).sort())
      .toEqual(['excellent', 'junk-a']);

    // And now ours. The junk channel's best does not tie the excellent one.
    const good = fuse(channels);
    const rank = (id: string): number => good.findIndex((f) => f.id === id);
    expect(rank('excellent')).toBeLessThan(rank('junk-a'));
    expect(good[0]!.id).toBe('excellent');
  });

  test('nothing anywhere in the output has been normalised to 1.0', () => {
    const out = fuse([{ name: 'poor', results: [c('only', 0.001)] }]);
    // The channel's own score is retained verbatim; the fused score is an RRF value, which
    // can never be 1.0 for any positive k.
    expect(out[0]!.contributions[0]!.score).toBe(0.001);
    expect(out[0]!.fusedScore).toBeLessThan(1);
  });
});

describe('fuse — every item can explain its own ranking', () => {
  const channels: Channel[] = [
    { name: 'lexical', results: [c('a', 12.5), c('b', 3.1)] },
    { name: 'structural', results: [c('b', 0.9)] },
  ];

  test('each contribution carries its channel, 1-based rank and ORIGINAL score', () => {
    const out = fuse(channels);
    const b = out.find((f) => f.id === 'b')!;
    expect(b.contributions).toEqual([
      { channel: 'lexical', rank: 2, score: 3.1, rrf: 1 / (RRF_K + 2) },
      { channel: 'structural', rank: 1, score: 0.9, rrf: 1 / (RRF_K + 1) },
    ]);
  });

  test('the fused score is exactly the sum of its contributions', () => {
    for (const item of fuse(channels)) {
      const summed = item.contributions.reduce((s, x) => s + x.rrf, 0);
      expect(item.fusedScore).toBeCloseTo(summed, 12);
    }
  });

  test('a multi-channel hit keeps BOTH contributions, not just the last', () => {
    // Fix for the original's last-list-wins reconstruction.
    const b = fuse(channels).find((f) => f.id === 'b')!;
    expect(b.contributions.map((x) => x.channel)).toEqual(['lexical', 'structural']);
  });
});

describe('fuse — bad input is a named error, never a silent ranking', () => {
  test('a candidate with no id is rejected with missing_id', () => {
    let code: string | undefined;
    try {
      fuse([{ name: 'a', results: [{ id: '', score: 1 }] }]);
    } catch (e) { code = (e as FusionError).code; }
    expect(code).toBe('missing_id');
  });

  test('the error names the channel and position, so it can be found', () => {
    expect(() => fuse([
      { name: 'lexical', results: [c('ok', 1)] },
      { name: 'structural', results: [c('ok', 1), { id: '', score: 1 }] },
    ])).toThrow(/"structural" position 2/);
  });

  test('one channel listing the same id twice is rejected', () => {
    let code: string | undefined;
    try {
      fuse([{ name: 'a', results: [c('x', 2), c('x', 1)] }]);
    } catch (e) { code = (e as FusionError).code; }
    expect(code).toBe('duplicate_id_in_channel');
  });

  test('a non-positive or non-finite k is rejected rather than dividing oddly', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      let code: string | undefined;
      try { fuse([{ name: 'a', results: [c('x', 1)] }], bad); }
      catch (e) { code = (e as FusionError).code; }
      expect(code).toBe('invalid_k');
    }
  });
});

describe('fuse — n channels, not two', () => {
  test('three channels fuse, which memory/src/recall.ts cannot express', () => {
    const out = fuse([
      { name: 'lexical', results: [c('x', 1)] },
      { name: 'structural', results: [c('x', 1)] },
      { name: 'recency', results: [c('x', 1)] },
    ]);
    expect(out[0]!.contributions).toHaveLength(3);
    expect(out[0]!.fusedScore).toBeCloseTo(3 / (RRF_K + 1), 12);
  });
});
