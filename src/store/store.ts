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
import { parseInstant, stateAt, type Snapshot, type TemporalEdge, type TemporalNode } from '../temporal/window';
import { closingValidUntil } from '../temporal/retract';
import { chainReport, findChains, type CausalEdge, type ChainReport, type Direction } from '../decision/causal';
import { readLog, withLoggedMutation } from './log';
import { assertConsistent, type RetrievalDecision } from '../retrieval/channels';
import { block } from '../resolve/blocking';
import { cluster, merged, type Cluster } from '../resolve/cluster';
import type { Candidate } from '../resolve/similarity';
import type { RecordKind, RecordMeta, RecordMetaInput, StoredRecord } from './records';
import { ensureStoreDir, type StorePaths } from './paths';

export type StoreErrorCode =
  | 'chain_invalid'
  | 'not_found'
  | 'already_purged'
  | 'duplicate_id'
  | 'merge_too_small'
  | 'canonical_not_a_member'
  | 'member_already_merged'
  | 'canonical_of_active_merge';

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


/** A record's display name, for clustering. Content is caller-shaped, so this is defensive. */
function nameOf(content: Json | null): string {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return '';
  const c = content as Record<string, unknown>;
  for (const k of ['name', 'title', 'text', 'scenario']) {
    const v = c[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

/**
 * The merges in force at `at`, honouring retraction.
 *
 * A merge is a record, so retracting it closes its window exactly as `DEC-012` says — there is no
 * separate un-merge, because a second undo mechanism is how two paths drift apart.
 *
 * `bound` decides what happens at the exact closing instant, and the two callers genuinely want
 * different answers. A read (`inclusive`) follows Algorithm 2, where a window is open at both its
 * endpoints. The purge guard (`after`) asks a different question — *will this merge redirect any
 * FUTURE read* — and a merge closing at this instant will not.
 *
 * Without that split, the refusal below named a remedy that did not work: retract the merge and
 * purge immediately, both land in the same second at `now()`'s one-second resolution, and the
 * purge was refused again for a merge the caller had just closed. An error that instructs an
 * action and then rejects it is worse than no message.
 */
function activeMergesIn(
  records: readonly StoredRecord[],
  at: string,
  bound: 'inclusive' | 'after' = 'inclusive',
): readonly StoredRecord[] {
  const merges = records.filter((r) => r.kind === 'merge');
  return merges.filter((m) => {
    let end = m.meta.validUntil;
    for (const r of records) {
      if (r.kind !== 'retraction' || r.meta.subject !== m.id) continue;
      end = closingValidUntil(end, r.meta.validFrom ?? r.meta.recordedAt);
    }
    if (end === null) return true;
    const a = parseInstant(at), e = parseInstant(end);
    if (!a.ok || !e.ok) return true;
    return bound === 'after' ? a.ms < e.ms : a.ms <= e.ms;
  });
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

  /**
   * Append one record.
   *
   * The chain head is read **inside the lock**, not from this instance's snapshot. Two processes
   * that both opened an empty store would otherwise both compute `seq = 1` and both write it —
   * which Phase 3's concurrency test reproduced. `withLoggedMutation` owns that critical section.
   */
  async append(input: RecordInput): Promise<StoredRecord> {
    const rec = await withLoggedMutation(this.paths, (current) => {
      if (current.some((r) => r.id === input.id)) {
        throw new StoreError('duplicate_id', `${JSON.stringify(input.id)} is already in this store`);
      }
      const built = this.build(current, input.kind, input.id, input.content, {
        recordedAt: this.deps.now(),
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.edgeType !== undefined ? { edgeType: input.edgeType } : {}),
        ...(input.weight !== undefined ? { weight: input.weight } : {}),
      });
      this.records = [...current, built];
      return { append: [built], value: built };
    });
    return rec;
  }

  /**
   * Close a subject's window and file a retraction. Content is kept — this is not erasure.
   *
   * A retraction is **appended, never applied in place.** The first version of this method edited
   * the target's `validUntil` and recomputed its digest, and the store's own tests caught it
   * immediately: every later record's `prev` still pointed at the old digest, so a single
   * retraction broke the chain. That was not a bug in the chain — it was this method violating
   * `DEC-007`, which says records are immutable and a correction appends.
   *
   * So the window closure is **derived at read time** by `effectiveValidUntil` instead, using the
   * same `min(existing, at)` narrowing rule from Algorithm 3. The log stays append-only.
   */
  async retract(id: string, reason: string | null = null, at?: string): Promise<StoredRecord> {
    return withLoggedMutation(this.paths, (current) => {
      const target = current.find((r) => r.id === id);
      if (target === undefined) {
        throw new StoreError('not_found', `no record with id ${JSON.stringify(id)}`);
      }
      // Two different instants, and conflating them was a real bug. `closedAt` is VALID time —
      // when the fact stopped being true, which the caller knows and the engine does not.
      // `recordedAt` is TRANSACTION time — when we were told, which the engine supplies and a
      // caller must not be able to set. The original takes this parameter
      // (`context_graph.py:1556`); the port dropped it, so the only retraction expressible was
      // "it stops being true now". Phase 3's scenario test surfaced it: a session replaying
      // three days in March could not say a policy ended in March.
      const recordedAt = this.deps.now();
      const closedAt = at ?? recordedAt;
      const p = parseInstant(closedAt);
      if (!p.ok) {
        throw new StoreError('not_found', `retraction instant ${JSON.stringify(closedAt)} is unusable: ${p.reason}`);
      }
      const record = this.build(current, 'retraction', `${id}:retracted:${closedAt}`, { reason }, {
        recordedAt, validFrom: closedAt, validUntil: null,
        subject: id, subjectKind: this.subjectKind(target), reason,
      });
      this.records = [...current, record];
      return { append: [record], value: record };
    });
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
      // Fold on the retraction's VALID-time instant, not when we were told about it.
      end = closingValidUntil(end, r.meta.validFrom ?? r.meta.recordedAt);
    }
    return end;
  }

  /**
   * Remove a record's content and leave a tombstone.
   *
   * The log is **rewritten**, not appended to: an append cannot unpublish bytes already on disk.
   * `digest`, `prev`, `seq` and `contentDigest` are untouched, which is exactly why the chain
   * still verifies afterwards (`DEC-007`).
   */
  async purge(id: string, reason: string | null = null): Promise<StoredRecord> {
    return withLoggedMutation(this.paths, (current) => {
      const target = current.find((r) => r.id === id);
      if (target === undefined) {
        throw new StoreError('not_found', `no record with id ${JSON.stringify(id)}`);
      }
      if (target.content === null && target.salt === null) {
        throw new StoreError('already_purged', `${JSON.stringify(id)} has already been purged`);
      }
      // Refuse to purge the canonical of an active merge.
      //
      // Measured before this guard existed: purging the canonical made `contentOf` return null
      // for EVERY member, because reads redirect to a record whose content is gone — while each
      // member's own content sat untouched on disk. That is the worst state available: it reads
      // as erased and is not. Someone purging a leaked credential would see null and reasonably
      // conclude it was gone.
      //
      // Cascading the purge to the members was the alternative and is rejected: an implicit
      // destructive action across records the caller did not name is exactly what `DEC-004`'s
      // "purge is the remedy" must not become. Refusing says what to do instead — retract the
      // merge, or purge every member explicitly.
      const blocking = activeMergesIn(current, this.deps.now(), 'after')
        .find((m) => m.meta.canonical === id);
      if (blocking !== undefined) {
        throw new StoreError(
          'canonical_of_active_merge',
          `${JSON.stringify(id)} is the canonical record of merge ${JSON.stringify(blocking.id)}, ` +
            `so purging it would make every member read as empty while their own content remains on ` +
            `disk. Retract the merge first, or purge each member: ${(blocking.meta.members ?? []).join(', ')}.`,
        );
      }
      const at = this.deps.now();
      const tombstone = this.build(current, 'tombstone', `${id}:purged:${at}`, { reason }, {
        recordedAt: at, validFrom: at, validUntil: null,
        subject: id, subjectKind: this.subjectKind(target), reason,
        contentDigest: target.contentDigest, scope: 'this-store-only',
      });
      const emptied = purgeContent(target) as StoredRecord;
      const next = [...current.map((r) => (r.id === id ? emptied : r)), tombstone];
      this.records = next;
      return { rewrite: next, value: tombstone };
    });
  }

  /**
   * Persist a retrieval decision.
   *
   * `DEC-005`'s stored-data table lists retrieval decision records as stored, and until now
   * nothing wrote one — the `retrieval` kind existed with no writer, which is schema decoration
   * on dead code. Phase 3 resolves it by wiring the writer rather than deleting the kind,
   * because the alternative is a system that claims to record every decision and records none
   * of them durably.
   *
   * THE CONSEQUENCE, STATED: a query now mutates the store. `find` appends. That is a real
   * cost — the log grows with reads, not only writes — and it is the price of the ledger being
   * true rather than aspirational. `DEC-005` already forbids storing the query text, so the row
   * carries a hash and a length; the served ids are stored because they are already in the log.
   */
  async recordRetrieval(decision: RetrievalDecision): Promise<StoredRecord> {
    assertConsistent(decision);
    return withLoggedMutation(this.paths, (current) => {
      const at = this.deps.now();
      const rec = this.build(current, 'retrieval', `retrieval:${decision.queryHash}:${at}`, {
        outcome: decision.outcome,
        queryHash: decision.queryHash,
        queryChars: decision.queryChars,
        served: decision.served.map((x) => x.id),
        channels: decision.channels.map((c) => ({
          channel: c.channel, considered: c.considered,
          topScore: c.topScore, floor: c.floor, margin: c.margin,
        })),
        reason: decision.reason,
      }, { recordedAt: at, validFrom: at, validUntil: null });
      this.records = [...current, rec];
      return { append: [rec], value: rec };
    });
  }

  /**
   * Propose clusters. **Writes nothing** — `DEC-012` makes a cluster derived, and a derived thing
   * that persists is a second store.
   *
   * A proposal is a suggestion about identity, not a fact. It carries the weakest link holding
   * each cluster together so a caller can see what it is being asked to believe, rather than a
   * merged blob with a confidence attached.
   */
  suggest(minScore = 0.6): readonly Cluster[] {
    const named: Candidate[] = this.live()
      .filter((r) => r.kind === 'node' || r.kind === 'decision')
      .map((r) => ({ id: r.id, name: nameOf(r.content), type: r.kind }))
      .filter((c) => c.name !== '');
    if (named.length < 2) return [];
    const pairs = block(named, { typeScoped: true, phonetic: true }).pairs;
    return merged(cluster(named.map((c) => c.id), pairs, minScore));
  }

  /**
   * Assert that several records are one thing.
   *
   * Nothing is rewritten. `DEC-012`: the members stay byte for byte, their digests are untouched,
   * and reads redirect through this record to `canonical`. The record carries ids and a reason and
   * **never content**, so purging a member later needs no purge here.
   *
   * There is no automatic path to this method and there must not be. The resolver proposes; a
   * caller disposes.
   */
  async merge(members: readonly string[], canonical: string, reason: string | null = null): Promise<StoredRecord> {
    return withLoggedMutation(this.paths, (current) => {
      if (members.length < 2) {
        throw new StoreError('merge_too_small', `a merge needs at least two members, got ${members.length}`);
      }
      if (!members.includes(canonical)) {
        throw new StoreError('canonical_not_a_member', `${JSON.stringify(canonical)} is not among the members`);
      }
      for (const m of members) {
        if (!current.some((r) => r.id === m)) {
          throw new StoreError('not_found', `no record with id ${JSON.stringify(m)}`);
        }
      }
      // A record already inside an active merge cannot join a second one. Two competing identity
      // claims would make `canonicalOf` order-dependent, and an identity that depends on read
      // order is not an identity.
      const existing = activeMergesIn(current, this.deps.now());
      for (const m of members) {
        if (existing.some((x) => (x.meta.members ?? []).includes(m))) {
          throw new StoreError('member_already_merged', `${JSON.stringify(m)} is already in an active merge`);
        }
      }
      const at = this.deps.now();
      const rec = this.build(current, 'merge', `merge:${[...members].sort().join('+')}`, { reason }, {
        recordedAt: at, validFrom: at, validUntil: null,
        members: [...members].sort(), canonical, reason,
      });
      this.records = [...current, rec];
      return { append: [rec], value: rec };
    });
  }

  // ───────────────────────── read paths ─────────────────────────
  // Every one of these is enumerated in test/store.test.ts's READ_PATHS list. A read path
  // added here without being added there fails that test by construction.

  /** 1 */ contentOf(id: string): Json | null {
    // Resolves through an active merge. A read for a merged record answers from the canonical
    // one — and `resolveId` says which merge redirected it, so an answer can always explain why
    // it came from a different record than the one asked for.
    return this.byId(this.resolveId(id).canonical)?.content ?? null;
  }

  /**
   * 11
   * Where a read for `id` actually lands, and what redirected it.
   *
   * `via` is `null` when nothing redirected. An answer that silently comes from a different
   * record than the one asked for is the same failure as a retrieval that cannot say why it
   * served — so the redirect is always reportable.
   */
  resolveId(id: string, at?: string): { readonly requested: string; readonly canonical: string; readonly via: string | null } {
    const when = at ?? this.deps.now();
    for (const m of activeMergesIn(this.records, when)) {
      const members = m.meta.members ?? [];
      if (members.includes(id) && m.meta.canonical !== undefined && m.meta.canonical !== id) {
        return { requested: id, canonical: m.meta.canonical, via: m.id };
      }
    }
    return { requested: id, canonical: id, via: null };
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
      .filter((r) => r.content !== null && r.kind !== 'retrieval')
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
      (r) => r.content !== null && r.kind !== 'retraction' && r.kind !== 'tombstone' && r.kind !== 'merge',
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

  private subjectKind(r: StoredRecord): 'node' | 'edge' | 'decision' {
    return r.kind === 'edge' ? 'edge' : r.kind === 'decision' ? 'decision' : 'node';
  }

  private build(
    chain: readonly StoredRecord[],
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
    const entry = appendEntry(chain as readonly ChainEntry[], { kind, id, content, meta: full }, this.deps.salt());
    return { ...entry, kind, meta: full } as StoredRecord;
  }

}
