import { describe, expect, test } from 'bun:test';
import { DEFAULT_RULES, extract, type Rule } from '../src/extract/rules';
import { resolveSpan, type Span } from '../src/extract/span';
import { CAUSAL_EDGE_TYPES } from '../src/decision/causal';

/** Phase 9. Closes finding A-8: an edge is emitted only when the text stated the relation. */

const quote = (span: Span, text: string): string => {
  const r = resolveSpan(span, { content: { text } });
  return r.ok ? r.quote : `<${r.reason}>`;
};

describe('Task 9.2 — proximity emits nothing; only a stated relation emits', () => {
  // The A-8 fixture, in the recon's own words: ten entities with no stated relation between them.
  const TEN = 'Present: Alice, Bob, Carol, Dave, Erin, Frank, Grace, Heidi, Ivan, Judy.';

  test('ten entities in one paragraph emit ZERO relations', () => {
    expect(extract('r1', TEN)).toEqual([]);
  });

  test('and the zero is a result, not an empty input — the ten mentions are really there', () => {
    // Without this, "0 relations" would also be what an extractor that never ran would print.
    const names = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy'];
    expect(names.filter((n) => TEN.includes(n))).toHaveLength(10);
    // Semantica's co-occurrence extractor would emit 45 edges here: every pair within 100 chars.
    expect((names.length * (names.length - 1)) / 2).toBe(45);
  });

  test('a sentence stating one relation emits exactly one, and the trigger is the words that stated it', () => {
    const text = 'The friday deploy caused a checkout outage.';
    const got = extract('r1', text);
    expect(got).toHaveLength(1);
    const r = got[0]!;
    expect(r.predicate).toBe('CAUSED');
    expect(r.rule).toBe('caused-direct');
    expect(quote(r.subject, text)).toBe('The friday deploy');
    expect(quote(r.object, text)).toBe('a checkout outage');
    expect(quote(r.trigger, text)).toBe('The friday deploy caused a checkout outage');
    // The trigger contains the word that carried the predicate — that is what makes it evidence.
    expect(quote(r.trigger, text)).toContain('caused');
  });

  test('all three causal types are reachable, and no rule emits a type outside the closed set', () => {
    const text = 'The audit informed the rewrite. The rewrite set a precedent for later builds. '
      + 'The outage caused an incident.';
    const got = extract('r1', text);
    expect(got.map((r) => r.predicate).sort()).toEqual(['CAUSED', 'INFLUENCED', 'PRECEDENT_FOR']);
    for (const rule of DEFAULT_RULES) {
      expect(CAUSAL_EDGE_TYPES).toContain(rule.predicate);
    }
  });

  test('no relation carries a confidence — a rule matched or it did not', () => {
    // Semantica emits 0.6 / 0.7 / 0.75 from three rule-based extractors, none with provenance,
    // and the 0.6 carries the comment "Meets default threshold". DEC-013 emits no number.
    const r = extract('r1', 'The deploy caused an outage.')[0]!;
    expect(Object.keys(r).sort()).toEqual(['object', 'predicate', 'rule', 'subject', 'trigger']);
    expect(JSON.stringify(r)).not.toContain('confidence');
  });

  test('two entities sharing a surface form do NOT collapse — they are different spans', () => {
    // Semantica builds entity_map = {e.text.lower(): e}, which is last-wins: a relation about the
    // first occurrence is attributed to the second. Reading spans straight from the match makes
    // that impossible to express.
    const text = 'checkout caused checkout to fail';
    const r = extract('r1', text)[0]!;
    expect(quote(r.subject, text)).toBe('checkout');
    expect(r.subject.start).not.toBe(r.object.start);
    expect(r.subject).not.toEqual(r.object);
  });

  test('every emitted relation carries all three spans, pointing at the source it was given', () => {
    const got = extract('rec-42', 'The audit informed the rewrite. The deploy caused an outage.');
    expect(got.length).toBeGreaterThan(0);
    for (const r of got) {
      for (const s of [r.subject, r.object, r.trigger]) {
        expect(s.source).toBe('rec-42');
        expect(s.end).toBeGreaterThan(s.start);
      }
    }
  });

  test('a relation carries NO text of its own — only pointers', () => {
    const text = 'The friday deploy caused a checkout outage.';
    const serialised = JSON.stringify(extract('r1', text));
    for (const v of ['friday deploy', 'checkout outage', text]) {
      expect(serialised).not.toContain(v);
    }
    expect(JSON.stringify({ leak: 'friday deploy' })).toContain('friday deploy');   // scan works
  });
});

describe('Task 9.2 — the g-flag trap', () => {
  test('extracting twice with the same rule object gives the same answer both times', () => {
    // Measured, after an earlier version of this comment got it wrong: `matchAll` does NOT leak
    // lastIndex — it clones the regex and leaves the original at 0. `exec` does leak it, so this
    // goes red if the loop is ever rewritten as `while ((m = re.exec(text)))` over a shared regex,
    // which would drop every relation in the SECOND record and pass any single-record test.
    const text = 'The deploy caused an outage.';
    const first = extract('a', text);
    const second = extract('b', text);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]!.subject.start).toBe(first[0]!.subject.start);
  });

  test('the shared-regex hazard is real for exec, which is why the loop does not use it', () => {
    // Proving the hazard exists rather than asserting it in prose. A rule object is reused across
    // records by construction — DEFAULT_RULES is a module constant.
    const shared = /(?<subject>\w+)\s+caused\s+(?<object>\w+)/gd;
    expect(shared.lastIndex).toBe(0);
    [...'deploy caused outage'.matchAll(shared)];
    expect(shared.lastIndex).toBe(0);                 // matchAll leaves it alone
    shared.exec('deploy caused outage');
    expect(shared.lastIndex).toBe(20);                // exec does not
  });

  test('a rule supplied without the d flag still yields indices', () => {
    const rule: Rule = {
      id: 'test-no-d-flag',
      predicate: 'CAUSED',
      pattern: /(?<subject>\w+)\s+broke\s+(?<object>\w+)/g,
    };
    expect(rule.pattern.flags).not.toContain('d');
    const text = 'deploy broke checkout';
    const got = extract('r1', text, [rule]);
    expect(got).toHaveLength(1);
    expect(quote(got[0]!.subject, text)).toBe('deploy');
  });

  test('a rule whose groups do not resolve emits nothing rather than invented offsets', () => {
    const rule: Rule = {
      id: 'test-missing-groups',
      predicate: 'CAUSED',
      pattern: /deploy\s+broke\s+checkout/g,      // no named groups at all
    };
    expect(extract('r1', 'deploy broke checkout', [rule])).toEqual([]);
  });

  test('a rule cannot match across a sentence boundary', () => {
    // The subject pattern admits only word characters and hyphens, so a full stop stops it. Without
    // this, two unrelated sentences would produce a relation neither of them stated.
    const text = 'The audit finished. The deploy caused an outage.';
    const r = extract('r1', text)[0]!;
    expect(quote(r.subject, text)).toBe('The deploy');
    expect(quote(r.trigger, text)).not.toContain('finished');
  });
});
