/**
 * Algorithm 1 — the hash-chained provenance record.
 *
 * Ported from `semantica/semantica/provenance/integrity.py` and
 * `semantica/semantica/provenance/manager.py:1415-1485`, with one deliberate change of
 * substance and three things carried over unaltered because they were right.
 *
 * THE CHANGE (`DEC-007`, from the research in `docs/research/01-provenance-chain.md`).
 * Semantica hashes field values directly, so erasing content breaks the digest of the
 * record holding it and the link of every record after it — erasure and chain integrity
 * become mutually exclusive. `DEC-004` has already committed to erasure being possible,
 * so we hash a *salted commitment* to the content instead:
 *
 *     contentDigest = SHA-256(salt ‖ canonicalJson(content))
 *     digest        = SHA-256(canonicalJson(record minus digest, content, salt))
 *
 * `contentDigest` is inside `digest`; `content` and `salt` are not. A purge deletes both
 * together and the chain still verifies. Deleting the salt is the load-bearing half: an
 * unsalted commitment to low-entropy content is brute-forceable, so a purge that kept the
 * salt would be theatre.
 *
 * CARRIED OVER UNALTERED, each because the original states its reason at the site:
 *  - Link before hashing (`manager.py:156-166`), so `prev` is inside the digest rather
 *    than beside it. A link stored outside the digest can be rewritten undetected.
 *  - Advance verification state from each record's own stored fields whether or not it
 *    was flagged (`manager.py:1475-1479`), so one corrupt record does not cascade into a
 *    spurious break for every record after it.
 *  - Check the sequence as well as the link (`manager.py:1432-1436`): two distinct records
 *    could share a digest, and a link-only check would miss a gap the sequence still catches.
 *
 * NOT CARRIED OVER. Semantica excludes its primary key from the hash
 * (`integrity.py:45-55`) because its versioning archives a prior value under a new id, so
 * hashing the id would turn a legitimate rename into a permanent false chain break — and
 * it records what that costs: a row whose id is swapped while its content is kept is no
 * longer caught. We do not inherit the exclusion because we do not inherit the cause.
 * Records here are immutable and a correction is a new record, so no id is ever relabelled.
 *
 * Stage 1: pure functions over plain data. No I/O, no store. The salt is a parameter, not
 * something this module generates — which is also what makes every test deterministic.
 */

import { createHash } from 'node:crypto';
import { canonicalJson, type Json } from './canonical';

/** Fields the digest attests. Everything here is immutable once written. */
export interface AttestedFields {
  readonly kind: string;
  readonly id: string;
  readonly seq: number;
  readonly prev: string | null;
  readonly contentDigest: string;
  readonly meta: { readonly [k: string]: Json | undefined };
}

export interface ChainEntry extends AttestedFields {
  readonly digest: string;
  /** Excluded from `digest`. `null` once purged — always together with `content`. */
  readonly salt: string | null;
  /** Excluded from `digest`. `null` once purged — always together with `salt`. */
  readonly content: Json | null;
}

export type BreakReason =
  | 'content_tampered'
  | 'digest_mismatch'
  | 'chain_break'
  | 'sequence_gap';

export interface ChainProblem {
  readonly id: string;
  readonly seq: number;
  readonly reason: BreakReason;
  readonly expected: string | number | null;
  readonly actual: string | number | null;
}

export interface ChainReport {
  readonly valid: boolean;
  readonly total: number;
  readonly purged: number;
  readonly problems: readonly ChainProblem[];
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * A record is purged when BOTH payload fields are gone. They are removed together and
 * this is the only definition of purged — there is no stored flag, because a stored flag
 * would sit inside `digest` and flipping it would itself break the chain.
 */
export function isPurged(entry: Pick<ChainEntry, 'salt' | 'content'>): boolean {
  return entry.salt === null && entry.content === null;
}

/** `contentDigest = SHA-256(salt ‖ canonicalJson(content))`. */
export function computeContentDigest(salt: string, content: Json): string {
  // The salt is length-prefixed rather than merely concatenated, so a salt/content
  // boundary cannot be moved — the exact ambiguity that makes Semantica's unseparated
  // sixteen-field concatenation collidable.
  return sha256(`${salt.length}:${salt}${canonicalJson(content)}`);
}

/** `digest = SHA-256(canonicalJson(attested fields))`. Excludes `digest`, `content`, `salt`. */
export function computeDigest(f: AttestedFields): string {
  return sha256(
    canonicalJson({
      contentDigest: f.contentDigest,
      id: f.id,
      kind: f.kind,
      meta: f.meta,
      prev: f.prev,
      seq: f.seq,
    }),
  );
}

export interface AppendInput {
  readonly kind: string;
  readonly id: string;
  readonly content: Json;
  readonly meta?: { readonly [k: string]: Json | undefined };
}

/**
 * Append one record to a chain and return it. Pure: takes the chain it is extending and
 * the salt to use, mutates nothing.
 *
 * `seq` starts at 1, matching the original (`manager.py:161`), so a `seq` of 0 is always
 * a defect rather than a legitimate first record.
 */
export function appendEntry(
  chain: readonly ChainEntry[],
  input: AppendInput,
  salt: string,
): ChainEntry {
  const head = chain.length > 0 ? chain[chain.length - 1] : undefined;

  const contentDigest = computeContentDigest(salt, input.content);
  const attested: AttestedFields = {
    kind: input.kind,
    id: input.id,
    seq: head ? head.seq + 1 : 1,
    prev: head ? head.digest : null,
    contentDigest,
    meta: input.meta ?? {},
  };

  // Link first, hash second. The order is the point: `prev` is inside the digest.
  return { ...attested, digest: computeDigest(attested), salt, content: input.content };
}

/**
 * Verify a chain. Four checks in a fixed order, each with a reason code.
 *
 * Entries are verified in the order given. Callers hold an append-only log, so that order
 * is insertion order; the sequence check is what catches a caller who reordered it.
 */
export function verifyChain(entries: readonly ChainEntry[]): ChainReport {
  const problems: ChainProblem[] = [];
  let expectedPrev: string | null = null;
  let expectedSeq: number | null = null;
  let purged = 0;

  for (const e of entries) {
    const gone = isPurged(e);
    if (gone) purged++;

    // 1. Content integrity. Skipped only for a purged record, whose payload is absent by
    //    design. Every other check still applies to it — a purge must not be able to hide
    //    a real break.
    if (!gone) {
      if (e.salt === null || e.content === null) {
        // Half-purged: one of the pair removed. Never legitimate; they go together.
        problems.push({
          id: e.id, seq: e.seq, reason: 'content_tampered',
          expected: 'salt and content both present, or both absent',
          actual: e.salt === null ? 'salt removed, content kept' : 'content removed, salt kept',
        });
      } else {
        const recomputed = computeContentDigest(e.salt, e.content);
        if (recomputed !== e.contentDigest) {
          problems.push({
            id: e.id, seq: e.seq, reason: 'content_tampered',
            expected: e.contentDigest, actual: recomputed,
          });
        }
      }
    }

    // 2. Self-digest.
    const recomputedDigest = computeDigest(e);
    if (recomputedDigest !== e.digest) {
      problems.push({
        id: e.id, seq: e.seq, reason: 'digest_mismatch',
        expected: e.digest, actual: recomputedDigest,
      });
    }

    // 3. Chain link.
    if (e.prev !== expectedPrev) {
      problems.push({
        id: e.id, seq: e.seq, reason: 'chain_break',
        expected: expectedPrev, actual: e.prev,
      });
    }

    // 4. Sequence contiguity. `expectedSeq === null` only for the first record examined.
    const wantSeq: number = expectedSeq === null ? 1 : expectedSeq + 1;
    if (e.seq !== wantSeq) {
      problems.push({
        id: e.id, seq: e.seq, reason: 'sequence_gap',
        expected: wantSeq, actual: e.seq,
      });
    }

    // Advance from this record's OWN stored fields, flagged or not, so a single corrupt
    // record does not cascade. `manager.py:1475-1479` does the same and says why.
    expectedPrev = e.digest;
    expectedSeq = e.seq;
  }

  return { valid: problems.length === 0, total: entries.length, purged, problems };
}

/**
 * Remove a record's payload, keeping its commitment. This is the chain-side half of
 * Algorithm 3's purge; the tombstone record it also appends is Task 1.3's.
 *
 * Both payload fields go together. Returning a new entry rather than mutating keeps this
 * pure, and keeps the caller responsible for rewriting the log.
 */
export function purgeContent(entry: ChainEntry): ChainEntry {
  return { ...entry, salt: null, content: null };
}
