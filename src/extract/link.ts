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
import { expandAgainst } from './acronym';

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
 * The gap to the runner-up below which a result is reported as `weak`.
 *
 * PROVENANCE: **calibrated**, 2026-08-20, by `eval/link-sweep.ts` over the 24-mention labelled set,
 * evaluated as the FLAG it actually is rather than as a hard reject:
 *
 *     rule                     NIL flagged   Top-1    soft cost
 *     score  < 0.30  (Phase 15)      4/7     15/17        1
 *     margin < 0.05                  5/7     15/17        1
 *     margin < 0.10                  6/7     15/17        1     <- adopted
 *     score < 0.30 or margin < 0.10  6/7     15/17        2
 *
 * **This supersedes `LINK_WEAK_SCORE` and it corrects a methodological error in Phase 15**, which
 * swept every rule as a hard reject — where a margin rule drops six correct answers and looks
 * hopeless — and then shipped a flag, where it drops none and wins. The sweep measured a design the
 * code does not use. `eval/link-sweep.ts` now evaluates both.
 *
 * A null margin — one candidate, nothing to compare against — counts as confident. On this set all
 * three single-candidate mentions are correct answers and no NIL mention has exactly one candidate,
 * so a score fallback added soft cost and caught nothing. **That is an assumption this set cannot
 * test**, and it is the first thing to re-examine on a larger one.
 *
 * Recalibrate with `bun --cwd engine eval/link-sweep.ts` after any change to the scorer. Phase 16
 * changed one and this number moved; that is the rule working.
 */
export const LINK_WEAK_MARGIN = 0.1;

/**
 * `no_candidates` — the generator returned nothing; the mention refers to nothing here.
 * `tie`          — the two best candidates score identically, so rank 1 is not an answer.
 * `weak`         — the top candidate is barely ahead of the runner-up. Six of the seven mentions
 *                  that refer to nothing land here, and so does one real match, so it is a warning
 *                  and never a rejection: every candidate is still returned.
 * `ranked`       — candidates are ordered; the caller decides, with the scores and margin to hand.
 */
export type LinkVerdict = 'no_candidates' | 'tie' | 'weak' | 'ranked';

/**
 * Head nouns that name what KIND of thing a phrase refers to.
 *
 * The survey literature calls this **semantic type prediction**, and the constraint it feeds is
 * blunt: if the mention is a person, a candidate that is a building is discarded. Phase 15 measured
 * two mentions no threshold could reject — *"the payments team"* at 0.336 against `svc-payments`,
 * and *"the third quarter reliability review"* at 0.495 against `q2-review` — and both are the same
 * failure. A payments *service* exists and a payments *team* does not; the words are close and the
 * things are different kinds.
 *
 * `semantica` has the constraint and cannot use it here: `entity_linker.py:392` filters on
 * `entity.get("type") != entity_type`, and **the caller must already know the mention's type**.
 * Nothing in that repository derives one from text. Our mentions arrive as raw phrases out of
 * `extract`, so the type has to be inferred or the filter is unreachable.
 *
 * PROVENANCE: **declared placeholder.** Hand-written from the kinds of thing this engine's own
 * records are — services, teams, documents, decisions, incidents, projects. Not a taxonomy and not
 * derived from a corpus. What would calibrate it is a labelled set of mentions with their true
 * types; `eval/linking.ts` has referents but not types. The measure until then is `nil-near` in
 * `bun run --cwd engine eval:link`.
 *
 * **Only phrases ending in one of these are typed at all.** A phrase with no type noun is untyped,
 * and an untyped side never causes a mismatch — that is deliberate: *"no friday releases"* ends in
 * `releases`, which is not a kind of thing, and treating its last word as a type would destroy a
 * correct link at 0.081.
 */
export const TYPE_NOUNS: readonly string[] = [
  'service', 'services', 'team', 'teams', 'rota', 'project', 'projects', 'rewrite', 'migration',
  'document', 'doc', 'docs', 'runbook', 'policy', 'contract', 'review', 'report', 'postmortem',
  'incident', 'outage', 'spike', 'failure', 'decision', 'gate', 'indexer', 'owner', 'workshop',
];

/**
 * The kind of thing a phrase names, from its head noun.
 *
 * English puts the head of a simple noun phrase last, so the last word is checked first and then
 * the rest — `the SLO doc` types as `doc`, `the checkout service` as `service`. Returns `undefined`
 * when nothing in the phrase names a kind, which is the common case and must stay harmless.
 */
export function inferType(text: string): string | undefined {
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i] as string;
    if (TYPE_NOUNS.includes(w)) return w.replace(/s$/, '');
  }
  return undefined;
}

/**
 * Words too common to distinguish one record from another.
 *
 * PROVENANCE: **declared placeholder**, and it is the **third** hand-written vocabulary in this
 * feature after `TYPE_NOUNS` and the polarity cues. That is the standing weakness of this whole
 * build and adding to it deserves the note rather than a shrug: what would calibrate it is document
 * frequency over a real store, which `lexicalChannel` already computes for retrieval and which is
 * not reusable here because `link` scores against a candidate pool rather than a corpus.
 *
 * Kept to the closed-class words that carry no identity. A content word here would silently stop
 * distinguishing two records that differ only by it.
 */
const NON_DISTINGUISHING = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'and', 'or', 'on', 'in', 'at', 'by', 'with', 'we', 'our',
]);

/**
 * Does the mention share nothing with this record except the kind of thing it is?
 *
 * *"the search rewrite"* against *"the checkout rewrite"* shares only `rewrite`, which is the type
 * noun — they agree on **kind** and on nothing else, which is agreement about a category rather
 * than about identity. Phase 16 found that a type match raises confidence on exactly these
 * within-type near-misses; this is the other half of that finding.
 *
 * Measured over the labelled set: fires on 2 mentions, both of which refer to nothing, and on **0**
 * correct answers.
 */
export function typeOnlyMatch(mention: string, recordName: string): boolean {
  const type = inferType(mention);
  if (type === undefined) return false;
  const words = (s: string): ReadonlySet<string> =>
    new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)
      .filter((w) => w !== '' && !NON_DISTINGUISHING.has(w)));
  const rec = words(recordName);
  const shared = [...words(mention)].filter((w) => rec.has(w));
  return shared.length > 0 && shared.every((w) => w.replace(/s$/, '') === type);
}

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
  // The mention's type is INFERRED, not supplied. Until Phase 16 the probe carried `''`, which can
  // never equal a record's kind, so the 0.2 the weights give `type` was dead in every linking call
  // and a perfect name match capped at 0.700. Measured before the change.
  const mentionType = opts.type ?? inferType(mention);
  const probe: Candidate = mentionType === undefined
    ? { id: MENTION_PROBE_ID, name: mention }
    : { id: MENTION_PROBE_ID, name: mention, type: mentionType };
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
    // A record's stored `type` is its record KIND — every note is a `node` — so it cannot separate a
    // team from a service. Its head noun can, and falls back to the kind when there is none.
    const recType = inferType(r.name) ?? r.type;
    const typed: Candidate = recType === undefined ? { id: r.id, name: r.name } : { id: r.id, name: r.name, type: recType };

    // An acronym is expanded ONLY against a record whose own name supports it, per Schwartz &
    // Hearst's matching rule. `the SLO doc` becomes `the service level objective doc` for the
    // record that spells it out, and stays `the SLO doc` for every record that does not — so a
    // short form cannot lift the score of a record it has nothing to do with.
    const expanded = expandAgainst(probe.name, r.name);
    const scoreProbe: Candidate = expanded === probe.name
      ? probe
      : mentionType === undefined
        ? { id: probe.id, name: expanded }
        : { id: probe.id, name: expanded, type: mentionType };

    scored.push({ id: r.id, name: r.name, score: similarity(scoreProbe, typed).total });
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
        : (margin ?? 1) < LINK_WEAK_MARGIN ? 'weak'
          // Agreeing only on the kind of thing is agreement about a category, not an identity.
          : typeOnlyMatch(mention, top.name) ? 'weak'
            : 'ranked';

  const capped = opts.limit === undefined ? scored : scored.slice(0, opts.limit);
  return { mention, verdict, candidates: capped, margin };
}
