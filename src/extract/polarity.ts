/**
 * Polarity: does the clause actually assert the relation its verb names?
 *
 * Phase 13 measured `src/extract/rules.ts` and found it matches a trigger word wherever the word
 * appears. It extracts a `CAUSED` relation from *"The friday deploy never caused the checkout
 * outage"* and from *"The deploy may have caused the outage"*, because a regex over `caused` cannot
 * see a denial or a hedge. Five of fifteen emitted relations were false positives, and every one
 * was this.
 *
 * NOTHING WAS PORTED, because there is nothing to port. Measured 2026-08-20: `negat`, `polarity`,
 * `hedge` and `speculat` appear **zero times** anywhere in `semantica/semantica/semantic_extract/`.
 * Its dependency extractor reads `acl`, `nsubj`, `dobj`, `conj` and `prep` from a spaCy parse and
 * never reads `neg`, so even with a full parse in hand it ignores negation.
 *
 * THE DESIGN IS NegEx'S, WITH ITS KNOWN WEAKNESS DESIGNED OUT. NegEx is trigger terms, pseudo-
 * negation terms, termination terms, and a scope of five to six tokens after the trigger. Its
 * documented failure mode is that fixed window: with several candidates inside it, the window
 * produces false positives, which is why later work replaces it with dependency paths.
 *
 * **This engine needs no window.** The rule that matched already reports the exact offsets of the
 * predicate, so scope can be the thing a window approximates: the clause the predicate sits in.
 * Take the text from the nearest clause boundary before the predicate up to the predicate itself,
 * and ask whether a cue governs it. That is threshold-free — there is no token count to calibrate —
 * and it is why no constant is introduced here.
 *
 * Stage 1: pure functions over plain data.
 */

/**
 * Words that make the clause they govern something other than an assertion.
 *
 * PROVENANCE: **declared placeholder.** Hand-written, in the families NegEx names — denial,
 * uncertainty, and reported-or-questioned claims — and extended with the cases `eval/extraction.ts`
 * labels. Not derived from a corpus, and not a published cue list. What would calibrate it is a
 * labelled set of causal sentences with polarity annotations, which does not exist here; the
 * measure until then is the false-positive count in `bun run --cwd engine eval:extract`.
 *
 * A cue only suppresses when it appears **before** the predicate in the same clause, so an ordinary
 * assertion followed by a denial about something else is untouched.
 */
export const POLARITY_CUES: readonly string[] = [
  // denial
  'not', 'never', 'no', 'nor', 'neither', 'without', 'nobody', 'nothing', 'none', 'cannot',
  'hardly', 'rarely', 'seldom', 'unable', 'fails', 'failed', "didn't",
  "doesn't", "wasn't", "weren't", "isn't", "aren't", "hasn't", "haven't", 'denies', 'denied',
  'refuted', 'disproved', 'rules out', 'ruled out',
  // uncertainty and hedging
  'may', 'might', 'could', 'possibly', 'perhaps', 'probably', 'unclear', 'unknown', 'uncertain',
  'suspect', 'suspected', 'allegedly', 'apparently', 'seems', 'seemed', 'appears', 'appeared',
  'likely', 'unlikely', 'presumably', 'supposedly',
  // questioned, hypothetical, or reported rather than asserted
  'whether', 'if', 'unless', 'would', 'should', 'assuming', 'suppose', 'hypothetically', 'had',
  'believes', 'believed', 'thinks', 'thought', 'claims', 'claimed', 'alleges', 'alleged',
];

/**
 * Phrases that contain a cue and nevertheless assert the relation.
 *
 * NegEx calls these **pseudo-negation** terms and names them as a required part of the algorithm —
 * "not rule out" and the like — and skipping them was measured, not theorised: on ten held-out
 * sentences the first version scored 6, and two of the four failures were double negatives. *"No
 * one disputes that the deploy caused the outage"* asserts it, and a cue list alone reads the
 * leading "no" and suppresses.
 *
 * A pseudo phrase is removed from the clause before cues are looked for, so its cue cannot fire and
 * any *other* cue in the clause still can.
 *
 * PROVENANCE: **declared placeholder**, same as `POLARITY_CUES` and calibrated by the same absent
 * corpus. Kept deliberately short: every phrase here is a hole in the negation check, so a wrong
 * entry costs precision — the metric this whole module exists to protect.
 */
export const PSEUDO_CUES: readonly string[] = [
  'no one disputes', 'nobody disputes', 'no one denies', 'nobody denies', 'not rule out',
  'cannot be ruled out', 'no doubt', 'not only',
];

/**
 * Where one clause ends and the next begins.
 *
 * This is NegEx's *termination term* idea: a scope must not run past the point where the sentence
 * changes what it is talking about. Sentence punctuation ends a clause, and so do the coordinators
 * that join two independent statements — without them, *"It is not raining and the deploy caused
 * the outage"* would inherit a denial that governs the other half of the sentence.
 */
const CLAUSE_BOUNDARY = /[.;:!?,]|\s+(?:and|but|however|though|although|because|so|yet|while|whereas)\s+/gi;

/**
 * The clause a character offset sits in, up to that offset.
 *
 * Returns the text between the nearest preceding clause boundary and `offset`. That span is what a
 * cue has to appear in to govern the predicate at `offset`.
 */
export function governingClause(text: string, offset: number): string {
  const before = text.slice(0, offset);
  let start = 0;
  CLAUSE_BOUNDARY.lastIndex = 0;
  for (let m = CLAUSE_BOUNDARY.exec(before); m !== null; m = CLAUSE_BOUNDARY.exec(before)) {
    start = m.index + m[0].length;
  }
  return before.slice(start);
}

/**
 * Where a SUBJECT may not begin before.
 *
 * Wider than `CLAUSE_BOUNDARY` and deliberately a separate list, because these answer different
 * questions. Polarity asks *"does a cue govern this predicate"*, and a cue in the main clause
 * governs a `that`-complement inside it — *"Nobody believes that the deploy caused the outage"* is
 * still a denial. Subject extent asks *"where does this noun phrase start"*, and there the
 * complementiser is exactly the boundary: the subject of `caused` is `the deploy`, not
 * `disputes that the deploy`.
 *
 * Measured 2026-08-20: with one shared list, either the subject swallowed `disputes that` or the
 * denial in `Nobody believes that …` stopped being seen. Two lists, two questions.
 */
const SUBJECT_BOUNDARY = /[.;:!?,]|\s+(?:that|which|who|whom|whose|and|but|however|though|although|because|so|yet|while|whereas)\s+/gi;

/**
 * Trim a matched subject so it cannot start before its own clause.
 *
 * The rules capture up to four words backwards from the verb with no notion of where the sentence
 * changes subject, so `It is not raining and the deploy caused the outage` yielded a subject of
 * `raining and the deploy`. Returns the offset the subject should start at.
 */
export function trimmedSubjectStart(text: string, subjectStart: number, subjectEnd: number): number {
  const within = text.slice(subjectStart, subjectEnd);
  let cut = 0;
  SUBJECT_BOUNDARY.lastIndex = 0;
  for (let m = SUBJECT_BOUNDARY.exec(within); m !== null; m = SUBJECT_BOUNDARY.exec(within)) {
    cut = m.index + m[0].length;
  }
  return subjectStart + cut;
}

export interface PolarityCheck {
  /** True when the clause asserts the relation — the only case a caller may emit. */
  readonly asserted: boolean;
  /** The cue that governed it, for the caller to report. `null` when asserted. */
  readonly cue: string | null;
}

/**
 * Does the clause containing the predicate at `triggerStart` assert it?
 *
 * Word-boundary matched, so `no` does not fire inside `notice` and `if` does not fire inside
 * `verify` — an early version without boundaries suppressed a true positive for exactly that
 * reason, which is the risk of a cue list nobody tests against its own recall.
 */
export function assertsRelation(text: string, triggerStart: number): PolarityCheck {
  let clause = governingClause(text, triggerStart).toLowerCase();
  // Pseudo phrases first: strip them so their cue cannot fire, leaving any other cue free to.
  for (const pseudo of PSEUDO_CUES) clause = clause.split(pseudo).join(' ');
  for (const cue of POLARITY_CUES) {
    const pattern = new RegExp(`(?:^|[^a-z'])${cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z'])`, 'i');
    if (pattern.test(clause)) return { asserted: false, cue };
  }
  return { asserted: true, cue: null };
}
