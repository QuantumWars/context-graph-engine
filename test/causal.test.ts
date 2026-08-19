import { describe, expect, test } from 'bun:test';
import {
  CAUSAL_EDGE_TYPES, CausalError, DECISION_KIND, assertCausalEdgeType, chainReport,
  classifyDistance, decisionContent, findChains, isDecision, linkDecisions, normaliseKind,
  type CausalEdge, type GraphNode,
} from '../src/decision/causal';

const decision = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind: DECISION_KIND,
  content: { scenario: `s-${id}`, reasoning: `r-${id}`, outcome: `o-${id}`, confidence: 0.8 },
  ...over,
});

const e = (source: string, target: string, weight = 1, type: CausalEdge['type'] = 'CAUSED'): CausalEdge =>
  ({ source, target, type, weight });

describe('the casing trap, fixed', () => {
  test('every casing Semantica produces normalises to the one canonical kind', () => {
    // record_decision writes "decision"; add_decision writes "Decision"; two readers compare
    // exactly, so decisions made one way are invisible to them.
    for (const raw of ['decision', 'Decision', 'DECISION', '  Decision  ']) {
      expect(normaliseKind(raw)).toBe(DECISION_KIND);
      expect(isDecision({ kind: raw })).toBe(true);
    }
  });

  test('a non-decision node is still not a decision', () => {
    expect(isDecision({ kind: 'entity' })).toBe(false);
  });
});

describe('typed causal edges are validated at the boundary', () => {
  test('the three asserted types are accepted', () => {
    for (const t of CAUSAL_EDGE_TYPES) expect(assertCausalEdgeType(t)).toBe(t);
    expect(CAUSAL_EDGE_TYPES).toEqual(['CAUSED', 'INFLUENCED', 'PRECEDENT_FOR']);
  });

  test('an unknown type is a named error, not a silently created edge', () => {
    let code: string | undefined;
    try { assertCausalEdgeType('RELATED_TO'); } catch (err) { code = (err as CausalError).code; }
    expect(code).toBe('unknown_edge_type');
  });

  test('linking a non-decision is an error rather than a silent no-op', () => {
    // Semantica returns silently here, so a mistyped id produces no edge and no complaint.
    let code: string | undefined;
    try {
      linkDecisions(decision('a'), { id: 'b', kind: 'entity', content: {} }, 'CAUSED');
    } catch (err) { code = (err as CausalError).code; }
    expect(code).toBe('not_a_decision');
  });

  test('a weight outside 0..1 is rejected', () => {
    for (const w of [-0.1, 1.1, NaN]) {
      let code: string | undefined;
      try { linkDecisions(decision('a'), decision('b'), 'CAUSED', w); }
      catch (err) { code = (err as CausalError).code; }
      expect(code).toBe('weight_out_of_range');
    }
  });

  test('a weight of exactly 0 is accepted — it is meaningful, not missing', () => {
    expect(linkDecisions(decision('a'), decision('b'), 'INFLUENCED', 0).weight).toBe(0);
  });
});

describe('findChains — per-path cycle detection, not global', () => {
  test('a diamond returns BOTH branches', () => {
    // The case Semantica's comment names: a global visited set marks D seen on the first
    // branch and silently drops the second, so the caller sees one arm of the diamond.
    const edges = [e('A', 'B'), e('A', 'C'), e('B', 'D'), e('C', 'D')];
    const chains = findChains(edges, 'A', { direction: 'downstream', maxDepth: 5 });

    const asPaths = chains.map((c) => c.map((h) => `${h.from}->${h.to}`).join(','));
    expect(asPaths.sort()).toEqual(['A->B,B->D', 'A->C,C->D']);
    expect(chains).toHaveLength(2);
  });

  test('a cycle terminates instead of looping', () => {
    const edges = [e('A', 'B'), e('B', 'C'), e('C', 'A')];
    const chains = findChains(edges, 'A', { direction: 'downstream', maxDepth: 10 });
    expect(chains).toHaveLength(1);
    expect(chains[0]!.map((h) => h.to)).toEqual(['B', 'C']);
  });

  test('a self-loop does not hang', () => {
    expect(findChains([e('A', 'A')], 'A', { direction: 'downstream', maxDepth: 5 })).toEqual([]);
  });

  test('maxDepth truncates rather than running to the end', () => {
    const edges = [e('A', 'B'), e('B', 'C'), e('C', 'D'), e('D', 'E')];
    const chains = findChains(edges, 'A', { direction: 'downstream', maxDepth: 2 });
    expect(chains).toHaveLength(1);
    expect(chains[0]).toHaveLength(2);
  });

  test('upstream walks the other way and hops still read source to target', () => {
    const edges = [e('cause', 'effect')];
    const up = findChains(edges, 'effect', { direction: 'upstream', maxDepth: 3 });
    expect(up).toHaveLength(1);
    expect(up[0]![0]).toEqual({ from: 'cause', to: 'effect', type: 'CAUSED', weight: 1 });
  });

  test('a start node with no causal edges yields no chains', () => {
    expect(findChains([e('X', 'Y')], 'A', { direction: 'downstream', maxDepth: 3 })).toEqual([]);
  });

  test('an invalid maxDepth is a named error', () => {
    let code: string | undefined;
    try { findChains([], 'A', { direction: 'downstream', maxDepth: 0 }); }
    catch (err) { code = (err as CausalError).code; }
    expect(code).toBe('invalid_max_depth');
  });
});

describe('chainReport — two numbers, each with its assumption', () => {
  test('it names its own weakest hop', () => {
    const hops = findChains([e('A', 'B', 0.9), e('B', 'C', 0.3), e('C', 'D', 0.8)], 'A',
      { direction: 'downstream', maxDepth: 5 })[0]!;
    const r = chainReport(hops);
    expect(r.weakestLink).toEqual({ from: 'B', to: 'C', type: 'CAUSED', weight: 0.3 });
    expect(r.weakestConfidence).toBe(0.3);
  });

  test('a 0.0 weight yields a product of 0.0, NOT 1.0', () => {
    // The original reads `float(hop.get("edge_weight", 1.0))`. A stored zero means "this
    // link carries no confidence", which is the opposite of the default it could become.
    const r = chainReport([{ from: 'A', to: 'B', type: 'INFLUENCED', weight: 0 }]);
    expect(r.productConfidence).toBe(0);
    expect(r.weakestConfidence).toBe(0);
  });

  test('the product is the product, and it is never above the weakest link', () => {
    const hops = findChains([e('A', 'B', 0.8), e('B', 'C', 0.5)], 'A',
      { direction: 'downstream', maxDepth: 5 })[0]!;
    const r = chainReport(hops);
    expect(r.productConfidence).toBeCloseTo(0.4, 12);
    expect(r.weakestConfidence).toBe(0.5);
    // The relationship that makes reporting both worth doing: product <= min, always.
    expect(r.productConfidence).toBeLessThanOrEqual(r.weakestConfidence);
  });

  test('the two numbers are reported separately and never blended', () => {
    const r = chainReport([
      { from: 'A', to: 'B', type: 'CAUSED', weight: 0.9 },
      { from: 'B', to: 'C', type: 'CAUSED', weight: 0.9 },
    ]);
    expect(r.productConfidence).toBeCloseTo(0.81, 12);
    expect(r.weakestConfidence).toBe(0.9);
    expect(r.productConfidence).not.toBe(r.weakestConfidence);
  });

  test('an empty chain is neutral rather than zero', () => {
    const r = chainReport([]);
    expect(r.hopCount).toBe(0);
    expect(r.productConfidence).toBe(1);
    expect(r.weakestLink).toBeNull();
  });

  test('distance bands are the ported boundaries', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 20].map(classifyDistance)).toEqual([
      'direct', 'direct', 'near', 'near', 'mid-range', 'mid-range', 'distant', 'distant',
    ]);
  });
});

describe('stored once — A-2 cannot recur here', () => {
  test('a decision content read comes from the node and nowhere else', () => {
    const d = decision('d1');
    expect(decisionContent(d)).toBe(d.content as never);
  });

  test('mutating the node is the ONLY way to change what a read returns', () => {
    // Structural, not by inspection: if a shadow copy existed, editing the node would leave
    // the read unchanged. That is exactly the A-2 symptom.
    const before = decision('d1');
    const after: GraphNode = { ...before, content: { ...(before.content as object), outcome: 'changed' } as never };
    expect(decisionContent(after).outcome).toBe('changed');
    expect(decisionContent(before).outcome).toBe('o-d1');
  });

  test('the module exports no store, index or registry to hold a second copy', async () => {
    // The strongest available structural assertion at Stage 1: nothing here is stateful.
    const mod = await import('../src/decision/causal');
    const stateful = Object.entries(mod).filter(([, v]) =>
      v instanceof Map || v instanceof Set || (Array.isArray(v) && !Object.isFrozen(v) && v.length > 0 && typeof v[0] === 'object'),
    );
    expect(stateful).toEqual([]);
  });

  test('reading content off a non-decision is an error, not an empty object', () => {
    let code: string | undefined;
    try { decisionContent({ id: 'x', kind: 'entity', content: {} }); }
    catch (err) { code = (err as CausalError).code; }
    expect(code).toBe('not_a_decision');
  });
});
