/**
 * Algorithm 4 — Reciprocal Rank Fusion.
 *
 * Ported from `semantica/semantica/vector_store/hybrid_search.py:148-186`, which is a
 * faithful implementation of Cormack, Clarke & Buettcher (SIGIR 2009): sum `1/(k+rank)`
 * across channels, ranks 1-based, nothing normalised.
 *
 * WHY RRF AND NOT WEIGHTED SCORES. The channels are not on a common scale — a lexical score
 * and a structural one measure different things — so any scheme that adds their magnitudes is
 * comparing units that do not compare. RRF uses only the *rank*, which every channel has in
 * the same units by construction.
 *
 * WHAT IT REPLACES, and this is finding A-6. `semantica/semantica/context/context_retriever.py`'s
 * `_rank_and_merge` min–max normalises each source independently before weighting. That throws
 * away absolute quality: the best result *within* a source becomes 1.0 whether it is excellent
 * or the least-bad of three irrelevant ones, so a source that found nothing useful still
 * contributes a maximally-scored candidate, and no downstream weight can recover the signal.
 * The correct implementation was already in the same repository and the headline class could
 * not reach it (A-7).
 *
 * THREE DEFECTS IN THE ORIGINAL, FIXED HERE:
 *  1. `result.get("id", str(id(result)))` falls back to the Python object address, so a result
 *     carrying no id silently becomes its own key and can never fuse across channels. Here a
 *     missing id is a hard error with a reason code — HARD RULE 4.
 *  2. Result reconstruction is last-list-wins, so the payload kept for a fused id is whichever
 *     channel happened to come last. Here every channel's contribution is kept.
 *  3. `result["score"] = score` overwrites the per-channel score with the fused one, destroying
 *     the evidence needed to explain a ranking. Here the original score is retained per channel.
 *
 * Stage 1: pure functions over plain data.
 */

/**
 * The paper's own default. `k` damps the dominance of a single high rank, so one channel's
 * outstanding vote becomes comparable to agreement across channels rather than overwhelming it.
 *
 * PROVENANCE: **declared placeholder** — and now for a *measured* reason rather than an
 * unexamined one, which is a materially better place to be.
 *
 * `eval/sweep.ts` ran it over 1, 5, 10, 20, 30, 60, 120 and 300 against 19 labelled queries.
 * **Every value scored identically (0.819).** The sweep cannot calibrate it, and the cause is
 * structural rather than a shortage of data: `structuralChannel` excludes every lexical seed by
 * construction, so **no document is ever in both channels** — measured at 0 overlaps across all
 * 19 queries. With one contribution per item the score is `1/(k+rank)`, which is monotonically
 * decreasing in rank for any positive k, so the ordering is by rank and k cannot affect it.
 *
 * RRF's entire mechanism is rewarding agreement across channels, and this engine's channels are
 * disjoint by design. A variant that lets seeds also score structurally was measured: it does
 * create overlap, and at the calibrated `LEXICAL_FLOOR` it scores **0.819 — identical**. So the
 * variant was not adopted.
 *
 * What would settle it: channels that can genuinely overlap *and* a labelled set where the
 * difference matters. Until then 60 stands as the source paper's default (Cormack, Clarke &
 * Buettcher, SIGIR 2009), and no document may describe it as tuned.
 * `memory/src/recall.ts:361` carries the same constant with the same declared status.
 */
export const RRF_K = 60;

export type FusionErrorCode = 'missing_id' | 'duplicate_id_in_channel' | 'invalid_k';

export class FusionError extends Error {
  readonly code: FusionErrorCode;
  constructor(code: FusionErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'FusionError';
    this.code = code;
  }
}

export interface Candidate {
  readonly id: string;
  /** The channel's own score, in the channel's own units. Never normalised, never overwritten. */
  readonly score: number;
}

export interface Channel {
  readonly name: string;
  /** Ranked best-first. Rank is position, so the caller's order is the claim being fused. */
  readonly results: readonly Candidate[];
}

export interface Contribution {
  readonly channel: string;
  /** 1-based, as in the paper. */
  readonly rank: number;
  /** What this channel actually scored it. Retained so a ranking can be explained. */
  readonly score: number;
  /** This channel's share of the fused score: `1/(k+rank)`. */
  readonly rrf: number;
}

export interface FusedItem {
  readonly id: string;
  readonly fusedScore: number;
  /** One per channel that returned this id, in channel order. Never collapsed. */
  readonly contributions: readonly Contribution[];
}

/**
 * Fuse any number of ranked channels.
 *
 * Ties are broken by id so the result is a total order and therefore reproducible; without
 * it, two runs over the same input could disagree and the difference would look like a bug
 * somewhere more interesting.
 */
export function fuse(channels: readonly Channel[], k: number | undefined = RRF_K): readonly FusedItem[] {
  if (k === undefined) k = RRF_K;
  if (!Number.isFinite(k) || k <= 0) {
    throw new FusionError('invalid_k', `k must be a positive finite number, got ${String(k)}`);
  }

  const acc = new Map<string, { score: number; contributions: Contribution[] }>();

  for (const channel of channels) {
    const seen = new Set<string>();
    for (let i = 0; i < channel.results.length; i++) {
      const r = channel.results[i] as Candidate;

      // Fix 1. The original degrades to the object address here, which produces a candidate
      // that can never fuse with its own duplicate in another channel — silently, and the
      // symptom is a ranking that is merely slightly wrong.
      if (typeof r.id !== 'string' || r.id === '') {
        throw new FusionError(
          'missing_id',
          `channel ${JSON.stringify(channel.name)} position ${i + 1} has no id; ` +
            'an id-less candidate cannot be fused and must not be silently ranked alone',
        );
      }
      if (seen.has(r.id)) {
        throw new FusionError(
          'duplicate_id_in_channel',
          `channel ${JSON.stringify(channel.name)} lists ${JSON.stringify(r.id)} twice; ` +
            'one channel gives one candidate one rank',
        );
      }
      seen.add(r.id);

      const rank = i + 1;
      const rrf = 1 / (k + rank);
      const entry = acc.get(r.id) ?? { score: 0, contributions: [] };
      entry.score += rrf;
      // Fixes 2 and 3: keep every channel's contribution, and keep its own score alongside.
      entry.contributions.push({ channel: channel.name, rank, score: r.score, rrf });
      acc.set(r.id, entry);
    }
  }

  return [...acc.entries()]
    .map(([id, v]) => ({ id, fusedScore: v.score, contributions: v.contributions }))
    .sort((a, b) => (b.fusedScore - a.fusedScore) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
