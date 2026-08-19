/**
 * Algorithm 2 — bitemporal validity windows and `stateAt`.
 *
 * Ported from `semantica/semantica/context/context_graph.py:2590-2631` (`state_at`) and
 * `:333-350` (`ContextNode.is_active`).
 *
 * CARRIED OVER, because it is the one rule that makes a snapshot coherent: an edge is
 * admitted only when its own window is open AND both of its endpoints are active
 * (`context_graph.py:2596-2601`). Without it a snapshot can contain an edge pointing at a
 * node that is not in the snapshot — a dangling edge, which is not a view of anything.
 * Bounds are inclusive at both ends and a null bound means unbounded, also as ported.
 *
 * CHANGED — malformed input fails closed, not open. Semantica parses a bad bound to `None`
 * and then imposes no bound at all, logging "treating node as Always-Active"
 * (`context_graph.py:151`, `:168`). So a corrupted timestamp makes a record MORE visible,
 * and a record that should have expired never does. `DEC-003` forbids that: a malformed
 * bound is a rejected input with a reason code. Here a record with an unusable bound is
 * excluded from the snapshot and reported in `rejected` — never silently included.
 *
 * ADDED — the second time axis. Semantica's comments call its windows bitemporal, but it
 * carries only one axis: `valid_from`/`valid_until`, caller-supplied. SQL:2011 separates
 * *valid time* (when a fact holds in the world, application-supplied) from *transaction
 * time* (when the store recorded it, system-supplied); bitemporal means both. See
 * `docs/research/02-temporal-windows.md`.
 *
 * We get the second axis almost free, because Algorithm 1's append-only log already orders
 * records by insertion: `recordedAt` is transaction time, and `asOf` truncates the input to
 * what the store had recorded by that instant before any valid-time filtering runs. That is
 * what separates "what was true at T" from "what did we believe at T" — and for a context
 * engine the second question is the one that explains a past decision.
 *
 * Stage 1: pure functions over plain data. No I/O, no store, no clock — `validAt` is always
 * a parameter, so there is no hidden "now".
 */

/** The two ways a single instant can be unusable. `parseInstant` returns only these. */
export type ParseReason = 'malformed_temporal_value' | 'ambiguous_timezone';

/** Every way a record's temporal fields can be unusable. `inverted_window` needs both bounds,
 *  so it is a property of the record rather than of any one instant. */
export type TemporalReason = ParseReason | 'inverted_window';

export interface Rejection {
  readonly id: string;
  readonly field: 'validFrom' | 'validUntil' | 'recordedAt' | 'window';
  readonly reason: TemporalReason;
  readonly value: string;
}

export interface Interval {
  /** ISO-8601 instant, or null for unbounded. Inclusive. */
  readonly validFrom: string | null;
  /** ISO-8601 instant, or null for unbounded. Inclusive. */
  readonly validUntil: string | null;
  /** Transaction time: when the store recorded this. ISO-8601, never null. */
  readonly recordedAt: string;
}

export interface TemporalNode extends Interval {
  readonly id: string;
}

export interface TemporalEdge extends Interval {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface Snapshot {
  readonly validAt: string;
  readonly asOf: string | null;
  readonly nodes: readonly TemporalNode[];
  readonly edges: readonly TemporalEdge[];
  /** Records excluded because a bound could not be trusted. Never silently dropped. */
  readonly rejected: readonly Rejection[];
}

export type Parsed = { readonly ok: true; readonly ms: number }
                  | { readonly ok: false; readonly reason: ParseReason };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;
const CALENDAR = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Is this a date that exists?
 *
 * `Date.parse` does not answer that. It **rolls over**: `2026-02-29` parses happily and comes
 * back as 1 March, so a caller asking about a day that never existed silently gets a different
 * day. Phase 3's suite caught it. `DEC-003` forbids exactly this class of silent temporal
 * coercion — a bound we cannot trust must be rejected, not adjusted into one we can.
 *
 * The check is on the written calendar date, which is correct even with an offset: an offset
 * shifts which instant the date denotes, not whether the date is real.
 */
function isRealCalendarDate(s: string): boolean {
  const m = CALENDAR.exec(s);
  if (m === null) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] as number;
  return d <= days;
}

/**
 * Parse an ISO-8601 instant to epoch milliseconds.
 *
 * Deliberately stricter than the original, which also accepted a year-only shorthand and a
 * naive date-time it silently read as UTC (`context_graph.py:142-170`). A date-time with no
 * offset is rejected as `ambiguous_timezone` rather than assumed: reading a local timestamp
 * as UTC shifts a record by hours, and a window that moves by hours is a wrong answer that
 * looks like a right one. A date-only value is accepted and documented as UTC midnight,
 * which is a stated convention rather than a guess.
 */
export function parseInstant(value: string): Parsed {
  const s = value.trim();
  if (s === '') return { ok: false, reason: 'malformed_temporal_value' };

  if (!isRealCalendarDate(s)) return { ok: false, reason: 'malformed_temporal_value' };

  if (DATE_ONLY.test(s)) {
    const ms = Date.parse(`${s}T00:00:00Z`);
    return Number.isNaN(ms)
      ? { ok: false, reason: 'malformed_temporal_value' }
      : { ok: true, ms };
  }

  if (!s.includes('T')) return { ok: false, reason: 'malformed_temporal_value' };
  if (!HAS_OFFSET.test(s)) return { ok: false, reason: 'ambiguous_timezone' };

  const ms = Date.parse(s);
  return Number.isNaN(ms)
    ? { ok: false, reason: 'malformed_temporal_value' }
    : { ok: true, ms };
}

/** Resolve one record's bounds, or the reasons it cannot be trusted. */
function resolve(r: Interval & { readonly id: string }): { ms: { from: number | null; until: number | null; recorded: number } } | { rejections: Rejection[] } {
  const rejections: Rejection[] = [];

  const recorded = parseInstant(r.recordedAt);
  if (!recorded.ok) {
    rejections.push({ id: r.id, field: 'recordedAt', reason: recorded.reason, value: r.recordedAt });
  }

  let from: number | null = null;
  if (r.validFrom !== null) {
    const p = parseInstant(r.validFrom);
    if (!p.ok) rejections.push({ id: r.id, field: 'validFrom', reason: p.reason, value: r.validFrom });
    else from = p.ms;
  }

  let until: number | null = null;
  if (r.validUntil !== null) {
    const p = parseInstant(r.validUntil);
    if (!p.ok) rejections.push({ id: r.id, field: 'validUntil', reason: p.reason, value: r.validUntil });
    else until = p.ms;
  }

  // Not in the original. A window whose start is after its end can never be active, so it
  // is a defect in whatever wrote it rather than an intent to hide a record. Reporting it
  // is the difference between a record that is invisible and a record that is invisible
  // for a reason someone can read.
  if (from !== null && until !== null && from > until) {
    rejections.push({ id: r.id, field: 'window', reason: 'inverted_window', value: `${r.validFrom}/${r.validUntil}` });
  }

  if (rejections.length > 0) return { rejections };
  return { ms: { from, until, recorded: (recorded as { ok: true; ms: number }).ms } };
}

/** Inclusive at both ends, and unbounded on a null bound — as ported. */
function withinWindow(at: number, from: number | null, until: number | null): boolean {
  if (from !== null && at < from) return false;
  if (until !== null && at > until) return false;
  return true;
}

export interface StateAtOptions {
  /** Valid time: the instant to view the world at. */
  readonly validAt: string;
  /**
   * Transaction time: view the store as it stood once everything recorded up to this
   * instant was in it. Omit to use everything given.
   */
  readonly asOf?: string;
}

/**
 * Reconstruct the graph as it stood at one point on each time axis.
 *
 * Order matters: transaction time is applied first (what had the store recorded?), then
 * valid time (what did those records claim was true?), then the endpoint rule. Applying
 * them the other way round would let a record that had not yet been written influence a
 * snapshot of an earlier belief.
 */
export function stateAt(
  nodes: readonly TemporalNode[],
  edges: readonly TemporalEdge[],
  opts: StateAtOptions,
): Snapshot {
  const rejected: Rejection[] = [];

  const at = parseInstant(opts.validAt);
  if (!at.ok) {
    throw new Error(`${at.reason}: validAt ${JSON.stringify(opts.validAt)} is not a usable instant`);
  }
  let asOfMs: number | null = null;
  if (opts.asOf !== undefined) {
    const p = parseInstant(opts.asOf);
    if (!p.ok) {
      throw new Error(`${p.reason}: asOf ${JSON.stringify(opts.asOf)} is not a usable instant`);
    }
    asOfMs = p.ms;
  }

  const admit = <T extends Interval & { readonly id: string }>(r: T): boolean => {
    const res = resolve(r);
    if ('rejections' in res) {
      rejected.push(...res.rejections);
      return false;
    }
    // Transaction time first.
    if (asOfMs !== null && res.ms.recorded > asOfMs) return false;
    // Then valid time.
    return withinWindow(at.ms, res.ms.from, res.ms.until);
  };

  const activeNodes = nodes.filter(admit);
  const activeIds = new Set(activeNodes.map((n) => n.id));

  // The rule worth having: an edge needs its own open window AND both endpoints active.
  const activeEdges = edges.filter(
    (e) => admit(e) && activeIds.has(e.source) && activeIds.has(e.target),
  );

  return {
    validAt: opts.validAt,
    asOf: opts.asOf ?? null,
    nodes: activeNodes,
    edges: activeEdges,
    rejected,
  };
}
