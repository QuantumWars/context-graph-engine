/**
 * Entity linking: from a mention in text to the records it might refer to.
 *
 * `DEC-014`. The survey literature describes linking as three stages — candidate generation,
 * ranking, and unlinkable (NIL) prediction. The first two already exist here as
 * `src/resolve/blocking.ts` and `src/resolve/similarity.ts`, and reusing them is deliberate: a
 * second scorer in one package is the duplication this monorepo has already made four times.
 *
 * THE PORT'S DEFECT, AND WHY NO THRESHOLD FIXES IT.
 *
 * `semantica/semantica/context/entity_linker.py:444` decides identity with
 * `link_type="same_as" if similarity >= 0.9 else "related_to"`, where `similarity` is set-Jaccard
 * over whitespace-split words (`:481`). A set has no order, so
 * `'the deploy caused the outage'` and `'the outage caused the deploy'` score exactly **1.0** and
 * are declared the same entity — in a library for building causal graphs. Raising `0.9` to `0.99`
 * changes nothing. The defect is not the constant, and a better constant would not fix it.
 *
 * THIS MODULE INTRODUCES NO CONSTANT, and `test/link.test.ts` asserts that, red against a
 * deliberately added threshold. Two of the four standard NIL techniques need a number and two do
 * not — "the generator returned nothing" and "the top two are tied" are facts about the result.
 * Those are the verdicts. Everything else is returned ranked, with the margin between the top two
 * reported as a number and never compared against one, so the caller judges with the same signal a
 * threshold would have used.
 *
 * Stage 1: pure functions over plain data.
 */

import { blockKeys } from '../resolve/blocking';
import { similarity, type Candidate } from '../resolve/similarity';

/**
 * The id given to the mention while it is scored against real records.
 *
 * It is never compared — `similarity` reads name, type and props — but it must not look like a
 * record id to anyone reading a debug dump. It was a leading space until 2026-08-20, when a sweep
 * found the byte was actually NUL, which made `grep` classify this whole file as binary and skip
 * it silently. Named rather than inlined so the next reader sees a word instead of whitespace.
 */
export const MENTION_PROBE_ID = '(mention)';

/**
 * The score below which a top candidate is reported as `weak`.
 *
 * PROVENANCE: **calibrated**, 2026-08-20, by `eval/link-sweep.ts` over the 24-mention labelled set
 * in `eval/linking.ts`. Sweeping a hard reject:
 *
 *     none (today)   kept 15/17  nil 0/7  total 62.5%
 *     score < 0.30   kept 13/17  nil 5/7  total 75.0%   <- best of twelve score cuts
 *     score < 0.34   kept 11/17  nil 6/7  total 70.8%
 *     margin < 0.05  kept 11/17  nil 5/7  total 66.7%   <- margin rules are all worse
 *
 * 0.30 is the peak. **The populations overlap** — a correct answer scores as low as 0.081 and a NIL
 * as high as 0.495 — so no cut separates them, and this number is the best of a bad set rather than
 * a boundary between two things.
 *
 * That is exactly why it labels instead of rejecting. A hard cut at 0.30 would have silenced two
 * correct answers, both rewordings: *"no friday releases"* at 0.081 and *"the follow the sun rota"*
 * at 0.293. Reporting `weak` and keeping every candidate costs neither, and still flags five of the
 * seven mentions that refer to nothing.
 *
 * Recalibrate with `bun --cwd engine eval/link-sweep.ts` after any change to the scorer.
 */
export const LINK_WEAK_SCORE = 0.3;

/**
 * `no_candidates` — the generator returned nothing; the mention refers to nothing here.
 * `tie`          — the two best candidates score identically, so rank 1 is not an answer.
 * `weak`         — a candidate exists but scores below `LINK_WEAK_SCORE`. Most mentions that refer
 *                  to nothing land here, and so do a few real matches, so it is a warning and never
 *                  a rejection: every candidate is still returned.
 * `ranked`       — candidates are ordered; the caller decides, with the scores and margin to hand.
 */
export type LinkVerdict = 'no_candidates' | 'tie' | 'weak' | 'ranked';

export interface LinkCandidate {
  readonly id: string;
  readonly name: string;
  readonly score: number;
}

export interface LinkResult {
  readonly mention: string;
  readonly verdict: LinkVerdict;
  readonly candidates: readonly LinkCandidate[];
  /**
   * Top score minus runner-up. Reported, never thresholded — a top candidate at 0.9 against a
   * runner-up at 0.88 is ambiguous however high the top score is, which a threshold on the top
   * score alone cannot see. `null` when fewer than two candidates exist.
   */
  readonly margin: number | null;
}

export interface LinkOptions {
  /**
   * How many candidates to return. A **display cap**, not a decision about identity: it shortens a
   * list, and every candidate it drops scored no higher than one it kept. Deliberately has no
   * default, so the number lives at the call site that displays the result rather than in here.
   */
  readonly limit?: number;
  /** Restrict candidates to one record kind, when the caller knows it. */
  readonly type?: string;
  /**
   * Record ids to leave out. The caller that matters is `propose`: a mention read out of record X
   * matches X trivially and always ranks it first, because the phrase is literally in its text.
   * Linking a phrase back to the record it was read from answers a question nobody asked, and it
   * pushes the records the caller actually wants down the list.
   */
  readonly exclude?: readonly string[];
}

/**
 * Rank the records a mention might refer to.
 *
 * `records` are the store's live records as `Candidate`s. Candidate generation is the same
 * multi-key blocking used for duplicate detection: a record is considered only if it shares a block
 * key with the mention, so an unrelated record is never scored and never ranked.
 */
export function link(
  mention: string,
  records: readonly Candidate[],
  opts: LinkOptions = {},
): LinkResult {
  const probe: Candidate = { id: MENTION_PROBE_ID, name: mention, type: opts.type ?? '' };
  const keys = blockKeys(probe, { phonetic: true });

  const scored: LinkCandidate[] = [];
  const excluded = new Set(opts.exclude ?? []);
  for (const r of records) {
    if (excluded.has(r.id)) continue;
    if (opts.type !== undefined && r.type !== opts.type) continue;
    // Generation, then ranking — a record sharing no key with the mention is never scored.
    let shares = false;
    for (const k of blockKeys(r, { phonetic: true })) {
      if (keys.has(k)) { shares = true; break; }
    }
    if (!shares) continue;
    scored.push({ id: r.id, name: r.name, score: similarity(probe, r).total });
  }

  // Ties broken by id so the order is stable across runs; the `tie` verdict is what tells a caller
  // that the ordering between the top two carries no information.
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const top = scored[0];
  const next = scored[1];
  const margin = top === undefined || next === undefined ? null : top.score - next.score;

  const verdict: LinkVerdict =
    top === undefined ? 'no_candidates'
      : margin === 0 ? 'tie'
        : top.score < LINK_WEAK_SCORE ? 'weak'
          : 'ranked';

  const capped = opts.limit === undefined ? scored : scored.slice(0, opts.limit);
  return { mention, verdict, candidates: capped, margin };
}
