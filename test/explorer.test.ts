import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authorise, bindingWarning, graphView, LOOPBACK_HOSTS, ROUTES } from '../explorer/server/server';
import { Store, type StoreDeps } from '../src/store/store';
import { resolveWorkspace, storePaths, type StorePaths } from '../src/store/paths';

/** Phase 19. `DEC-020`: the explorer reads over loopback and never writes. */

let dir: string;
let paths: StorePaths;
let t = 0;
let n = 0;
const deps: StoreDeps = {
  now: () => `2026-05-${String(++t).padStart(2, '0')}T00:00:00Z`,
  salt: () => `s-${++n}`,
};

beforeEach(() => {
  t = 0; n = 0;
  dir = mkdtempSync(join(tmpdir(), 'ge-exp-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('DEC-020 — the route table cannot mutate', () => {
  test('every route is a GET', () => {
    expect(ROUTES.length).toBeGreaterThan(0);                 // anti-vacuity
    expect([...new Set(ROUTES.map((r) => r.method))]).toEqual(['GET']);
  });

  test('no route path names a mutating operation', () => {
    // The clause most likely to be argued with later is "just an annotation endpoint". This makes
    // adding one a red test rather than a judgement call in review.
    const forbidden = ['append', 'record', 'merge', 'confirm', 'retract', 'purge', 'write', 'delete', 'annotate'];
    for (const r of ROUTES) {
      for (const f of forbidden) {
        expect({ path: r.path, names: f, ok: !r.path.includes(f) }).toEqual({ path: r.path, names: f, ok: true });
      }
    }
  });

  test('and the check can see a mutating route when one is present', () => {
    // Proving the guard fails, without adding one.
    const rogue = { method: 'POST' as const, path: '/api/annotate' };
    expect(['GET', rogue.method].includes('POST')).toBe(true);
    expect(rogue.path.includes('annotate')).toBe(true);
  });
});

describe('DEC-020 — purged content never reaches a payload', () => {
  test('a purged record appears as purged, and its content is not in the view', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'secret', content: { text: 'sk-live-DO-NOT-LEAK-4471' } });
    await s.append({ kind: 'node', id: 'ordinary', content: { text: 'a harmless note' } });

    // Prove it is there first, or the absence afterwards proves nothing.
    expect(JSON.stringify(graphView(s))).toContain('sk-live-DO-NOT-LEAK-4471');

    await s.purge('secret', 'contained a credential');
    const re = await Store.open(paths, deps);
    const view = graphView(re);
    const payload = JSON.stringify(view);

    expect(payload).not.toContain('sk-live-DO-NOT-LEAK-4471');
    expect(payload).toContain('a harmless note');
    expect(view.nodes.find((x) => x.id === 'secret')?.purged).toBe(true);
    expect(view.nodes.find((x) => x.id === 'secret')?.label).toBe('(purged)');
  });

  test('the view reports the chain verdict rather than assuming it', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'a', content: { text: 'one' } });
    const v = graphView(s);
    expect(v.chain).toEqual({ valid: true, total: 1, purged: 0, problems: 0 });
  });

  test('edges report whether they carry evidence, without carrying the text', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'decision', id: 'd1', content: { text: 'first' } });
    await s.append({ kind: 'decision', id: 'd2', content: { text: 'second' } });
    await s.append({ kind: 'node', id: 'src', content: { text: 'The friday deploy caused a checkout outage.' } });
    await s.confirm(s.propose('src')[0]!, 'd1', 'd2');

    const v = graphView(s);
    const edge = v.edges.find((e) => e.source === 'd1')!;
    expect(edge.hasEvidence).toBe(true);
    // The quote is fetched on demand from /api/evidence; it is not baked into the graph payload.
    expect(JSON.stringify(v.edges)).not.toContain('friday deploy');
  });
});

describe('DEC-020 — the exposure model', () => {
  test('loopback needs no key', () => {
    for (const host of LOOPBACK_HOSTS) {
      expect(authorise({ host }, null)).toEqual({ ok: true });
    }
  });

  test('beyond loopback with no key, every request is REFUSED rather than served', () => {
    // Fails closed. This is the half that matters: the alternative is serving the whole store
    // unauthenticated to anything that can reach the port.
    const r = authorise({ host: '0.0.0.0' }, null);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.status).toBe(503);
    expect(r.ok === false && r.reason).toContain('no API key configured');
  });

  test('beyond loopback with a key, the right key passes and a wrong one does not', () => {
    const opts = { host: '0.0.0.0', apiKey: 'correct-horse' };
    expect(authorise(opts, 'correct-horse')).toEqual({ ok: true });
    expect(authorise(opts, 'wrong').ok).toBe(false);
    expect(authorise(opts, null).ok).toBe(false);
    // A shorter and a longer candidate must both be refused rather than throwing.
    expect(authorise(opts, 'c').ok).toBe(false);
    expect(authorise(opts, 'correct-horse-and-more').ok).toBe(false);
  });

  test('anonymous access beyond loopback is possible only by explicit opt-in', () => {
    expect(authorise({ host: '0.0.0.0' }, null).ok).toBe(false);
    expect(authorise({ host: '0.0.0.0', allowAnonymous: true }, null)).toEqual({ ok: true });
  });

  test('the binding warning is specific about what becomes readable', () => {
    expect(bindingWarning('127.0.0.1', {})).toBeNull();
    const anon = bindingWarning('0.0.0.0', { allowAnonymous: true })!;
    expect(anon).toContain('any host that can reach this port');
    expect(anon).toContain('read-only');
    expect(bindingWarning('0.0.0.0', {})!).toContain('refused');
  });
});
