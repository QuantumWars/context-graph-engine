/**
 * The harness: run an arm over the labelled set and report.
 *
 * An "arm" is any function from a query to a ranked list of ids. The real retrieval path is one
 * arm; the baselines are others. A number with nothing to compare it to is not a measurement,
 * which is why an arm interface exists at all rather than a single hardcoded run.
 */

import { lexicalChannel, retrieve, type Doc, type Link } from '../src/retrieval/channels';
import { CORPUS, EDGES, QUERIES, type EvalQuery } from './dataset';
import { aggregate, score, type Cased, type Report } from './metrics';

export const DOCS: readonly Doc[] = CORPUS.map((r) => ({ id: r.id, text: r.text }));
export const LINKS: readonly Link[] = EDGES.map((e) => ({ source: e.source, target: e.target }));

export interface ArmOptions {
  readonly k?: number;
  readonly rrfK?: number;
  readonly lexicalFloor?: number;
  readonly structuralFloor?: number;
}

export type Arm = (query: string, o: ArmOptions) => readonly string[];

/** The real path: lexical + structural, floored, fused, with the abstain decision intact. */
export const engineArm: Arm = (query, o) => {
  const opts: Parameters<typeof retrieve>[3] = { limit: o.k ?? 10 };
  const full = {
    ...opts,
    ...(o.lexicalFloor !== undefined ? { lexicalFloor: o.lexicalFloor } : {}),
    ...(o.structuralFloor !== undefined ? { structuralFloor: o.structuralFloor } : {}),
    ...(o.rrfK !== undefined ? { rrfK: o.rrfK } : {}),
  };
  return retrieve(DOCS, LINKS, query, full).items.map((i) => i.id);
};

/**
 * Baseline 1 — lexical only, no floor, no graph, no abstention.
 *
 * The simplest thing that could work. If the real path cannot beat this, the structural channel
 * and the fusion are costing complexity for nothing, and that is a finding about the engine.
 */
export const lexicalOnlyArm: Arm = (query, o) =>
  lexicalChannel(DOCS, query).results.slice(0, o.k ?? 10).map((r) => r.id);

/**
 * Baseline 2 — return everything, ranked arbitrarily but stably.
 *
 * Deliberately terrible. It exists to prove the metric discriminates: perfect recall, dreadful
 * precision, and a false serve on every query that should have abstained. A scoring function
 * that rates this well is broken.
 */
export const returnAllArm: Arm = (_query, o) =>
  DOCS.map((d) => d.id).slice(0, o.k ?? 10);

export interface ArmResult {
  readonly report: Report;
  readonly score: number;
  readonly perQuery: readonly { query: EvalQuery; returned: readonly string[] }[];
}

export function runArm(arm: Arm, o: ArmOptions = {}): ArmResult {
  const k = o.k ?? 10;
  const perQuery = QUERIES.map((q) => ({ query: q, returned: arm(q.query, { ...o, k }) }));
  const cases: Cased[] = perQuery.map(({ query, returned }) => ({
    returned,
    relevant: query.relevant,
    ...(query.irrelevant !== undefined ? { irrelevant: query.irrelevant } : {}),
  }));
  const report = aggregate(cases, k);
  return { report, score: score(report), perQuery };
}
