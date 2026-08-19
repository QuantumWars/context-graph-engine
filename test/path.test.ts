import { describe, expect, test } from 'bun:test';
import { chainPath } from '../src/decision/path';
import { findChains, type CausalEdge } from '../src/decision/causal';

/**
 * The bug this guards: rendering an upstream chain of two or more hops repeated a node.
 * It was correct at one hop, which is why 254 tests and six phases did not catch it — every
 * causal fixture in the suite was single-hop or walked downstream. It was found by reading a
 * real two-hop chain on screen.
 */

const e = (source: string, target: string): CausalEdge =>
  ({ source, target, type: 'CAUSED', weight: 1 });

describe('chainPath', () => {
  // a -> b -> c
  const edges = [e('a', 'b'), e('b', 'c')];

  test('a two-hop UPSTREAM chain visits each node exactly once', () => {
    const hops = findChains(edges, 'c', { direction: 'upstream', maxDepth: 5 })[0]!;
    expect(hops).toHaveLength(2);                       // anti-vacuity: it really is two hops
    const path = chainPath(hops, 'upstream');
    expect(path).toEqual(['c', 'b', 'a']);
    expect(new Set(path).size).toBe(path.length);       // no node appears twice
  });

  test('a two-hop DOWNSTREAM chain reads the other way, also once each', () => {
    const hops = findChains(edges, 'a', { direction: 'downstream', maxDepth: 5 })[0]!;
    const path = chainPath(hops, 'downstream');
    expect(path).toEqual(['a', 'b', 'c']);
    expect(new Set(path).size).toBe(path.length);
  });

  test('one hop is correct in both directions — the case that hid the bug', () => {
    const one = [e('x', 'y')];
    expect(chainPath(findChains(one, 'y', { direction: 'upstream', maxDepth: 3 })[0]!, 'upstream')).toEqual(['y', 'x']);
    expect(chainPath(findChains(one, 'x', { direction: 'downstream', maxDepth: 3 })[0]!, 'downstream')).toEqual(['x', 'y']);
  });

  test('a THREE-hop upstream chain still visits each node once', () => {
    const long = [e('a', 'b'), e('b', 'c'), e('c', 'd')];
    const hops = findChains(long, 'd', { direction: 'upstream', maxDepth: 6 })[0]!;
    expect(hops).toHaveLength(3);
    const path = chainPath(hops, 'upstream');
    expect(path).toEqual(['d', 'c', 'b', 'a']);
    expect(new Set(path).size).toBe(4);
  });

  test('the path always has exactly one more node than it has hops', () => {
    // The invariant the old code broke. Holds for every chain, both directions.
    for (const dir of ['upstream', 'downstream'] as const) {
      const start = dir === 'upstream' ? 'c' : 'a';
      for (const hops of findChains(edges, start, { direction: dir, maxDepth: 5 })) {
        expect(chainPath(hops, dir)).toHaveLength(hops.length + 1);
      }
    }
  });

  test('an empty chain is an empty path, not a crash', () => {
    expect(chainPath([], 'upstream')).toEqual([]);
  });
});
