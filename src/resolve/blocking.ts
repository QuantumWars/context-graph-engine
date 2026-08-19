/**
 * Blocking: compare only the pairs worth comparing.
 *
 * All-pairs comparison is O(n^2) — 10,000 records is 50 million comparisons. Blocking builds cheap
 * overlapping keys, and only records sharing a key are ever scored. Ported from
 * `semantica/semantica/deduplication/similarity_calculator.py:651-692`, whose multi-key union is
 * the good idea: an entity belongs to several blocks at once, so one bad key does not lose a match.
 *
 * TWO DEFECTS DESIGNED OUT, both confirmed by reading the source this session.
 *
 * 1. **No strategy option, and no `legacy` mode** (finding A-11). The original reads
 *    `options.get("candidate_strategy", "legacy")`, and `legacy` blocks on `name[0]` — first-letter
 *    bucketing. The good implementation is reachable only by passing an option that its CLI sets
 *    and its documented Python API does not, so the advertised "blocking + semantic deduplication"
 *    is first-letter bucketing for most callers. A default that silently degrades the advertised
 *    behaviour is the defect; there is one strategy here and it is the good one.
 *
 * 2. **The cap keeps the most similar, not the lowest-indexed.** The original's
 *    `sorted(neighbors)[:max_candidates]` truncates in *insertion order*, so it sheds recall by
 *    accident of how records happened to be loaded. See `capBySimilarity`.
 *
 * Stage 1: pure functions over plain data.
 */

import { similarity, type Candidate } from './similarity';

/**
 * PROVENANCE: **declared placeholder.** Ported from the original's `t[:4]`. Four characters is
 * short enough that a typo late in a word still collides, and long enough that common short words
 * do not merge everything. Not measured; the sweep in `eval/` can move it.
 */
export const TOKEN_PREFIX = 4;

/**
 * PROVENANCE: **declared placeholder.** Tokens of one or two characters are mostly noise as block
 * keys — "of", "a", "id" would put half a corpus in one block. Ported from `len(t) > 2`.
 */
export const MIN_TOKEN_LENGTH = 3;

export interface BlockOptions {
  /** Add a type-scoped key, so same-named records of different kinds separate. */
  readonly typeScoped?: boolean;
  /** Add a phonetic key, so `Smith` and `Smyth` collide. */
  readonly phonetic?: boolean;
  /** Maximum candidates retained per record. `undefined` keeps every pair. */
  readonly maxCandidates?: number;
}

/** Split on whitespace and separators, drop the too-short. */
export function tokens(name: string): readonly string[] {
  const parts = name.toLowerCase().replace(/[_\-/.]+/g, ' ').split(/\s+/).filter(Boolean);
  const kept = parts.filter((t) => t.length >= MIN_TOKEN_LENGTH);
  // If nothing survives, the whole name is the token — better one crowded block than none.
  return kept.length > 0 ? kept : parts.length > 0 ? [parts.join('')] : [];
}

/**
 * A compact phonetic code, ported from the original's `_soundex`.
 *
 * Deliberately non-standard, and kept that way: what matters for a block key is that two spellings
 * of one sound collide, not that the code matches a published table. Saying so here stops a later
 * reader "fixing" it against Knuth and quietly changing which records are compared.
 */
export function soundex(word: string): string {
  const w = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (w === '') return '';
  const map: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3', L: '4', M: '5', N: '5', R: '6',
  };
  let out = w[0] as string;
  for (const ch of w.slice(1)) {
    const d = map[ch];
    if (d !== undefined && d !== out[out.length - 1]) out += d;
  }
  return (out + '000').slice(0, 4);
}

/** The key families a record belongs to. A record joins every block whose key it produces. */
export function blockKeys(c: Candidate, o: BlockOptions = {}): ReadonlySet<string> {
  const keys = new Set<string>();
  const ts = tokens(c.name);

  if (ts.length === 0) {
    // Nameless records share one block. Stated rather than incidental: they become mutual
    // candidates, which is cheap while they are few and quadratic if they are many.
    keys.add('nameless:');
    return keys;
  }

  for (const t of ts) keys.add(`tok:${t.slice(0, TOKEN_PREFIX)}`);
  if (o.typeScoped === true) {
    keys.add(`type:${(c.type ?? 'unknown').toLowerCase()}:${(ts[0] as string).slice(0, TOKEN_PREFIX)}`);
  }
  if (o.phonetic === true) for (const t of ts) keys.add(`pho:${soundex(t)}`);
  return keys;
}

export interface Pair {
  readonly a: string;
  readonly b: string;
  readonly score: number;
}

export interface BlockingResult {
  readonly pairs: readonly Pair[];
  /** Pairs an all-pairs comparison would have made — the denominator for reduction ratio. */
  readonly allPairs: number;
  /** Pairs actually scored, before the cap. */
  readonly compared: number;
  readonly blocks: number;
}

/**
 * Keep each record's `max` most similar candidates.
 *
 * The original keeps `sorted(neighbors)[:max_candidates]` — the lowest **indices**, which is
 * insertion order and carries no information about similarity at all. A true match loaded late is
 * dropped in favour of an unrelated record loaded early, and nothing reports it.
 *
 * A pair survives if EITHER endpoint keeps it, matching the original's union-of-per-entity-keeps
 * behaviour. That is deliberately not a hard degree bound, and saying so matters: a popular record
 * can still exceed `max`, because dropping a pair the other side ranked first would lose a match to
 * a cap that was only ever meant to bound work.
 */
export function capBySimilarity(pairs: readonly Pair[], max: number | undefined): readonly Pair[] {
  if (max === undefined || max <= 0) return pairs;

  const byRecord = new Map<string, Pair[]>();
  const push = (id: string, p: Pair): void => {
    const arr = byRecord.get(id);
    if (arr === undefined) byRecord.set(id, [p]); else arr.push(p);
  };
  for (const p of pairs) { push(p.a, p); push(p.b, p); }

  const kept = new Set<string>();
  for (const [, ps] of byRecord) {
    ps.sort((x, y) => y.score - x.score || (`${x.a} ${x.b}` < `${y.a} ${y.b}` ? -1 : 1));
    for (const p of ps.slice(0, max)) kept.add(`${p.a} ${p.b}`);
  }
  return pairs.filter((p) => kept.has(`${p.a} ${p.b}`));
}

/** Build blocks, score only same-block pairs, then cap. */
export function block(records: readonly Candidate[], o: BlockOptions = {}): BlockingResult {
  const blocks = new Map<string, string[]>();
  const byId = new Map<string, Candidate>();
  for (const r of records) {
    byId.set(r.id, r);
    for (const k of blockKeys(r, o)) {
      const arr = blocks.get(k);
      if (arr === undefined) blocks.set(k, [r.id]); else arr.push(r.id);
    }
  }

  // A pair reached through several keys is scored once — the union is what makes multi-key
  // blocking robust, not a reason to do the same work repeatedly.
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  for (const [, ids] of blocks) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const x = ids[i] as string;
        const y = ids[j] as string;
        const [a, b] = x < y ? [x, y] : [y, x];
        const key = `${a} ${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ a, b, score: similarity(byId.get(a)!, byId.get(b)!).total });
      }
    }
  }

  const n = records.length;
  return {
    pairs: capBySimilarity(pairs, o.maxCandidates),
    allPairs: (n * (n - 1)) / 2,
    compared: pairs.length,
    blocks: blocks.size,
  };
}
