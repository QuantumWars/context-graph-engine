import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store, StoreError, type StoreDeps } from '../src/store/store';
import { resolveWorkspace, storePaths, type StorePaths } from '../src/store/paths';

/** Phase 8. `DEC-012`: a cluster is derived and never stored; a merge is an appended assertion. */

let dir: string;
let paths: StorePaths;
let t = 0;
let n = 0;
/** An ADVANCING clock. A frozen one hides the inclusive-bound behaviour tested at the bottom. */
const deps: StoreDeps = {
  now: () => `2026-05-${String(++t).padStart(2, '0')}T00:00:00Z`,
  salt: () => `s-${++n}`,
};

beforeEach(() => {
  t = 0; n = 0;
  dir = mkdtempSync(join(tmpdir(), 'ge-merge-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function seeded(): Promise<Store> {
  const s = await Store.open(paths, deps);
  await s.append({ kind: 'node', id: 'A', content: { text: 'checkout outage after friday deploy' } });
  await s.append({ kind: 'node', id: 'B', content: { text: 'friday deploy took checkout down' } });
  await s.append({ kind: 'node', id: 'C', content: { text: 'parking permit renewal' } });
  return s;
}

describe('Task 8.1 — suggest writes nothing', () => {
  test('a suggestion run leaves the log byte-identical', async () => {
    const s = await seeded();
    const before = readFileSync(paths.log, 'utf8');
    const proposals = s.suggest(0.5);
    expect(readFileSync(paths.log, 'utf8')).toBe(before);
    // Anti-vacuity: it really did compute something, so "no write" is not "no work".
    expect(proposals.length).toBeGreaterThan(0);
  });

  test('a proposal names the weakest link holding it together', async () => {
    const s = await seeded();
    const p = s.suggest(0.5)[0]!;
    expect(p.members.length).toBeGreaterThan(1);
    expect(p.weakestLink).not.toBeNull();
    expect(p.weakestLink!.score).toBeGreaterThan(0);
  });

  test('the unrelated record is not proposed', async () => {
    const s = await seeded();
    const all = s.suggest(0.5).flatMap((p) => p.members);
    expect(all).not.toContain('C');
  });

  test('a store with fewer than two named records proposes nothing, rather than throwing', async () => {
    const s = await Store.open(paths, deps);
    expect(s.suggest()).toEqual([]);
    await s.append({ kind: 'node', id: 'only', content: { text: 'one record' } });
    expect(s.suggest()).toEqual([]);
  });
});

describe('Task 8.2 — a merge is appended, and reads resolve through it', () => {
  test('a read for the merged record answers from the canonical AND names the merge', async () => {
    const s = await seeded();
    expect(s.contentOf('B')).toEqual({ text: 'friday deploy took checkout down' });

    const m = await s.merge(['A', 'B'], 'A', 'same incident');
    const re = await Store.open(paths, deps);

    expect(re.contentOf('B')).toEqual({ text: 'checkout outage after friday deploy' });
    const r = re.resolveId('B');
    expect(r).toEqual({ requested: 'B', canonical: 'A', via: m.id });
  });

  test('an unmerged record resolves to itself, with nothing to explain', async () => {
    const s = await seeded();
    await s.merge(['A', 'B'], 'A', 'same');
    expect(s.resolveId('C')).toEqual({ requested: 'C', canonical: 'C', via: null });
  });

  test('nothing is rewritten — both members keep their bytes and their digests', async () => {
    const s = await seeded();
    const before = s.all().filter((r) => ['A', 'B'].includes(r.id)).map((r) => ({ id: r.id, d: r.digest, c: r.content }));
    await s.merge(['A', 'B'], 'A', 'same');
    const after = (await Store.open(paths, deps)).all()
      .filter((r) => ['A', 'B'].includes(r.id)).map((r) => ({ id: r.id, d: r.digest, c: r.content }));
    expect(after).toEqual(before);
  });

  test('the merge record contains NO field value of either member content — DEC-012', async () => {
    const s = await seeded();
    const m = await s.merge(['A', 'B'], 'A', 'same incident');
    const serialised = JSON.stringify(m);
    for (const v of ['checkout outage after friday deploy', 'friday deploy took checkout down']) {
      expect(serialised).not.toContain(v);
    }
    // And prove the scan can find a value when one IS present.
    expect(JSON.stringify({ ...m, leak: 'checkout outage after friday deploy' }))
      .toContain('checkout outage after friday deploy');
    expect(m.meta.members).toEqual(['A', 'B']);
    expect(m.meta.canonical).toBe('A');
  });

  test('the chain verifies after a merge', async () => {
    const s = await seeded();
    await s.merge(['A', 'B'], 'A', 'same');
    expect((await Store.open(paths, deps)).verify().valid).toBe(true);
  });

  test('a merge is refused when it is too small, mis-canonicalised, or names a ghost', async () => {
    const s = await seeded();
    const codes: string[] = [];
    const cases: ReadonlyArray<readonly [string[], string]> =
      [[['A'], 'A'], [['A', 'B'], 'Z'], [['A', 'ghost'], 'A']];
    for (const [members, canon] of cases) {
      try { await s.merge(members, canon); }
      catch (e) { codes.push((e as StoreError).code); }
    }
    expect(codes).toEqual(['merge_too_small', 'canonical_not_a_member', 'not_found']);
  });

  test('a record already in an active merge cannot join a second one', async () => {
    const s = await seeded();
    await s.merge(['A', 'B'], 'A', 'same');
    let code: string | undefined;
    try { await s.merge(['B', 'C'], 'B', 'also same'); }
    catch (e) { code = (e as StoreError).code; }
    // Two competing identity claims would make resolution order-dependent, and an identity that
    // depends on read order is not an identity.
    expect(code).toBe('member_already_merged');
  });
});

describe('Task 8.3 — retracting the merge un-merges it', () => {
  test('after retraction, a read for the member answers from the member again', async () => {
    const s = await seeded();
    const m = await s.merge(['A', 'B'], 'A', 'same');
    expect(s.contentOf('B')).toEqual({ text: 'checkout outage after friday deploy' });

    await s.retract(m.id, 'not the same after all');
    const re = await Store.open(paths, deps);
    expect(re.contentOf('B')).toEqual({ text: 'friday deploy took checkout down' });
    expect(re.resolveId('B').via).toBeNull();
  });

  test('the un-merge is visible on the valid-time axis, not a silent revert', async () => {
    const s = await seeded();
    const m = await s.merge(['A', 'B'], 'A', 'same');
    const mergedAt = m.meta.validFrom as string;
    await s.retract(m.id, 'wrong');
    const re = await Store.open(paths, deps);

    // At the instant the merge was made it was in force; today it is not.
    expect(re.resolveId('B', mergedAt).via).toBe(m.id);
    expect(re.resolveId('B', '2026-12-01T00:00:00Z').via).toBeNull();
  });

  test('there is no separate un-merge operation to drift from retraction', async () => {
    const s = await Store.open(paths, deps);
    expect((s as unknown as Record<string, unknown>)['unmerge']).toBeUndefined();
  });
});

describe('Task 8.4 — the interactions', () => {
  test('purging a NON-canonical member is allowed, and reads still resolve', async () => {
    const s = await seeded();
    await s.merge(['A', 'B'], 'A', 'same');
    await s.purge('B', 'contained a credential');
    const re = await Store.open(paths, deps);
    expect(re.all().find((r) => r.id === 'B')?.content).toBeNull();
    expect(re.contentOf('B')).toEqual({ text: 'checkout outage after friday deploy' });
    expect(re.verify().valid).toBe(true);
  });

  test('purging the CANONICAL is REFUSED, and the refusal says what to do', async () => {
    // The defect this guard exists for, measured before it existed: purging the canonical made
    // contentOf return null for every member, while each member's own content sat untouched on
    // disk. It read as erased and was not — the worst state available for an erasure feature.
    const s = await seeded();
    await s.merge(['A', 'B'], 'A', 'same');
    let err: StoreError | undefined;
    try { await s.purge('A', 'contained a credential'); } catch (e) { err = e as StoreError; }
    expect(err?.code).toBe('canonical_of_active_merge');
    expect(err?.message).toContain('Retract the merge first');
    expect(err?.message).toContain('A, B');

    // And nothing was written by the refusal.
    expect(s.all().find((r) => r.id === 'A')?.content).not.toBeNull();
  });

  test('after retracting the merge, the canonical CAN be purged', async () => {
    const s = await seeded();
    const m = await s.merge(['A', 'B'], 'A', 'same');
    await s.retract(m.id, 'wrong merge');
    await s.purge('A', 'contained a credential');
    const re = await Store.open(paths, deps);
    expect(re.all().find((r) => r.id === 'A')?.content).toBeNull();
    expect(re.contentOf('B')).toEqual({ text: 'friday deploy took checkout down' });
    expect(re.verify().valid).toBe(true);
  });

  test('retracting a MEMBER does not un-merge it — identity and truth are different claims', async () => {
    // A record's claim stopping being true says nothing about whether it names the same thing as
    // another record. Conflating them would let a retraction silently change what a read returns.
    const s = await seeded();
    const m = await s.merge(['A', 'B'], 'A', 'same');
    await s.retract('B', 'that phrasing was wrong');
    expect(s.resolveId('B').via).toBe(m.id);
  });

  test('a purged member leaves the merge record intact, because it holds no content', async () => {
    const s = await seeded();
    const m = await s.merge(['A', 'B'], 'A', 'same');
    await s.purge('B', 'credential');
    const re = await Store.open(paths, deps);
    const still = re.all().find((r) => r.id === m.id)!;
    expect(still.content).not.toBeNull();
    expect(still.meta.members).toEqual(['A', 'B']);
  });

  test('the remedy the refusal names WORKS when followed immediately', async () => {
    // Found by running the real CLI, not by a test. The message said "Retract the merge first";
    // doing exactly that within the same second was refused again, because `now()` has one-second
    // resolution and Algorithm 2's windows are inclusive at both ends. An error that instructs an
    // action and then rejects it is worse than no message. A FROZEN clock reproduces it exactly.
    const frozen: StoreDeps = { now: () => '2026-05-01T00:00:00Z', salt: () => `f-${++n}` };
    const s = await Store.open(paths, frozen);
    await s.append({ kind: 'node', id: 'A', content: { text: 'canonical' } });
    await s.append({ kind: 'node', id: 'B', content: { text: 'duplicate' } });
    const m = await s.merge(['A', 'B'], 'A', 'same');
    await s.retract(m.id, 'wrong merge');
    await s.purge('A', 'leaked token');                    // same instant as the retraction
    expect(s.all().find((r) => r.id === 'A')?.content).toBeNull();
    expect(s.verify().valid).toBe(true);
  });

  test('but a merge still open at that instant is STILL refused — the guard was narrowed, not removed', async () => {
    const frozen: StoreDeps = { now: () => '2026-05-01T00:00:00Z', salt: () => `g-${++n}` };
    const s = await Store.open(paths, frozen);
    await s.append({ kind: 'node', id: 'A', content: { text: 'canonical' } });
    await s.append({ kind: 'node', id: 'B', content: { text: 'duplicate' } });
    await s.merge(['A', 'B'], 'A', 'same');
    let code: string | undefined;
    try { await s.purge('A', 'leaked token'); } catch (e) { code = (e as StoreError).code; }
    expect(code).toBe('canonical_of_active_merge');
  });

  test('retracting the CANONICAL leaves reads resolving to it, because retraction keeps content', async () => {
    // Distinct from purge, and deliberately so: a retraction says the claim stopped being true,
    // not that the record is gone. `B` still names the same thing, and that thing's content is
    // still readable — which is what makes "what did we believe in March" answerable at all.
    const s = await seeded();
    const m = await s.merge(['A', 'B'], 'A', 'same');
    await s.retract('A', 'the canonical claim stopped being true');
    expect(s.contentOf('B')).toEqual({ text: 'checkout outage after friday deploy' });
    expect(s.resolveId('B').via).toBe(m.id);
    expect(s.verify().valid).toBe(true);
  });

  test('a retraction takes effect AFTER the instant it names — inclusive bounds', async () => {
    // Consistent with Algorithm 2, where bounds are inclusive at both ends. The practical edge:
    // retract and purge within the same second, and the purge is still refused, because `now()`
    // has one-second resolution and the merge is still active AT its closing instant.
    const s = await seeded();
    const m = await s.merge(['A', 'B'], 'A', 'same');
    const at = '2026-06-01T00:00:00Z';
    await s.retract(m.id, 'wrong', at);
    expect(s.resolveId('B', at).via).toBe(m.id);            // still in force AT the instant
    expect(s.resolveId('B', '2026-06-01T00:00:01Z').via).toBeNull();  // and gone one second later
  });
});

describe('DEC-015 — a merged view is composed at read time, never stored', () => {
  async function twoHalves(): Promise<Store> {
    const s = await Store.open(paths, deps);
    await s.append({ kind: 'node', id: 'A', content: { text: 'checkout outage', severity: 'p1' } });
    await s.append({ kind: 'node', id: 'B', content: { text: 'the friday incident', owner: 'platform' } });
    return s;
  }

  test('the view composes fields the canonical does not have', async () => {
    const s = await twoHalves();
    // Before the merge, the canonical alone knows nothing about the owner.
    expect(s.contentOf('A')).toEqual({ text: 'checkout outage', severity: 'p1' });
    await s.merge(['A', 'B'], 'A', 'same incident');

    const v = (await Store.open(paths, deps)).mergedView('A');
    expect(v.content).toEqual({ text: 'checkout outage', severity: 'p1', owner: 'platform' });
    expect([...v.members].sort()).toEqual(['A', 'B']);
    expect(v.canonical).toBe('A');
  });

  test('the canonical wins a disagreement, AND the disagreement is reported with who holds what', async () => {
    const s = await twoHalves();
    await s.merge(['A', 'B'], 'A', 'same incident');
    const v = s.mergedView('B');                     // asking via the non-canonical member
    expect((v.content as Record<string, unknown>)['text']).toBe('checkout outage');
    const clash = v.conflicts.find((c) => c.field === 'text')!;
    expect(clash.values.map((x) => x.value)).toEqual(['checkout outage', 'the friday incident']);
    expect(clash.values.map((x) => x.from)).toEqual([['A'], ['B']]);
    // A field only one member has is not a conflict.
    expect(v.conflicts.map((c) => c.field)).not.toContain('owner');
  });

  test('a record in no merge returns its own content and no conflicts — callers need no special case', async () => {
    const s = await twoHalves();
    const v = s.mergedView('A');
    expect(v).toEqual({
      requested: 'A', canonical: 'A', via: null, members: ['A'],
      content: { text: 'checkout outage', severity: 'p1' }, conflicts: [], unavailable: [],
    });
  });

  test('a purged member is named in `unavailable`, so a thin view is not mistaken for a complete one', async () => {
    const s = await twoHalves();
    await s.merge(['A', 'B'], 'A', 'same incident');
    await s.purge('B', 'contained a customer name');
    const v = (await Store.open(paths, deps)).mergedView('A');
    expect(v.unavailable).toEqual(['B']);
    expect(v.content).toEqual({ text: 'checkout outage', severity: 'p1' });   // B's owner is gone
    expect(JSON.stringify(v)).not.toContain('platform');
  });

  test('a RETRACTED member still composes, because retraction is not erasure', async () => {
    const s = await twoHalves();
    await s.merge(['A', 'B'], 'A', 'same incident');
    await s.retract('B', 'that phrasing was wrong');
    const v = s.mergedView('A');
    expect(v.unavailable).toEqual([]);
    expect((v.content as Record<string, unknown>)['owner']).toBe('platform');
  });

  test('composing writes nothing', async () => {
    const s = await twoHalves();
    await s.merge(['A', 'B'], 'A', 'same incident');
    const before = readFileSync(paths.log, 'utf8');
    const v = s.mergedView('A');
    expect(Object.keys(v.content as object).length).toBeGreaterThan(2);   // it really composed
    expect(readFileSync(paths.log, 'utf8')).toBe(before);
  });
});
