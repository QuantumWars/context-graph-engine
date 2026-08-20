/**
 * A labelled extraction set, for measuring `src/extract/rules.ts`.
 *
 * ─── THE LABELLING RULE, written before any extractor output was looked at ─────────────────
 *
 * A relation is GOLD when the text **states** it. Not implies it, not makes it likely, not places
 * the two things near each other: states it. This is the recon's Task 3.2 rule — *an edge is
 * written only when something in the source text supports its predicate; proximity is not support*
 * — applied to labelling rather than to code.
 *
 * Consequences that decide the hard rows, all settled before running anything:
 *
 *   - **A negated statement states nothing.** "The deploy did not cause the outage" is not evidence
 *     that the deploy caused the outage. Gold: no relation.
 *   - **A hedged statement states nothing.** "The deploy may have caused the outage" reports a
 *     possibility. Gold: no relation.
 *   - **A question states nothing.** "Did the deploy cause the outage?" Gold: no relation.
 *   - **A reported claim is not the claim.** "Nobody thinks the deploy caused the outage" states
 *     the opposite. Gold: no relation.
 *   - **Direction is part of the claim.** "A caused B" and "B caused A" are different relations,
 *     and getting the direction wrong is wrong, not half-right.
 *
 * ─── WHY MOST OF THIS SET IS NEGATIVE ──────────────────────────────────────────────────────
 *
 * In the standard sentence-level relation-extraction sets, the negative class dominates — around
 * four fifths of the data — and it is excluded from the headline micro-F1 so a system is not
 * rewarded for predicting it. The same asymmetry is the whole point here: finding A-8 is that
 * `semantica`'s co-occurrence extractor emits an edge for every entity pair within 100 characters,
 * and **no test in that repository asks an extractor to stay silent.** Measured 2026-08-20: the one
 * test asserting `relations == []` feeds the parser an empty LLM response — empty in, empty out. It
 * is a parser test, not a silence test.
 *
 * A set of only positive sentences cannot see that failure at all. An extractor that fires on
 * everything scores 100% recall on it.
 *
 * So negatives here contribute to **precision only**: a sentence that should emit nothing produces
 * no true positive and no false negative, and costs precision if the extractor fires. Silence is
 * reported separately as its own rate.
 *
 * ─── WHO LABELLED IT, AND WHAT THAT IS WORTH ───────────────────────────────────────────────
 *
 * The same session that wrote the rules. That is the weakest thing about this set and it is stated
 * here rather than in a footnote, as `eval/dataset.ts`, `eval/duplicates.ts` and `eval/linking.ts`
 * all do. The rule above was written first, every label follows the rule rather than what the
 * extractor returns, and where the two disagreed the label stood and the disagreement became a
 * finding. What would fix it is labels from someone who did not write the code.
 *
 * ─── WHAT A GOLD RELATION IS COMPARED ON ───────────────────────────────────────────────────
 *
 * Predicate, subject text and object text — the standard criterion is that a triple counts only
 * when the relation and both argument spans are right. Comparing the resolved **quotes** rather
 * than raw offsets is a deliberate weakening: two different spans could in principle resolve to the
 * same string. On these sentences they do not, and stating the gap is cheaper than a brittle set of
 * hand-counted offsets that no one will maintain.
 */

export type ExtractFamily =
  | 'stated-causal' | 'stated-influence' | 'stated-precedent' | 'stated-multiple'
  | 'negative-cooccurrence' | 'negative-negated' | 'negative-hedged' | 'negative-question'
  | 'negative-narrative'
  | 'scope-other-clause' | 'pseudo-negation' | 'negative-counterfactual' | 'stated-parenthetical';

export interface GoldRelation {
  readonly predicate: 'CAUSED' | 'INFLUENCED' | 'PRECEDENT_FOR';
  readonly subject: string;
  readonly object: string;
}

export interface LabelledText {
  readonly id: string;
  readonly text: string;
  readonly family: ExtractFamily;
  readonly gold: readonly GoldRelation[];
  readonly note?: string;
}

export const TEXTS: readonly LabelledText[] = [
  // ── stated, one relation each ────────────────────────────────────────────────────────────
  {
    id: 's1', family: 'stated-causal',
    text: 'The friday deploy caused a checkout outage.',
    gold: [{ predicate: 'CAUSED', subject: 'The friday deploy', object: 'a checkout outage' }],
  },
  {
    id: 's2', family: 'stated-causal',
    text: 'The expired certificate led to a login failure.',
    gold: [{ predicate: 'CAUSED', subject: 'The expired certificate', object: 'a login failure' }],
  },
  {
    id: 's3', family: 'stated-causal',
    text: 'The schema migration resulted in a read timeout.',
    gold: [{ predicate: 'CAUSED', subject: 'The schema migration', object: 'a read timeout' }],
  },
  {
    id: 's4', family: 'stated-influence',
    text: 'The March postmortem informed the rollback policy.',
    gold: [{ predicate: 'INFLUENCED', subject: 'The March postmortem', object: 'the rollback policy' }],
  },
  {
    id: 's5', family: 'stated-influence',
    text: 'The cost review shaped the vendor decision.',
    gold: [{ predicate: 'INFLUENCED', subject: 'The cost review', object: 'the vendor decision' }],
  },
  {
    id: 's6', family: 'stated-precedent',
    text: 'The payments rollout set a precedent for later launches.',
    gold: [{ predicate: 'PRECEDENT_FOR', subject: 'The payments rollout', object: 'later launches' }],
  },

  // ── stated, more than one relation in one text ───────────────────────────────────────────
  {
    id: 'm1', family: 'stated-multiple',
    text: 'The friday deploy caused a checkout outage. The outage informed the gate.',
    gold: [
      { predicate: 'CAUSED', subject: 'The friday deploy', object: 'a checkout outage' },
      { predicate: 'INFLUENCED', subject: 'The outage', object: 'the gate' },
    ],
  },
  {
    id: 'm2', family: 'stated-multiple',
    text: 'The audit informed the rewrite. The rewrite set a precedent for later builds.',
    gold: [
      { predicate: 'INFLUENCED', subject: 'The audit', object: 'the rewrite' },
      { predicate: 'PRECEDENT_FOR', subject: 'The rewrite', object: 'later builds' },
    ],
  },

  // ── negative: the A-8 shape — many entities, nothing stated between them ─────────────────
  {
    id: 'n1', family: 'negative-cooccurrence',
    text: 'Present: Alice, Bob, Carol, Dave, Erin, Frank, Grace, Heidi, Ivan, Judy.',
    gold: [],
    note: 'ten entities; co-occurrence extraction emits 45 edges here and the text states none',
  },
  {
    id: 'n2', family: 'negative-cooccurrence',
    text: 'The checkout service, the payments service and the search indexer were all reviewed.',
    gold: [],
    note: 'three services in one sentence, no relation between them stated',
  },
  {
    id: 'n3', family: 'negative-cooccurrence',
    text: 'Attendees: the platform team, the growth team, the on-call rota owner.',
    gold: [],
  },

  // ── negative: the text uses a trigger word and states the opposite, or nothing ───────────
  {
    id: 'g1', family: 'negative-negated',
    text: 'The friday deploy did not cause the checkout outage.',
    gold: [],
    note: 'contains the trigger word and denies the relation',
  },
  {
    id: 'g2', family: 'negative-negated',
    text: 'Nobody believes the migration caused the timeout.',
    gold: [],
    note: 'reports a claim in order to reject it',
  },
  {
    id: 'g2b', family: 'negative-negated',
    text: 'The friday deploy never caused the checkout outage.',
    gold: [],
    note: 'negation with the trigger word in the PAST tense. g1 uses "did not cause", where English '
      + 'puts the verb in the infinitive and the rule misses it for reasons that have nothing to do '
      + 'with polarity — this row is here so the family is not credited for that accident',
  },
  {
    id: 'g5b', family: 'negative-question',
    text: 'Whether the deploy caused the outage is still open.',
    gold: [],
    note: 'past tense inside an embedded clause that states the question, not the answer',
  },
  {
    id: 'g3', family: 'negative-hedged',
    text: 'The deploy may have caused the outage.',
    gold: [],
    note: 'states a possibility, not a relation',
  },
  {
    id: 'g4', family: 'negative-hedged',
    text: 'It is unclear whether the certificate caused the failure.',
    gold: [],
  },
  {
    id: 'g5', family: 'negative-question',
    text: 'Did the friday deploy cause the checkout outage?',
    gold: [],
    note: 'asks; states nothing',
  },

  // ── negative: ordinary prose that mentions related things without relating them ──────────
  {
    id: 'p1', family: 'negative-narrative',
    text: 'We shipped on friday. Checkout was down for two hours. The postmortem is written.',
    gold: [],
    note: 'three sentences a reader would connect; none of them states a relation',
  },
  {
    id: 'p2', family: 'negative-narrative',
    text: 'The rollback policy is documented in the runbook and reviewed each quarter.',
    gold: [],
  },
  {
    id: 'p3', family: 'negative-narrative',
    text: 'Parking permit renewal happens every January.',
    gold: [],
  },
];

// ── Phase 14, polarity. These ten were HELD OUT while the polarity check was built: none of them
// informed the cue list, and the first version of that check scored 6 of 10 on them against 100% on
// everything above. They are promoted into the set now so they guard against a regression, and the
// history is recorded in build/phase-14-summary.md so nobody reads a later 10/10 as the original
// result.
const HELD_OUT: readonly LabelledText[] = [
  {
    id: 'sc1', family: 'scope-other-clause',
    text: 'The deploy caused the outage, which was not detected for an hour.',
    gold: [{ predicate: 'CAUSED', subject: 'The deploy', object: 'the outage' }],
    note: 'the denial is after the verb and about something else',
  },
  {
    id: 'sc2', family: 'scope-other-clause',
    text: 'It is not raining and the deploy caused the outage.',
    gold: [{ predicate: 'CAUSED', subject: 'the deploy', object: 'the outage' }],
    note: 'the denial governs the other half of the sentence',
  },
  {
    id: 'sc3', family: 'scope-other-clause',
    text: 'The rollback did not prevent the failure; the deploy caused the outage.',
    gold: [{ predicate: 'CAUSED', subject: 'the deploy', object: 'the outage' }],
  },
  {
    id: 'ps1', family: 'pseudo-negation',
    text: 'No one disputes that the deploy caused the outage.',
    gold: [{ predicate: 'CAUSED', subject: 'the deploy', object: 'the outage' }],
    note: 'a double negative asserts; NegEx calls these pseudo-negation terms',
  },
  {
    id: 'cf1', family: 'negative-counterfactual',
    text: 'Had the deploy caused the outage, we would have rolled back.',
    gold: [],
    note: 'counterfactual: states what would follow IF, not that it did',
  },
  {
    id: 'nq1', family: 'negative-question',
    text: 'The report questions whether the migration caused the timeout.',
    gold: [],
  },
  {
    id: 'nn1', family: 'negative-negated',
    text: 'Nothing suggests the deploy caused the outage.',
    gold: [],
  },
  {
    id: 'nn2', family: 'negative-negated',
    text: 'We cannot say the deploy caused the outage.',
    gold: [],
  },
  {
    id: 'nh1', family: 'negative-hedged',
    text: 'The deploy allegedly caused the outage.',
    gold: [],
    note: 'reported, not asserted',
  },
  {
    id: 'pr1', family: 'stated-parenthetical',
    text: 'The audit, if thorough, informed the rewrite.',
    gold: [{ predicate: 'INFLUENCED', subject: 'The audit', object: 'the rewrite' }],
    note: 'A KNOWN RECALL GAP, and not a polarity one. Measured: 0 relations AND 0 suppressed, so '
      + 'the rule never matched — the subject pattern admits only word characters and cannot span '
      + 'a parenthetical. Polarity gets this right: asked directly, assertsRelation returns true.',
  },
];

/** Texts that state at least one relation. */
export const ALL: readonly LabelledText[] = [...TEXTS, ...HELD_OUT];
export const POSITIVE: readonly LabelledText[] = ALL.filter((t) => t.gold.length > 0);
/** Texts whose correct output is silence. */
export const NEGATIVE: readonly LabelledText[] = ALL.filter((t) => t.gold.length === 0);
/** Every gold relation across the set. */
export const GOLD_COUNT: number = ALL.reduce((n, t) => n + t.gold.length, 0);
