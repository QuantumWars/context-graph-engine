/**
 * Algorithm 5 — a decision as a node, typed causal edges, and the causal chain report.
 *
 * Ported from `semantica/semantica/context/context_graph.py:2734-2772`
 * (`add_causal_relationship`) and `:3938-3974` (`_build_causal_chain_report`).
 *
 * STORED ONCE. A decision is a node and that is the only copy. This is the whole of finding
 * A-2's fix. Semantica writes a decision twice — as a node of type `decision` and as a plain
 * dict in `self._decisions` — and an AST query confirmed this session that `save_to_file`,
 * `load_from_file`, `purge_node` and `clear` never mention the dict while `record_decision`
 * and `find_precedents_by_scenario` do. So a saved graph loses precedent search on reload, and
 * a purged decision stays searchable by full text. There is no second store here, and
 * `decisionContent` reads from the node so there is nowhere for one to hide.
 *
 * CARRIED OVER:
 *  - The three causal edge types, and the distinction the original records at its definition
 *    site: these are what a caller ASSERTED, as opposed to relationships inferred from shared
 *    entities and timestamps. Only asserted edges are traversed here.
 *  - Per-path cycle detection rather than a global visited set. Semantica's own comment says a
 *    global set "silently loses valid chains" on branching graphs — a diamond loses one arm.
 *  - The weakest link: the hop with the lowest weight, reported by name.
 *
 * FIXED — the casing trap. `record_decision` writes `node_type="decision"` while
 * `add_decision` writes `"Decision"`, and `state_at`/`get_causal_chain` compare with `.lower()`
 * while `multi_hop_reasoning` and `trace_decision_path` compare exactly. So decisions created
 * one way are invisible to two of the readers. Here there is one canonical form, normalised
 * and validated at the boundary, and no reader does its own comparison.
 *
 * FIXED — a stored weight of `0.0`. The original reads `float(hop.get("edge_weight", 1.0))`,
 * and elsewhere notes that a stored `0.0` is meaningful and must not become the default. A
 * zero-weight edge means "this link carries no confidence", which is the opposite of 1.0.
 *
 * CHANGED — two numbers, not one. See `docs/research/05-causal-chains.md`. Semantica reports
 * the product of edge weights as *the* confidence and the weakest link as an aside. The
 * product assumes the hops are independent, which along a causal chain they generally are not,
 * and the weights themselves are uncalibrated — so collapsing them into one number is false
 * precision. Both are reported, each labelled with the assumption it carries, and no single
 * blended figure is emitted.
 *
 * NOT PORTED — the interpretation string and its 0.7 / 0.4 thresholds. They are unmeasured
 * constants that turn two numbers into a confident English sentence, which is the "uncalibrated
 * constants shipped silently" item on the teardown's reject list.
 *
 * Stage 1: pure functions over plain data.
 */

/** What a caller asserted. Inferred relationships are a different thing and are not traversed. */
export const CAUSAL_EDGE_TYPES = ['CAUSED', 'INFLUENCED', 'PRECEDENT_FOR'] as const;
export type CausalEdgeType = (typeof CAUSAL_EDGE_TYPES)[number];

/** The one canonical node kind for a decision. Compared nowhere else, by anyone. */
export const DECISION_KIND = 'decision';

export type CausalErrorCode =
  | 'unknown_edge_type'
  | 'not_a_decision'
  | 'weight_out_of_range'
  | 'invalid_max_depth';

export class CausalError extends Error {
  readonly code: CausalErrorCode;
  constructor(code: CausalErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'CausalError';
    this.code = code;
  }
}

export interface DecisionContent {
  readonly scenario: string;
  readonly reasoning: string;
  readonly outcome: string;
  readonly confidence: number;
}

/** A decision is a node. There is no other representation of one. */
export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly content: DecisionContent | Readonly<Record<string, unknown>>;
}

export interface CausalEdge {
  readonly source: string;
  readonly target: string;
  readonly type: CausalEdgeType;
  /** 0..1 inclusive. `0` is meaningful — it is not a missing value. */
  readonly weight: number;
}

/** Normalise a node kind to its canonical form. The single place casing is decided. */
export function normaliseKind(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isDecision(node: Pick<GraphNode, 'kind'>): boolean {
  return normaliseKind(node.kind) === DECISION_KIND;
}

/** Validate an edge type at the boundary, so no reader ever compares a raw string. */
export function assertCausalEdgeType(raw: string): CausalEdgeType {
  const found = CAUSAL_EDGE_TYPES.find((t) => t === raw);
  if (found === undefined) {
    throw new CausalError(
      'unknown_edge_type',
      `${JSON.stringify(raw)} is not one of ${CAUSAL_EDGE_TYPES.join(', ')}`,
    );
  }
  return found;
}

/**
 * Build a causal edge between two decisions.
 *
 * Semantica's writer silently returns when either endpoint is missing or is not a decision
 * (`context_graph.py:2734-2772`), so a mistyped id produces no edge and no complaint. Here it
 * is a named error — HARD RULE 4.
 */
export function linkDecisions(
  source: GraphNode,
  target: GraphNode,
  type: string,
  weight = 1,
): CausalEdge {
  for (const n of [source, target]) {
    if (!isDecision(n)) {
      throw new CausalError('not_a_decision', `node ${JSON.stringify(n.id)} has kind ${JSON.stringify(n.kind)}`);
    }
  }
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new CausalError('weight_out_of_range', `weight ${String(weight)} is outside 0..1`);
  }
  return { source: source.id, target: target.id, type: assertCausalEdgeType(type), weight };
}

export interface Hop {
  readonly from: string;
  readonly to: string;
  readonly type: CausalEdgeType;
  readonly weight: number;
}

export type Direction = 'upstream' | 'downstream';

export interface ChainOptions {
  readonly direction: Direction;
  readonly maxDepth: number;
}

/**
 * Every simple path from `startId`, up to `maxDepth` hops.
 *
 * Cycle detection is **per path**, not global: a node already on the current path is not
 * revisited, but a node reached by one branch may still be reached by another. A global
 * visited set would return one arm of a diamond and silently drop the other, which is what
 * Semantica's comment warns about.
 */
export function findChains(
  edges: readonly CausalEdge[],
  startId: string,
  opts: ChainOptions,
): readonly (readonly Hop[])[] {
  if (!Number.isInteger(opts.maxDepth) || opts.maxDepth < 1) {
    throw new CausalError('invalid_max_depth', `maxDepth must be a positive integer, got ${String(opts.maxDepth)}`);
  }

  const out: Hop[][] = [];

  const step = (current: string, path: Hop[], onPath: ReadonlySet<string>): void => {
    if (path.length >= opts.maxDepth) {
      if (path.length > 0) out.push([...path]);
      return;
    }

    const next = edges.filter((e) =>
      opts.direction === 'downstream' ? e.source === current : e.target === current,
    );
    const advanced = next.filter((e) => {
      const other = opts.direction === 'downstream' ? e.target : e.source;
      return !onPath.has(other);
    });

    if (advanced.length === 0) {
      if (path.length > 0) out.push([...path]);
      return;
    }

    for (const e of advanced) {
      const other = opts.direction === 'downstream' ? e.target : e.source;
      // Hops always read source -> target, whichever way we walked, so a report is
      // readable without knowing which direction produced it.
      path.push({ from: e.source, to: e.target, type: e.type, weight: e.weight });
      step(other, path, new Set([...onPath, other]));
      path.pop();
    }
  };

  step(startId, [], new Set([startId]));
  return out;
}

/**
 * Distance bands, ported from `semantica/semantica/utils/helpers.py:586-605`.
 *
 * PROVENANCE: **declared placeholder.** The 1 / 3 / 6 boundaries are carried over from the
 * original, where they are the single source of truth for two consumers but are not derived
 * from any measurement. Nothing here has calibrated them. Calibrating needs the evaluation
 * harness, which is post-spine work.
 */
export function classifyDistance(hopCount: number): 'direct' | 'near' | 'mid-range' | 'distant' {
  if (hopCount <= 1) return 'direct';
  if (hopCount <= 3) return 'near';
  if (hopCount <= 6) return 'mid-range';
  return 'distant';
}

export interface ChainReport {
  readonly hops: readonly Hop[];
  readonly hopCount: number;
  /**
   * Product of the hop weights. Carries an **independence assumption** the chain generally
   * does not satisfy, so treat it as a lower bound rather than an estimate.
   */
  readonly productConfidence: number;
  /**
   * The lowest hop weight — the weakest-link reading. Assumption-free, and never below the
   * product. Reported alongside it rather than instead of it.
   */
  readonly weakestConfidence: number;
  /** The hop that produced `weakestConfidence`. `null` only for an empty chain. */
  readonly weakestLink: Hop | null;
  readonly distanceBand: ReturnType<typeof classifyDistance>;
}

/**
 * Summarise one chain.
 *
 * Two numbers, deliberately. See the module header and `docs/research/05-causal-chains.md`:
 * the product and the minimum encode different assumptions, the weights feeding them are
 * uncalibrated, and blending them into one figure would be false precision.
 */
export function chainReport(hops: readonly Hop[]): ChainReport {
  let product = 1;
  let weakest: Hop | null = null;

  for (const hop of hops) {
    // `hop.weight` is read directly. A stored 0 is meaningful and must not become 1.
    product *= hop.weight;
    if (weakest === null || hop.weight < weakest.weight) weakest = hop;
  }

  return {
    hops,
    hopCount: hops.length,
    productConfidence: hops.length === 0 ? 1 : product,
    weakestConfidence: weakest === null ? 1 : weakest.weight,
    weakestLink: weakest,
    distanceBand: classifyDistance(hops.length),
  };
}

/** Read a decision's content from the node. There is no second place to look. */
export function decisionContent(node: GraphNode): DecisionContent {
  if (!isDecision(node)) {
    throw new CausalError('not_a_decision', `node ${JSON.stringify(node.id)} has kind ${JSON.stringify(node.kind)}`);
  }
  return node.content as DecisionContent;
}
