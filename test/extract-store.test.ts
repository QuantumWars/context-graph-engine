import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, StoreError, type StoreDeps } from '../src/store/store';
import { resolveWorkspace, storePaths, type StorePaths } from '../src/store/paths';

/** Phase 9, Task 9.4. `DEC-013`: the extractor proposes; a caller disposes; a span never copies text. */

let dir: string;
let paths: StorePaths;
let t = 0;
let n = 0;
const deps: StoreDeps = {
  now: () => `2026-05-${String(++t).padStart(2, '0')}T00:00:00Z`,
  salt: () => `s-${++n}`,
};

const SENTENCE = 'The friday deploy caused a checkout outage.';

beforeEach(() => {
  t = 0; n = 0;
  dir = mkdtempSync(join(tmpdir(), 'ge-ex-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function seeded(): Promise<Store> {
  const s = await Store.open(paths, deps);
  await s.append({ kind: 'decision', id: 'd-friday', content: { text: 'we stopped shipping on fridays' } });
  await s.append({ kind: 'decision', id: 'd-gate', content: { text: 'we added a pre-deploy gate' } });
  await s.append({ kind: 'node', id: 'note-1', content: { text: SENTENCE } });
  return s;
}

describe('Task 9.4 — propose writes nothing', () => {
  test('a proposal run leaves the log byte-identical', async () => {
    const s = await seeded();
    const before = readFileSync(paths.log, 'utf8');
    const proposals = s.propose('note-1');
    expect(readFileSync(paths.log, 'utf8')).toBe(before);
    expect(proposals).toHaveLength(1);        // anti-vacuity: it really did compute something
  });

  test('a proposal carries the quoted evidence, resolved rather than stored', async () => {
    const s = await seeded();
    const p = s.propose('note-1')[0]!;
    expect(p.predicate).toBe('CAUSED');
    expect(p.subjectText).toBe('The friday deploy');
    expect(p.triggerText).toBe('The friday deploy caused a checkout outage');
  });

  test('a record with no text, and a record that does not exist, propose nothing rather than throwing', async () => {
    const s = await seeded();
    await s.append({ kind: 'node', id: 'no-text', content: { note: 'has no text key' } });
    expect(s.propose('no-text')).toEqual([]);
    expect(s.propose('does-not-exist')).toEqual([]);
  });
});

describe('Task 9.4 — confirming appends exactly one edge, carrying its evidence', () => {
  test('the edge exists, resolves back to the trigger text, and the chain verifies', async () => {
    const s = await seeded();
    const p = s.propose('note-1')[0]!;
    const before = s.all().length;
    const edge = await s.confirm(p, 'd-friday', 'd-gate', 'read from note-1');

    const re = await Store.open(paths, deps);
    expect(re.all().length).toBe(before + 1);
    expect(re.getEdge(edge.id)).toBeDefined();

    const ev = re.evidenceFor(edge.id)!;
    expect(ev.rule).toBe('caused-direct');
    expect(ev.source).toBe('note-1');
    expect(ev.quote).toEqual({ ok: true, quote: 'The friday deploy caused a checkout outage' });
    expect(re.verify().valid).toBe(true);
  });

  test('the causal walk reaches it, so the extracted edge is a real edge', async () => {
    const s = await seeded();
    await s.confirm(s.propose('note-1')[0]!, 'd-friday', 'd-gate');
    const chains = (await Store.open(paths, deps)).why('d-friday', 'downstream', 3);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.hops[0]!.type).toBe('CAUSED');
  });

  test('THE EDGE STORES NO TEXT — the whole point of DEC-013', async () => {
    // Semantica's Relation carries `context: str`, a ±30-character copy of the source. Porting
    // that would leave the sentence sitting in the edge after the record was purged.
    const s = await seeded();
    const edge = await s.confirm(s.propose('note-1')[0]!, 'd-friday', 'd-gate');
    const serialised = JSON.stringify(edge);
    for (const v of [SENTENCE, 'friday deploy', 'checkout outage']) {
      expect(serialised).not.toContain(v);
    }
    // And the scan can find a value when one IS present.
    expect(JSON.stringify({ ...edge, leak: 'checkout outage' })).toContain('checkout outage');
    // Derived from the sentence rather than hand-counted: the trigger is the whole sentence less
    // its full stop, which a rule cannot match.
    expect(edge.meta.triggerSpan).toEqual({ source: 'note-1', start: 0, end: SENTENCE.length - 1 });
    expect(SENTENCE.length - 1).toBe(42);
  });

  test('an endpoint that is not a live record is refused with a reason code', async () => {
    const s = await seeded();
    const p = s.propose('note-1')[0]!;
    const codes: string[] = [];
    for (const [from, to] of [['ghost', 'd-gate'], ['d-friday', 'ghost']] as const) {
      try { await s.confirm(p, from, to); } catch (e) { codes.push((e as StoreError).code); }
    }
    expect(codes).toEqual(['endpoint_not_found', 'endpoint_not_found']);
  });

  test('a span that no longer resolves is refused rather than recorded as evidence', async () => {
    // Recording evidence that already points at nothing would make the edge look supported.
    const s = await seeded();
    const p = s.propose('note-1')[0]!;
    await s.purge('note-1', 'contained a customer name');
    let code: string | undefined;
    try { await s.confirm(p, 'd-friday', 'd-gate'); } catch (e) { code = (e as StoreError).code; }
    expect(code).toBe('span_unresolvable');
  });
});

describe('Task 9.4 — purging the source erases the evidence, and leaves no copy', () => {
  test('evidence becomes source_purged, the edge stands, and the chain still verifies', async () => {
    const s = await seeded();
    const edge = await s.confirm(s.propose('note-1')[0]!, 'd-friday', 'd-gate');
    expect(s.evidenceFor(edge.id)!.quote.ok).toBe(true);      // reachable first, or this proves nothing

    await s.purge('note-1', 'contained a customer name');
    const re = await Store.open(paths, deps);

    expect(re.evidenceFor(edge.id)!.quote).toEqual({ ok: false, reason: 'source_purged' });
    expect(re.getEdge(edge.id)).toBeDefined();
    expect(re.verify().valid).toBe(true);
  });

  test('and the sentence is gone from the FILE — no copy survives in the edge', async () => {
    const s = await seeded();
    await s.confirm(s.propose('note-1')[0]!, 'd-friday', 'd-gate');
    const withText = readFileSync(paths.log, 'utf8');
    expect(withText).toContain('checkout outage');            // prove the scan works, before purge

    await s.purge('note-1', 'contained a customer name');
    const after = readFileSync(paths.log, 'utf8');
    for (const v of [SENTENCE, 'friday deploy', 'checkout outage']) {
      expect(after).not.toContain(v);
    }
  });

  test('an edge asserted by hand has no provenance, and says so rather than inventing one', async () => {
    const s = await seeded();
    await s.append({
      kind: 'edge', id: 'by-hand', content: {},
      source: 'd-friday', target: 'd-gate', edgeType: 'CAUSED', weight: 1,
    });
    expect(s.evidenceFor('by-hand')).toBeNull();
    expect(s.evidenceFor('no-such-edge')).toBeNull();
  });
});
