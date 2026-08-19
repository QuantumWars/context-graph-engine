/**
 * The record envelope — one shape for every kind, as `DEC-007` fixes it.
 *
 * The temporal fields live inside `meta`, which means they are inside the digest and therefore
 * attested: a validity window cannot be edited without the chain noticing. `DEC-008` requires
 * `recordedAt` on every record with no nullable path, because a record with no transaction time
 * is invisible to every `asOf` query and would quietly reduce the second time axis to decoration.
 */

import type { Json } from '../provenance/canonical';
import type { ChainEntry } from '../provenance/chain';
import type { CausalEdgeType } from '../decision/causal';
import type { WorkspaceMethod } from './paths';

export const RECORD_KINDS = ['node', 'edge', 'decision', 'retraction', 'tombstone', 'retrieval'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export interface RecordMeta {
  readonly workspace: string;
  readonly workspaceMethod: WorkspaceMethod;
  /** Transaction time. Never null — DEC-008. */
  readonly recordedAt: string;
  /** Valid time, inclusive. `null` means unbounded. */
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  /** Edge-only. */
  readonly source?: string;
  readonly target?: string;
  readonly edgeType?: CausalEdgeType | string;
  readonly weight?: number;
  /** Retraction- and tombstone-only: the subject they act on. */
  readonly subject?: string;
  readonly subjectKind?: 'node' | 'edge' | 'decision';
  readonly reason?: string | null;
  readonly cascadedFrom?: string;
  readonly scope?: 'this-store-only';
  [k: string]: Json | undefined;
}

/** A record on disk is a chain entry whose `meta` is a `RecordMeta` and whose kind is known. */
export interface StoredRecord extends ChainEntry {
  readonly kind: RecordKind;
  readonly meta: RecordMeta;
}

export function isRecordKind(v: unknown): v is RecordKind {
  return typeof v === 'string' && (RECORD_KINDS as readonly string[]).includes(v);
}

/**
 * What a caller supplies for `meta`. Deliberately has **no index signature**: `RecordMeta`
 * needs one so it can be canonicalised as `Json`, and that signature widens every property to
 * `Json | undefined` under `Omit`, which would let a missing `recordedAt` through the compiler
 * and onto disk. `DEC-008` says there is no nullable path for transaction time, so this type
 * is what enforces it.
 */
export interface RecordMetaInput {
  readonly recordedAt: string;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly source?: string;
  readonly target?: string;
  readonly edgeType?: string;
  readonly weight?: number;
  readonly subject?: string;
  readonly subjectKind?: 'node' | 'edge' | 'decision';
  readonly reason?: string | null;
  readonly cascadedFrom?: string;
  readonly scope?: 'this-store-only';
  readonly contentDigest?: string;
}
