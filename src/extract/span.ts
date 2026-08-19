/**
 * A span: a pointer into an immutable record, never a copy of its text.
 *
 * `DEC-013`. Semantica's `Relation` carries `context: str`, filled by slicing ±30 characters
 * around a match (`semantica/semantica/semantic_extract/methods.py`, `extract_relations_regex`),
 * and carries no offsets at all. Porting that would put source text inside every edge, so purging
 * a record would clear the record and leave its sentences sitting in the edges extracted from it —
 * `DEC-004`'s erasure hole rebuilt through a side door.
 *
 * The W3C Web Annotation Data Model pairs a position selector with a quote selector so a drifting
 * document can be re-anchored. **Records here cannot drift** — `DEC-007` makes them immutable — so
 * an offset into one is stable for as long as the record exists, and the quote would add
 * duplication rather than robustness. When the source is purged the span resolves to nothing, which
 * is the outcome we want: the evidence is genuinely gone.
 *
 * Stage 1: pure functions over plain data.
 */

import type { Json } from '../provenance/canonical';

/**
 * The offset unit, stated rather than implied.
 *
 * Python indexes strings by Unicode **code point**; TypeScript indexes by **UTF-16 code unit**.
 * `len("👍") == 1` in Python and `"👍".length === 2` here. Semantica's `start_char`/`end_char` are
 * code points, so porting the numbers without porting the unit makes every offset after the first
 * astral character wrong by an amount nothing reports.
 *
 * Every ASCII fixture passes under either unit, which is exactly what makes this dangerous — see
 * `test/span.test.ts`, which uses an emoji specifically so the two can be told apart.
 */
export const OFFSET_UNIT = 'utf16' as const;
export type OffsetUnit = typeof OFFSET_UNIT;

export interface Span {
  /** The id of a record already in this store. */
  readonly source: string;
  /** Inclusive start, in UTF-16 code units. */
  readonly start: number;
  /** Exclusive end, in UTF-16 code units. */
  readonly end: number;
}

export type SpanReason =
  | 'source_not_found'
  | 'source_purged'
  | 'source_has_no_text'
  | 'span_out_of_bounds'
  | 'span_inverted'
  | 'span_not_integral';

export type Resolved =
  | { readonly ok: true; readonly quote: string }
  | { readonly ok: false; readonly reason: SpanReason };

/**
 * The text a record offers for spanning.
 *
 * Content is caller-shaped, so this is defensive in the same way `nameOf` is in the store. A record
 * whose content is not an object with a string `text` cannot be spanned, and says so rather than
 * being coerced into `""` — an empty string would make every span "out of bounds" and hide the real
 * reason.
 */
export function spannableText(content: Json | null): string | null {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null;
  const t = (content as Record<string, unknown>)['text'];
  return typeof t === 'string' ? t : null;
}

/**
 * Resolve a span to the text it points at.
 *
 * Never returns an empty string for a failure and never throws: a caller that cannot tell "the span
 * is empty" from "the source was purged" will report the wrong thing to a person, and this engine's
 * whole claim is that an answer can say why.
 */
export function resolveSpan(
  span: Span,
  source: { readonly content: Json | null } | undefined,
  opts: { readonly purged?: boolean } = {},
): Resolved {
  if (source === undefined) return { ok: false, reason: 'source_not_found' };
  // Checked before the content check: a purged record has null content, and reporting that as
  // "no text" would describe an erasure as a formatting problem.
  if (opts.purged === true || source.content === null) return { ok: false, reason: 'source_purged' };

  const text = spannableText(source.content);
  if (text === null) return { ok: false, reason: 'source_has_no_text' };

  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) {
    return { ok: false, reason: 'span_not_integral' };
  }
  if (span.end < span.start) return { ok: false, reason: 'span_inverted' };
  if (span.start < 0 || span.end > text.length) return { ok: false, reason: 'span_out_of_bounds' };

  return { ok: true, quote: text.slice(span.start, span.end) };
}

/** A span over `text`, for building one from a match. The unit is whatever `String` uses: UTF-16. */
export function spanOf(source: string, start: number, end: number): Span {
  return { source, start, end };
}
