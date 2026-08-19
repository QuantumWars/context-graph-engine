import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, StoreError, type StoreDeps } from '../src/store/store';
import { resolveWorkspace, storePaths, type StorePaths } from '../src/store/paths';
import { readLog } from '../src/store/log';
import { canonicalJson } from '../src/provenance/canonical';
import { parseInstant, stateAt } from '../src/temporal/window';

/** What actually arrives, not what is convenient to write. */

let dir: string;
let paths: StorePaths;
let n = 0;
const deps: StoreDeps = {
  now: () => '2026-03-01T00:00:00Z',
  salt: () => `salt-${String(++n).padStart(6, '0')}`,
};

beforeEach(() => {
  n = 0;
  dir = mkdtempSync(join(tmpdir(), 'ge-ugly-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('degenerate sizes', () => {
  test('an empty store loads, verifies and answers every read path without throwing', async () => {
    const s = await Store.open(paths, deps);
    expect(s.all()).toEqual([]);
    expect(s.verify()).toEqual({ valid: true, total: 0, purged: 0, problems: [] });
    expect(s.listNodes()).toEqual([]);
    expect(s.listDecisions()).toEqual([]);
    expect(s.contentOf('nothing')).toBeNull();
    expect(s.why('nothing')).toEqual([]);
    expect(s.searchable()).toEqual([]);
    expect(s.stateAt('2026-01-01T00:00:00Z').nodes).toEqual([]);
  });

  test('a store of exactly one record has a null prev and seq 1, and verifies', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'only', content: { v: 1 } });
    const r = s.all()[0]!;
    expect(r.seq).toBe(1);
    expect(r.prev).toBeNull();
    expect((await Store.open(paths, deps)).verify().valid).toBe(true);
  });

  test('purging the ONLY record leaves a verifiable two-record log', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'only', content: { secret: 'gone' } });
    await s.purge('only', 'test');
    const re = await Store.open(paths, deps);
    expect(re.verify().valid).toBe(true);
    expect(re.contentOf('only')).toBeNull();
    expect(readFileSync(paths.log, 'utf8')).not.toContain('gone');
  });
});

describe('hostile content', () => {
  test('unicode survives a write and a reload byte-for-byte', async () => {
    const nasty = {
      combining: 'é vs é',            // decomposed vs precomposed — NOT equal
      rtl: 'שלום عربى',
      emoji: '👩‍👩‍👧‍👦 family with ZWJ',
      control: 'tab\there\nnewline',
      quotes: 'he said "hi" and \\escaped\\',
    };
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'u', content: nasty });
    const re = await Store.open(paths, deps);
    expect(re.contentOf('u')).toEqual(nasty);
    expect(re.verify().valid).toBe(true);
  });

  test('decomposed and precomposed unicode are DIFFERENT records, not silently merged', async () => {
    // The engine does not normalise. If it did, two genuinely different strings would collide
    // and the digest would attest to something the caller did not write.
    const a = canonicalJson({ v: 'é' });
    const b = canonicalJson({ v: 'é' });
    expect(a).not.toBe(b);
  });

  test('a very long content value round-trips', async () => {
    const long = 'x'.repeat(200_000);
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'long', content: { long } });
    expect((await Store.open(paths, deps)).contentOf('long')).toEqual({ long });
  });

  test('deeply nested content canonicalises without blowing the stack', async () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 400; i++) deep = { [`k${i}`]: deep };
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'deep', content: deep as never });
    expect((await Store.open(paths, deps)).verify().valid).toBe(true);
  });

  test('content that looks like a record does not confuse the reader', async () => {
    const s = await Store.open(paths, deps);
    await s.append({
      kind: 'node', id: 'trojan',
      content: { seq: 999, prev: null, digest: 'f'.repeat(64), kind: 'node' },
    });
    const re = await Store.open(paths, deps);
    expect(re.all()[0]!.seq).toBe(1);          // the real envelope, not the content's claim
    expect(re.verify().valid).toBe(true);
  });

  test('a duplicate id is refused, and the store is unchanged afterwards', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'dup', content: { v: 1 } });
    let code: string | undefined;
    try { await s.append({ kind: 'node', id: 'dup', content: { v: 2 } }); }
    catch (e) { code = (e as StoreError).code; }
    expect(code).toBe('duplicate_id');
    expect(readLog(paths)).toHaveLength(1);    // the refused write left nothing behind
  });
});

describe('timestamps at the edges', () => {
  test('leap day, the epoch and a far-future date all parse', () => {
    for (const t of ['2024-02-29T12:00:00Z', '1970-01-01T00:00:00Z', '2999-12-31T23:59:59Z']) {
      expect(parseInstant(t).ok).toBe(true);
    }
  });

  test('a non-leap-year 29 February is rejected, not silently rolled to 1 March', () => {
    const p = parseInstant('2026-02-29T00:00:00Z');
    // Date.parse rolls this over in some engines. If it ever starts, this catches it.
    if (p.ok) {
      expect(new Date(p.ms).toISOString().slice(0, 10)).not.toBe('2026-03-01');
    } else {
      expect(p.reason).toBe('malformed_temporal_value');
    }
  });

  test('two records at the SAME instant both survive and stay ordered by seq', async () => {
    const s = await Store.open(paths, deps);   // deps.now() is constant
    await s.append({ kind: 'node', id: 'a', content: { v: 1 } });
    await s.append({ kind: 'node', id: 'b', content: { v: 2 } });
    const re = await Store.open(paths, deps);
    expect(re.all().map((r) => r.id)).toEqual(['a', 'b']);
    expect(re.all().map((r) => r.seq)).toEqual([1, 2]);
    expect(re.verify().valid).toBe(true);
  });

  test('a window whose bounds are the same instant is active at exactly that instant', () => {
    const at = '2026-06-01T00:00:00Z';
    const snap = stateAt([{ id: 'p', validFrom: at, validUntil: at, recordedAt: at }], [], { validAt: at });
    expect(snap.nodes.map((x) => x.id)).toEqual(['p']);   // inclusive at both ends
  });
});

describe('two writers at once — the only place the vendored lock is load-bearing', () => {
  test('two REAL processes appending concurrently both land, and the chain verifies', async () => {
    // Real subprocesses, not simulated. A single-process test would exercise the promise queue
    // and prove nothing about the cross-process lock this engine vendored.
    const writer = join(dir, 'writer.ts');
    const srcDir = join(import.meta.dir, '..', 'src');
    writeFileSync(writer, `
import { Store } from ${JSON.stringify(join(srcDir, 'store', 'store.ts'))};
import { resolveWorkspace, storePaths } from ${JSON.stringify(join(srcDir, 'store', 'paths.ts'))};
const tag = process.argv[2];
const paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: ${JSON.stringify(dir)} } }));
for (let i = 0; i < 8; i++) {
  const s = await Store.open(paths);
  await s.append({ kind: 'node', id: tag + '-' + i, content: { tag, i } });
}
`);
    const [a, b] = await Promise.all([
      Bun.spawn(['bun', writer, 'A'], { stdout: 'pipe', stderr: 'pipe' }).exited,
      Bun.spawn(['bun', writer, 'B'], { stdout: 'pipe', stderr: 'pipe' }).exited,
    ]);
    expect({ a, b }).toEqual({ a: 0, b: 0 });

    const raw = readLog(paths);
    const ids = raw.map((r) => r.id);
    // Both writers' records are present — neither was lost to the other's write.
    expect(ids.filter((i) => i.startsWith('A-'))).toHaveLength(8);
    expect(ids.filter((i) => i.startsWith('B-'))).toHaveLength(8);
    // And seq is a contiguous 1..16 with no duplicate, which is what the lock buys.
    expect(raw.map((r) => r.seq)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  }, 30_000);
});
