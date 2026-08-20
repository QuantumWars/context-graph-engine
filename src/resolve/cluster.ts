/**
 * Turn accepted pairs into entities.
 *
 * Blocking and scoring produce *pairs*. Resolution needs *entities* — the set of records that all
 * refer to one real thing. The usual move is connected components: if A matches B and B matches C,
 * put all three together.
 *
 * THE COST OF THAT, STATED RATHER THAN DISCOVERED. Similarity is not transitive. `Jon Smith` may
 * match `J. Smith`, and `J. Smith` may match `Jane Smith`, without `Jon Smith` resembling
 * `Jane Smith` at all. A closure over weak links chains them into one entity, and the merge is
 * silent — nothing errors, the graph just quietly asserts that two different people are one.
 *
 * This is the same shape as the engine's founding complaint: a system that answers confidently
 * without saying what the answer rests on.
 *
 * THE POLICY HERE, and it is a choice with a cost either way:
 *
 *   Components are formed by transitive closure, AND every component reports the weakest link that
 *   holds it together. A cluster whose weakest edge is 0.42 is not the same claim as one whose
 *   weakest edge is 0.95, and the caller is given both rather than a merged blob.
 *
 * That mirrors what Algorithm 5 does for causal chains — report the product and the weakest hop,
 * refuse to blend them into one number — and it is the same reasoning: the honest summary of a
 * chain of uncertain links names its weakest point.
 *
 * Callers who cannot tolerate a chained merge raise `minScore` until the chain breaks. There is no
 * setting that makes transitivity safe, and pretending otherwise would be the decoration this
 * project keeps finding elsewhere.
 *
 * Stage 1: pure functions over plain data.
 */

import type { Pair } from './blocking';

/**
 * The pairwise score at or above which two records are proposed as the same thing.
 *
 * PROVENANCE: **declared placeholder** — with evidence, which is more than it had before, and
 * still not a calibration. Measured 2026-08-20 on an 805-record fixture of company names drawn from
 * disjoint word pools with five planted exact duplicates. Recall is 100% at every value below the
 * ceiling; precision is what moves:
 *
 *     th=0.6  groups=114  precision=  4.4%  recall=100%  biggestGroup=32
 *     th=0.7  groups=  5  precision=100.0%  recall=100%  biggestGroup=2
 *     th=0.8  groups=  5  precision=100.0%  recall=100%  biggestGroup=2
 *     th=0.9  groups=  0  precision=  0.0%  recall=  0%  biggestGroup=0
 *
 * **0.6 was the shipped default until this measurement and it was wrong**: 109 of its 114 proposals
 * mixed records with different names, and transitive closure chained 32 unrelated companies into one
 * group. It was also a bare default parameter on `Store.suggest` rather than a named constant, so
 * `constants-gate` never saw it — the exact hiding place the constants rule exists to close.
 *
 * 0.7 is chosen over 0.8 because they are indistinguishable on this fixture and 0.7 is the value
 * `semantica`'s own `DuplicateDetector` defaults to (`duplicate_detector.py:99`), so the more
 * permissive of two equal options is also the one with independent precedent.
 *
 * **One synthetic fixture is not a calibration**, which is why this stays a declared placeholder:
 * it establishes that 0.6 is wrong on name-shaped data and that 0.7 is not, and nothing more. What
 * would calibrate it is a labelled set of duplicates drawn from a real store; the nearest thing,
 * `eval/duplicates.ts`, has 26 records and its labels were written by the same session that wrote
 * the blocker. `th=0.9` matching nothing is not a tuning result — see
 * `MAX_SCORE_WITHOUT_PROPS`, which no pair without properties can exceed.
 */
export const SUGGEST_MIN_SCORE = 0.7;

export interface Cluster {
  /** Stable: the lexicographically smallest member, so the same input yields the same id. */
  readonly id: string;
  readonly members: readonly string[];
  /** The lowest-scoring edge holding this cluster together. `null` for a singleton. */
  readonly weakestLink: Pair | null;
  /** How many merge steps formed it. 0 for a singleton, 1 for a plain pair. */
  readonly merges: number;
}

/**
 * Union-find over the pairs that clear `minScore`.
 *
 * Path compression only; union by size is not worth the code at this scale and would make the
 * merge order harder to reason about.
 */
export function cluster(
  ids: readonly string[],
  pairs: readonly Pair[],
  minScore: number,
): readonly Cluster[] {
  const parent = new Map<string, string>();
  for (const id of ids) parent.set(id, id);

  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c) as string; parent.set(c, r); c = n; }
    return r;
  };

  // Strongest first, so the edges that form a component are the ones a reader would expect, and
  // the weakest link recorded below is genuinely the last thing holding it together.
  const accepted = pairs
    .filter((p) => p.score >= minScore)
    .slice()
    .sort((a, b) => b.score - a.score || (`${a.a} ${a.b}` < `${b.a} ${b.b}` ? -1 : 1));

  const mergeEdges: Pair[] = [];
  for (const p of accepted) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra === rb) continue;          // already the same entity; this edge adds nothing
    parent.set(ra, rb);
    mergeEdges.push(p);               // an edge that actually merged, not merely one that passed
  }

  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    const g = groups.get(r);
    if (g === undefined) groups.set(r, [id]); else g.push(id);
  }

  const out: Cluster[] = [];
  for (const [, members] of groups) {
    members.sort();
    const inside = new Set(members);
    const held = mergeEdges.filter((p) => inside.has(p.a) && inside.has(p.b));
    out.push({
      id: members[0] as string,
      members,
      weakestLink: held.length === 0
        ? null
        : held.reduce((w, p) => (p.score < w.score ? p : w)),
      merges: held.length,
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  return out;
}

/** Clusters with more than one member — the ones that actually assert a merge. */
export function merged(clusters: readonly Cluster[]): readonly Cluster[] {
  return clusters.filter((c) => c.members.length > 1);
}
