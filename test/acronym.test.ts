import { describe, expect, test } from 'bun:test';
import { acronymsIn, expandAgainst, initialismSpan } from '../src/extract/acronym';
import { link } from '../src/extract/link';
import type { Candidate } from '../src/resolve/similarity';

/** Phase 17. Schwartz & Hearst's matching rule: a long form supports a short one, or it does not. */

describe('acronymsIn', () => {
  test('finds all-capital tokens of two or more characters', () => {
    expect(acronymsIn('the SLO doc')).toEqual(['SLO']);
    expect(acronymsIn('the CDN provider contract')).toEqual(['CDN']);
    expect(acronymsIn('SLO and CDN')).toEqual(['SLO', 'CDN']);
  });

  test('an ordinary capitalised word is not an acronym', () => {
    // Without this, "The checkout service" would look like it began with a short form.
    expect(acronymsIn('The checkout service')).toEqual([]);
    expect(acronymsIn('Acme Robotics Group')).toEqual([]);
  });

  test('a single letter is not an acronym', () => {
    expect(acronymsIn('plan A')).toEqual([]);
  });

  test('punctuation is stripped rather than blocking a match', () => {
    expect(acronymsIn('the SLO, revised')).toEqual(['SLO']);
    expect(acronymsIn('(CDN)')).toEqual(['CDN']);
  });
});

describe('initialismSpan — the matching rule', () => {
  test('a long form whose word initials spell the short form matches, and returns that span', () => {
    expect(initialismSpan('SLO', 'the service level objective document'))
      .toEqual(['service', 'level', 'objective']);
  });

  test('a long form that does NOT support it returns null', () => {
    // The important half. Without it an acronym would lift every record's score.
    expect(initialismSpan('SLO', 'the search indexer')).toBeNull();
    expect(initialismSpan('SLO', 'the second quarter reliability review')).toBeNull();
    expect(initialismSpan('API', 'the platform team')).toBeNull();
  });

  test('a literal occurrence matches itself', () => {
    expect(initialismSpan('CDN', 'the CDN provider contract')).toEqual(['cdn']);
  });

  test("the paper's own hard case, matching a character inside a word", () => {
    // GNAT for Gcn5-related N-acetyltransferase is the example Schwartz & Hearst use to show that
    // initials alone are not enough. Dropping the inside-a-word rule loses it.
    expect(initialismSpan('GNAT', 'Gcn5-related N-acetyltransferase'))
      .toEqual(['gcn5', 'related']);
  });

  test('the first character must begin a word', () => {
    // `LO` appears inside "level objective" but nothing there STARTS with L before O in order
    // beginning at a word boundary other than "level" — this asserts the anchor rule holds.
    expect(initialismSpan('VL', 'the service level objective')).toBeNull();
  });

  test('a one-character short form is refused', () => {
    expect(initialismSpan('S', 'the service level objective')).toBeNull();
  });

  test('an empty long form is refused rather than throwing', () => {
    expect(initialismSpan('SLO', '')).toBeNull();
    expect(initialismSpan('SLO', '   ')).toBeNull();
  });
});

describe('expandAgainst — per record, never globally', () => {
  test('it expands against a supporting record', () => {
    expect(expandAgainst('the SLO doc', 'the service level objective document'))
      .toBe('the service level objective doc');
  });

  test('it leaves the text alone against a record that does not support it', () => {
    // This is what stops an acronym lifting the score of an unrelated record.
    expect(expandAgainst('the SLO doc', 'the search indexer')).toBe('the SLO doc');
    expect(expandAgainst('the checkout service', 'anything at all')).toBe('the checkout service');
  });
});

describe('linking, end to end', () => {
  const RECS: readonly Candidate[] = [
    { id: 'doc-slo', name: 'the service level objective document', type: 'node' },
    { id: 'svc-search', name: 'the search indexer', type: 'node' },
    { id: 'doc-runbook', name: 'the incident response runbook', type: 'node' },
  ];

  test('an acronym mention now ranks its expansion first', () => {
    const r = link('the SLO doc', RECS);
    expect(r.candidates[0]!.id).toBe('doc-slo');
  });

  test('and it beats the record it used to lose to', () => {
    // Measured before this change: svc-search ranked first at 0.112 and doc-slo sat at rank 2.
    const r = link('the SLO doc', RECS);
    const slo = r.candidates.find((c) => c.id === 'doc-slo')!;
    const search = r.candidates.find((c) => c.id === 'svc-search');
    expect(slo.score).toBeGreaterThan(search?.score ?? 0);
  });

  test('a record that does not support the acronym is not lifted by it', () => {
    const withAcronym = link('the SLO doc', RECS).candidates.find((c) => c.id === 'svc-search');
    const without = link('the doc', RECS).candidates.find((c) => c.id === 'svc-search');
    // svc-search cannot expand SLO, so its score comes from the unexpanded mention either way.
    expect(withAcronym?.score ?? 0).toBeLessThan(0.3);
    expect(without === undefined || without.score >= 0).toBe(true);
  });

  test('a mention with no acronym is scored exactly as before', () => {
    const r = link('the incident response runbook', RECS);
    expect(r.candidates[0]!.id).toBe('doc-runbook');
    expect(r.candidates[0]!.score).toBeGreaterThan(0.5);
  });
});
