/**
 * Acronyms: deciding whether a long form supports a short one.
 *
 * Phase 12 measured `abbreviation` at 1 of 2, and the failure is *"the SLO doc"* ranking
 * `svc-search` first while the gold `doc-slo` — *"the service level objective document"* — sits at
 * rank 2. Trigram similarity cannot relate `SLO` to those three words: they share almost no
 * character trigrams, which is exactly what trigrams are for and exactly why they cannot do this.
 *
 * NOTHING TO PORT. Measured 2026-08-20: `acronym`, `abbreviat`, `initialism` and `alias` appear
 * nowhere in `semantica`'s linker or its similarity calculator, and every `alias` hit elsewhere in
 * that repository is a method alias in a docstring.
 *
 * THE RULE IS SCHWARTZ & HEARST'S MATCHING HALF, not its extraction half. Their algorithm finds
 * `long form (SHORT)` pairs in running text and reports 96% precision without training data; we
 * have no such pattern to find, because the short form and the long form are in two different
 * places — a mention and a record. What transfers is the test they use to decide whether a
 * candidate long form supports a short one:
 *
 *   - every character of the short form appears in the long form, **in order**;
 *   - the **first** character of the short form begins a word.
 *
 * Their published rule also allows matching a character inside a word, which is what lets `GNAT`
 * match *Gcn5-related N-acetyltransferase*. That is kept.
 *
 * NO CONSTANT IS INTRODUCED. A short form must be at least two characters, which is structural
 * rather than tunable — a one-letter acronym is not an acronym — and there is deliberately no upper
 * bound, because a long all-capitals token is still one.
 *
 * Stage 1: pure functions over plain data.
 */

/** All-capital tokens that could be a short form. Punctuation is stripped; digits are allowed. */
export function acronymsIn(text: string): readonly string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const t = raw.replace(/[^A-Za-z0-9]/g, '');
    // At least two characters, and every letter capital. `SLO` and `CDN` qualify; `The` does not.
    if (t.length >= 2 && /^[A-Z0-9]+$/.test(t) && /[A-Z]/.test(t)) out.push(t);
  }
  return out;
}

/**
 * Does `long` support `short`, and over which of its words?
 *
 * Returns the words of `long` that the short form spans, or `null`. Matching runs left to right
 * over the words: the first character of the short form must start a word, and each remaining
 * character must appear at or after that point, in order — inside a word if necessary.
 */
export function initialismSpan(short: string, long: string): readonly string[] | null {
  const s = short.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (s.length < 2) return null;
  const words = long.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return null;

  // Try each word as the anchor for the short form's first character, nearest first.
  for (let start = 0; start < words.length; start++) {
    if (!(words[start] as string).startsWith(s[0] as string)) continue;

    let si = 1;
    let last = start;
    for (let wi = start; wi < words.length && si < s.length; wi++) {
      const w = words[wi] as string;
      // The anchor word's first character is already consumed; look at the rest of it.
      const from = wi === start ? 1 : 0;
      for (let ci = from; ci < w.length && si < s.length; ci++) {
        if (w[ci] === s[si]) { si++; last = wi; }
      }
      // A word contributes only if its FIRST character carries the next short-form character, or
      // the character was found inside it. Advancing the anchor here is what allows skipped words.
      if (si < s.length && wi + 1 < words.length && (words[wi + 1] as string).startsWith(s[si] as string)) {
        si++; last = wi + 1;
      }
    }
    if (si === s.length) return words.slice(start, last + 1);
  }
  return null;
}

/**
 * Rewrite `text`, replacing any acronym that `long` supports with the words it stands for.
 *
 * Per-record by design: an acronym is expanded only against a record whose own name supports it, so
 * a record that has nothing to do with the short form is scored against the mention unchanged.
 * Returns `text` untouched when nothing expands, which is the common case.
 */
export function expandAgainst(text: string, long: string): string {
  let out = text;
  for (const a of acronymsIn(text)) {
    const span = initialismSpan(a, long);
    if (span === null) continue;
    out = out.replace(new RegExp(`\\b${a}\\b`, 'g'), span.join(' '));
  }
  return out;
}
