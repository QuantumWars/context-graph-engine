/** Mirrors the server's `GraphView`. Kept as a hand-written mirror rather than imported, because
 *  the browser bundle must not pull `engine/src/` — the dependency direction is one-way (DEC-020). */
export interface GraphNode {
  id: string; kind: string; label: string;
  validFrom: string | null; validUntil: string | null; recordedAt: string; purged: boolean;
}
export interface GraphEdge {
  id: string; source: string; target: string; type: string; weight: number; hasEvidence: boolean;
}
export interface GraphView {
  nodes: GraphNode[]; edges: GraphEdge[];
  chain: { valid: boolean; total: number; purged: number; problems: number };
}
export interface Evidence {
  edge: string; rule: string | null; source: string;
  quote: { ok: true; quote: string } | { ok: false; reason: string };
}
