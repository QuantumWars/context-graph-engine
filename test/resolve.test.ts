import { describe, expect, test } from 'bun:test';
import {
  block, blockKeys, capBySimilarity, soundex, tokens,
  MIN_TOKEN_LENGTH, TOKEN_PREFIX, type Pair,
} from '../src/resolve/blocking';
import { WEIGHTS, WEIGHT_TOTAL, jaccard, similarity, trigrams, type Candidate } from '../src/resolve/similarity';
import { cluster, merged } from '../src/resolve/cluster';
import { scoreBlocking } from '../eval/resolve-metrics';
import { DUPLICATES, RECORDS } from '../eval/duplicates';

const c = (id: string, name: string, type?: string, props?: Record<string, string>): Candidate =>
  type === undefined ? { id, name } : props === undefined ? { id, name, type } : { id, name, type, props };

describe('similarity — the weights live in exactly one place', () => {
  test('they sum to the stated total, so a change that forgets to restate it fails here', () => {
    // Finding A-12: the original's docstring names four weights and its signature uses four
    // different ones, presenting embedding similarity as the largest term while it is off.
    const sum = WEIGHTS.name + WEIGHTS.type + WEIGHTS.props;
    expect(sum).toBeCloseTo(WEIGHT_TOTAL, 12);
    expect(Object.keys(WEIGHTS).sort()).toEqual(['name', 'props', 'type']);
  });

  test('a perfect match on every component scores exactly the total', () => {
    const a = c('a', 'checkout outage', 'incident', { service: 'checkout' });
    const b = c('b', 'checkout outage', 'incident', { service: 'checkout' });
    expect(similarity(a, b).total).toBeCloseTo(WEIGHT_TOTAL, 12);
  });

  test('a missing component scores 0 rather than being dropped from the denominator', () => {
    // Renormalising over "the components we happen to have" is how a record with only a name
    // scores 1.0 against anything similarly named — the same shape as finding A-6.
    const s = similarity(c('a', 'checkout outage'), c('b', 'checkout outage'));
    expect(s.name).toBeCloseTo(1, 12);
    expect(s.type).toBe(0);
    expect(s.props).toBe(0);
    expect(s.total).toBeCloseTo(WEIGHTS.name, 12);
    expect(s.total).toBeLessThan(WEIGHT_TOTAL);
  });

  test('an unknown type is neither a match nor a mismatch', () => {
    expect(similarity(c('a', 'x', 'incident'), c('b', 'x')).type).toBe(0);
    expect(similarity(c('a', 'x', 'incident'), c('b', 'x', 'runbook')).type).toBe(0);
    expect(similarity(c('a', 'x', 'incident'), c('b', 'x', 'incident')).type).toBe(1);
  });

  test('trigrams tolerate a typo and a reordering that token equality would not', () => {
    expect(jaccard(trigrams('postgres'), trigrams('postgress'))).toBeGreaterThan(0.6);
    expect(jaccard(trigrams('jon smith'), trigrams('smith jon'))).toBeGreaterThan(0.5);
    expect(jaccard(trigrams('checkout'), trigrams('cafeteria'))).toBeLessThan(0.15);
  });

  test('two empty sets are identical, not disjoint', () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
  });
});

describe('blocking — one strategy, and it is the good one', () => {
  test('records sharing a token are candidates; records sharing nothing are not', () => {
    const rs = [c('a', 'checkout outage'), c('b', 'checkout timeout'), c('c', 'parking permit')];
    const keys = rs.map((r) => [...blockKeys(r)]);
    expect(keys[0]!.some((k) => keys[1]!.includes(k))).toBe(true);
    expect(keys[0]!.some((k) => keys[2]!.includes(k))).toBe(false);
  });

  test('there is no legacy first-letter mode to fall back to — finding A-11', () => {
    // The original defaults to `legacy`, which blocks on name[0]. Two records sharing only a
    // first letter must NOT become candidates here.
    const rs = [c('a', 'checkout outage'), c('b', 'cafeteria menu')];
    const shared = [...blockKeys(rs[0]!)].filter((k) => blockKeys(rs[1]!).has(k));
    expect(shared).toEqual([]);
    // And prove the first letters really are the same, or the assertion proves nothing.
    expect(rs[0]!.name[0]).toBe(rs[1]!.name[0] as string);
  });

  test('blocking really does reduce comparisons, by a stated number', () => {
    const r = block(RECORDS, { typeScoped: true, phonetic: true });
    expect(r.allPairs).toBe((RECORDS.length * (RECORDS.length - 1)) / 2);
    expect(r.compared).toBeLessThan(r.allPairs / 5);   // an order-of-magnitude claim, not a vibe
    expect(r.blocks).toBeGreaterThan(5);               // anti-vacuity: it really built blocks
  });

  test('a pair reachable through several keys is scored once', () => {
    const rs = [c('a', 'checkout outage', 'incident'), c('b', 'checkout outage', 'incident')];
    const r = block(rs, { typeScoped: true, phonetic: true });
    expect(r.compared).toBe(1);
  });

  test('tokens shorter than the minimum are dropped, and a name of only short words survives', () => {
    expect(tokens('a of id')).toEqual(['aofid']);         // nothing survives, so the whole name
    expect(tokens('checkout of the outage')).toEqual(['checkout', 'the', 'outage']);
    expect(MIN_TOKEN_LENGTH).toBe(3);
    expect(TOKEN_PREFIX).toBe(4);
  });

  test('a nameless record does not silently join every block', () => {
    const keys = [...blockKeys(c('x', '  '))];
    expect(keys).toEqual(['nameless:']);
  });
});

describe('the cap keeps the most similar, not the lowest-indexed', () => {
  // A clique, so every record has more candidates than the cap allows and something must be
  // dropped. The true pair is `mm-target`/`zz-true`, which sorts LAST from both ends — so an
  // index-ordered cap sheds it from both sides and the union cannot rescue it.
  //
  // The first version of this fixture was a star, and it proved nothing: each spoke had one
  // edge, kept it, and the union preserved everything regardless of ordering. The test passed
  // the wrong way round until the fixture was rebuilt.
  const ids = ['aa', 'bb', 'cc', 'dd', 'mm-target', 'zz-true'];
  const pairs: Pair[] = ids.flatMap((a, i) =>
    ids.slice(i + 1).map((b) => ({
      a, b,
      score: (a === 'mm-target' && b === 'zz-true') ? 0.95 : 0.1 + i / 100,
    })),
  );

  /** What the original does: `sorted(neighbors)[:max]` — insertion/lexical order, not score. */
  function capByIndex(ps: readonly Pair[], max: number): readonly Pair[] {
    const byRecord = new Map<string, Pair[]>();
    for (const p of ps) for (const id of [p.a, p.b]) {
      const arr = byRecord.get(id); if (arr === undefined) byRecord.set(id, [p]); else arr.push(p);
    }
    const kept = new Set<string>();
    for (const [, list] of byRecord) {
      list.sort((x, y) => (`${x.a} ${x.b}` < `${y.a} ${y.b}` ? -1 : 1));
      for (const p of list.slice(0, max)) kept.add(`${p.a} ${p.b}`);
    }
    return ps.filter((p) => kept.has(`${p.a} ${p.b}`));
  }

  const truePair = (ps: readonly Pair[]): boolean =>
    ps.some((p) => p.a === 'mm-target' && p.b === 'zz-true');

  test('index-ordered capping DROPS the true match — the ported behaviour, proven', () => {
    // Anti-vacuity: the pair really is in the input, so its absence is the cap and not the fixture.
    expect(truePair(pairs)).toBe(true);
    expect(truePair(capByIndex(pairs, 2))).toBe(false);
  });

  test('similarity-ordered capping KEEPS it', () => {
    expect(truePair(capBySimilarity(pairs, 2))).toBe(true);
  });

  test('a cap of 0 or undefined keeps everything, rather than dropping everything', () => {
    expect(pairs.length).toBe(15);                       // a 6-record clique
    expect(capBySimilarity(pairs, undefined)).toHaveLength(pairs.length);
    expect(capBySimilarity(pairs, 0)).toHaveLength(pairs.length);
  });

  test('the cap is not a hard degree bound, and that is deliberate', () => {
    // A pair survives if EITHER endpoint keeps it. A popular record can exceed the cap, because
    // dropping a pair the other side ranked first would lose a match to a work bound.
    const hub: Pair[] = [
      { a: 'hub', b: 'x1', score: 0.9 }, { a: 'hub', b: 'x2', score: 0.8 },
      { a: 'hub', b: 'x3', score: 0.7 }, { a: 'hub', b: 'x4', score: 0.6 },
    ];
    expect(capBySimilarity(hub, 2).length).toBeGreaterThanOrEqual(2);
  });
});

describe('soundex — coarse on purpose, and the cost is visible', () => {
  test('spelling variants after the first letter collide', () => {
    expect(soundex('smith')).toBe(soundex('smyth'));
    expect(soundex('oleary')).toBe(soundex('olery'));
  });

  test('LIMITATION: a differing FIRST letter never collides, however alike the sound', () => {
    // Soundex keeps the initial letter literally, so `catherine` is C365 and `katherine` is
    // K365. This is Soundex working as specified, not a porting error, and it is the reason the
    // labelled pair `per-5a`/`per-5b` is recovered by its SURNAME rather than its forename.
    // Asserted so nobody "fixes" the code expecting the forenames to match.
    expect(soundex('catherine')).not.toBe(soundex('katherine'));
    expect(soundex('catherine').slice(1)).toBe(soundex('katherine').slice(1));
  });

  test('it over-collides, which is the price of the recall it buys', () => {
    // Measured, not assumed: `forty` and `friday` share a code. In the eval set that accident
    // recovers a true duplicate, which is luck rather than the mechanism working.
    expect(soundex('forty')).toBe(soundex('friday'));
  });

  test('an empty or non-alphabetic word yields an empty code, not a crash', () => {
    expect(soundex('')).toBe('');
    expect(soundex('123')).toBe('');
  });
});

describe('clustering — transitivity, with its cost shown', () => {
  test('A~B and B~C merges all three even when A is plainly not C', () => {
    // The risk, demonstrated rather than described. Similarity is not transitive.
    const ids = ['jon-smith', 'j-smith', 'jane-smith'];
    const pairs: Pair[] = [
      { a: 'j-smith', b: 'jon-smith', score: 0.72 },
      { a: 'j-smith', b: 'jane-smith', score: 0.70 },
    ];
    // And the two ends genuinely are not similar — or the fixture proves nothing.
    expect(similarity(c('jon-smith', 'jon smith'), c('jane-smith', 'jane smith')).total)
      .toBeLessThan(0.6);

    const cs = merged(cluster(ids, pairs, 0.65));
    expect(cs).toHaveLength(1);
    expect(cs[0]!.members).toEqual(['j-smith', 'jane-smith', 'jon-smith']);
  });

  test('the cluster names the weakest link holding it together', () => {
    const ids = ['a', 'b', 'c'];
    const pairs: Pair[] = [
      { a: 'a', b: 'b', score: 0.95 },
      { a: 'b', b: 'c', score: 0.66 },
    ];
    const cl = merged(cluster(ids, pairs, 0.65))[0]!;
    expect(cl.weakestLink?.score).toBeCloseTo(0.66, 12);
    expect(cl.merges).toBe(2);
  });

  test('raising the threshold breaks the chain — the only lever that actually helps', () => {
    const ids = ['a', 'b', 'c'];
    const pairs: Pair[] = [{ a: 'a', b: 'b', score: 0.95 }, { a: 'b', b: 'c', score: 0.66 }];
    expect(merged(cluster(ids, pairs, 0.65))).toHaveLength(1);
    expect(merged(cluster(ids, pairs, 0.70))[0]!.members).toEqual(['a', 'b']);
  });

  test('a singleton has no weakest link and no merges', () => {
    const cl = cluster(['solo'], [], 0.5)[0]!;
    expect(cl).toMatchObject({ id: 'solo', members: ['solo'], weakestLink: null, merges: 0 });
  });

  test('an edge inside an already-merged cluster is not counted as a merge', () => {
    const pairs: Pair[] = [
      { a: 'a', b: 'b', score: 0.9 }, { a: 'b', b: 'c', score: 0.9 }, { a: 'a', b: 'c', score: 0.9 },
    ];
    expect(merged(cluster(['a', 'b', 'c'], pairs, 0.5))[0]!.merges).toBe(2);
  });
});

describe('metrics — hand-computed', () => {
  test('PC, PQ, RR and FM on a worked example', () => {
    // 2 true pairs; blocker proposes 4, of which 1 is true; all-pairs would be 10.
    const truth = [{ a: 'a', b: 'b' }, { a: 'c', b: 'd' }];
    const cand = [{ a: 'a', b: 'b' }, { a: 'a', b: 'e' }, { a: 'b', b: 'e' }, { a: 'c', b: 'e' }];
    const s = scoreBlocking(cand, truth, 10);
    expect(s.pc).toBeCloseTo(1 / 2, 12);      // 1 of 2 true pairs survived
    expect(s.pq).toBeCloseTo(1 / 4, 12);      // 1 of 4 candidates was true
    expect(s.rr).toBeCloseTo(1 - 4 / 10, 12); // 60% of comparisons avoided
    expect(s.fm).toBeCloseTo((2 * 0.5 * 0.25) / 0.75, 12);
    expect(s.missed).toEqual(['c d']);         // named, not just counted
  });

  test('pair order does not matter', () => {
    const s = scoreBlocking([{ a: 'b', b: 'a' }], [{ a: 'a', b: 'b' }], 1);
    expect(s.pc).toBe(1);
  });

  test('a dataset with no duplicates has perfect recall, stated rather than zero', () => {
    expect(scoreBlocking([{ a: 'a', b: 'b' }], [], 3).pc).toBe(1);
  });
});

describe('blocking on the labelled set', () => {
  test('phonetic keys are what lift recall to complete — and one of them is luck', () => {
    const all = (RECORDS.length * (RECORDS.length - 1)) / 2;
    const withoutPho = scoreBlocking(block(RECORDS, { typeScoped: true }).pairs, DUPLICATES, all);
    const withPho = scoreBlocking(block(RECORDS, { typeScoped: true, phonetic: true }).pairs, DUPLICATES, all);

    expect(withoutPho.pc).toBeLessThan(1);
    expect(withPho.pc).toBe(1);

    // Of the two pairs phonetic recovers, ONE is a real name variant and one is an accidental
    // code collision (`forty` / `friday`). Recording that stops "PC 100%" being read as
    // "the mechanism works", which is the claim the number does not support.
    expect([...withoutPho.missed].sort()).toEqual(['hard-9a hard-9b', 'per-5a per-5b']);
    expect(soundex('forty')).toBe(soundex('friday'));
  });

  test('blocking beats all-pairs on effort by an order of magnitude, at full recall', () => {
    const all = (RECORDS.length * (RECORDS.length - 1)) / 2;
    const s = scoreBlocking(block(RECORDS, { typeScoped: true, phonetic: true }).pairs, DUPLICATES, all);
    expect(s.rr).toBeGreaterThan(0.9);
    expect(s.pc).toBe(1);
    expect(s.pq).toBeGreaterThan(base(all).pq * 10);
  });

  function base(all: number): { pq: number } {
    const cand = RECORDS.flatMap((r, i) => RECORDS.slice(i + 1).map((s) => ({ a: r.id, b: s.id })));
    return scoreBlocking(cand, DUPLICATES, all);
  }
});
