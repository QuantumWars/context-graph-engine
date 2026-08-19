/**
 * The store — one append-only log, every view rebuilt on load.
 *
 * This is where Stage 1's five islands get callers. None of them changed to make this work,
 * which was the point of keeping them pure.
 *
 * ONE STORE PER FACT (`DEC-007`, closing finding A-2). A decision is a record in the log and
 * that is the only copy. `nodes`, `edges`, `decisions` and the adjacency index below are all
 * rebuilt in `load()` from the same lines and are **never written to disk** — a persisted
 * derived copy would be a second store, and purge would then have to reach it too.
 *
 * WHAT THIS NEEDS FROM ITS NEIGHBOURS, AND WHAT HAPPENS WHEN THEY FAIL — the Stage 2 question,
 * answered at each call site rather than in a diagram. The full table is `ARCHITECTURE.md` §4.
 */

import { appendEntry, purgeContent, verifyChain, type ChainEntry } from '../provenance/chain';
import type { Json } from '../provenance/canonical';
import { stateAt, type Snapshot, type TemporalEdge, type TemporalNode } from '../temporal/window';
import { closingValidUntil } from '../temporal/retract';
import { chainReport, findChains, type CausalEdge, type ChainReport, type Direction } from '../decision/causal';
import { appendLog, readLog, rewriteLog } from './log';
import type { RecordKind, RecordMeta, RecordMetaInput, StoredRecord } from './records';
import { ensureStoreDir, type StorePaths } from './paths';

export type StoreErrorCode =
  | 'chain_invalid'
  | 'not_found'
  | 'already_purged'
  | 'duplicate_id';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly detail: string;
  constructor(code: StoreErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'StoreError';
    this.code = code;
    this.detail = detail;
  }
}

/** Injected so nothing here reads a hidden clock or a hidden RNG, and tests stay deterministic. */
export interface StoreDeps {
  readonly now: () => string;
  readonly salt: () => string;
}

export const realDeps: StoreDeps = {
  now: () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  salt: () => {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  },
};

export interface RecordInput {
  readonly kind: Exclude<RecordKind, 'retraction' | 'tombstone'>;
  readonly id: string;
  readonly content: Json;
  readonly validFrom?: string | null;
  readonly validUntil?: string | null;
  readonly source?: string;
  readonly target?: string;
  readonly edgeType?: string;
  readonly weight?: number;
}

export class Store {
  private constructor(
    readonly paths: StorePaths,
    private readonly deps: StoreDeps,
    private records: StoredRecord[],
  ) {}

  /**
   * Load a store, verifying the chain first.
   *
   * A log whose chain does not verify is **refused**, not loaded partially. Returning a
   * best-effort graph from a tampered log is the silent failure this whole design exists to
   * prevent — the caller would get answers with no indication they came from an altered record.
   */
  static async open(paths: StorePaths, deps: StoreDeps = realDeps): Promise<Store> {
    ensureStoreDir(paths);
    const records = [...readLog(paths)];
    const report = verifyChain(records as readonly ChainEntry[]);
    if (!report.valid) {
      const first = report.problems[0]!;
      throw new StoreError(
        'chain_invalid',
        `${report.problems.length} problem(s) in ${paths.log}; first is ${first.reason} at seq ` +
          `${first.seq} (${first.id}). Refusing to load — a partial graph from a tampered log ` +
          'would answer questions without saying the record was altered.',
      );
    }
    return new Store(paths, deps, records);
  }

  // ───────────────────────── mutations ─────────────────────────

  /** Append one record. Every mutation goes through here, so nothing can skip the chain. */
  async append(input: RecordInput): Promise<StoredRecord> {
    if (this.byId(input.id) !== undefined) {
      throw new StoreError('duplicate_id', `${JSON.stringify(input.id)} is already in this store`);
    }
    const rec = this.build(input.kind, input.id, input.content, {
      recordedAt: this.deps.now(),
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.target !== undefined ? { target: input.target } : {}),
      ...(input.edgeType !== undefined ? { edgeType: input.edgeType } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
    });
    await appendLog(this.paths, [rec]);
    this.records.push(rec);
    return rec;
  }

  /**
   * Close a subject's window and file a retraction. Content is kept — this is not erasure.
   *
   * A retraction is **appended, never applied in place.** The first version of this method
   * edited the target's `validUntil` and recomputed its digest, and the store's own tests
   * caught it immediately: every later record's `prev` still pointed at the old digest, so
   * a single retraction broke the chain. That was not a bug in the chain — it was this method
   * violating `DEC-007`, which says records are immutable and a correction appends.
   *
   * So the window closure is **derived at read time** by `effectiveValidUntil` instead, using
   * the same `min(existing, at)` narrowing rule from Algorithm 3. The log stays append-only and
   * the chain never has to be rewritten.
   */
  async retract(id: string, reason: string | null = null): Promise<StoredRecord> {
    const target = this.require(id);
    const at = this.deps.now();
    const record = this.build('retraction', `${id}:retracted:${at}`, { reason }, {
      recordedAt: at, validFrom: at, validUntil: null,
      subject: id, subjectKind: this.subjectKind(target), reason,
    });
    await appendLog(this.paths, [record]);
    this.records.push(record);
    return record;
  }

  /**
   * A record's window end, after every retraction filed against it.
   *
   * `closingValidUntil` is Algorithm 3's narrowing rule: a retraction takes the EARLIER of the
   * existing bound and the retraction instant, so it can only narrow. Folding over every
   * retraction means two retractions cannot widen a window between them either.
   */
  private effectiveValidUntil(rec: StoredRecord): string | null {
    let end = rec.meta.validUntil;
    for (const r of this.records) {
      if (r.kind !== 'retraction' || r.meta.subject !== rec.id) continue;
      end = closingValidUntil(end, r.meta.recordedAt);
    }
    return end;
  }

  /**
   * Remove a record's content and leave a tombstone.
   *
   * The log is **rewritten**, not appended to: an append cannot unpublish bytes already on
   * disk. `digest`, `prev`, `seq` and `contentDigest` are untouched, which is exactly why the
   * chain still verifies afterwards (`DEC-007`).
   */
  async purge(id: string, reason: string | null = null): Promise<StoredRecord> {
    const target = this.require(id);
    if (target.content === null && target.salt === null) {
      throw new StoreError('already_purged', `${JSON.stringify(id)} has already been purged`);
    }
    const at = this.deps.now();
    const tombstone = this.build('tombstone', `${id}:purged:${at}`, { reason }, {
      recordedAt: at, validFrom: at, validUntil: null,
      subject: id, subjectKind: this.subjectKind(target), reason,
      contentDigest: target.contentDigest, scope: 'this-store-only',
    });
    const emptied = purgeContent(target) as StoredRecord;
    this.records = this.records.map((r) => (r.id === id ? emptied : r));
    this.records.push(tombstone);
    await rewriteLog(this.paths, this.records);
    return tombstone;
  }

  // ───────────────────────── read paths ─────────────────────────
  // Every one of these is enumerated in test/store.test.ts's READ_PATHS list. A read path
  // added here without being added there fails that test by construction.

  /** 1 */ contentOf(id: string): Json | null {
    return this.byId(id)?.content ?? null;
  }
  /** 2 */ getNode(id: string): StoredRecord | undefined {
    return this.live().find((r) => r.id === id && r.kind === 'node');
  }
  /** 3 */ listNodes(): readonly StoredRecord[] {
    return this.live().filter((r) => r.kind === 'node');
  }
  /** 4 */ getDecision(id: string): StoredRecord | undefined {
    return this.live().find((r) => r.id === id && r.kind === 'decision');
  }
  /** 5 */ listDecisions(): readonly StoredRecord[] {
    return this.live().filter((r) => r.kind === 'decision');
  }
  /** 6 */ getEdge(id: string): StoredRecord | undefined {
    return this.live().find((r) => r.id === id && r.kind === 'edge');
  }
  /** 7 */ listEdges(): readonly StoredRecord[] {
    return this.live().filter((r) => r.kind === 'edge');
  }
  /** 8 */ stateAt(validAt: string, asOf?: string): Snapshot {
    const subjects = this.live().filter((r) => r.kind === 'node' || r.kind === 'decision');
    const nodes: TemporalNode[] = subjects.map((r) => ({
      id: r.id, validFrom: r.meta.validFrom,
      validUntil: this.effectiveValidUntil(r), recordedAt: r.meta.recordedAt,
    }));
    const edges: TemporalEdge[] = this.live()
      .filter((r) => r.kind === 'edge' && typeof r.meta.source === 'string' && typeof r.meta.target === 'string')
      .map((r) => ({
        id: r.id, source: r.meta.source as string, target: r.meta.target as string,
        validFrom: r.meta.validFrom, validUntil: this.effectiveValidUntil(r),
        recordedAt: r.meta.recordedAt,
      }));
    return asOf === undefined ? stateAt(nodes, edges, { validAt }) : stateAt(nodes, edges, { validAt, asOf });
  }
  /** 9 */ why(decisionId: string, direction: Direction = 'upstream', maxDepth = 5): readonly ChainReport[] {
    return findChains(this.causalEdges(), decisionId, { direction, maxDepth }).map(chainReport);
  }
  /** 10 */ searchable(): readonly { id: string; text: string }[] {
    return this.live()
      .filter((r) => r.content !== null)
      .map((r) => ({ id: r.id, text: JSON.stringify(r.content) }));
  }

  // ───────────────────────── plumbing ─────────────────────────

  /** Raw records including purged shells and removal records. Not a content read path. */
  all(): readonly StoredRecord[] {
    return this.records;
  }

  verify(): ReturnType<typeof verifyChain> {
    return verifyChain(this.records as readonly ChainEntry[]);
  }

  /** Records that still carry content — the basis of every content read path above. */
  private live(): readonly StoredRecord[] {
    return this.records.filter(
      (r) => r.content !== null && r.kind !== 'retraction' && r.kind !== 'tombstone',
    );
  }

  private causalEdges(): readonly CausalEdge[] {
    return this.live()
      .filter((r) => r.kind === 'edge')
      .map((r) => ({
        source: String(r.meta.source), target: String(r.meta.target),
        type: (r.meta.edgeType ?? 'INFLUENCED') as CausalEdge['type'],
        weight: typeof r.meta.weight === 'number' ? r.meta.weight : 1,
      }));
  }

  private byId(id: string): StoredRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  private require(id: string): StoredRecord {
    const r = this.byId(id);
    if (r === undefined) throw new StoreError('not_found', `no record with id ${JSON.stringify(id)}`);
    return r;
  }

  private subjectKind(r: StoredRecord): 'node' | 'edge' | 'decision' {
    return r.kind === 'edge' ? 'edge' : r.kind === 'decision' ? 'decision' : 'node';
  }

  private build(
    kind: RecordKind,
    id: string,
    content: Json,
    meta: RecordMetaInput,
  ): StoredRecord {
    // The three required fields are written explicitly rather than left to the spread:
    // `RecordMeta` carries an index signature, which defeats `Omit`'s ability to prove the
    // spread supplies them. Being explicit means a missing one is a compile error, not a
    // record that reaches disk without a transaction time.
    const full: RecordMeta = {
      ...meta,
      workspace: this.paths.workspace.root,
      workspaceMethod: this.paths.workspace.method,
      recordedAt: meta.recordedAt,
      validFrom: meta.validFrom,
      validUntil: meta.validUntil,
    };
    const entry = appendEntry(this.records as readonly ChainEntry[], { kind, id, content, meta: full }, this.deps.salt());
    return { ...entry, kind, meta: full } as StoredRecord;
  }

}
