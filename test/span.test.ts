import { describe, expect, test } from 'bun:test';
import { OFFSET_UNIT, resolveSpan, spanOf, spannableText, type Span } from '../src/extract/span';

/** Phase 9. `DEC-013`: a span points into an immutable record and never copies its text. */

const rec = (text: unknown) => ({ content: { text } as never });

describe('Task 9.1 — a span resolves, or says why it cannot', () => {
  test('a span resolves to exactly the quoted substring', () => {
    const text = 'the friday deploy caused a checkout outage';
    const r = resolveSpan(spanOf('r1', 4, 17), rec(text));
    expect(r).toEqual({ ok: true, quote: 'friday deploy' });
    // Anti-vacuity: the quote is really a slice of the source, not a coincidence.
    expect(text.slice(4, 17)).toBe('friday deploy');
  });

  test('each failure has its own reason code, and none of them is an empty string', () => {
    const text = 'short';
    const cases: ReadonlyArray<readonly [string, Span, Parameters<typeof resolveSpan>[1], boolean]> = [
      ['source_not_found', spanOf('gone', 0, 1), undefined, false],
      ['source_purged', spanOf('r1', 0, 1), { content: null }, false],
      ['source_has_no_text', spanOf('r1', 0, 1), rec(42), false],
      ['span_out_of_bounds', spanOf('r1', 0, 99), rec(text), false],
      ['span_inverted', spanOf('r1', 4, 2), rec(text), false],
      ['span_not_integral', spanOf('r1', 0.5, 2), rec(text), false],
    ];
    const got = cases.map(([, span, src]) => {
      const r = resolveSpan(span, src);
      return r.ok ? `UNEXPECTED_OK:${r.quote}` : r.reason;
    });
    expect(got).toEqual(cases.map(([expected]) => expected));
  });

  test('a purged source is reported as purged, not as "no text"', () => {
    // The distinction is the point. Reporting an erasure as a formatting problem would tell a
    // person the wrong thing about the one operation whose whole job is to be trustworthy.
    const r = resolveSpan(spanOf('r1', 0, 3), { content: null });
    expect(r).toEqual({ ok: false, reason: 'source_purged' });
  });

  test('an empty span is a success, and distinguishable from every failure', () => {
    const r = resolveSpan(spanOf('r1', 2, 2), rec('abcdef'));
    expect(r).toEqual({ ok: true, quote: '' });
  });

  test('a span carries NO text — scanned the way the tombstone test scans', () => {
    const text = 'the friday deploy caused a checkout outage';
    const span = spanOf('r1', 4, 17);
    const serialised = JSON.stringify(span);
    for (const v of [text, 'friday deploy', 'checkout']) expect(serialised).not.toContain(v);
    // And the scan is proven able to find a value when one IS present.
    expect(JSON.stringify({ ...span, quote: 'friday deploy' })).toContain('friday deploy');
    expect(Object.keys(span).sort()).toEqual(['end', 'source', 'start']);
  });

  test('spannableText refuses content it cannot span, rather than coercing it to ""', () => {
    // Coercing to "" would make every span "out of bounds" and hide the real reason.
    expect(spannableText({ text: 'ok' })).toBe('ok');
    expect(spannableText(null)).toBeNull();
    expect(spannableText({ note: 'no text key' } as never)).toBeNull();
    expect(spannableText({ text: 42 } as never)).toBeNull();
    expect(spannableText(['a'] as never)).toBeNull();
  });
});

describe('Task 9.3 — the offset unit, proven with a character that can tell the difference', () => {
  // Every ASCII fixture passes under either unit. This one cannot.
  const text = '🚀🚀 the friday deploy caused a checkout outage';

  test('the fixture really does distinguish the two units', () => {
    expect(text.length).toBe(47);          // UTF-16 code units
    expect([...text].length).toBe(45);     // Unicode code points
    expect(text.length).not.toBe([...text].length);
  });

  test('resolving with UTF-16 offsets gives the right text', () => {
    const start = text.indexOf('the friday deploy');
    expect(start).toBe(5);
    const r = resolveSpan(spanOf('r1', start, start + 17), rec(text));
    expect(r).toEqual({ ok: true, quote: 'the friday deploy' });
  });

  test('resolving with CODE-POINT offsets gives a lone surrogate and shifted text', () => {
    // This is what porting Semantica's start_char without porting the unit would produce. Python
    // reports 3 where this engine reports 5, and nothing anywhere would report the difference.
    const cp = [...text];
    const pythonStart = cp.findIndex((_, i) => cp.slice(i).join('').startsWith('the friday deploy'));
    expect(pythonStart).toBe(3);

    const wrong = resolveSpan(spanOf('r1', pythonStart, pythonStart + 17), rec(text));
    expect(wrong.ok).toBe(true);
    expect(wrong.ok && wrong.quote).toBe('\ude80 the friday depl');
    expect(wrong.ok && wrong.quote).not.toBe('the friday deploy');
  });

  test('the declared unit matches what the code does, measured rather than restated', () => {
    expect(OFFSET_UNIT).toBe('utf16');
    // Measure it: a span of length 2 over one astral character captures the whole character under
    // UTF-16, and would capture two characters under code points.
    const r = resolveSpan(spanOf('r1', 0, 2), rec('🚀🚀'));
    expect(r).toEqual({ ok: true, quote: '🚀' });
  });
});
