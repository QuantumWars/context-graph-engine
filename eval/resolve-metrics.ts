/**
 * The standard measures for a blocking scheme. Not invented here.
 *
 * Blocking is judged on two axes that trade against each other, and reporting only one of them is
 * how a scheme gets called good when it is merely cheap:
 *
 *   Pair Completeness  PC = |D(B)| / |D(E)|     recall — of all true duplicate pairs, how many
 *                                                survived blocking at all
 *   Pairs Quality      PQ = |D(B)| / ||B||      precision — of the pairs we chose to compare,
 *                                                how many were real
 *   Reduction Ratio    RR = 1 - ||B|| / ||E||   effort saved against comparing everything
 *   F-Measure          FM = 2·PC·PQ / (PC+PQ)
 *
 * where B is the candidate set, E is all pairs, and D(X) is the true duplicates within X.
 *
 * **PC is the one that matters most, and it is not symmetric with the others.** A pair blocking
 * drops is gone: no downstream scorer, threshold or clustering step can recover it, because it is
 * never looked at. PQ and RR only cost time. A scheme with RR of 0.999 and PC of 0.4 has thrown
 * away three fifths of the answer to save work nobody asked it to save.
 *
 * Sources are listed in `docs/research/07-entity-resolution.md`, with the usual caveat that they
 * came through a summarising layer.
 */

export interface PairKey {
  readonly a: string;
  readonly b: string;
}

/** Order-independent key, so (a,b) and (b,a) are the same pair. */
export const key = (p: PairKey): string => (p.a < p.b ? `${p.a} ${p.b}` : `${p.b} ${p.a}`);

export interface BlockingScore {
  /** True duplicate pairs that survived blocking. */
  readonly retained: number;
  /** True duplicate pairs in the whole dataset. */
  readonly truePairs: number;
  /** Pairs the blocker proposed comparing. */
  readonly candidates: number;
  /** Pairs an all-pairs comparison would have made. */
  readonly allPairs: number;
  readonly pc: number;
  readonly pq: number;
  readonly rr: number;
  readonly fm: number;
  /** The true pairs blocking lost. Named, because a count alone cannot be acted on. */
  readonly missed: readonly string[];
}

export function scoreBlocking(
  candidates: readonly PairKey[],
  truth: readonly PairKey[],
  allPairs: number,
): BlockingScore {
  const cand = new Set(candidates.map(key));
  const truthKeys = truth.map(key);
  const retainedKeys = truthKeys.filter((k) => cand.has(k));

  const retained = retainedKeys.length;
  const truePairs = truthKeys.length;
  const nCand = cand.size;

  // A dataset with no duplicates has perfect recall trivially; saying 0 would be wrong, and
  // saying 1 without saying why would be worse.
  const pc = truePairs === 0 ? 1 : retained / truePairs;
  const pq = nCand === 0 ? 0 : retained / nCand;
  const rr = allPairs === 0 ? 0 : 1 - nCand / allPairs;
  const fm = pc + pq === 0 ? 0 : (2 * pc * pq) / (pc + pq);

  return {
    retained, truePairs, candidates: nCand, allPairs, pc, pq, rr, fm,
    missed: truthKeys.filter((k) => !cand.has(k)),
  };
}
