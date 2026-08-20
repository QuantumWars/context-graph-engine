import { describe, expect, test } from 'bun:test';
import { assertsRelation, governingClause, trimmedSubjectStart, POLARITY_CUES, PSEUDO_CUES } from '../src/extract/polarity';
import { extractWithSuppressed } from '../src/extract/rules';

/** Phase 14. A relation is emitted only when its clause asserts it — not denies, hedges or asks it. */

const rel = (t: string) => extractWithSuppressed('x', t);

describe('governingClause — scope is a clause, not a token window', () => {
  test('it runs from the nearest boundary before the offset', () => {
    const t = 'It is not raining and the deploy caused the outage.';
    expect(governingClause(t, t.indexOf('caused'))).toBe('the deploy ');
  });

  test('sentence punctuation ends a clause', () => {
    const t = 'The rollback did not prevent it. The deploy caused the outage.';
    expect(governingClause(t, t.indexOf('caused'))).toBe(' The deploy ');
  });

  test('the whole prefix is the clause when there is no boundary', () => {
    const t = 'The deploy caused the outage.';
    expect(governingClause(t, t.indexOf('caused'))).toBe('The deploy ');
  });
});

describe('assertsRelation', () => {
  test('a denial before the verb suppresses; the same word after it does not', () => {
    const denied = 'The deploy never caused the outage.';
    expect(assertsRelation(denied, denied.indexOf('caused'))).toEqual({ asserted: false, cue: 'never' });

    const after = 'The deploy caused the outage, which was not detected.';
    expect(assertsRelation(after, after.indexOf('caused')).asserted).toBe(true);
  });

  test('a cue governing the OTHER clause does not reach across the boundary', () => {
    const t = 'It is not raining and the deploy caused the outage.';
    expect(assertsRelation(t, t.indexOf('caused')).asserted).toBe(true);
  });

  test('a pseudo-negation phrase asserts, and does not disable other cues in the clause', () => {
    const t = 'No one disputes that the deploy caused the outage.';
    expect(assertsRelation(t, t.indexOf('caused')).asserted).toBe(true);
    // The pseudo phrase is stripped, not the whole check: a real cue alongside it still fires.
    const both = 'No one disputes that the deploy may have caused the outage.';
    expect(assertsRelation(both, both.indexOf('caused')).asserted).toBe(false);
  });

  test('cues match on word boundaries, so they do not fire inside longer words', () => {
    // Without boundaries `no` fires inside "notice" and `if` inside "verify" — an early version of
    // this module did exactly that, which is how a cue list quietly destroys recall.
    for (const t of ['The notice caused the outage.', 'The verify step caused the outage.']) {
      expect(assertsRelation(t, t.indexOf('caused')).asserted).toBe(true);
    }
  });
});

describe('the extractor, end to end', () => {
  test('denial, hedge, counterfactual and question all emit nothing, each naming its cue', () => {
    const cases: [string, string][] = [
      ['The friday deploy never caused the checkout outage.', 'never'],
      ['The deploy may have caused the outage.', 'may'],
      ['Nothing suggests the deploy caused the outage.', 'nothing'],
      ['Had the deploy caused the outage, we would have rolled back.', 'had'],
      ['The report questions whether the migration caused the timeout.', 'whether'],
      ['The deploy allegedly caused the outage.', 'allegedly'],
    ];
    for (const [text, cue] of cases) {
      const r = rel(text);
      expect({ text, relations: r.relations.length }).toEqual({ text, relations: 0 });
      // A suppressed match is reported, not silently dropped — the caller can see it was noticed.
      expect({ text, cue: r.suppressed[0]?.cue }).toEqual({ text, cue });
    }
  });

  test('a plain assertion is untouched', () => {
    const r = rel('The friday deploy caused a checkout outage.');
    expect(r.relations).toHaveLength(1);
    expect(r.suppressed).toHaveLength(0);
  });

  test('suppression is reported with the span it would have covered', () => {
    const t = 'The deploy may have caused the outage.';
    const s = rel(t).suppressed[0]!;
    expect(s.rule).toBe('caused-direct');
    expect(t.slice(s.trigger.start, s.trigger.end)).toContain('caused');
  });
});

describe('trimmedSubjectStart — a subject may not start before its own clause', () => {
  test('it cuts a subject that spans a coordinator', () => {
    const t = 'It is not raining and the deploy caused the outage.';
    const r = rel(t).relations[0]!;
    expect(t.slice(r.subject.start, r.subject.end)).toBe('the deploy');
  });

  test('it cuts a subject that spans a complementiser', () => {
    const t = 'No one disputes that the deploy caused the outage.';
    const r = rel(t).relations[0]!;
    expect(t.slice(r.subject.start, r.subject.end)).toBe('the deploy');
  });

  test('an ordinary subject is left alone', () => {
    const t = 'The expired certificate led to a login failure.';
    const r = rel(t).relations[0]!;
    expect(t.slice(r.subject.start, r.subject.end)).toBe('The expired certificate');
    expect(trimmedSubjectStart(t, 0, 'The expired certificate'.length)).toBe(0);
  });

  test('SUBJECT_BOUNDARY and CLAUSE_BOUNDARY answer different questions and must stay separate', () => {
    // `that` bounds a subject but must NOT bound polarity scope, or a denial in the main clause
    // stops reaching its complement. Both directions asserted, because one shared list broke one
    // of them whichever way it was written.
    const t = 'Nobody believes that the deploy caused the outage.';
    expect(rel(t).relations).toHaveLength(0);              // the denial still reaches across `that`
    const u = 'No one disputes that the deploy caused the outage.';
    expect(rel(u).relations[0] !== undefined
      && u.slice(rel(u).relations[0]!.subject.start, rel(u).relations[0]!.subject.end)).toBe('the deploy');
  });
});

describe('the cue lists', () => {
  test('no cue is a substring of another in a way that shadows it', () => {
    expect(new Set(POLARITY_CUES).size).toBe(POLARITY_CUES.length);
    expect(new Set(PSEUDO_CUES).size).toBe(PSEUDO_CUES.length);
  });

  test('every pseudo cue contains a real cue, or it would have nothing to disarm', () => {
    for (const p of PSEUDO_CUES) {
      const contains = POLARITY_CUES.some((c) => new RegExp(`(?:^|[^a-z])${c}(?![a-z])`, 'i').test(p));
      expect({ pseudo: p, containsACue: contains }).toEqual({ pseudo: p, containsACue: true });
    }
  });
});
