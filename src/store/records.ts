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

export const RECORD_KINDS = ['node', 'edge', 'decision', 'retraction', 'tombstone', 'retrieval', 'merge'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/**
 * `DEC-023`: whether a record's integrity comes from the hash chain or from an external source.
 *
 * - `attested` — a decision, edge or retrieval, not re-derivable from anywhere else, so the chain
 *   is its only proof. Lives in `log.jsonl`.
 * - `re-scannable` — a git commit, file or session, whose truth is git or the filesystem, so it can
 *   be rebuilt exactly and is not chained. Lives in `derived.jsonl` (from the git-ingest phase).
 *
 * **Absent means `attested`.** That default is what makes the 38 records written before this field
 * existed correct untouched. Always read it through `nodeClassOf`, never `meta.nodeClass` directly,
 * so the default is applied in exactly one place.
 */
export type NodeClass = 'attested' | 're-scannable';

/**
 * A span as it sits in a record's meta: offsets into another record, never that record's text.
 * Mirrors `src/extract/span.ts`'s `Span`; declared here so `records.ts` keeps no import from the
 * extractor, which is a Stage 1 module.
 */
export interface SpanMeta {
  readonly source: string;
  readonly start: number;
  readonly end: number;
  readonly [k: string]: Json | undefined;
}

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
  /** Merge-only. Ids of the records asserted to be one thing. Never their content — DEC-012. */
  readonly members?: readonly string[];
  /** Merge-only. The member reads redirect to. */
  readonly canonical?: string;
  /**
   * Edge-only, extraction provenance — `DEC-013`. The id of the rule that fired, and the three
   * spans it read. A span is `{source,start,end}` in UTF-16 code units and carries **no text**, so
   * purging the source erases the evidence rather than leaving a copy behind in the edge.
   */
  readonly rule?: string;
  readonly subjectSpan?: SpanMeta;
  readonly objectSpan?: SpanMeta;
  readonly triggerSpan?: SpanMeta;
  /**
   * `DEC-023`. Absent means `attested` — read via `nodeClassOf`, never directly. Inside `meta`, so
   * inside the digest: a re-scannable record cannot be relabelled attested (or the reverse) without
   * the chain noticing, on the records that are chained.
   */
  readonly nodeClass?: NodeClass;
  /**
   * `DEC-024`. Who wrote this — the git author verbatim on an ingested node, the agent's own id
   * (`claude-opus`, `codex`) on a recorded one. Optional and free text; absence means not recorded
   * and is never guessed. Inside `meta`, so a claim about authorship is attested.
   */
  readonly author?: string;
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
 * A record's effective class, applying `DEC-023`'s default: absent means `attested`.
 *
 * The one place the default lives. Reading `meta.nodeClass` directly anywhere else would let a
 * caller forget the default and treat a legacy record — which has no field — as neither class.
 */
export function nodeClassOf(r: { readonly meta: RecordMeta }): NodeClass {
  return r.meta.nodeClass ?? 'attested';
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
  readonly rule?: string;
  readonly subjectSpan?: SpanMeta;
  readonly objectSpan?: SpanMeta;
  readonly triggerSpan?: SpanMeta;
  readonly target?: string;
  readonly edgeType?: string;
  readonly weight?: number;
  readonly subject?: string;
  readonly subjectKind?: 'node' | 'edge' | 'decision';
  readonly reason?: string | null;
  readonly cascadedFrom?: string;
  readonly scope?: 'this-store-only';
  readonly contentDigest?: string;
  readonly members?: readonly string[];
  readonly canonical?: string;
  /** `DEC-023`. Omit for an attested record (the default); the git-ingest phase sets `re-scannable`. */
  readonly nodeClass?: NodeClass;
  /** `DEC-024`. Free text; the git author on ingest, the agent id on a recorded node. */
  readonly author?: string;
}
