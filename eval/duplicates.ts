/**
 * A labelled duplicate set, for measuring blocking.
 *
 * ─── THE LABELLING RULE, written before any blocking parameter was looked at ────────────────
 *
 * Two records are DUPLICATES when they refer to the same real-world thing — the same incident,
 * the same decision, the same person, the same service. Not "similar", not "related": the same.
 * Two records about the same *topic* are not duplicates. Two records of the same incident written
 * by different people, at different times, with different wording, are.
 *
 * The set is built the way a context store actually accumulates them:
 *
 *   - the same incident recorded twice with different phrasing
 *   - an abbreviation against its expansion
 *   - a typo against the correct spelling
 *   - a name reordered, or with a middle initial added
 *   - the same title with a different type, which must NOT be merged
 *   - near-misses that share a lot of text and are genuinely different things
 *
 * That last family is the point. A blocking set of obvious duplicates measures nothing, because
 * every scheme finds those. The pairs worth having are the ones that are hard both ways.
 *
 * ─── WHO LABELLED IT, AND WHAT THAT IS WORTH ───────────────────────────────────────────────
 *
 * The same session that wrote the blocker. That is the weakest thing about this set and it is
 * stated here rather than in a footnote, exactly as `eval/dataset.ts` does for retrieval.
 *
 * The mitigation is the same and is equally partial: the rule above was written first, every label
 * follows the rule rather than what the blocker happens to return, and where the two disagreed the
 * label stood and the disagreement became a finding. What would genuinely fix it is labels from
 * someone who did not write the code.
 *
 * 24 labelled pairs is small. A parameter sweep over a set this size fits noise, so the sweep
 * reports the curve and does not silently pick a winner.
 */

import type { Candidate } from '../src/resolve/similarity';

export const RECORDS: readonly Candidate[] = [
  // ── the same incident, recorded twice ────────────────────────────────────────────────────
  { id: 'inc-1a', name: 'checkout outage after friday deploy', type: 'incident', props: { service: 'checkout' } },
  { id: 'inc-1b', name: 'friday deploy took checkout down', type: 'incident', props: { service: 'checkout' } },

  // ── abbreviation against expansion ───────────────────────────────────────────────────────
  { id: 'svc-2a', name: 'site reliability engineering rota', type: 'doc', props: { team: 'platform' } },
  { id: 'svc-2b', name: 'sre rota', type: 'doc', props: { team: 'platform' } },

  // ── typo against correct spelling ────────────────────────────────────────────────────────
  { id: 'db-3a', name: 'postgres migration lock timeout', type: 'incident', props: { service: 'orders' } },
  { id: 'db-3b', name: 'postgress migration lock timout', type: 'incident', props: { service: 'orders' } },

  // ── reordered name, initial added ────────────────────────────────────────────────────────
  { id: 'per-4a', name: 'jon smith', type: 'person', props: { team: 'platform' } },
  { id: 'per-4b', name: 'smith, jon a', type: 'person', props: { team: 'platform' } },

  // ── phonetic variant ─────────────────────────────────────────────────────────────────────
  { id: 'per-5a', name: 'catherine oleary', type: 'person', props: { team: 'data' } },
  { id: 'per-5b', name: 'katherine olery', type: 'person', props: { team: 'data' } },

  // ── same wording, different kind — NOT a duplicate ───────────────────────────────────────
  { id: 'dep-6a', name: 'deploy gate', type: 'decision', props: { area: 'release' } },
  { id: 'dep-6b', name: 'deploy gate', type: 'runbook', props: { area: 'release' } },

  // ── near-misses: heavy overlap, genuinely different ──────────────────────────────────────
  { id: 'nm-7a', name: 'orders table migration', type: 'incident', props: { service: 'orders' } },
  { id: 'nm-7b', name: 'orders table index rebuild', type: 'incident', props: { service: 'orders' } },
  { id: 'nm-8a', name: 'session expiry twelve hours', type: 'decision', props: { area: 'auth' } },
  { id: 'nm-8b', name: 'session expiry thirty days', type: 'decision', props: { area: 'auth' } },

  // ── same thing, almost no shared vocabulary — the hard recall case ───────────────────────
  { id: 'hard-9a', name: 'p1 checkout unavailable forty minutes', type: 'incident', props: { service: 'checkout' } },
  { id: 'hard-9b', name: 'the friday outage', type: 'incident', props: { service: 'checkout' } },

  // ── unrelated noise ──────────────────────────────────────────────────────────────────────
  { id: 'noise-1', name: 'cafeteria menu wednesday', type: 'doc', props: { area: 'office' } },
  { id: 'noise-2', name: 'parking permit renewal', type: 'doc', props: { area: 'office' } },
  { id: 'noise-3', name: 'laptop refresh policy', type: 'doc', props: { area: 'office' } },
  { id: 'noise-4', name: 'fire drill schedule', type: 'doc', props: { area: 'office' } },
  { id: 'noise-5', name: 'welcome pack contents', type: 'doc', props: { area: 'office' } },
  { id: 'noise-6', name: 'bike shed colour', type: 'doc', props: { area: 'office' } },
  { id: 'noise-7', name: 'stationery order process', type: 'doc', props: { area: 'office' } },
  { id: 'noise-8', name: 'plant watering rota', type: 'doc', props: { area: 'office' } },
];

export interface LabelledPair {
  readonly a: string;
  readonly b: string;
  /** Why this pair is labelled the way it is, for the reader who disagrees. */
  readonly note: string;
}

/** Pairs that ARE the same real-world thing. */
export const DUPLICATES: readonly LabelledPair[] = [
  { a: 'inc-1a', b: 'inc-1b', note: 'one outage, two phrasings; shares checkout, friday, deploy' },
  { a: 'svc-2a', b: 'svc-2b', note: 'sre is the abbreviation of site reliability engineering; same rota' },
  { a: 'db-3a', b: 'db-3b', note: 'two typos, same incident' },
  { a: 'per-4a', b: 'per-4b', note: 'same person, name reordered with a middle initial' },
  { a: 'per-5a', b: 'per-5b', note: 'same person; catherine/katherine and oleary/olery are spelling variants' },
  { a: 'hard-9a', b: 'hard-9b', note: 'same outage; almost no shared vocabulary. The hard recall case.' },
];

/**
 * Pairs a blocker might plausibly propose that are NOT duplicates. Not exhaustive — every pair not
 * in DUPLICATES is a non-duplicate — but these are the ones worth naming, because they are the
 * ones a scheme gets wrong for an interesting reason.
 */
export const NOT_DUPLICATES: readonly LabelledPair[] = [
  { a: 'dep-6a', b: 'dep-6b', note: 'identical name, different kind: a decision is not its runbook' },
  { a: 'nm-7a', b: 'nm-7b', note: 'same table, different incident: a migration is not an index rebuild' },
  { a: 'nm-8a', b: 'nm-8b', note: 'same policy area, opposite values: twelve hours is not thirty days' },
];
