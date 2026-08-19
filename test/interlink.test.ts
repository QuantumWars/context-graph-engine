import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, type StoreDeps } from '../src/store/store';
import { resolveWorkspace, storePaths, type StorePaths } from '../src/store/paths';
import { RECORD_KINDS } from '../src/store/records';
import { lexicalChannel, retrieve, type Doc, type Link } from '../src/retrieval/channels';

/** Task 3.4 — the three items Phase 2 left open, each resolved rather than restated. */

let dir: string;
let paths: StorePaths;
let n = 0;
const deps: StoreDeps = { now: () => '2026-04-01T00:00:00Z', salt: () => `s-${++n}` };

beforeEach(() => {
  n = 0;
  dir = mkdtempSync(join(tmpdir(), 'ge-inter-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('the structural channel, on a graph with real depth', () => {
  // Phase 2's transcript reported considered=0, because a four-record store has no neighbour
  // that is not itself a lexical seed. That made the channel present but unexercised.
  const docs: Doc[] = [
    { id: 'outage', text: 'checkout outage during the friday deploy window' },
    { id: 'freeze', text: 'no deploys after thursday' },
    { id: 'gate', text: 'canary gate on the pipeline' },
    { id: 'hiring', text: 'headcount approved for site reliability' },
    { id: 'oncall', text: 'rotation moved to weekly handover' },
    { id: 'menu', text: 'the cafeteria now serves laksa on wednesdays' },
  ];
  const links: Link[] = [
    { source: 'outage', target: 'freeze' },
    { source: 'freeze', target: 'gate' },
    { source: 'outage', target: 'hiring' },
    { source: 'hiring', target: 'oncall' },
  ];

  test('it surfaces a record the lexical channel did not find at all', () => {
    const query = 'checkout outage friday';
    const { decision, items } = retrieve(docs, links, query);

    const lexical = decision.channels.find((c) => c.channel === 'lexical')!;
    const structural = decision.channels.find((c) => c.channel === 'structural')!;

    // The channel is genuinely exercised now — this is the assertion Phase 2 could not make.
    expect(structural.considered).toBeGreaterThan(0);
    expect(structural.topScore).not.toBeNull();

    // `hiring` and `freeze` share no query token, so lexical cannot reach them...
    const lexIds = docs.filter((d) => ['hiring', 'freeze'].includes(d.id));
    for (const d of lexIds) expect(d.text).not.toContain('outage');

    // ...but the graph does, and they appear in the fused result.
    const ids = items.map((i) => i.id);
    expect(ids).toContain('hiring');
    expect(lexical.considered).toBeLessThan(ids.length + structural.considered);

    // And the one connected to nothing, matching nothing, stays out.
    expect(ids).not.toContain('menu');
  });

  test('a candidate found ONLY structurally carries exactly one contribution, naming that channel', () => {
    const { items } = retrieve(docs, links, 'checkout outage friday');
    const onlyStructural = items.find((i) => i.id === 'hiring')!;
    expect(onlyStructural.contributions).toHaveLength(1);
    expect(onlyStructural.contributions[0]!.channel).toBe('structural');
  });
});

describe('the retrieval record kind now has a writer', () => {
  test('every record kind in RECORD_KINDS is written by something', async () => {
    // A kind with no writer is schema decoration on dead code. This asserts the set of kinds
    // and the set of kinds actually produced are the same, so adding a kind without a writer
    // fails here rather than sitting unnoticed.
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'decision', id: 'd1', content: { text: 'ship the gate' } });
    await s.append({ kind: 'node', id: 'n1', content: { text: 'a note about the gate' } });
    await s.append({ kind: 'edge', id: 'e1', content: {}, source: 'd1', target: 'n1', edgeType: 'CAUSED', weight: 1 });
    await s.retract('n1', 'superseded');
    await s.purge('d1', 'contained a credential');
    const { decision } = retrieve(
      s.searchable().map((d) => ({ id: d.id, text: d.text })),
      s.listEdges().map((e) => ({ source: String(e.meta.source), target: String(e.meta.target) })),
      'gate',
    );
    await s.recordRetrieval(decision);

    const produced = new Set((await Store.open(paths, deps)).all().map((r) => r.kind));
    expect([...produced].sort()).toEqual([...RECORD_KINDS].sort());
  });

  test('the stored row distinguishes served from abstained, and carries the margins', async () => {
    // A realistic corpus, not a single document: the lexical channel weights each match by how
    // RARE the token is, and with one document every token has the same frequency and therefore
    // the same near-zero weight. See the small-corpus test below — that is a real property, and
    // this test is about the stored row, so it should not be measuring that property by accident.
    const s = await Store.open(paths, deps);
    const corpus = [
      { id: 'n1', text: 'deploy gate canary before full rollout' },
      { id: 'n2', text: 'the cafeteria menu changes on wednesday' },
      { id: 'n3', text: 'laptops are replaced after four years' },
      { id: 'n4', text: 'parking permits renew in january' },
      { id: 'n5', text: 'the fire drill is scheduled quarterly' },
    ];
    for (const c of corpus) await s.append({ kind: 'node', id: c.id, content: { text: c.text } });
    const { decision } = retrieve(corpus, [], 'deploy gate canary');
    await s.recordRetrieval(decision);

    const row = (await Store.open(paths, deps)).all().find((r) => r.kind === 'retrieval')!;
    const c = row.content as { outcome: string; channels: { floor: number }[]; queryHash: string };
    expect(c.outcome).toBe('served');
    expect(c.channels).toHaveLength(2);
    expect(c.channels[0]).toHaveProperty('floor');
    expect(c.queryHash).toMatch(/^[0-9a-f]{16}$/);
  });

  test('a score does not depend on how much UNRELATED material is in the store', () => {
    // This began as a test documenting a limitation and became a test guarding its fix, which is
    // the better outcome. Measured before the fix: the query "gate" against a document containing
    // it ABSTAINED at 3 documents and SERVED at 10, because ln(1 + N/df) grows with corpus size
    // and the floor did not. Relevance must not depend on the size of the pile a thing is buried
    // in, so the weight is now normalised by its own maximum, ln(1 + N).
    const target = { id: 'only', text: 'deploy gate canary' };
    const filler = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `x${i}`, text: `unrelated note ${i} concerning nothing at all` }));

    for (const query of ['deploy gate canary', 'deploy gate', 'gate']) {
      const scores = [1, 3, 10, 30].map((n) => {
        const corpus = [target, ...filler(n - 1)];
        return lexicalChannel(corpus, query).results.find((r) => r.id === 'only')?.score ?? 0;
      });
      // Identical at every corpus size, to twelve places.
      expect(scores.length).toBe(4);                                     // anti-vacuity
      for (const sc of scores) expect(sc).toBeCloseTo(scores[0] as number, 12);
      // And non-zero, or the invariance would be the trivial kind.
      expect(scores[0]).toBeGreaterThan(0);
    }
  });

  test('a rare token outranks a common one, which is the whole point of the weighting', () => {
    // The defect real usage found: "the" appeared in 13 of 26 records and counted as much as
    // "vendor", which appeared in one — so the correct answer did not clear the floor.
    const corpus = [
      { id: 'right', text: 'the vendored lock resolves at one filesystem depth' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `noise${i}`, text: `the note number ${i} about the office` })),
    ];
    const hits = lexicalChannel(corpus, 'the vendored lock').results;
    expect(hits[0]!.id).toBe('right');
    // And the common-token-only documents score far below it rather than merely below it.
    const best = hits[0]!.score;
    const noise = hits.filter((h) => h.id.startsWith('noise')).map((h) => h.score);
    expect(noise.length).toBeGreaterThan(0);
    for (const n of noise) expect(n).toBeLessThan(best / 2);
  });

  test('the query text is not in the stored row — DEC-005', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'n1', content: { text: 'anything' } });
    const secretish = 'reset token abcd-1234-secret';
    const { decision } = retrieve([{ id: 'n1', text: 'anything' }], [], secretish);
    await s.recordRetrieval(decision);
    const raw = JSON.stringify((await Store.open(paths, deps)).all());
    expect(raw).not.toContain('abcd-1234-secret');
  });

  test('a retrieval row is not itself searchable — a query cannot match earlier queries', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'n1', content: { text: 'deploy gate canary' } });
    const { decision } = retrieve([{ id: 'n1', text: 'deploy gate canary' }], [], 'deploy gate');
    await s.recordRetrieval(decision);
    const re = await Store.open(paths, deps);
    expect(re.searchable().map((d) => d.id)).toEqual(['n1']);
  });

  test('recording a retrieval keeps the chain valid', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'n1', content: { text: 'x' } });
    const { decision } = retrieve([{ id: 'n1', text: 'x' }], [], 'x');
    await s.recordRetrieval(decision);
    expect((await Store.open(paths, deps)).verify().valid).toBe(true);
  });
});
