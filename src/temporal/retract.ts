/**
 * Algorithm 3 — retract and purge, as two operations with two record types.
 *
 * Ported from `semantica/semantica/context/context_graph.py:1556-1919`.
 *
 * The distinction is the whole point, and Semantica gets it right: **retract** means "this
 * is no longer true" and **purge** means "this should never have been captured". A retraction
 * closes the validity window and files a record that keeps the content answerable in history.
 * A purge removes the content and leaves a tombstone that deliberately holds none of it.
 *
 * CARRIED OVER:
 *  - The narrowing rule (`_closing_valid_until`, `context_graph.py:191-208`): a retraction
 *    takes the EARLIER of an existing end bound and the retraction instant, so it can only
 *    ever narrow a window. Without it, an entity whose `validUntil` was already in the past
 *    would be reported active for the span between its original end and the retraction.
 *  - A purge supersedes and removes any prior retraction for the same subject. One subject
 *    has one removal record, never both.
 *  - Cascade on a node retraction: incident edges are closed too, and the set of
 *    already-retracted edges is snapshotted BEFORE the loop. Semantica's comment explains
 *    why — reading the live set inside the loop lets the first record for a duplicated edge
 *    block a second one from ever being closed.
 *  - Honest scoping. `purge_node`'s docstring calls itself "one step of an erasure workflow,
 *    not the whole of it" (`context_graph.py:1734`). Task 1.3's research confirms that is the
 *    correct posture rather than a cop-out: GDPR Art. 17 reaches every copy, and a controller
 *    must notify downstream holders, who are then independently responsible. A store cannot
 *    honestly claim to have discharged that obligation on its own — so the tombstone SAYS SO.
 *
 * CHANGED — the chain survives a purge. Semantica hashes content directly, so erasing it
 * would break the chain; here `DEC-007` hashes a salted commitment instead, and purge deletes
 * `content` and `salt` together while `contentDigest`, `digest`, `prev` and `seq` stand. The
 * chain still verifies. Deleting the salt is the load-bearing half: an unsalted commitment to
 * low-entropy content is brute-forceable, so keeping it would make the purge theatre.
 *
 * Stage 1: pure functions over plain data, and deliberately no import from
 * `../provenance/chain` — the algorithms stay islands until Phase 2 wires them.
 */

import type { Json } from '../provenance/canonical';
import { parseInstant, type ParseReason } from './window';

export type RemovalKind = 'node' | 'edge';

/** The minimal shape both operations act on. */
export interface Subject {
  readonly id: string;
  readonly kind: RemovalKind;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly recordedAt: string;
  readonly contentDigest: string;
  /** Excluded from the digest. `null` once purged — always together with `salt`. */
  readonly content: Json | null;
  /** Excluded from the digest. `null` once purged — always together with `content`. */
  readonly salt: string | null;
}

/** Keeps the content. The subject stays answerable in history. */
export interface Retraction {
  readonly type: 'retraction';
  readonly id: string;
  readonly kind: RemovalKind;
  readonly retractedAt: string;
  readonly reason: string | null;
  /** Present only on an edge closed as a consequence of its node being retracted. */
  readonly cascadedFrom?: string;
}

/**
 * Holds NO field of the purged content. Every field here is metadata about the erasure.
 * `contentDigest` survives deliberately — it proves something was committed at this position
 * without revealing what, which is what lets the chain still verify.
 */
export interface Tombstone {
  readonly type: 'tombstone';
  readonly id: string;
  readonly kind: RemovalKind;
  readonly purgedAt: string;
  readonly reason: string | null;
  readonly contentDigest: string;
  /**
   * The honest scope statement. This store is one holder; GDPR Art. 17 reaches every copy
   * and obliges the controller to notify downstream holders, who are then independently
   * responsible. A tombstone that omitted this would imply an obligation had been discharged
   * when only part of it had.
   */
  readonly scope: 'this-store-only';
}

export class TemporalInputError extends Error {
  readonly code: ParseReason;
  constructor(code: ParseReason, message: string) {
    super(`${code}: ${message}`);
    this.name = 'TemporalInputError';
    this.code = code;
  }
}

function requireInstant(value: string, what: string): number {
  const p = parseInstant(value);
  if (!p.ok) throw new TemporalInputError(p.reason, `${what} ${JSON.stringify(value)}`);
  return p.ms;
}

/**
 * The earlier of an existing end bound and the retraction instant. A retraction narrows a
 * window and never widens one.
 *
 * An unparseable existing bound closes at `at`, matching the original. That is the safe
 * direction here and stays consistent with `DEC-003`: an untrusted bound results in LESS
 * visibility, not more.
 */
export function closingValidUntil(current: string | null, at: string): string {
  const atMs = requireInstant(at, 'retraction instant');
  if (current === null) return at;
  const existing = parseInstant(current);
  if (!existing.ok) return at;
  return existing.ms <= atMs ? current : at;
}

export interface RetractResult {
  readonly subject: Subject;
  readonly record: Retraction;
}

/** Close a subject's window and file a retraction. Content is untouched. */
export function retract(
  subject: Subject,
  at: string,
  reason: string | null = null,
  cascadedFrom?: string,
): RetractResult {
  const validUntil = closingValidUntil(subject.validUntil, at);
  const record: Retraction = cascadedFrom === undefined
    ? { type: 'retraction', id: subject.id, kind: subject.kind, retractedAt: at, reason }
    : { type: 'retraction', id: subject.id, kind: subject.kind, retractedAt: at, reason, cascadedFrom };
  return { subject: { ...subject, validUntil }, record };
}

export interface PurgeResult {
  readonly subject: Subject;
  readonly tombstone: Tombstone;
}

/**
 * Remove a subject's content and leave a tombstone.
 *
 * The window is closed too — a purged subject must not be reported active — and `content` and
 * `salt` are cleared together. `contentDigest` is kept on purpose.
 */
export function purge(subject: Subject, at: string, reason: string | null = null): PurgeResult {
  const validUntil = closingValidUntil(subject.validUntil, at);
  return {
    subject: { ...subject, validUntil, content: null, salt: null },
    tombstone: {
      type: 'tombstone',
      id: subject.id,
      kind: subject.kind,
      purgedAt: at,
      reason,
      contentDigest: subject.contentDigest,
      scope: 'this-store-only',
    },
  };
}

export function isPurged(s: Pick<Subject, 'content' | 'salt'>): boolean {
  return s.content === null && s.salt === null;
}

/**
 * A purge supersedes any prior retraction for the same subject: one subject carries one
 * removal record, never both. Ported from `purge_node`'s `self._retractions.pop(...)`.
 */
export function supersedeRetractions(
  retractions: readonly Retraction[],
  tombstones: readonly Tombstone[],
): readonly Retraction[] {
  const purgedKeys = new Set(tombstones.map((t) => `${t.kind}:${t.id}`));
  return retractions.filter((r) => !purgedKeys.has(`${r.kind}:${r.id}`));
}

export interface CascadeResult {
  readonly node: Subject;
  readonly edges: readonly Subject[];
  readonly records: readonly Retraction[];
}

/**
 * Retract a node and close every edge incident to it.
 *
 * `alreadyRetracted` is snapshotted before the loop rather than consulted live. Semantica's
 * comment at `context_graph.py:1626-1628` gives the reason: with a live set, the record
 * written for the first of two colliding edge identities blocks the second from ever being
 * closed, leaving an edge open against a retracted node.
 */
export function retractWithCascade(
  node: Subject,
  incidentEdges: readonly Subject[],
  at: string,
  reason: string | null = null,
  alreadyRetractedEdgeIds: readonly string[] = [],
): CascadeResult {
  const skip = new Set(alreadyRetractedEdgeIds);
  const head = retract(node, at, reason);

  const edges: Subject[] = [];
  const records: Retraction[] = [head.record];
  for (const e of incidentEdges) {
    if (skip.has(e.id)) {
      edges.push(e);
      continue;
    }
    const r = retract(e, at, reason, node.id);
    edges.push(r.subject);
    records.push(r.record);
  }

  return { node: head.subject, edges, records };
}
