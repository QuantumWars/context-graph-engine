import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, type StoreDeps } from '../src/store/store';
import { resolveWorkspace, storePaths, type StorePaths } from '../src/store/paths';
import { RECORD_KINDS } from '../src/store/records';
import { retrieve, type Doc, type Link } from '../src/retrieval/channels';

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
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'n1', content: { text: 'deploy gate canary' } });
    const { decision } = retrieve([{ id: 'n1', text: 'deploy gate canary' }], [], 'deploy gate');
    await s.recordRetrieval(decision);

    const row = (await Store.open(paths, deps)).all().find((r) => r.kind === 'retrieval')!;
    const c = row.content as { outcome: string; channels: { floor: number }[]; queryHash: string };
    expect(c.outcome).toBe('served');
    expect(c.channels).toHaveLength(2);
    expect(c.channels[0]).toHaveProperty('floor');
    expect(c.queryHash).toMatch(/^[0-9a-f]{16}$/);
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
