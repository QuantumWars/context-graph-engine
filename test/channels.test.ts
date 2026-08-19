import { describe, expect, test } from 'bun:test';
import {
  ContradictoryDecisionError, LEXICAL_FLOOR, STRUCTURAL_FLOOR, assertConsistent,
  lexicalChannel, retrieve, structuralChannel, tokenise,
  type Doc, type Link, type RetrievalDecision,
} from '../src/retrieval/channels';

const docs: Doc[] = [
  { id: 'd1', text: 'deploy on friday caused an incident in production' },
  { id: 'd2', text: 'added a deploy gate to the pipeline' },
  { id: 'd3', text: 'hired a site reliability engineer' },
  { id: 'd4', text: 'the cafeteria menu changed on tuesday' },
];
const links: Link[] = [
  { source: 'd1', target: 'd2' },
  { source: 'd1', target: 'd3' },
  { source: 'd3', target: 'd5' },
];

describe('tokenise', () => {
  test('lowercases, splits on non-alphanumerics, drops 1-char tokens', () => {
    expect(tokenise('Deploy-on Friday, a TEST!')).toEqual(['deploy', 'on', 'friday', 'test']);
  });
  test('empty and punctuation-only input yields nothing', () => {
    expect(tokenise('   ...   ')).toEqual([]);
  });
});

describe('lexical channel', () => {
  test('ranks by token overlap and returns only documents that matched', () => {
    const ch = lexicalChannel(docs, 'deploy friday');
    expect(ch.name).toBe('lexical');
    expect(ch.results[0]!.id).toBe('d1');
    expect(ch.results.map((r) => r.id)).not.toContain('d4');
  });

  test('length normalisation stops a long document winning on volume alone', () => {
    const short: Doc = { id: 'short', text: 'deploy gate' };
    const long: Doc = { id: 'long', text: `deploy gate ${'filler word '.repeat(40)}` };
    const ch = lexicalChannel([short, long], 'deploy gate');
    // Both match both tokens; the shorter one is the better answer.
    expect(ch.results[0]!.id).toBe('short');
  });

  test('a query sharing no token returns nothing at all', () => {
    expect(lexicalChannel(docs, 'quantum entanglement').results).toEqual([]);
  });

  test('ordering is total, so two runs agree', () => {
    const a = lexicalChannel(docs, 'deploy').results.map((r) => r.id);
    const b = lexicalChannel([...docs].reverse(), 'deploy').results.map((r) => r.id);
    expect(a).toEqual(b);
  });
});

describe('structural channel — real graph signal, not a restatement of lexical', () => {
  test('a record that shares NO token with the query can still rank', () => {
    // d3 ("hired a site reliability engineer") matches nothing in the query, but the graph
    // says it sits next to d1, which does. That is the whole point of the second channel.
    const lex = lexicalChannel(docs, 'deploy friday incident');
    expect(lex.results.map((r) => r.id)).not.toContain('d3');

    const st = structuralChannel(links, lex.results.map((r) => r.id));
    expect(st.results.map((r) => r.id)).toContain('d3');
  });

  test('seeds do not score themselves', () => {
    const st = structuralChannel(links, ['d1']);
    expect(st.results.map((r) => r.id)).not.toContain('d1');
  });

  test('degree counts edges to seeds in either direction', () => {
    const st = structuralChannel([{ source: 'x', target: 'seed' }, { source: 'seed', target: 'x' }], ['seed']);
    expect(st.results).toEqual([{ id: 'x', score: 2 }]);
  });

  test('no seeds means no structural signal, not an error', () => {
    expect(structuralChannel(links, []).results).toEqual([]);
  });
});

describe('retrieve — served', () => {
  const { decision, items } = retrieve(docs, links, 'deploy friday incident');

  test('it serves, and the fused order is explainable', () => {
    expect(decision.outcome).toBe('served');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.contributions.length).toBeGreaterThan(0);
  });

  test('the query text is NOT stored — only a hash and a length', () => {
    // DEC-005: a query carries whatever the user typed, including pasted secrets.
    const serialised = JSON.stringify(decision);
    expect(serialised).not.toContain('deploy friday incident');
    expect(decision.queryHash).toMatch(/^[0-9a-f]{16}$/);
    expect(decision.queryChars).toBe('deploy friday incident'.length);
  });

  test('EVERY channel carries top score, floor and margin — on a SERVED decision', () => {
    expect(decision.channels.map((c) => c.channel)).toEqual(['lexical', 'structural']);
    for (const c of decision.channels) {
      expect(c).toHaveProperty('topScore');
      expect(c).toHaveProperty('floor');
      expect(c).toHaveProperty('margin');
      expect(c.considered).toBeGreaterThanOrEqual(0);
      if (c.topScore !== null) expect(c.margin).toBeCloseTo(c.topScore - c.floor, 12);
    }
  });

  test('a served decision records no reason, because there is nothing to explain', () => {
    expect(decision.reason).toBeNull();
  });
});

describe('retrieve — abstained', () => {
  const { decision, items } = retrieve(docs, links, 'quantum entanglement');

  test('it abstains rather than serving its least-bad candidate', () => {
    expect(decision.outcome).toBe('abstained');
    expect(items).toEqual([]);
    expect(decision.served).toEqual([]);
  });

  test('an abstention is distinguishable from a crash BY THE ROW ALONE', () => {
    // The failure memory/src/ledger.ts was built after: a recall that served nothing was
    // written as success, indistinguishable from one that served four things.
    expect(decision.reason).toBeTruthy();
    expect(decision.reason).toContain('no_candidates');
    expect(decision.outcome).not.toBe('error');
  });

  test('margins are recorded on an ABSTENTION too, not only when serving', () => {
    for (const c of decision.channels) {
      expect(c).toHaveProperty('floor');
      expect(c).toHaveProperty('margin');
    }
    expect(decision.channels.every((c) => c.topScore === null)).toBe(true);
  });

  test('a below-floor abstention says so, distinctly from having no candidates', () => {
    const { decision: d } = retrieve(docs, links, 'deploy', { lexicalFloor: 999 });
    expect(d.outcome).toBe('abstained');
    expect(d.reason).toContain('below_floor');
    expect(d.channels[0]!.topScore).not.toBeNull();      // it HAD a candidate
    expect(d.channels[0]!.margin!).toBeLessThan(0);      // it just did not clear
  });
});

describe('a contradictory decision is refused, never written', () => {
  const base: RetrievalDecision = {
    outcome: 'served', queryHash: 'a'.repeat(16), queryChars: 3,
    channels: [], served: [{ id: 'x', fusedScore: 1 }], reason: null,
  };

  test('served with nothing served is rejected', () => {
    let code: string | undefined;
    try { assertConsistent({ ...base, served: [] }); }
    catch (e) { code = (e as ContradictoryDecisionError).code; }
    expect(code).toBe('contradictory_decision');
  });

  test('abstained while serving something is rejected', () => {
    expect(() => assertConsistent({ ...base, outcome: 'abstained', reason: 'x' }))
      .toThrow(/abstained.*1 item/);
  });

  test('a non-served outcome with no reason is rejected', () => {
    expect(() => assertConsistent({ ...base, outcome: 'error', served: [], reason: null }))
      .toThrow(/no reason recorded/);
  });

  test('the consistent case passes, so the guard is not simply always throwing', () => {
    expect(() => assertConsistent(base)).not.toThrow();
  });
});

describe('floors are declared placeholders and say so', () => {
  test('both floors are exported so they can be overridden and later calibrated', () => {
    expect(LEXICAL_FLOOR).toBeGreaterThan(0);
    expect(STRUCTURAL_FLOOR).toBeGreaterThanOrEqual(1);
    const { decision } = retrieve(docs, links, 'deploy', { lexicalFloor: 0.5, structuralFloor: 9 });
    expect(decision.channels.map((c) => c.floor)).toEqual([0.5, 9]);
  });
});
