import { describe, expect, test } from 'bun:test';
import {
  closingValidUntil, isPurged, purge, retract, retractWithCascade, supersedeRetractions,
  type Subject,
} from '../src/temporal/retract';
import { stateAt, type TemporalNode } from '../src/temporal/window';
import type { Json } from '../src/provenance/canonical';

const SECRET: Json = {
  apiKey: 'sk-live-9f2b7c41aa',
  note: 'rotate before the Helsinki demo',
  owner: 'ada@example.com',
};

const subject = (over: Partial<Subject> = {}): Subject => ({
  id: 'n1',
  kind: 'node',
  validFrom: '2026-01-01T00:00:00Z',
  validUntil: null,
  recordedAt: '2026-01-01T00:00:00Z',
  contentDigest: 'd'.repeat(64),
  content: SECRET,
  salt: 'salt-0001',
  ...over,
});

const asNode = (s: Subject): TemporalNode =>
  ({ id: s.id, validFrom: s.validFrom, validUntil: s.validUntil, recordedAt: s.recordedAt });

describe('closingValidUntil — a retraction narrows, never widens', () => {
  test('an open window closes at the retraction instant', () => {
    expect(closingValidUntil(null, '2026-06-01T00:00:00Z')).toBe('2026-06-01T00:00:00Z');
  });

  test('an EARLIER existing bound is kept — this is the whole rule', () => {
    // Without it, a record whose window already closed in March would be reported active
    // for the span between March and the June retraction.
    expect(closingValidUntil('2026-03-01T00:00:00Z', '2026-06-01T00:00:00Z'))
      .toBe('2026-03-01T00:00:00Z');
  });

  test('a LATER existing bound is narrowed to the retraction instant', () => {
    expect(closingValidUntil('2026-12-01T00:00:00Z', '2026-06-01T00:00:00Z'))
      .toBe('2026-06-01T00:00:00Z');
  });

  test('an equal bound is left alone', () => {
    expect(closingValidUntil('2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'))
      .toBe('2026-06-01T00:00:00Z');
  });

  test('an untrusted existing bound closes at the retraction — less visibility, not more', () => {
    expect(closingValidUntil('garbage', '2026-06-01T00:00:00Z')).toBe('2026-06-01T00:00:00Z');
  });

  test('an unusable retraction instant is an error, not a silent no-op', () => {
    expect(() => closingValidUntil(null, '2026-06-01T00:00:00')).toThrow(/ambiguous_timezone/);
  });
});

describe('retract — the record stays answerable in history', () => {
  const { subject: after, record } = retract(subject(), '2026-06-01T00:00:00Z', 'superseded');

  test('a point-in-time query BEFORE the retraction still returns it', () => {
    const s = stateAt([asNode(after)], [], { validAt: '2026-03-01T00:00:00Z' });
    expect(s.nodes.map((n) => n.id)).toEqual(['n1']);
  });

  test('a query AFTER the retraction does not', () => {
    const s = stateAt([asNode(after)], [], { validAt: '2026-09-01T00:00:00Z' });
    expect(s.nodes).toHaveLength(0);
  });

  test('the content is untouched — retract is not erase', () => {
    expect(after.content).toEqual(SECRET);
    expect(after.salt).toBe('salt-0001');
    expect(isPurged(after)).toBe(false);
  });

  test('the retraction record carries its reason and instant', () => {
    expect(record).toEqual({
      type: 'retraction', id: 'n1', kind: 'node',
      retractedAt: '2026-06-01T00:00:00Z', reason: 'superseded',
    });
  });

  test('a retraction against an already-earlier-closed window leaves the earlier bound', () => {
    const early = subject({ validUntil: '2026-02-01T00:00:00Z' });
    const r = retract(early, '2026-06-01T00:00:00Z');
    expect(r.subject.validUntil).toBe('2026-02-01T00:00:00Z');
  });
});

describe('purge — the content is gone and the tombstone holds none of it', () => {
  const { subject: after, tombstone } = purge(subject(), '2026-06-01T00:00:00Z', 'secret leaked');

  test('neither a past nor a present query returns the content', () => {
    expect(after.content).toBeNull();
    expect(after.salt).toBeNull();
    expect(isPurged(after)).toBe(true);
    // And the window is closed, so it is not reported active either.
    expect(stateAt([asNode(after)], [], { validAt: '2026-09-01T00:00:00Z' }).nodes).toHaveLength(0);
  });

  test('the serialised tombstone contains NO field value of the purged content', () => {
    // The acceptance clause, tested the way it was written: scan for EVERY value, not a
    // sample. A new content field added later is caught without anyone remembering.
    const serialised = JSON.stringify(tombstone);
    const values = Object.values(SECRET as Record<string, string>);

    expect(values.length).toBeGreaterThan(0); // anti-vacuity
    for (const v of values) {
      expect(serialised).not.toContain(v);
    }
    // And prove the scan can actually find a value when one IS present, so a passing
    // result means "absent" rather than "the scan is broken".
    expect(JSON.stringify({ ...tombstone, leak: SECRET })).toContain(values[0] as string);
  });

  test('the tombstone keeps the commitment, which is what lets the chain still verify', () => {
    expect(tombstone.contentDigest).toBe('d'.repeat(64));
    expect(tombstone.purgedAt).toBe('2026-06-01T00:00:00Z');
    expect(tombstone.reason).toBe('secret leaked');
  });

  test('the tombstone states its scope rather than implying the erasure is complete', () => {
    // GDPR Art. 17 reaches every copy and obliges notifying downstream holders. A store
    // cannot discharge that alone, so it says so instead of implying otherwise.
    expect(tombstone.scope).toBe('this-store-only');
  });

  test('a purge supersedes a prior retraction — one subject, one removal record', () => {
    const r = retract(subject(), '2026-05-01T00:00:00Z', 'wrong');
    const p = purge(r.subject, '2026-06-01T00:00:00Z', 'leaked');
    const remaining = supersedeRetractions([r.record], [p.tombstone]);
    expect(remaining).toEqual([]);
  });

  test('a retraction for a DIFFERENT subject survives the purge', () => {
    const kept = retract(subject({ id: 'other' }), '2026-05-01T00:00:00Z').record;
    const p = purge(subject(), '2026-06-01T00:00:00Z');
    expect(supersedeRetractions([kept], [p.tombstone]).map((r) => r.id)).toEqual(['other']);
  });

  test('a node and an edge sharing an id are not confused', () => {
    const nodeRetraction = retract(subject({ id: 'x', kind: 'node' }), '2026-05-01T00:00:00Z').record;
    const edgePurge = purge(subject({ id: 'x', kind: 'edge' }), '2026-06-01T00:00:00Z').tombstone;
    expect(supersedeRetractions([nodeRetraction], [edgePurge])).toHaveLength(1);
  });
});

describe('retractWithCascade — no edge is left open against a retracted node', () => {
  const node = subject({ id: 'n', kind: 'node' });
  const edges = [
    subject({ id: 'e1', kind: 'edge' }),
    subject({ id: 'e2', kind: 'edge' }),
  ];

  test('incident edges are closed and marked with what caused it', () => {
    const r = retractWithCascade(node, edges, '2026-06-01T00:00:00Z', 'node retracted');
    expect(r.records).toHaveLength(3);
    const cascaded = r.records.filter((x) => x.cascadedFrom !== undefined);
    expect(cascaded.map((x) => x.id).sort()).toEqual(['e1', 'e2']);
    expect(cascaded.every((x) => x.cascadedFrom === 'n')).toBe(true);
  });

  test('the snapshot leaves no dangling edge behind', () => {
    const r = retractWithCascade(node, edges, '2026-06-01T00:00:00Z');
    const after = '2026-09-01T00:00:00Z';
    expect(stateAt([asNode(r.node)], [], { validAt: after }).nodes).toHaveLength(0);
    for (const e of r.edges) {
      expect(stateAt([], [], { validAt: after }).edges).toHaveLength(0);
      expect(e.validUntil).toBe('2026-06-01T00:00:00Z');
    }
  });

  test('two edges sharing an id are BOTH closed — the pre-loop snapshot is what allows it', () => {
    // The case Semantica's comment at context_graph.py:1626-1628 names. Its edge ids are
    // content-derived and can collide, so two distinct edge objects can carry one id. If the
    // skip set were consulted live, the record written for the first would block the second
    // from ever being closed, leaving an edge open against a retracted node.
    const dupes = [
      subject({ id: 'dup', kind: 'edge', validFrom: '2026-01-01T00:00:00Z' }),
      subject({ id: 'dup', kind: 'edge', validFrom: '2026-02-01T00:00:00Z' }),
    ];
    const r = retractWithCascade(node, dupes, '2026-06-01T00:00:00Z');

    expect(r.edges).toHaveLength(2);
    // Both must be closed. A live skip set closes only the first.
    expect(r.edges.every((e) => e.validUntil === '2026-06-01T00:00:00Z')).toBe(true);
    expect(r.records.filter((x) => x.id === 'dup')).toHaveLength(2);
  });

  test('an already-retracted edge is skipped, and the snapshot is taken before the loop', () => {
    // Two edges sharing an identity is the case Semantica's comment names: with a live
    // set, the record written for the first blocks the second from ever being closed.
    const r = retractWithCascade(node, edges, '2026-06-01T00:00:00Z', null, ['e1']);
    expect(r.records.map((x) => x.id).sort()).toEqual(['e2', 'n']);
    // e1 keeps its original window because it was already handled.
    expect(r.edges.find((e) => e.id === 'e1')!.validUntil).toBeNull();
    expect(r.edges.find((e) => e.id === 'e2')!.validUntil).toBe('2026-06-01T00:00:00Z');
  });
});
