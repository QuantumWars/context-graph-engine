/**
 * Metrics for an engine that is allowed to say nothing.
 *
 * Precision and recall alone are the wrong instrument here. They score a ranked list, and this
 * engine's most important decision is often *whether to return a list at all*. A wrong answer
 * and a refusal are different failures with different costs — a refusal wastes a query, a
 * wrong answer poisons whatever reads it — so they are counted separately and never averaged
 * into one number that hides which one happened.
 *
 * Pure functions over plain data, and each one has a test with a hand-computed expected value:
 * a metric you have not checked by hand is a number you are trusting a loop to produce.
 */

export interface Judged {
  /** Ranked best-first. Empty means the engine abstained. */
  readonly returned: readonly string[];
  /** Ids the labelling rule says should be returned. Empty means it should have abstained. */
  readonly relevant: readonly string[];
}

/** Of what we returned in the top k, what fraction should have been returned? */
export function precisionAt(j: Judged, k: number): number {
  const top = j.returned.slice(0, k);
  if (top.length === 0) return 0;
  const rel = new Set(j.relevant);
  return top.filter((id) => rel.has(id)).length / top.length;
}

/** Of what should have been returned, what fraction did we return in the top k? */
export function recallAt(j: Judged, k: number): number {
  if (j.relevant.length === 0) return 1;   // nothing to find, so nothing was missed
  const top = new Set(j.returned.slice(0, k));
  return j.relevant.filter((id) => top.has(id)).length / j.relevant.length;
}

/**
 * Reciprocal rank of the first relevant hit. 0 when none was returned.
 *
 * Answers "how far does a reader have to look", which precision does not: a relevant item at
 * rank 1 and at rank 9 give identical precision@10 and very different experiences.
 */
export function reciprocalRank(j: Judged): number {
  const rel = new Set(j.relevant);
  const i = j.returned.findIndex((id) => rel.has(id));
  return i === -1 ? 0 : 1 / (i + 1);
}

/** Returned something when the correct answer was to abstain. */
export function isFalseServe(j: Judged): boolean {
  return j.relevant.length === 0 && j.returned.length > 0;
}

/** Abstained when a relevant record existed. */
export function isFalseAbstain(j: Judged): boolean {
  return j.relevant.length > 0 && j.returned.length === 0;
}

/** Returned an id the labels explicitly name as wrong for this query. */
export function forbiddenHits(j: Judged, irrelevant: readonly string[], k: number): readonly string[] {
  const top = new Set(j.returned.slice(0, k));
  return irrelevant.filter((id) => top.has(id));
}

export interface Report {
  readonly queries: number;
  readonly precision: number;
  readonly recall: number;
  readonly mrr: number;
  readonly falseServe: number;
  readonly falseAbstain: number;
  readonly forbidden: number;
  /** Queries whose correct answer was to abstain, and did. */
  readonly correctAbstain: number;
}

export interface Cased extends Judged {
  readonly irrelevant?: readonly string[];
}

/**
 * Aggregate.
 *
 * Precision, recall and MRR are averaged over the queries that HAVE a relevant set — averaging
 * an abstain-query's precision of 0 into the same mean would make a correct abstention look
 * like a failure, which is exactly the conflation these metrics exist to avoid.
 */
export function aggregate(cases: readonly Cased[], k: number): Report {
  const answerable = cases.filter((c) => c.relevant.length > 0);
  const mean = (xs: readonly number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  return {
    queries: cases.length,
    precision: mean(answerable.map((c) => precisionAt(c, k))),
    recall: mean(answerable.map((c) => recallAt(c, k))),
    mrr: mean(answerable.map(reciprocalRank)),
    falseServe: cases.filter(isFalseServe).length,
    falseAbstain: cases.filter(isFalseAbstain).length,
    forbidden: cases.reduce((n, c) => n + forbiddenHits(c, c.irrelevant ?? [], k).length, 0),
    correctAbstain: cases.filter((c) => c.relevant.length === 0 && c.returned.length === 0).length,
  };
}

/**
 * One number for a sweep to optimise.
 *
 * F1 over precision and recall, minus a penalty for each abstention failure. The weights are
 * a JUDGEMENT, not a measurement, and are stated here rather than buried: a false serve is
 * penalised twice as hard as a false abstain, because a wrong answer propagates into whatever
 * reads it while a refusal only costs the query. Change the ratio and the sweep may choose a
 * different constant — which is why the sweep prints the components alongside the score rather
 * than the score alone.
 */
/**
 * PROVENANCE: **no provenance** — a judgement, stated plainly rather than dressed as a
 * measurement. Nothing measured the relative cost of a wrong answer against a refusal, and
 * nothing here could: it depends on what reads the output, which varies by deployment.
 *
 * The ratio is 2:1 because a wrong answer propagates into whatever consumes it while a refusal
 * only costs the query. **This ratio steers every calibration the sweep performs**, so it is the
 * most load-bearing unmeasured number in the project — change it and `LEXICAL_FLOOR` may move.
 * `eval/sweep.ts` prints precision, recall and both failure counts alongside the score so a
 * reader can disagree with the weighting and still use the table.
 */
export const FALSE_SERVE_PENALTY = 0.02;
/** PROVENANCE: **no provenance** — see `FALSE_SERVE_PENALTY`; half of it, by the same judgement. */
export const FALSE_ABSTAIN_PENALTY = 0.01;

export function score(r: Report): number {
  const f1 = r.precision + r.recall === 0 ? 0 : (2 * r.precision * r.recall) / (r.precision + r.recall);
  return f1 - r.falseServe * FALSE_SERVE_PENALTY - r.falseAbstain * FALSE_ABSTAIN_PENALTY;
}
