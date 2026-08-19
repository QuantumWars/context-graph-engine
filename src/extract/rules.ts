/**
 * Rule-based relation extraction: emit only what the text stated.
 *
 * Ported in shape from `extract_relations_regex`
 * (`semantica/semantica/semantic_extract/methods.py`), which is the honest extractor in that file:
 * named patterns with `(?P<subject>…)` / `(?P<object>…)` groups, emitting only on a match. A
 * paragraph with no matching pattern produces nothing.
 *
 * THREE DEFECTS DESIGNED OUT, all confirmed by reading the source this session.
 *
 * 1. **No co-occurrence extractor exists here, in any form** (finding A-8). The original's
 *    `extract_relations_cooccurrence` emits `related_to` for every entity pair within 100
 *    characters, at `confidence=0.6,  # Meets default threshold` — a value whose own comment says
 *    it was chosen to clear the filter it would be tested against. Ten entities produce 45 edges
 *    none of which the text supports. Proximity is not support, and there is no option here that
 *    turns it back on.
 *
 * 2. **No confidence float** (`DEC-013`). The original emits `0.6`, `0.7` and `0.75` from three
 *    rule-based extractors, none with provenance. A rule matched or it did not; a number would be
 *    invented, and there is no labelled set here to calibrate one against.
 *
 * 3. **No entity map, so nothing collapses.** The original builds
 *    `entity_map = {e.text.lower(): e for e in entities}`, which is last-wins: two entities sharing
 *    a surface form silently become one, and a relation about the first is attributed to the
 *    second. Subject and object here are **spans read straight from the match**, so two occurrences
 *    of the same word are two different spans and cannot collapse.
 *
 * Stage 1: pure functions over plain data.
 */

import type { CausalEdgeType } from '../decision/causal';
import { spanOf, type Span } from './span';

export interface Rule {
  /** Stable identifier, recorded on every relation it produces so a reader can check the rule. */
  readonly id: string;
  readonly predicate: CausalEdgeType;
  /**
   * Must declare named groups `subject` and `object`. The **whole match** is the trigger span, so
   * the recorded evidence includes the words that stated the relation and not only its endpoints.
   */
  readonly pattern: RegExp;
}

export interface Extracted {
  readonly predicate: CausalEdgeType;
  readonly rule: string;
  readonly subject: Span;
  readonly object: Span;
  /** The text that stated the relation. An extraction without one is a defect, not a degraded mode. */
  readonly trigger: Span;
}

/**
 * The default rules, written against the closed causal vocabulary.
 *
 * `CAUSAL_EDGE_TYPES` is deliberately closed, so an extractor emitting `related_to` — as the
 * original does — would produce relations that can never become edges. These emit the three types
 * that exist.
 *
 * PROVENANCE: **declared placeholder.** Hand-written from the causal language that appears in this
 * repository's own decision records, not derived from a corpus. What would calibrate them is a
 * labelled set of decision texts with their true relations, which does not exist yet; the honest
 * measure until then is the one in `docs/research/08`: recall misses are visible and acceptable,
 * manufactured edges are not.
 */
export const DEFAULT_RULES: readonly Rule[] = [
  {
    id: 'caused-direct',
    predicate: 'CAUSED',
    pattern: /(?<subject>[\w-]+(?:\s+[\w-]+){0,3})\s+(?:caused|led\s+to|resulted\s+in)\s+(?<object>[\w-]+(?:\s+[\w-]+){0,3})/gid,
  },
  {
    id: 'influenced-direct',
    predicate: 'INFLUENCED',
    pattern: /(?<subject>[\w-]+(?:\s+[\w-]+){0,3})\s+(?:influenced|informed|shaped)\s+(?<object>[\w-]+(?:\s+[\w-]+){0,3})/gid,
  },
  {
    id: 'precedent-for',
    predicate: 'PRECEDENT_FOR',
    pattern: /(?<subject>[\w-]+(?:\s+[\w-]+){0,3})\s+(?:set\s+(?:a\s+)?precedent\s+for|is\s+precedent\s+for)\s+(?<object>[\w-]+(?:\s+[\w-]+){0,3})/gid,
  },
];

/**
 * Run the rules over one record's text.
 *
 * `sourceId` is the record the offsets index into. Offsets come from the regex match's own indices,
 * so they are UTF-16 code units by construction rather than by assumption — see `OFFSET_UNIT`.
 */
export function extract(
  sourceId: string,
  text: string,
  rules: readonly Rule[] = DEFAULT_RULES,
): readonly Extracted[] {
  const out: Extracted[] = [];

  for (const rule of rules) {
    // A fresh RegExp per call, to guarantee the `d` flag — without it `m.indices` is undefined and
    // every match would be skipped, so a caller supplying their own rule would get silence.
    //
    // Measured 2026-08-20, because the first version of this comment claimed something else: a
    // `g`-flagged literal does NOT leak `lastIndex` across `matchAll` calls. `matchAll` clones the
    // regex internally and leaves the original's `lastIndex` at 0, so two extractions with one rule
    // object agree. `exec` is the one that advances it — 0 before, 20 after — so a future rewrite
    // of this loop into `while ((m = re.exec(text)))` over a SHARED regex would silently drop every
    // relation in the second record. `test/extract.test.ts` pins that.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('d')
      ? rule.pattern.flags
      : `${rule.pattern.flags}d`);

    for (const m of text.matchAll(re)) {
      const g = m.indices?.groups;
      const whole = m.indices?.[0];
      // No silent returns: a rule whose groups did not resolve is skipped and the caller can see
      // it produced nothing, rather than an entry with invented offsets.
      if (g === undefined || whole === undefined) continue;
      const s = g['subject'];
      const o = g['object'];
      if (s === undefined || o === undefined) continue;

      out.push({
        predicate: rule.predicate,
        rule: rule.id,
        subject: spanOf(sourceId, s[0], s[1]),
        object: spanOf(sourceId, o[0], o[1]),
        trigger: spanOf(sourceId, whole[0], whole[1]),
      });
    }
  }

  return out;
}
