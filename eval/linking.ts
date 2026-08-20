/**
 * A labelled linking set, for measuring `src/extract/link.ts`.
 *
 * ─── THE LABELLING RULE, written before any linking output was looked at ───────────────────
 *
 * A mention LINKS to a record when a competent reader of this store would say the phrase refers to
 * that record's subject. Not "is about the same topic", not "is similar wording": refers to it.
 *
 * A mention is NIL when no record in the store is its referent. NIL is a label, not an absence —
 * a set with no NIL mentions measures only the easy half of the problem, because a linker that
 * always answers something scores perfectly on it. Roughly a quarter of this set is NIL by design.
 *
 * The mentions are the shape `extract` actually produces: subject and object phrases lifted out of
 * sentences, so they are short, they carry articles ("the friday deploy"), and they are not tidy
 * entity names. That matters — a set of clean names would measure a problem this engine does not
 * have.
 *
 * The families, chosen so the set is hard in both directions:
 *
 *   - exact — the phrase is the record's own wording
 *   - partial — the phrase is a fragment of a longer record
 *   - reworded — the same referent in different words
 *   - abbreviation — an acronym or short form against its expansion
 *   - ambiguous — two records are plausible; the label is the better one, and the linker is
 *     expected to find both, which is what the margin is for
 *   - NIL-near — refers to nothing here, but shares vocabulary with records that exist
 *   - NIL-far — refers to nothing here and shares nothing
 *
 * The NIL-near family is the point. A linker is easy to fool with NIL-far mentions and every
 * scheme gets those right; the ones worth having look linkable and are not.
 *
 * ─── WHO LABELLED IT, AND WHAT THAT IS WORTH ───────────────────────────────────────────────
 *
 * The same session that wrote the linker. That is the weakest thing about this set and it is
 * stated here rather than in a footnote, exactly as `eval/dataset.ts` and `eval/duplicates.ts` do.
 *
 * The mitigation is the same and is equally partial: the rule above was written first, the records
 * and mentions were written before any score was computed, every label follows the rule rather than
 * what the linker returns, and where the two disagreed the label stood and the disagreement became
 * a finding. What would genuinely fix it is labels from someone who did not write the code.
 *
 * One thing this set is NOT: a benchmark. 24 mentions over 20 records is small enough that a single
 * label change moves a metric by four percentage points. It is enough to catch a regression and to
 * answer "is the margin worth anything", and not enough to compare two designs.
 */

import type { Candidate } from '../src/resolve/similarity';

/** The store the mentions are linked against. Names are the record text, as `linkables()` builds them. */
export const RECORDS: readonly Candidate[] = [
  { id: 'd-friday', name: 'we stopped shipping on fridays', type: 'decision' },
  { id: 'd-gate', name: 'we added a pre-deploy gate', type: 'decision' },
  { id: 'd-rollback', name: 'we made rollback a one-command operation', type: 'decision' },
  { id: 'd-oncall', name: 'we moved to a follow-the-sun on-call rota', type: 'decision' },
  { id: 'd-postmortem', name: 'every incident gets a written postmortem', type: 'decision' },
  { id: 'i-checkout', name: 'the checkout outage of 14 March', type: 'node' },
  { id: 'i-payments', name: 'the payments latency spike in April', type: 'node' },
  { id: 'i-search', name: 'search returned empty results for two hours', type: 'node' },
  { id: 'svc-checkout', name: 'the checkout service', type: 'node' },
  { id: 'svc-payments', name: 'the payments service', type: 'node' },
  { id: 'svc-search', name: 'the search indexer', type: 'node' },
  { id: 'team-platform', name: 'the platform team', type: 'node' },
  { id: 'team-growth', name: 'the growth team', type: 'node' },
  { id: 'doc-runbook', name: 'the incident response runbook', type: 'node' },
  { id: 'doc-slo', name: 'the service level objective document', type: 'node' },
  { id: 'proj-migration', name: 'the postgres migration project', type: 'node' },
  { id: 'proj-checkout-rewrite', name: 'the checkout rewrite', type: 'node' },
  { id: 'vendor-cdn', name: 'the CDN provider contract', type: 'node' },
  { id: 'q1-review', name: 'the first quarter reliability review', type: 'node' },
  { id: 'q2-review', name: 'the second quarter reliability review', type: 'node' },
];

export type Family = 'exact' | 'partial' | 'reworded' | 'abbreviation' | 'ambiguous' | 'nil-near' | 'nil-far';

export interface LabelledMention {
  readonly mention: string;
  /** The record it refers to, or `null` for NIL. */
  readonly gold: string | null;
  readonly family: Family;
  /** Why this label, where the phrase alone does not make it obvious. */
  readonly note?: string;
}

export const MENTIONS: readonly LabelledMention[] = [
  // exact — the record's own wording
  { mention: 'the checkout service', gold: 'svc-checkout', family: 'exact' },
  { mention: 'the platform team', gold: 'team-platform', family: 'exact' },
  { mention: 'the checkout rewrite', gold: 'proj-checkout-rewrite', family: 'exact' },

  // partial — a fragment of a longer record
  { mention: 'the checkout outage', gold: 'i-checkout', family: 'partial' },
  { mention: 'payments latency', gold: 'i-payments', family: 'partial' },
  { mention: 'a pre-deploy gate', gold: 'd-gate', family: 'partial' },
  { mention: 'the postgres migration', gold: 'proj-migration', family: 'partial' },
  { mention: 'the incident response runbook', gold: 'doc-runbook', family: 'exact' },

  // reworded — same referent, different words
  { mention: 'no friday releases', gold: 'd-friday', family: 'reworded',
    note: 'the decision is worded "stopped shipping on fridays"' },
  { mention: 'one-command rollback', gold: 'd-rollback', family: 'reworded' },
  { mention: 'the search indexing job', gold: 'svc-search', family: 'reworded' },
  { mention: 'written postmortems for incidents', gold: 'd-postmortem', family: 'reworded' },
  { mention: 'the follow the sun rota', gold: 'd-oncall', family: 'reworded' },

  // abbreviation — short form against expansion
  { mention: 'the SLO doc', gold: 'doc-slo', family: 'abbreviation',
    note: 'SLO expands to service level objective' },
  { mention: 'the CDN contract', gold: 'vendor-cdn', family: 'abbreviation' },

  // ambiguous — two records are plausible; the label is the better one
  { mention: 'the reliability review', gold: 'q1-review', family: 'ambiguous',
    note: 'q1 and q2 are both plausible; q1 is first and neither is wrong to surface — the point ' +
      'of this row is that the margin should be small, not that rank 1 must be q1' },
  { mention: 'the checkout problem', gold: 'i-checkout', family: 'ambiguous',
    note: 'svc-checkout and proj-checkout-rewrite also share the word; the incident is the referent' },

  // nil-near — refers to nothing here, but shares vocabulary with records that do exist
  { mention: 'the checkout redesign workshop', gold: null, family: 'nil-near',
    note: 'shares "checkout" with three records and is none of them' },
  { mention: 'the payments team', gold: null, family: 'nil-near',
    note: 'platform and growth teams exist; a payments team does not' },
  { mention: 'the third quarter reliability review', gold: null, family: 'nil-near',
    note: 'q1 and q2 exist; q3 does not' },
  { mention: 'the search rewrite', gold: null, family: 'nil-near',
    note: 'a checkout rewrite exists and a search indexer exists; a search rewrite does not' },
  { mention: 'the deploy freeze policy', gold: null, family: 'nil-near',
    note: 'shares "deploy" with the gate decision and is a different thing' },

  // nil-far — refers to nothing here and shares nothing
  { mention: 'the cafeteria menu rotation', gold: null, family: 'nil-far' },
  { mention: 'quantum tunnelling', gold: null, family: 'nil-far' },
];

/** Mentions with a referent in the store. */
export const IN_STORE: readonly LabelledMention[] = MENTIONS.filter((m) => m.gold !== null);
/** Mentions whose correct answer is "nothing here". */
export const NIL: readonly LabelledMention[] = MENTIONS.filter((m) => m.gold === null);
