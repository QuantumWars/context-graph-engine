/**
 * Linking metrics, taken from the literature rather than invented.
 *
 * `docs/research/09-entity-linking.md` names the three the survey material uses, and they are used
 * here unchanged: **Recall@k** for candidate generation, **Top-1 accuracy** for ranking, and
 * **NIL accuracy** for the reject option. Nothing here is a score of this engine's own making.
 *
 * WHY THIS FILE EXISTS AT ALL, stated because the port makes the point better than an argument
 * would. `semantica/semantica/semantic_extract/extraction_validator.py:18` advertises
 * "Validation Metrics: Precision, recall, F1-score calculations". Measured 2026-08-20: that phrase
 * appears exactly once in the file, in the docstring, and **nowhere in the code**. What
 * `_calculate_entity_score` actually computes is
 *
 *     score = 1.0
 *     score *= 1.0 - low_conf_ratio * 0.5
 *     score *= 1.0 - dup_ratio * 0.3
 *     score *= 0.5 + avg_confidence * 0.5
 *
 * — a function of the extractor's OWN self-reported confidence, with five unprovenanced constants
 * and no ground truth. `grep -rn "ground_truth"` over its source and tests returns nothing. An
 * extractor that emits `confidence=1.0` for everything scores perfectly; the score cannot detect a
 * wrong answer, only a diffident one. **A validator whose input is the thing it validates is not a
 * measurement**, and every function below therefore takes a gold label it did not produce.
 *
 * Pure functions over plain data: no store, no I/O.
 */

import type { LinkResult } from '../src/extract/link';

export interface Judged {
  readonly mention: string;
  readonly gold: string | null;
  readonly family: string;
  readonly verdict: LinkResult['verdict'];
  /** Rank of the gold record, 1-based. `null` when it is absent from the candidates. */
  readonly goldRank: number | null;
  readonly top: string | null;
  readonly topScore: number | null;
  readonly margin: number | null;
}

/** Judge one linking result against its label. Produces facts; decides nothing. */
export function judge(
  mention: string,
  gold: string | null,
  family: string,
  result: LinkResult,
): Judged {
  const idx = gold === null ? -1 : result.candidates.findIndex((c) => c.id === gold);
  const top = result.candidates[0];
  return {
    mention, gold, family,
    verdict: result.verdict,
    goldRank: idx === -1 ? null : idx + 1,
    top: top?.id ?? null,
    topScore: top?.score ?? null,
    margin: result.margin,
  };
}

export interface LinkScore {
  /** Mentions whose referent is in the store. */
  readonly inStore: number;
  /** Of those, how many had the gold record ANYWHERE in the candidates — candidate generation. */
  readonly recallAtAny: number;
  /** Of those, how many had it in the top k. */
  readonly recallAtK: number;
  readonly k: number;
  /** Of those, how many had it at rank 1 — ranking. */
  readonly top1: number;
  /** Mentions whose correct answer is "nothing here". */
  readonly nil: number;
  /** Of those, how many were flagged — `no_candidates` or `weak`. */
  readonly nilCorrect: number;
  /** Correct in-store answers ALSO flagged `weak`: the soft cost of the warning. */
  readonly weakButRight: number;
  /** Gold-bearing mentions the generator lost outright — unrecoverable downstream. */
  readonly missed: readonly string[];
}

/**
 * Score a judged set.
 *
 * `recallAtAny` is separated from `top1` deliberately: a pair the generator drops is gone, because
 * nothing downstream ever looks at it, while a bad rank is a scoring problem that a better scorer
 * can fix. Reporting one number would hide which of the two is failing.
 */
export function scoreLinking(judged: readonly Judged[], k: number): LinkScore {
  const inStore = judged.filter((j) => j.gold !== null);
  const nil = judged.filter((j) => j.gold === null);
  return {
    inStore: inStore.length,
    recallAtAny: inStore.filter((j) => j.goldRank !== null).length,
    recallAtK: inStore.filter((j) => j.goldRank !== null && j.goldRank <= k).length,
    k,
    top1: inStore.filter((j) => j.goldRank === 1).length,
    nil: nil.length,
    // `weak` counts as a reject here because it is the signal a caller acts on. It does not drop
    // the candidates, which is why `weakButRight` reports the other side of the same rule.
    nilCorrect: nil.filter((j) => j.verdict === 'no_candidates' || j.verdict === 'weak').length,
    weakButRight: inStore.filter((j) => j.goldRank === 1 && j.verdict === 'weak').length,
    missed: inStore.filter((j) => j.goldRank === null).map((j) => j.mention),
  };
}

export interface MarginSplit {
  readonly correctCount: number;
  readonly wrongCount: number;
  readonly medianWhenCorrect: number | null;
  readonly medianWhenWrong: number | null;
  /** Positive means a wider gap really does mean a better answer. */
  readonly separation: number | null;
}

/**
 * Does the margin separate a right top-1 from a wrong one?
 *
 * `DEC-014` returns a margin instead of a threshold, on the argument that the gap to the runner-up
 * is the honest signal. That is a claim about this data, and this function is what tests it: if the
 * median margin behind a correct answer is no larger than behind a wrong one, the margin is
 * decoration and the decision record should say so.
 */
export function marginSplit(judged: readonly Judged[]): MarginSplit {
  const withMargin = judged.filter((j) => j.gold !== null && j.margin !== null && j.top !== null);
  const correct = withMargin.filter((j) => j.top === j.gold).map((j) => j.margin as number);
  const wrong = withMargin.filter((j) => j.top !== j.gold).map((j) => j.margin as number);
  const median = (xs: readonly number[]): number | null => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  };
  const mc = median(correct);
  const mw = median(wrong);
  return {
    correctCount: correct.length,
    wrongCount: wrong.length,
    medianWhenCorrect: mc,
    medianWhenWrong: mw,
    separation: mc === null || mw === null ? null : mc - mw,
  };
}

/** Per-family breakdown, so a single number cannot hide which kind of mention is failing. */
export function byFamily(judged: readonly Judged[]): ReadonlyMap<string, { total: number; top1: number; nilCorrect: number }> {
  const out = new Map<string, { total: number; top1: number; nilCorrect: number }>();
  for (const j of judged) {
    const e = out.get(j.family) ?? { total: 0, top1: 0, nilCorrect: 0 };
    e.total += 1;
    if (j.gold !== null && j.goldRank === 1) e.top1 += 1;
    if (j.gold === null && (j.verdict === 'no_candidates' || j.verdict === 'weak')) e.nilCorrect += 1;
    out.set(j.family, e);
  }
  return out;
}
