import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, type StoreDeps } from '../src/store/store';
import { resolveWorkspace, storePaths, type StorePaths } from '../src/store/paths';
import { LogError, readLog } from '../src/store/log';
import { verifyChain, type ChainEntry } from '../src/provenance/chain';

/**
 * Every way someone with write access to `log.jsonl` could try to rewrite history.
 *
 * Two of them are NOT caught, and the tests for those assert the gap rather than hiding it —
 * see the "what this chain cannot detect" block at the bottom. An adversarial suite that only
 * lists the attacks it defeats is marketing.
 */

let dir: string;
let paths: StorePaths;
let n = 0;
const deps: StoreDeps = {
  now: () => `2026-03-0${(n % 9) + 1}T00:00:00Z`,
  salt: () => `salt-${String(++n).padStart(4, '0')}`,
};

beforeEach(() => {
  n = 0;
  dir = mkdtempSync(join(tmpdir(), 'ge-adv-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function seed(count = 5): Promise<Store> {
  const s = await Store.open(paths, deps);
  for (let i = 1; i <= count; i++) {
    await s.append({ kind: 'node', id: `r${i}`, content: { text: `record number ${i}`, i } });
  }
  return s;
}

const lines = (): string[] => readFileSync(paths.log, 'utf8').trimEnd().split('\n');
const write = (ls: readonly string[]): void => writeFileSync(paths.log, ls.join('\n') + '\n');

/** Load and return the reason codes, or the LogError code if the file will not even parse. */
async function attack(): Promise<{ codes: string[]; loadError?: string }> {
  try {
    const raw = readLog(paths);
    const report = verifyChain(raw as readonly ChainEntry[]);
    return { codes: report.problems.map((p) => p.reason) };
  } catch (e) {
    if (e instanceof LogError) return { codes: [], loadError: e.code };
    throw e;
  }
}

describe('adversarial — modification', () => {
  test('ATTACK: edit a record content in place → content_tampered', async () => {
    await seed();
    const ls = lines();
    const r = JSON.parse(ls[2]!) as { content: { text: string } };
    expect(r.content.text).toBe('record number 3');   // the edit is not a no-op
    r.content.text = 'record number three, obviously';
    ls[2] = JSON.stringify(r);
    write(ls);
    expect((await attack()).codes).toEqual(['content_tampered']);
  });

  test('ATTACK: edit an attested field → digest_mismatch', async () => {
    await seed();
    const ls = lines();
    const r = JSON.parse(ls[1]!) as { meta: { recordedAt: string } };
    r.meta.recordedAt = '2020-01-01T00:00:00Z';       // backdate it
    ls[1] = JSON.stringify(r);
    write(ls);
    expect((await attack()).codes).toEqual(['digest_mismatch']);
  });

  test('ATTACK: swap two records content, keeping both digests → both flagged', async () => {
    await seed();
    const ls = lines();
    const a = JSON.parse(ls[1]!) as { content: unknown };
    const b = JSON.parse(ls[2]!) as { content: unknown };
    [a.content, b.content] = [b.content, a.content];
    ls[1] = JSON.stringify(a); ls[2] = JSON.stringify(b);
    write(ls);
    const { codes } = await attack();
    expect(codes).toEqual(['content_tampered', 'content_tampered']);
  });
});

describe('adversarial — structure', () => {
  test('ATTACK: delete a record → chain_break AND sequence_gap on its successor', async () => {
    await seed();
    const ls = lines();
    write([...ls.slice(0, 2), ...ls.slice(3)]);
    const { codes } = await attack();
    expect(codes.sort()).toEqual(['chain_break', 'sequence_gap']);
  });

  test('ATTACK: reorder two records → caught', async () => {
    await seed();
    const ls = lines();
    write([ls[0]!, ls[2]!, ls[1]!, ls[3]!, ls[4]!]);
    expect((await attack()).codes.length).toBeGreaterThan(0);
  });

  test('ATTACK: replay — append a duplicate of an existing record → caught', async () => {
    await seed();
    const ls = lines();
    write([...ls, ls[1]!]);          // record 2, appended again at the end
    const { codes } = await attack();
    expect(codes).toContain('chain_break');
    expect(codes).toContain('sequence_gap');
  });

  test('ATTACK: forge prev to point at a real earlier digest → chain_break', async () => {
    await seed();
    const ls = lines();
    const first = JSON.parse(ls[0]!) as { digest: string };
    const r = JSON.parse(ls[3]!) as { prev: string };
    r.prev = first.digest;           // a real digest, from a real record, just the wrong one
    ls[3] = JSON.stringify(r);
    write(ls);
    const { codes } = await attack();
    expect(codes).toContain('digest_mismatch');   // prev is attested, so the digest moves too
  });

  test('ATTACK: renumber seq to close a gap after deleting → still caught by the link', async () => {
    await seed();
    const ls = lines().filter((_, i) => i !== 2);   // drop record 3
    const fixed = ls.map((l, i) => {
      const r = JSON.parse(l) as { seq: number };
      r.seq = i + 1;                                 // renumber so the sequence looks contiguous
      return JSON.stringify(r);
    });
    write(fixed);
    const { codes } = await attack();
    // The sequence now looks clean, so the LINK is what survives to catch it. This is why
    // both checks exist — either alone can be defeated.
    expect(codes).toContain('digest_mismatch');
  });
});

describe('adversarial — the file itself', () => {
  test('ATTACK: truncate mid-line → malformed_line, not a shorter valid log', async () => {
    await seed();
    const text = readFileSync(paths.log, 'utf8');
    writeFileSync(paths.log, text.slice(0, text.length - 40));
    const { loadError } = await attack();
    expect(loadError).toBe('malformed_line');
  });

  test('ATTACK: inject a line that is valid JSON but not a record → unknown_kind', async () => {
    await seed();
    write([...lines(), JSON.stringify({ kind: 'invoice', id: 'x' })]);
    expect((await attack()).loadError).toBe('unknown_kind');
  });

  test('ATTACK: blank lines are tolerated, because they change nothing', async () => {
    await seed();
    const ls = lines();
    writeFileSync(paths.log, [ls[0], '', ls[1], '', ...ls.slice(2)].join('\n') + '\n');
    const { codes, loadError } = await attack();
    expect(loadError).toBeUndefined();
    expect(codes).toEqual([]);
  });

  test('ATTACK: purge-as-cover — empty a record to hide a break elsewhere → break still caught', async () => {
    const s = await seed();
    await s.purge('r2', 'cover story');
    const ls = lines();
    const idx = ls.findIndex((l) => (JSON.parse(l) as { id: string }).id === 'r4');
    const r = JSON.parse(ls[idx]!) as { content: { text: string } };
    r.content.text = 'tampered under cover of a purge';
    ls[idx] = JSON.stringify(r);
    write(ls);
    const { codes } = await attack();
    expect(codes).toEqual(['content_tampered']);   // exactly one — the purged record stays silent
  });
});

describe('what this chain CANNOT detect — stated, not hidden', () => {
  test('LIMITATION: truncating whole records off the END is not detected', async () => {
    // The remaining records are internally consistent: seq 1..k contiguous, every link intact.
    // Nothing in the file says how long the file should be, so a suffix truncation is
    // indistinguishable from a store that was simply never written to again.
    await seed(5);
    const ls = lines();
    write(ls.slice(0, 3));                       // drop the last two records entirely

    const { codes, loadError } = await attack();
    expect(loadError).toBeUndefined();
    expect(codes).toEqual([]);                   // verifies clean — the gap, asserted
    expect(readLog(paths)).toHaveLength(3);

    // And it loads without complaint, which is the part that matters for a caller.
    const reopened = await Store.open(paths, deps);
    expect(reopened.all()).toHaveLength(3);
  });

  test('LIMITATION: a wholesale rewrite by someone holding the code is not detected', async () => {
    // An attacker who can run this engine can build a fresh, internally perfect log saying
    // anything. Detecting that needs an anchor OUTSIDE the file — a signature over the head,
    // or a copy of the head digest held somewhere the attacker does not control.
    await seed(3);
    const honest = readFileSync(paths.log, 'utf8');

    rmSync(paths.log);
    const forged = await Store.open(paths, deps);
    await forged.append({ kind: 'node', id: 'r1', content: { text: 'a story that never happened' } });

    expect(readFileSync(paths.log, 'utf8')).not.toBe(honest);
    expect(forged.verify().valid).toBe(true);     // perfectly valid, and entirely fabricated
  });

  test('both limitations are documented, and this fails if the documentation is removed', () => {
    // The previous version of this test was `expect(claim).toBe(claim)` — vacuous, and it would
    // have passed against a deleted file, a deleted engine, anything. It asserted that a string
    // equals itself. Caught while writing Task 3.5's audit criteria against my own suite.
    //
    // The real guard: both limitations must be written down where someone will find them. If a
    // future session claims the chain is anchored, this goes red until the docs agree.
    const doc = readFileSync(
      new URL('../docs/future-work/02-what-the-chain-cannot-detect.md', import.meta.url), 'utf8',
    );
    expect(doc.length).toBeGreaterThan(500);                    // anti-vacuity: a real document
    expect(doc.toLowerCase()).toContain('truncat');
    expect(doc.toLowerCase()).toContain('wholesale');
    expect(doc).toContain('not built');
  });
});
