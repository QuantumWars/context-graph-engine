import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  appendEntry, computeContentDigest, isPurged, purgeContent, verifyChain,
  type ChainEntry, type BreakReason,
} from '../src/provenance/chain';
import type { Json } from '../src/provenance/canonical';

/** Deterministic salts — Stage 1 is pure, so the salt is a parameter, never generated here. */
const salt = (n: number): string => `salt-${n.toString().padStart(4, '0')}`;

function buildChain(n: number): ChainEntry[] {
  const out: ChainEntry[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(appendEntry(out, {
      kind: 'node',
      id: `n${i}`,
      content: { text: `record ${i}`, i },
      meta: { workspace: '/w' },
    }, salt(i)));
  }
  return out;
}

const reasons = (es: readonly ChainEntry[]): BreakReason[] =>
  verifyChain(es).problems.map((p) => p.reason);

describe('chain — the clean case', () => {
  test('a chain of N entries verifies clean', () => {
    const c = buildChain(12);
    // Anti-vacuity: a verifier that scans nothing also reports zero problems, so assert
    // it actually walked the chain before trusting `valid`.
    expect(c).toHaveLength(12);
    const r = verifyChain(c);
    expect(r.total).toBe(12);
    expect(r.problems).toEqual([]);
    expect(r.valid).toBe(true);
  });

  test('seq starts at 1 and prev links each entry to its predecessor', () => {
    const c = buildChain(3);
    expect(c.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(c[0]!.prev).toBeNull();
    expect(c[1]!.prev).toBe(c[0]!.digest);
    expect(c[2]!.prev).toBe(c[1]!.digest);
  });

  test('an empty chain is valid and says so, rather than throwing', () => {
    expect(verifyChain([])).toEqual({ valid: true, total: 0, purged: 0, problems: [] });
  });
});

describe('chain — tampering is detected', () => {
  test('editing an entry content in place is reported as content_tampered on that entry', () => {
    const c = buildChain(5);
    c[2] = { ...c[2]!, content: { text: 'edited', i: 3 } };

    const r = verifyChain(c);
    expect(r.valid).toBe(false);
    // Exactly one problem, on exactly the edited entry — not a cascade over its successors.
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]!.reason).toBe('content_tampered');
    expect(r.problems[0]!.seq).toBe(3);
    expect(r.problems[0]!.id).toBe('n3');
  });

  test('editing an attested field is reported as digest_mismatch', () => {
    const c = buildChain(4);
    c[1] = { ...c[1]!, meta: { workspace: '/somewhere-else' } };
    const r = verifyChain(c);
    expect(r.problems.map((p) => p.reason)).toEqual(['digest_mismatch']);
    expect(r.problems[0]!.seq).toBe(2);
  });

  test('deleting an entry is reported as BOTH chain_break and sequence_gap on its successor', () => {
    const c = buildChain(6);
    const withHole = [...c.slice(0, 2), ...c.slice(3)]; // drop seq 3

    const r = verifyChain(withHole);
    expect(r.valid).toBe(false);
    // Both signals fire, on the successor of the deleted row. Checking both is what
    // catches the narrow case where two rows share a digest — manager.py:1432-1436.
    const onSuccessor = r.problems.filter((p) => p.seq === 4);
    expect(onSuccessor.map((p) => p.reason).sort()).toEqual(['chain_break', 'sequence_gap']);
    expect(r.problems).toHaveLength(2);
  });

  test('reordering two entries is detected', () => {
    const c = buildChain(5);
    const swapped = [c[0]!, c[2]!, c[1]!, c[3]!, c[4]!];
    expect(verifyChain(swapped).valid).toBe(false);
  });

  test('one corrupt entry does not cascade into false reports about later entries', () => {
    const c = buildChain(8);
    c[1] = { ...c[1]!, content: { text: 'tampered', i: 2 } };
    const r = verifyChain(c);
    // Entries 3..8 are untouched and must stay unflagged. A verifier that advanced from
    // its own expectations rather than each entry's stored fields would flag all of them.
    expect(r.problems.every((p) => p.seq === 2)).toBe(true);
  });

  test('a forged prev pointing at a real earlier digest is still caught', () => {
    const c = buildChain(4);
    c[3] = { ...c[3]!, prev: c[0]!.digest };
    expect(reasons(c)).toContain('chain_break');
  });

  test('half a purge — salt removed but content kept — is content_tampered, not purged', () => {
    const c = buildChain(3);
    c[1] = { ...c[1]!, salt: null };
    expect(isPurged(c[1]!)).toBe(false);
    const r = verifyChain(c);
    expect(r.problems.map((p) => p.reason)).toEqual(['content_tampered']);
    expect(r.purged).toBe(0);
  });
});

describe('chain — the DEC-007 property: a purge does not break the chain', () => {
  test('a purged entry still verifies, and the chain stays valid', () => {
    const c = buildChain(5);
    const target = c[2]!;
    c[2] = purgeContent(target);

    expect(isPurged(c[2]!)).toBe(true);
    expect(c[2]!.content).toBeNull();
    expect(c[2]!.salt).toBeNull();

    const r = verifyChain(c);
    expect(r.problems).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.purged).toBe(1);
  });

  test('a purge leaves the attested fields untouched, which is why the chain survives', () => {
    const c = buildChain(3);
    const before = c[1]!;
    const after = purgeContent(before);
    expect(after.digest).toBe(before.digest);
    expect(after.prev).toBe(before.prev);
    expect(after.seq).toBe(before.seq);
    expect(after.contentDigest).toBe(before.contentDigest);
  });

  test('a purge still cannot hide a real break elsewhere', () => {
    const c = buildChain(6);
    c[1] = purgeContent(c[1]!);
    c[4] = { ...c[4]!, meta: { workspace: '/tampered' } };
    const r = verifyChain(c);
    // The purged entry is silent; the tampered one is not.
    expect(r.problems.map((p) => p.seq)).toEqual([5]);
    expect(r.problems[0]!.reason).toBe('digest_mismatch');
  });

  test('purging destroys the salt, so the commitment cannot be brute-forced back', () => {
    // The point of deleting the salt. With a low-entropy content — here a single boolean —
    // an unsalted commitment is trivially invertible by trying every candidate.
    const lowEntropy: Json[] = [true, false];
    const e = appendEntry([], { kind: 'node', id: 'x', content: true }, 'secret-salt');
    const purgedEntry = purgeContent(e);

    // Unsalted, the attacker wins immediately.
    const unsalted = createHash('sha256').update('true', 'utf8').digest('hex');
    expect(lowEntropy.some((g) =>
      createHash('sha256').update(JSON.stringify(g), 'utf8').digest('hex') === unsalted,
    )).toBe(true);

    // Salted with a salt that no longer exists anywhere in the record, guessing the
    // content is not enough — the attacker would also have to guess the salt.
    expect(purgedEntry.salt).toBeNull();
    expect(lowEntropy.some((g) =>
      computeContentDigest('', g) === purgedEntry.contentDigest,
    )).toBe(false);
  });
});

describe('chain — the collision Semantica has and we do not', () => {
  test('two records differing only in where a field boundary falls hash differently', () => {
    // semantica/semantica/provenance/integrity.py:74-116 joins its fields with no
    // separator, so a boundary can move without changing the bytes that get hashed.
    const semanticaStyle = (a: string, b: string): string =>
      createHash('sha256').update(`${a}${b}`, 'utf8').digest('hex');

    // Anti-vacuity first: prove the original really does collide on this input, so this
    // test is measuring a real defect rather than asserting our own code agrees with itself.
    expect(semanticaStyle('ab', 'c')).toBe(semanticaStyle('a', 'bc'));

    const one = appendEntry([], { kind: 'node', id: 'x', content: { a: 'ab', b: 'c' } }, 's');
    const two = appendEntry([], { kind: 'node', id: 'x', content: { a: 'a', b: 'bc' } }, 's');
    expect(one.contentDigest).not.toBe(two.contentDigest);
    expect(one.digest).not.toBe(two.digest);
  });

  test('the salt/content boundary cannot be moved either', () => {
    // Length-prefixing the salt is what stops ("ab", "c") and ("a", "bc") colliding
    // across the salt boundary rather than within the content.
    expect(computeContentDigest('ab', 'c')).not.toBe(computeContentDigest('a', 'bc'));
  });

  test('every digest is a 64-character hex string', () => {
    const c = buildChain(3);
    for (const e of c) {
      expect(e.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(e.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
