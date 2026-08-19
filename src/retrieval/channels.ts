/**
 * Task 2.3 — the retrieval path: two channels, fused, and every decision recorded.
 *
 * Both channels are pure and offline by decision: lexical over the record text, structural over
 * the graph. An embedding channel would sit behind the same `Channel` interface `fuse()` already
 * takes — the fusion is n-channel precisely so adding one does not reopen it.
 *
 * WHY THE RECORD MATTERS AS MUCH AS THE RESULT. A retrieval that serves nothing and a retrieval
 * that crashed look identical from the outside, and a system that cannot tell them apart cannot
 * tell working from broken. `memory/src/ledger.ts:47` splits the outcome three ways — `served`,
 * `abstained`, `error` — after exactly that problem showed up live; the shape is adopted here.
 *
 * Every firing records what was considered, what was served, and per channel its top score, its
 * floor, and the margin between them — **on served decisions as well as abstentions.** An
 * abstention with no recorded margin is indistinguishable from a crash.
 */

import { createHash } from 'node:crypto';
import { fuse, type Channel, type FusedItem } from './rrf';

export interface Doc {
  readonly id: string;
  readonly text: string;
}

export interface Link {
  readonly source: string;
  readonly target: string;
}

/**
 * PROVENANCE: **calibrated**, 2026-08-19, by `eval/sweep.ts` over `eval/dataset.ts` — 19 labelled
 * queries, k=10, one constant varied at a time. **Recalibrated twice**, and the history matters
 * more than the number.
 *
 * Recalibrated **three times**, and the history is the useful part:
 *
 * - `0.01` → `0.4` — the first sweep found the shipped value 40× too low.
 * - `0.4` → `1.0` — adding IDF weighting changed the score *scale*.
 * - `1.0` → `0.3` — normalising IDF by its own maximum changed it again.
 *
 * The rule those three share, and it is worth more than any of the numbers: **a floor is
 * calibrated against a scoring function, not against a corpus.** Every change to how a score is
 * computed invalidates it, silently, and the only thing that catches it is re-running the sweep.
 *
 * At `0.3`: score **0.922**, precision@10 **90.6%**, recall@10 93.8%, MRR 93.8%, and both false
 * serves and false abstains at **zero**. The best of the three (0.819 → 0.915 → 0.922).
 *
 * CAVEAT: a **peak, not a plateau**. 0.2 scores 0.707 and 0.4 scores 0.854, so the value sits on a
 * point rather than in a flat region — less robust to a corpus shift than the original 0.4/0.5
 * plateau was. Re-sweep after any change to the scoring function.
 *
 * Reproduce: `bun --cwd engine eval/sweep.ts`
 */
export const LEXICAL_FLOOR = 0.3;

/**
 * PROVENANCE: **calibrated**, 2026-08-19, by `eval/sweep.ts`, weakly — it was already the best
 * of the four values tested (1: 0.509, 2: 0.484, 3: 0.453, 4: 0.339 at the then-shipped lexical
 * floor), and the reasoning that produced it survives: a structural score is a count of edges to
 * a lexical seed, so 1 is the smallest value that means "connected to something the query
 * matched". Raising it trades recall for MRR monotonically, with no interior optimum.
 *
 * Reproduce: `bun --cwd engine eval/sweep.ts`
 */
export const STRUCTURAL_FLOOR = 1;

/** Lowercase, split on non-alphanumerics, drop 1-character tokens. */
export function tokenise(s: string): readonly string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
}

/**
 * Lexical channel — IDF-weighted token overlap, length-normalised.
 *
 * WHY IDF, AND WHY IT WAS NOT THERE BEFORE. The first version counted matching tokens equally.
 * The evaluation corpus never punished that, because its queries happened to be built from
 * distinctive words. The first **real** query did, immediately: asked "why did we vendor the file
 * lock" against a 26-record store, the token `the` appeared in 13 documents and counted exactly as
 * much as `vendor`, which appeared in one. The correct answer did not clear the floor at all, and a
 * record matching only `the, lock` outranked the one matching `vendor, the, file, lock` because it
 * was shorter.
 *
 * A token that appears in half the corpus carries almost no information about which document you
 * want. Weighting each match by `ln(1 + N/df)` says exactly that, and it is the same reason BM25
 * carries an IDF term. No stopword list: a fixed list is a guess about the corpus, and the corpus
 * can measure itself. In a store about locks, `lock` *should* stop being discriminating, and IDF
 * does that automatically while a hand-written list would not.
 *
 * Deliberately still *not* co-occurrence-based: finding A-8 in the teardown is a relation extractor
 * that manufactures an edge for every entity pair within 100 characters, at exactly its own filter
 * threshold. Proximity is not evidence, and nothing here treats it as such.
 */
export function lexicalChannel(docs: readonly Doc[], query: string): Channel {
  const q = new Set(tokenise(query));
  if (q.size === 0 || docs.length === 0) return { name: 'lexical', results: [] };

  // Document frequency, measured from the corpus rather than assumed from a list.
  const df = new Map<string, number>();
  const tokenised = docs.map((d) => ({ id: d.id, tokens: new Set(tokenise(d.text)), length: tokenise(d.text).length }));
  for (const t of q) {
    let n = 0;
    for (const d of tokenised) if (d.tokens.has(t)) n++;
    df.set(t, n);
  }
  const N = docs.length;
  // The largest weight any token can earn: unique in the corpus, df = 1.
  const maxIdf = Math.log(1 + N);

  const results = tokenised
    .map((d) => {
      if (d.length === 0) return { id: d.id, score: 0 };
      let sum = 0;
      for (const t of q) {
        if (!d.tokens.has(t)) continue;
        // ln(1 + N/df) normalised by its own maximum, ln(1 + N), so a token unique in the corpus
        // contributes exactly 1 and one present everywhere contributes ln(2)/ln(1+N).
        //
        // The normalisation is not cosmetic. Without it the score scale grows with corpus size,
        // and a fixed floor then means the SAME query against the SAME document serves or abstains
        // depending on how much unrelated material happens to be in the store. Measured before
        // fixing: the query "gate" against a document containing it abstained at N=3 and served at
        // N=10. Relevance must not depend on the size of the pile it is buried in.
        sum += Math.log(1 + N / (df.get(t) ?? N)) / maxIdf;
      }
      // Length normalisation, so a long document does not win by having more chances to match.
      return { id: d.id, score: sum / Math.sqrt(d.length) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return { name: 'lexical', results };
}

/**
 * Structural channel — how strongly a record is connected to what the query already matched.
 *
 * Seeds are the lexical hits. A candidate scores the number of edges joining it to a seed. This
 * is a genuine graph signal rather than a restatement of the lexical one: a record that shares no
 * token with the query can still rank, if the graph says it sits next to the things that do.
 */
export function structuralChannel(
  links: readonly Link[],
  seedIds: readonly string[],
): Channel {
  const seeds = new Set(seedIds);
  const degree = new Map<string, number>();
  for (const l of links) {
    if (seeds.has(l.source) && !seeds.has(l.target)) degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    if (seeds.has(l.target) && !seeds.has(l.source)) degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
  }
  const results = [...degree.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return { name: 'structural', results };
}

export type Outcome = 'served' | 'abstained' | 'error';

export interface ChannelMargin {
  readonly channel: string;
  readonly considered: number;
  /** The channel's own best raw score, or `null` when it returned nothing at all. */
  readonly topScore: number | null;
  readonly floor: number;
  /** `topScore - floor`. Negative means the channel had nothing above its floor. */
  readonly margin: number | null;
}

/**
 * The row written for every firing. `DEC-005` forbids storing the query text, so it carries a
 * hash and a length — the practice `memory/src/ledger.ts` already follows.
 */
export interface RetrievalDecision {
  readonly outcome: Outcome;
  readonly queryHash: string;
  readonly queryChars: number;
  readonly channels: readonly ChannelMargin[];
  readonly served: readonly { id: string; fusedScore: number }[];
  /** Always present on `abstained` and `error`; `null` on `served`. */
  readonly reason: string | null;
}

export class ContradictoryDecisionError extends Error {
  readonly code = 'contradictory_decision' as const;
  constructor(message: string) {
    super(`contradictory_decision: ${message}`);
    this.name = 'ContradictoryDecisionError';
  }
}

function margin(ch: Channel, floor: number): ChannelMargin {
  const top = ch.results.length > 0 ? (ch.results[0] as { score: number }).score : null;
  return {
    channel: ch.name,
    considered: ch.results.length,
    topScore: top,
    floor,
    margin: top === null ? null : top - floor,
  };
}

export interface RetrieveOptions {
  readonly limit?: number;
  readonly lexicalFloor?: number;
  readonly structuralFloor?: number;
  /** Overrides `RRF_K`. Exists so the evaluation harness can sweep it — a constant that cannot
   *  be varied cannot be calibrated, and one that cannot be calibrated stays a placeholder. */
  readonly rrfK?: number;
}

/**
 * Run both channels, fuse, and return the decision — served or abstained, always with margins.
 *
 * A decision claiming `served` while returning nothing is **rejected as a contradiction** rather
 * than written. That combination is not a legitimate state; it is a bug in whatever built the
 * row, and recording it would put a lie in the audit trail.
 */
export function retrieve(
  docs: readonly Doc[],
  links: readonly Link[],
  query: string,
  opts: RetrieveOptions = {},
): { decision: RetrievalDecision; items: readonly FusedItem[] } {
  const lexFloor = opts.lexicalFloor ?? LEXICAL_FLOOR;
  const strFloor = opts.structuralFloor ?? STRUCTURAL_FLOOR;
  const limit = opts.limit ?? 10;

  const queryHash = createHash('sha256').update(query, 'utf8').digest('hex').slice(0, 16);
  const queryChars = query.length;

  const lexical = lexicalChannel(docs, query);
  const seeds = lexical.results.filter((r) => r.score >= lexFloor).map((r) => r.id);
  const structural = structuralChannel(links, seeds);

  const margins = [margin(lexical, lexFloor), margin(structural, strFloor)];

  // Only candidates above their own channel's floor reach the fusion. Filtering here rather
  // than after means a channel with nothing to say contributes nothing, instead of contributing
  // its least-bad candidate — which is finding A-6 in a different costume.
  const above: Channel[] = [
    { name: 'lexical', results: lexical.results.filter((r) => r.score >= lexFloor) },
    { name: 'structural', results: structural.results.filter((r) => r.score >= strFloor) },
  ];

  const items = fuse(above, opts.rrfK).slice(0, limit);

  if (items.length === 0) {
    return {
      decision: {
        outcome: 'abstained', queryHash, queryChars, channels: margins, served: [],
        reason: margins.every((m) => m.topScore === null)
          ? 'no_candidates: neither channel returned anything'
          : 'below_floor: no candidate cleared its channel floor',
      },
      items,
    };
  }

  const decision: RetrievalDecision = {
    outcome: 'served', queryHash, queryChars, channels: margins,
    served: items.map((i) => ({ id: i.id, fusedScore: i.fusedScore })),
    reason: null,
  };
  assertConsistent(decision);
  return { decision, items };
}

/** A row that says one thing and shows another must never reach the log. */
export function assertConsistent(d: RetrievalDecision): void {
  if (d.outcome === 'served' && d.served.length === 0) {
    throw new ContradictoryDecisionError('outcome is "served" but nothing was served');
  }
  if (d.outcome === 'abstained' && d.served.length > 0) {
    throw new ContradictoryDecisionError(`outcome is "abstained" but ${d.served.length} item(s) were served`);
  }
  if (d.outcome !== 'served' && d.reason === null) {
    throw new ContradictoryDecisionError(`outcome is "${d.outcome}" with no reason recorded`);
  }
}
