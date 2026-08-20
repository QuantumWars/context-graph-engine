/**
 * Extraction metrics: precision, recall and F1 over emitted relations, plus a silence rate.
 *
 * The criterion is the strict one from `docs/research/08-extraction-and-span-provenance.md`: an
 * extracted triple counts as correct only when **the relation and both argument spans are right**.
 * Getting the entities right with the wrong predicate is wrong, and so is getting the direction
 * backwards — there is no partial credit, because a graph with a reversed causal edge is worse than
 * a graph missing it.
 *
 * **Negatives contribute to precision only.** A text that should emit nothing produces no true
 * positive and no false negative; it costs precision if the extractor fires. That mirrors the
 * standard treatment, where the dominant negative class is excluded from the headline F1 so a
 * system is not rewarded for predicting it — and it is why `silenceRate` is reported separately
 * rather than folded in. A single number that rewarded silence would let an extractor that emits
 * nothing at all look excellent.
 *
 * Pure functions over plain data: no store, no I/O.
 */

import type { GoldRelation } from './extraction';

/** One emitted relation, reduced to what the strict criterion compares. */
export interface EmittedRelation {
  readonly predicate: string;
  readonly subject: string;
  readonly object: string;
}

export const relKey = (r: EmittedRelation | GoldRelation): string =>
  `${r.predicate} ${r.subject} ${r.object}`;

export interface TextOutcome {
  readonly id: string;
  readonly family: string;
  readonly goldCount: number;
  readonly emittedCount: number;
  readonly truePositives: number;
  readonly falsePositives: readonly EmittedRelation[];
  readonly falseNegatives: readonly GoldRelation[];
  /** True when this text should have emitted nothing AND did. */
  readonly silent: boolean;
}

/**
 * Compare one text's emitted relations against its gold set.
 *
 * Duplicate emissions of the same triple count once as a true positive and the rest as false
 * positives, so an extractor cannot inflate recall by emitting the same relation repeatedly.
 */
export function judgeText(
  id: string,
  family: string,
  gold: readonly GoldRelation[],
  emitted: readonly EmittedRelation[],
): TextOutcome {
  const goldKeys = new Map<string, GoldRelation>();
  for (const g of gold) goldKeys.set(relKey(g), g);

  const matched = new Set<string>();
  const falsePositives: EmittedRelation[] = [];
  for (const e of emitted) {
    const k = relKey(e);
    if (goldKeys.has(k) && !matched.has(k)) matched.add(k);
    else falsePositives.push(e);
  }
  const falseNegatives = [...goldKeys.entries()]
    .filter(([k]) => !matched.has(k))
    .map(([, g]) => g);

  return {
    id, family,
    goldCount: gold.length,
    emittedCount: emitted.length,
    truePositives: matched.size,
    falsePositives,
    falseNegatives,
    silent: gold.length === 0 && emitted.length === 0,
  };
}

export interface ExtractScore {
  readonly texts: number;
  readonly gold: number;
  readonly emitted: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** Texts whose correct output was silence. */
  readonly negatives: number;
  /** Of those, how many were silent. */
  readonly silent: number;
  readonly silenceRate: number;
}

export function scoreExtraction(outcomes: readonly TextOutcome[]): ExtractScore {
  const gold = outcomes.reduce((n, o) => n + o.goldCount, 0);
  const emitted = outcomes.reduce((n, o) => n + o.emittedCount, 0);
  const tp = outcomes.reduce((n, o) => n + o.truePositives, 0);
  const fp = outcomes.reduce((n, o) => n + o.falsePositives.length, 0);
  const fn = outcomes.reduce((n, o) => n + o.falseNegatives.length, 0);
  const negatives = outcomes.filter((o) => o.goldCount === 0);
  const silent = negatives.filter((o) => o.silent).length;

  // Zero denominators are reported as 0 rather than NaN: a metric that renders as NaN in a table is
  // read as "broken" when it often means "nothing to measure", and the counts beside it say which.
  const precision = emitted === 0 ? 0 : tp / emitted;
  const recall = gold === 0 ? 0 : tp / gold;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    texts: outcomes.length, gold, emitted,
    truePositives: tp, falsePositives: fp, falseNegatives: fn,
    precision, recall, f1,
    negatives: negatives.length, silent,
    silenceRate: negatives.length === 0 ? 0 : silent / negatives.length,
  };
}

/** Per-family breakdown, so one number cannot hide which kind of text is failing. */
export function byFamily(outcomes: readonly TextOutcome[]): ReadonlyMap<string, ExtractScore> {
  const groups = new Map<string, TextOutcome[]>();
  for (const o of outcomes) {
    const arr = groups.get(o.family);
    if (arr === undefined) groups.set(o.family, [o]); else arr.push(o);
  }
  const out = new Map<string, ExtractScore>();
  for (const [family, os] of groups) out.set(family, scoreExtraction(os));
  return out;
}
