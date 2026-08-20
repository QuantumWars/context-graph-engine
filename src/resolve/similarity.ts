/**
 * How alike are two records?
 *
 * Ported in spirit from `semantica/semantica/deduplication/similarity_calculator.py`, with its
 * finding A-12 designed out rather than reproduced. In the original the constructor signature uses
 * `embedding=0.0, string=0.6, property=0.2, relationship=0.2` while the docstring six lines above
 * names `0.4 / 0.3 / 0.2 / 0.1` — so the documentation presents embedding similarity as the
 * largest term when it is switched off entirely.
 *
 * The defence here is structural, not editorial: **the weights exist in exactly one object**, their
 * total is asserted by a test, and nothing restates them in prose. A comment cannot drift from a
 * value it does not contain.
 *
 * Stage 1: pure functions over plain data.
 */

export interface Candidate {
  readonly id: string;
  /** The human-facing name or title. The dominant signal. */
  readonly name: string;
  /** A closed-vocabulary kind. Two records of different types are rarely the same thing. */
  readonly type?: string;
  /** Arbitrary comparable attributes. Overlap is weak evidence, never decisive alone. */
  readonly props?: Readonly<Record<string, string>>;
}

/**
 * PROVENANCE: **declared placeholder.** Chosen by judgement, not measurement: the name carries
 * most of the signal, the type is a strong filter but a weak positive, and property overlap is
 * corroboration rather than evidence. `eval/resolve-sweep.ts` can move them once a labelled
 * duplicate set is large enough to distinguish — 24 pairs is not.
 *
 * These are the ONLY place the weights appear. `WEIGHT_TOTAL` below is asserted against their sum,
 * so a change that forgets to restate the total fails a test rather than drifting.
 */
export const WEIGHTS = { name: 0.7, type: 0.2, props: 0.1 } as const;

/** PROVENANCE: **calibrated** by construction — asserted equal to the sum of `WEIGHTS`. */
export const WEIGHT_TOTAL = 1.0;

/**
 * The most two records can score when neither carries `props`.
 *
 * Derived from `WEIGHTS`, not chosen: a missing component scores 0 rather than being dropped from
 * the denominator, so two byte-identical records with no properties reach only `name + type`.
 * **This makes any threshold above it unusable** — measured 2026-08-20, `minScore = 0.9` matched
 * nothing at all on a 805-record fixture including five exact duplicates, and floating point puts
 * the real total at 0.8999999999999999, just under a `>=` comparison against 0.9.
 *
 * Semantica caps at exactly the same place, measured the same day against
 * `SimilarityCalculator.calculate_similarity`:
 *
 *     identical, no props   score=0.900000  {'string': 1.0, 'property': 1.0, 'relationship': 0.5}
 *     different names       score=0.656374  {'string': 0.594, 'property': 1.0, 'relationship': 0.5}
 *
 * Its ceiling comes from a neutral 0.5 for absent relationships; the more interesting number is the
 * second row. Two entirely unrelated companies score 0.656 there, because two EMPTY property sets
 * are scored 1.0 — absence read as agreement — giving every pair a floor of 0.3 before a name is
 * looked at. That is what `renormalising over the components we happen to have` buys, and it is why
 * the fixed denominator here stays: an unknown must not manufacture agreement it has no basis for.
 */
export const MAX_SCORE_WITHOUT_PROPS = WEIGHTS.name + WEIGHTS.type;

/** Character trigrams, which tolerate a typo and word reordering that token sets do not. */
export function trigrams(s: string): ReadonlySet<string> {
  const t = ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

/** Jaccard over two sets. 1 when identical, 0 when disjoint, 1 when both are empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface Score {
  readonly total: number;
  /** Per-component, so a score can be explained rather than asserted. */
  readonly name: number;
  readonly type: number;
  readonly props: number;
}

/**
 * Score two candidates in 0..1.
 *
 * A missing component scores 0 rather than being dropped from the denominator. Renormalising over
 * "the components we happen to have" is how a record with only a name scores 1.0 against anything
 * with a similar name — the same class of error as finding A-6's per-source normalisation, which
 * promotes a source's best candidate regardless of how good it actually is.
 */
export function similarity(a: Candidate, b: Candidate): Score {
  const name = jaccard(trigrams(a.name), trigrams(b.name));

  // Unknown type is not a mismatch and not a match. Scoring it 0 keeps an unknown from
  // manufacturing agreement it has no basis for.
  const type = a.type === undefined || b.type === undefined ? 0 : a.type === b.type ? 1 : 0;

  const ka = Object.keys(a.props ?? {});
  const kb = Object.keys(b.props ?? {});
  const shared = ka.filter((k) => kb.includes(k));
  const props = shared.length === 0
    ? 0
    : shared.filter((k) => (a.props ?? {})[k] === (b.props ?? {})[k]).length / shared.length;

  return {
    total: WEIGHTS.name * name + WEIGHTS.type * type + WEIGHTS.props * props,
    name, type, props,
  };
}
