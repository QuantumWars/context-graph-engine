import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, type StoreDeps } from '../src/store/store';
import { nodeClassOf, type StoredRecord } from '../src/store/records';
import { resolveWorkspace, storePaths, type StorePaths } from '../src/store/paths';

/** Phase 1. `DEC-023` node class and `DEC-024` author — the schema the context-OS build rests on. */

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
  dir = mkdtempSync(join(tmpdir(), 'ge-nc-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('DEC-023 — a node declares its class, and absent means attested', () => {
  test('a record written today carries no nodeClass and reads as attested', async () => {
    const s = await Store.open(paths, deps);
    const r = await s.append({ kind: 'decision', id: 'd1', content: { text: 'a decision' } });
    // Attested records stay lean — the field is omitted, not written as 'attested'.
    expect(r.meta.nodeClass).toBeUndefined();
    expect(nodeClassOf(r)).toBe('attested');
  });

  test('a legacy record with no nodeClass field at all reads as attested', () => {
    // Simulates every one of the 38 records written before this field existed.
    const legacy = { meta: {} } as unknown as StoredRecord;
    expect(nodeClassOf(legacy)).toBe('attested');
  });

  test('a record explicitly marked re-scannable reads as re-scannable', async () => {
    const s = await Store.open(paths, deps);
    const r = await s.append({ kind: 'node', id: 'commit-x', content: { text: 'a commit' }, nodeClass: 're-scannable' });
    expect(r.meta.nodeClass).toBe('re-scannable');
    expect(nodeClassOf(r)).toBe('re-scannable');
  });

  test('the default lives in exactly one place — nodeClassOf, not scattered reads', () => {
    // Guards against a caller reading meta.nodeClass directly and forgetting the default. If this
    // ever fails, a direct read has crept in and a legacy record will be misclassified as neither.
    const src = readFileSync(join(import.meta.dir, '..', 'src', 'store', 'store.ts'), 'utf8');
    // The store may WRITE nodeClass (in RecordInput passthrough) but must not branch on it without
    // the default. There is no such read today; this pins that.
    expect(src).not.toMatch(/\.meta\.nodeClass\s*===/);
    expect(src).not.toMatch(/\.meta\.nodeClass\s*\?\?\s*(?!.*nodeClassOf)/);
  });
});

describe('DEC-024 — author is optional, free text, and attested', () => {
  test('a record can carry a free-text author', async () => {
    const s = await Store.open(paths, deps);
    const r = await s.append({ kind: 'decision', id: 'd1', content: { text: 'x' }, author: 'claude-opus' });
    expect(r.meta.author).toBe('claude-opus');
  });

  test('author is optional — absence is absence, never a placeholder', async () => {
    const s = await Store.open(paths, deps);
    const r = await s.append({ kind: 'decision', id: 'd1', content: { text: 'x' } });
    expect(r.meta.author).toBeUndefined();
    expect('author' in r.meta).toBe(false);          // omitted, not set to null or ''
  });

  test('the author is INSIDE the digest — tampering it breaks the chain', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'decision', id: 'd1', content: { text: 'x' }, author: 'claude-opus' });
    expect(s.verify().valid).toBe(true);

    // Hand-edit the author on disk to impersonate a different writer.
    const lines = readFileSync(paths.log, 'utf8').split('\n').filter(Boolean);
    const rec = JSON.parse(lines[0] as string) as StoredRecord;
    expect(rec.meta.author).toBe('claude-opus');
    (rec.meta as Record<string, unknown>)['author'] = 'someone-else';
    writeFileSync(paths.log, `${JSON.stringify(rec)}\n`);

    // Reloading refuses, because the recomputed digest no longer matches the stored one.
    expect(() => Store.open(paths, deps)).toThrow(/chain_invalid|digest_mismatch/);
  });
});

describe('the change is additive — existing records survive untouched', () => {
  test('a record written without the new fields verifies exactly as before', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'decision', id: 'd1', content: { text: 'no new fields' } });
    const before = readFileSync(paths.log, 'utf8');

    // Reopen — the load path must not inject a default nodeClass or author onto disk, or the bytes
    // would change and a real store's digests would stop matching.
    await Store.open(paths, deps);
    expect(readFileSync(paths.log, 'utf8')).toBe(before);
    expect(before).not.toContain('nodeClass');
    expect(before).not.toContain('author');
  });

  test('the chain still verifies with attested and (would-be) re-scannable records side by side', async () => {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'decision', id: 'd1', content: { text: 'attested' } });
    await s.append({ kind: 'node', id: 'r1', content: { text: 're-scannable' }, nodeClass: 're-scannable' });
    await s.append({ kind: 'decision', id: 'd2', content: { text: 'attested too' } });
    // Until the sibling-file phase lands they all sit in log.jsonl and all chain; the point here is
    // that a re-scannable record does not break contiguity or the chain verdict.
    const re = await Store.open(paths, deps);
    expect(re.verify().valid).toBe(true);
    expect(nodeClassOf(re.all().find((r) => r.id === 'r1')!)).toBe('re-scannable');
  });
});
