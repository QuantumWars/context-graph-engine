import { describe, expect, test } from 'bun:test';
import { parseInstant, stateAt, type TemporalEdge, type TemporalNode } from '../src/temporal/window';

const T = (iso: string): string => iso;
const node = (id: string, from: string | null, until: string | null, rec = '2020-01-01T00:00:00Z'): TemporalNode =>
  ({ id, validFrom: from, validUntil: until, recordedAt: rec });
const edge = (id: string, source: string, target: string, from: string | null = null, until: string | null = null, rec = '2020-01-01T00:00:00Z'): TemporalEdge =>
  ({ id, source, target, validFrom: from, validUntil: until, recordedAt: rec });

describe('parseInstant', () => {
  test('accepts a date-only value as UTC midnight, by stated convention', () => {
    const p = parseInstant('2026-06-15');
    expect(p.ok).toBe(true);
    expect(p.ok && p.ms).toBe(Date.parse('2026-06-15T00:00:00Z'));
  });

  test('accepts Z and explicit offsets, and they agree on the same instant', () => {
    const z = parseInstant('2026-06-15T12:00:00Z');
    const off = parseInstant('2026-06-15T14:00:00+02:00');
    expect(z.ok && off.ok && z.ms === off.ms).toBe(true);
  });

  test('rejects a date-time with no offset rather than assuming UTC', () => {
    // The original reads a naive value as UTC. If it was local, the record silently moves
    // by hours — a wrong answer that looks like a right one.
    const p = parseInstant('2026-06-15T12:00:00');
    expect(p.ok).toBe(false);
    expect(!p.ok && p.reason).toBe('ambiguous_timezone');
  });

  test('rejects garbage with a reason code rather than returning null', () => {
    for (const bad of ['', '   ', 'not-a-date', '2026-13-45T00:00:00Z']) {
      const p = parseInstant(bad);
      expect(p.ok).toBe(false);
    }
  });
});

describe('stateAt — valid time', () => {
  const nodes = [
    node('always', null, null),
    node('past', '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z'),
    node('future', '2030-01-01T00:00:00Z', null),
  ];

  test('an unbounded record is active at any instant', () => {
    const s = stateAt(nodes, [], { validAt: T('2026-06-15T00:00:00Z') });
    expect(s.nodes.map((n) => n.id)).toEqual(['always']);
  });

  test('bounds are inclusive at BOTH ends', () => {
    const only = [node('w', '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z')];
    const atStart = stateAt(only, [], { validAt: '2026-01-01T00:00:00Z' });
    const atEnd = stateAt(only, [], { validAt: '2026-12-31T00:00:00Z' });
    const justAfter = stateAt(only, [], { validAt: '2026-12-31T00:00:01Z' });
    expect(atStart.nodes).toHaveLength(1);
    expect(atEnd.nodes).toHaveLength(1);
    expect(justAfter.nodes).toHaveLength(0);
  });

  test('a past window is visible then and not now', () => {
    expect(stateAt(nodes, [], { validAt: '2020-06-01T00:00:00Z' }).nodes.map((n) => n.id).sort())
      .toEqual(['always', 'past']);
  });
});

describe('stateAt — the endpoint rule, which is why a snapshot is coherent', () => {
  test('an edge whose own window is open is EXCLUDED when its target is not active', () => {
    const nodes = [node('a', null, null), node('b', null, '2021-01-01T00:00:00Z')];
    const edges = [edge('a->b', 'a', 'b')]; // edge itself unbounded, so open
    const s = stateAt(nodes, edges, { validAt: '2026-01-01T00:00:00Z' });

    // Anti-vacuity: the edge really is open on its own terms at this instant, so its
    // absence is the endpoint rule firing and not the edge expiring.
    expect(stateAt([node('a', null, null), node('b', null, null)], edges, { validAt: '2026-01-01T00:00:00Z' }).edges)
      .toHaveLength(1);
    expect(s.nodes.map((n) => n.id)).toEqual(['a']);
    expect(s.edges).toHaveLength(0);
  });

  test('NO snapshot edge ever has an endpoint outside the snapshot node set', () => {
    // Computed from the result, not hardcoded — a new way to leak a dangling edge fails
    // this without anyone remembering to add a case.
    const nodes = [
      node('a', null, null),
      node('b', null, '2021-01-01T00:00:00Z'),
      node('c', '2030-01-01T00:00:00Z', null),
      node('d', null, null),
    ];
    const edges = [
      edge('a-b', 'a', 'b'), edge('a-d', 'a', 'd'),
      edge('c-d', 'c', 'd'), edge('d-a', 'd', 'a'),
      edge('a-ghost', 'a', 'no-such-node'),
    ];
    const s = stateAt(nodes, edges, { validAt: '2026-01-01T00:00:00Z' });
    const ids = new Set(s.nodes.map((n) => n.id));

    expect(s.edges.length).toBeGreaterThan(0); // anti-vacuity
    for (const e of s.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
    expect(s.edges.map((e) => e.id).sort()).toEqual(['a-d', 'd-a']);
  });
});

describe('stateAt — transaction time, the axis Semantica does not carry', () => {
  const nodes = [
    node('early', null, null, '2026-01-01T00:00:00Z'),
    node('late', null, null, '2026-06-01T00:00:00Z'),
  ];

  test('asOf hides records the store had not yet recorded', () => {
    const before = stateAt(nodes, [], { validAt: '2026-12-01T00:00:00Z', asOf: '2026-03-01T00:00:00Z' });
    expect(before.nodes.map((n) => n.id)).toEqual(['early']);

    const after = stateAt(nodes, [], { validAt: '2026-12-01T00:00:00Z', asOf: '2026-09-01T00:00:00Z' });
    expect(after.nodes.map((n) => n.id).sort()).toEqual(['early', 'late']);
  });

  test('the two axes are independent — same valid time, different beliefs', () => {
    const all = stateAt(nodes, [], { validAt: '2026-12-01T00:00:00Z' });
    const partial = stateAt(nodes, [], { validAt: '2026-12-01T00:00:00Z', asOf: '2026-03-01T00:00:00Z' });
    expect(all.nodes).toHaveLength(2);
    expect(partial.nodes).toHaveLength(1);
    expect(all.asOf).toBeNull();
    expect(partial.asOf).toBe('2026-03-01T00:00:00Z');
  });

  test('transaction time is applied before valid time, so an unwritten record cannot leak in', () => {
    const n = [node('x', '2020-01-01T00:00:00Z', null, '2026-06-01T00:00:00Z')];
    // Valid at this instant, but not yet recorded as of the asOf instant.
    const s = stateAt(n, [], { validAt: '2026-01-01T00:00:00Z', asOf: '2026-02-01T00:00:00Z' });
    expect(s.nodes).toHaveLength(0);
  });
});

describe('stateAt — malformed input fails closed and is reported', () => {
  test('a record with a malformed bound is EXCLUDED and named, never always-active', () => {
    const nodes = [node('good', null, null), node('bad', 'not-a-date', null)];
    const s = stateAt(nodes, [], { validAt: '2026-01-01T00:00:00Z' });

    expect(s.nodes.map((n) => n.id)).toEqual(['good']);
    expect(s.rejected).toHaveLength(1);
    expect(s.rejected[0]!.id).toBe('bad');
    expect(s.rejected[0]!.field).toBe('validFrom');
    expect(s.rejected[0]!.reason).toBe('malformed_temporal_value');
  });

  test('an ambiguous-timezone bound is rejected with its own reason code', () => {
    const s = stateAt([node('n', '2026-01-01T00:00:00', null)], [], { validAt: '2026-06-01T00:00:00Z' });
    expect(s.rejected.map((r) => r.reason)).toEqual(['ambiguous_timezone']);
    expect(s.nodes).toHaveLength(0);
  });

  test('an inverted window is reported rather than being silently invisible', () => {
    const s = stateAt(
      [node('inv', '2026-12-01T00:00:00Z', '2026-01-01T00:00:00Z')],
      [], { validAt: '2026-06-01T00:00:00Z' },
    );
    expect(s.rejected.map((r) => r.reason)).toEqual(['inverted_window']);
  });

  test('an edge with a bad bound is excluded even when both endpoints are fine', () => {
    const s = stateAt(
      [node('a', null, null), node('b', null, null)],
      [edge('bad', 'a', 'b', 'garbage', null)],
      { validAt: '2026-01-01T00:00:00Z' },
    );
    expect(s.edges).toHaveLength(0);
    expect(s.rejected.map((r) => r.id)).toEqual(['bad']);
  });

  test('an unusable validAt is an error, not an empty snapshot', () => {
    // An empty result would read as "nothing was active then", which is a different and
    // false statement.
    expect(() => stateAt([], [], { validAt: '2026-01-01T00:00:00' })).toThrow(/ambiguous_timezone/);
  });
});
