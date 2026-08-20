import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { link } from '../src/extract/link';
import { similarity, type Candidate } from '../src/resolve/similarity';

/** Phase 10. `DEC-014`: linking reports ranked candidates and never decides identity from a score. */

const RECORDS: readonly Candidate[] = [
  { id: 'd-friday', name: 'we stopped shipping on fridays', type: 'decision' },
  { id: 'd-gate', name: 'we added a pre-deploy gate', type: 'decision' },
  { id: 'note-1', name: 'the friday deploy caused a checkout outage', type: 'node' },
  { id: 'park', name: 'parking permit renewal', type: 'node' },
];

describe('Task 10.1 — ranked candidates, threshold-free verdicts', () => {
  test('a mention matching a record ranks it first', () => {
    const r = link('checkout outage', RECORDS);
    expect(r.verdict).toBe('ranked');
    expect(r.candidates[0]!.id).toBe('note-1');
    expect(r.candidates[0]!.score).toBeGreaterThan(0);
  });

  test('a mention matching nothing returns no_candidates, not a poor match', () => {
    const r = link('quantum tunnelling', RECORDS);
    expect(r).toEqual({ mention: 'quantum tunnelling', verdict: 'no_candidates', candidates: [], margin: null });
  });

  test('two candidates scoring identically return `tie`, because rank 1 is then not an answer', () => {
    const twins: readonly Candidate[] = [
      { id: 'a', name: 'deploy gate', type: 'node' },
      { id: 'b', name: 'deploy gate', type: 'node' },
    ];
    const r = link('deploy gate', twins);
    // Prove the fixture really is a tie before relying on the verdict.
    expect(similarity({ id: 'm', name: 'deploy gate', type: 'node' }, twins[0]!).total)
      .toBe(similarity({ id: 'm', name: 'deploy gate', type: 'node' }, twins[1]!).total);
    expect(r.verdict).toBe('tie');
    expect(r.margin).toBe(0);
  });

  test('the margin is present with two or more candidates and absent with fewer', () => {
    const many = link('the friday deploy', RECORDS);
    expect(many.candidates.length).toBeGreaterThan(1);
    expect(many.margin).not.toBeNull();
    expect(many.margin).toBeCloseTo(many.candidates[0]!.score - many.candidates[1]!.score, 10);

    const one = link('parking permit', RECORDS);
    expect(one.candidates).toHaveLength(1);
    expect(one.margin).toBeNull();
  });

  test('the margin reflects the TRUE top two, not the two that survived the display cap', () => {
    // A cap applied before the margin would report a margin between records the caller never saw.
    const full = link('the friday deploy', RECORDS);
    const capped = link('the friday deploy', RECORDS, { limit: 1 });
    expect(capped.candidates).toHaveLength(1);
    expect(capped.margin).toBe(full.margin);
  });

  test('excluding the source record stops a mention linking to the text it was read from', () => {
    const withSource = link('the friday deploy', RECORDS);
    expect(withSource.candidates[0]!.id).toBe('note-1');          // trivially, the phrase is in it
    const without = link('the friday deploy', RECORDS, { exclude: ['note-1'] });
    expect(without.candidates.map((c) => c.id)).not.toContain('note-1');
    expect(without.candidates.length).toBeGreaterThan(0);
  });

  test('a record sharing no block key is never scored, so ranking never sees it', () => {
    const r = link('checkout outage', RECORDS);
    expect(r.candidates.map((c) => c.id)).not.toContain('park');
  });

  test('ordering is stable across runs', () => {
    const a = link('the friday deploy', RECORDS).candidates.map((c) => c.id);
    const b = link('the friday deploy', RECORDS).candidates.map((c) => c.id);
    expect(a).toEqual(b);
  });
});

describe('Task 10.1 — the module introduces no constant', () => {
  const SRC = readFileSync(join(import.meta.dir, '..', 'src', 'extract', 'link.ts'), 'utf8');
  // Only the code, so the doc comment quoting the original's `>= 0.9` is not mistaken for one.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  test('no exported numeric constant', () => {
    expect(CODE).not.toMatch(/export\s+const\s+\w+\s*(?::\s*number\s*)?=\s*-?\d/);
  });

  test('no comparison against a decimal literal — the shape a threshold takes', () => {
    // `DEC-014` forbids one. Two of the four standard NIL techniques need no number, and those are
    // the two used, so a decimal comparison appearing here means a threshold arrived quietly.
    expect(CODE).not.toMatch(/[<>]=?\s*-?\d*\.\d/);
    expect(CODE.length).toBeGreaterThan(500);          // anti-vacuity: the source really was read
  });

  test('and the scan can find a threshold when one is present', () => {
    // Proving the guard can fail, without waiting for someone to add one.
    const withThreshold = `${CODE}\nconst ok = score >= 0.9;`;
    expect(withThreshold).toMatch(/[<>]=?\s*-?\d*\.\d/);
    expect(`${CODE}\nexport const LINK_FLOOR = 0.35;`).toMatch(/export\s+const\s+\w+\s*(?::\s*number\s*)?=\s*-?\d/);
  });
});

describe('Task 10.2 — the port\'s defect, demonstrated rather than described', () => {
  /**
   * `semantica/semantica/context/entity_linker.py:481`, `_calculate_text_similarity`, transcribed.
   * THIS IS THE ORIGINAL'S BEHAVIOUR, NOT OURS — it is here to be shown wrong.
   */
  function semanticaSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;
    const w1 = new Set(text1.split(' '));
    const w2 = new Set(text2.split(' '));
    if (w1.size === 0 || w2.size === 0) return 0;
    const inter = [...w1].filter((w) => w2.has(w));
    const union = new Set([...w1, ...w2]);
    if (union.size === 0) return 0;
    return inter.length / union.size;
  }

  const A = 'the deploy caused the outage';
  const B = 'the outage caused the deploy';

  test('the ORIGINAL scores two opposite causal statements 1.0, and would call them same_as', () => {
    expect(semanticaSimilarity(A, B)).toBe(1);
    // entity_linker.py:444 — link_type="same_as" if similarity >= 0.9 else "related_to"
    expect(semanticaSimilarity(A, B) >= 0.9).toBe(true);
    // And no threshold rescues it: the score is exactly 1.0, the maximum.
    expect(semanticaSimilarity(A, B) >= 0.99).toBe(true);
  });

  test('THIS engine\'s scorer separates them, because trigrams carry order', () => {
    const s = similarity({ id: 'a', name: A, type: 'node' }, { id: 'b', name: B, type: 'node' }).total;
    expect(s).toBeLessThan(1);
    expect(semanticaSimilarity(A, B)).toBeGreaterThan(s);      // the two really do disagree
  });

  test('and nothing here emits an identity claim from a score, asserted structurally', () => {
    const r = link(A, [{ id: 'b', name: B, type: 'node' }]);
    const serialised = JSON.stringify(r);
    for (const forbidden of ['same_as', 'sameAs', 'identical', 'confidence']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(['no_candidates', 'tie', 'ranked']).toContain(r.verdict);
  });
});
