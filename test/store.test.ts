import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, StoreError, type StoreDeps } from '../src/store/store';
import { resolveWorkspace, storePaths, WorkspaceError, type StorePaths } from '../src/store/paths';
import { readLog } from '../src/store/log';

/**
 * EVERY CONTENT READ PATH ON THE STORE.
 *
 * Task 2.1's acceptance requires this to be an explicit list, and requires a read path added
 * to the store without being added here to FAIL. The structural test at the bottom of this
 * file enforces that by parsing the read-path section of `store.ts` — it is not a convention
 * anybody has to remember.
 */
const READ_PATHS = [
  'contentOf', 'getNode', 'listNodes', 'getDecision', 'listDecisions',
  'getEdge', 'listEdges', 'stateAt', 'why', 'searchable',
] as const;

/** Does this read path still surface `id`? One probe per path, so all ten are really exercised. */
const probes: Record<(typeof READ_PATHS)[number], (s: Store, id: string) => boolean> = {
  contentOf: (s, id) => s.contentOf(id) !== null,
  getNode: (s, id) => s.getNode(id) !== undefined,
  listNodes: (s, id) => s.listNodes().some((r) => r.id === id),
  getDecision: (s, id) => s.getDecision(id) !== undefined,
  listDecisions: (s, id) => s.listDecisions().some((r) => r.id === id),
  getEdge: (s, id) => s.getEdge(id) !== undefined,
  listEdges: (s, id) => s.listEdges().some((r) => r.id === id),
  stateAt: (s, id) => s.stateAt('2026-06-15T00:00:00Z').nodes.some((n) => n.id === id),
  why: (s, id) => s.why(id, 'upstream', 3).length > 0,
  searchable: (s, id) => s.searchable().some((r) => r.id === id),
};

let dir: string;
let paths: StorePaths;
let n = 0;
const deps: StoreDeps = {
  now: () => `2026-0${((n % 8) + 1)}-01T00:00:0${n % 10}Z`,
  salt: () => `salt-${String(++n).padStart(4, '0')}`,
};

beforeEach(() => {
  n = 0;
  dir = mkdtempSync(join(tmpdir(), 'ge-store-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A decision, a second decision, and a causal edge between them. */
async function seed(s: Store): Promise<void> {
  await s.append({ kind: 'decision', id: 'd1', content: { scenario: 'ship on friday', outcome: 'no' }, validFrom: '2026-01-01T00:00:00Z' });
  await s.append({ kind: 'decision', id: 'd2', content: { scenario: 'add a gate', outcome: 'yes' }, validFrom: '2026-01-01T00:00:00Z' });
  await s.append({ kind: 'node', id: 'n1', content: { text: 'a plain node' }, validFrom: '2026-01-01T00:00:00Z' });
  await s.append({ kind: 'edge', id: 'e1', content: { note: 'because of the incident' }, validFrom: '2026-01-01T00:00:00Z', source: 'd1', target: 'd2', edgeType: 'CAUSED', weight: 0.9 });
}

describe('workspace resolution — DEC-002', () => {
  test('an explicit env var wins and records how it was decided', () => {
    const w = resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } });
    expect(w.root).toBe(dir);
    expect(w.method).toBe('env:GRAPH_ENGINE_WORKSPACE');
  });

  test('the platform variable is the second source', () => {
    expect(resolveWorkspace({ env: { CLAUDE_PROJECT_DIR: dir } }).method).toBe('env:CLAUDE_PROJECT_DIR');
  });

  test('a marker walk finds the project root', () => {
    const deep = join(dir, 'a', 'b');
    mkdirSync(deep, { recursive: true });
    const w = resolveWorkspace({ env: {}, startDir: deep });
    expect(w.root).toBe(dir);
    expect(w.method).toBe('marker-walk');
  });

  test('with nothing to go on it THROWS rather than falling back to cwd', () => {
    // DEC-002 rejects a cwd fallback by name: it is the mechanism that produced six separate
    // stores under one repository. Guessing here is worse than refusing.
    let code: string | undefined;
    try { resolveWorkspace({ env: {} }); } catch (e) { code = (e as WorkspaceError).code; }
    expect(code).toBe('workspace_unresolved');
  });
});

describe('the store directory protects itself on creation', () => {
  test('.gitignore is written in the same operation that creates the directory', async () => {
    expect(existsSync(paths.dir)).toBe(false);
    await Store.open(paths, deps);
    expect(existsSync(paths.dir)).toBe(true);
    expect(readFileSync(join(paths.dir, '.gitignore'), 'utf8')).toContain('*');
  });
});

describe('Task 2.1 — one store per fact, across a save and a reload', () => {
  test('EVERY enumerated read path returns the record after write → save → reload', async () => {
    const a = await Store.open(paths, deps);
    await seed(a);

    // Reload from disk into a completely fresh instance — no shared memory at all.
    const b = await Store.open(paths, deps);

    const targets: Record<string, string> = {
      contentOf: 'd1', getNode: 'n1', listNodes: 'n1', getDecision: 'd1',
      listDecisions: 'd1', getEdge: 'e1', listEdges: 'e1', stateAt: 'd1',
      why: 'd2', searchable: 'd1',
    };
    expect(Object.keys(targets).sort()).toEqual([...READ_PATHS].sort()); // anti-vacuity

    for (const p of READ_PATHS) {
      expect({ path: p, found: probes[p](b, targets[p] as string) })
        .toEqual({ path: p, found: true });
    }
  });

  test('after purge → save → reload, NO enumerated read path returns it', async () => {
    const a = await Store.open(paths, deps);
    await seed(a);
    // Prove it was reachable first, or "not found" proves nothing.
    const before = await Store.open(paths, deps);
    expect(before.contentOf('d1')).not.toBeNull();
    expect(before.listDecisions().some((r) => r.id === 'd1')).toBe(true);

    await a.purge('d1', 'contained a credential');
    const after = await Store.open(paths, deps);

    for (const p of READ_PATHS) {
      expect({ path: p, found: probes[p](after, 'd1') }).toEqual({ path: p, found: false });
    }
  });

  test('the purged content is gone from the FILE, not just from the reader', async () => {
    const a = await Store.open(paths, deps);
    await a.append({ kind: 'node', id: 'secret', content: { key: 'sk-live-9f2b7c41aa' }, validFrom: null });
    expect(readFileSync(paths.log, 'utf8')).toContain('sk-live-9f2b7c41aa');

    await a.purge('secret', 'leaked');
    expect(readFileSync(paths.log, 'utf8')).not.toContain('sk-live-9f2b7c41aa');
  });

  test('nothing derived is ever written to disk — the log is the only file', async () => {
    const a = await Store.open(paths, deps);
    await seed(a);
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(paths.dir).sort()).toEqual(['.gitignore', 'log.jsonl']);
  });

  test('a duplicate id is refused rather than shadowing the first record', async () => {
    const a = await Store.open(paths, deps);
    await a.append({ kind: 'node', id: 'x', content: { v: 1 } });
    let code: string | undefined;
    try { await a.append({ kind: 'node', id: 'x', content: { v: 2 } }); }
    catch (e) { code = (e as StoreError).code; }
    expect(code).toBe('duplicate_id');
  });
});

describe('Task 2.2 — the store and the chain cannot diverge', () => {
  test('every mutation lands in the chain, and the count matches', async () => {
    const a = await Store.open(paths, deps);
    await seed(a);                      // 4 appends
    await a.retract('n1', 'superseded'); // +1 retraction record
    const raw = readLog(paths);
    expect(raw).toHaveLength(5);
    expect(a.verify().valid).toBe(true);
    expect(a.verify().total).toBe(5);
  });

  test('the chain still verifies over the raw file after a purge', async () => {
    const a = await Store.open(paths, deps);
    await seed(a);
    await a.purge('n1', 'personal data');
    const report = (await Store.open(paths, deps)).verify();
    expect(report.valid).toBe(true);
    expect(report.purged).toBe(1);
  });

  test('hand-editing one byte on disk makes the next load REFUSE, naming the record', async () => {
    const a = await Store.open(paths, deps);
    await seed(a);

    const lines = readFileSync(paths.log, 'utf8').trimEnd().split('\n');
    // d1's outcome is 'no'. Flip it — and assert the fixture really changed, because an
    // edit that happens to be a no-op would make this test pass against a broken verifier.
    const target = JSON.parse(lines[0] as string) as { content: { outcome: string } };
    expect(target.content.outcome).toBe('no');
    target.content.outcome = 'yes';
    lines[0] = JSON.stringify(target);
    writeFileSync(paths.log, lines.join('\n') + '\n');

    let err: StoreError | undefined;
    try { await Store.open(paths, deps); } catch (e) { err = e as StoreError; }
    expect(err?.code).toBe('chain_invalid');
    expect(err?.detail).toContain('content_tampered');
    expect(err?.detail).toContain('d1');
  });

  test('a deleted line is refused too, and reported as a chain break', async () => {
    const a = await Store.open(paths, deps);
    await seed(a);
    const lines = readFileSync(paths.log, 'utf8').trimEnd().split('\n');
    writeFileSync(paths.log, [lines[0], lines[2], lines[3]].join('\n') + '\n');

    let err: StoreError | undefined;
    try { await Store.open(paths, deps); } catch (e) { err = e as StoreError; }
    expect(err?.code).toBe('chain_invalid');
    expect(err?.detail).toMatch(/chain_break|sequence_gap/);
  });

  test('a writer stamped with a different workspace is refused', async () => {
    const a = await Store.open(paths, deps);
    await a.append({ kind: 'node', id: 'x', content: { v: 1 } });
    const other = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: join(dir, 'elsewhere') } }));
    const { appendLog } = await import('../src/store/log');
    let msg = '';
    try { await appendLog(other, [a.all()[0]!]); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('workspace_mismatch');
    expect(msg).toContain('Refusing to write across a workspace boundary');
  });
});

describe('retract keeps history answerable; purge does not', () => {
  test('a retracted record is gone from the present and present in the past', async () => {
    const a = await Store.open(paths, deps);
    await a.append({ kind: 'node', id: 'p', content: { text: 'deploy fridays' }, validFrom: '2026-01-01T00:00:00Z' });
    await a.retract('p', 'burned us twice');

    const b = await Store.open(paths, deps);
    const at = b.all().find((r) => r.kind === 'retraction')!.meta.recordedAt;
    expect(b.stateAt('2026-01-15T00:00:00Z').nodes.some((x) => x.id === 'p')).toBe(true);
    expect(b.stateAt('2026-12-01T00:00:00Z').nodes.some((x) => x.id === 'p')).toBe(false);
    expect(b.contentOf('p')).not.toBeNull();  // retract is not erase
    expect(at).toBeTruthy();
  });
});

describe('the read-path list cannot silently fall out of date', () => {
  test('every method in store.ts\'s read-path section is in READ_PATHS', () => {
    // Task 2.1's acceptance: a read path added to the store without being added to the list
    // must fail this test. Parsed from the source between the two section markers, so it is
    // structural rather than a convention someone has to remember.
    const src = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8');
    const start = src.indexOf('// ───────────────────────── read paths');
    const end = src.indexOf('// ───────────────────────── plumbing');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);

    const section = src.slice(start, end);
    const declared = [...section.matchAll(/^\s*\/\*\* \d+ \*\/\s*(\w+)\s*[(<]/gm)].map((m) => m[1] as string);

    expect(declared.length).toBeGreaterThan(0);              // anti-vacuity
    expect(declared.sort()).toEqual([...READ_PATHS].sort());
  });
});
