import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import Sigma from 'sigma';
import type { Evidence, GraphEdge, GraphNode, GraphView } from './types';

const EDGE_COLOUR: Record<string, string> = {
  CAUSED: '#f7768e', INFLUENCED: '#e0af68', PRECEDENT_FOR: '#9ece6a',
};

/**
 * The explorer.
 *
 * Three views over one store, following what the research says a knowledge-graph UI actually needs:
 * a node-link diagram, **details-on-demand with provenance** when something is selected, and a
 * temporal control. Node-link clutters at hundreds of edges, so the filter is not decoration — it is
 * the scalability story.
 *
 * Everything here is read-only (`DEC-020`). There is no control that writes, because an assertion
 * into this store needs a caller who names it.
 */
export function App(): JSX.Element {
  const [view, setView] = useState<GraphView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [filter, setFilter] = useState('');
  const [asOf, setAsOf] = useState<number>(100);
  const [visibleAt, setVisibleAt] = useState<Set<string> | null>(null);

  const container = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => (r.ok ? r.json() : r.json().then((b) => Promise.reject(new Error(b.error)))))
      .then(setView)
      .catch((e: Error) => setError(e.message));
  }, []);

  // The time axis. `asOf` is a percentage across the recorded span, resolved to an instant and sent
  // to /api/at — the engine decides what was valid then, not the browser.
  const instants = useMemo(
    () => (view === null ? [] : [...new Set(view.nodes.map((n) => n.recordedAt))].sort()),
    [view],
  );
  const asOfInstant = useMemo(() => {
    if (instants.length === 0) return null;
    if (asOf >= 100) return null;                       // 100% means "now", no filtering
    const i = Math.min(instants.length - 1, Math.floor((asOf / 100) * instants.length));
    return instants[i] ?? null;
  }, [asOf, instants]);

  useEffect(() => {
    if (asOfInstant === null) { setVisibleAt(null); return; }
    fetch(`/api/at?validAt=${encodeURIComponent(asOfInstant)}`)
      .then((r) => r.json())
      .then((s: { nodes: string[] }) => setVisibleAt(new Set(s.nodes)))
      .catch(() => setVisibleAt(null));
  }, [asOfInstant]);

  const shown = useCallback((n: GraphNode): boolean => {
    if (filter !== '' && !`${n.id} ${n.label}`.toLowerCase().includes(filter.toLowerCase())) return false;
    if (visibleAt !== null && !visibleAt.has(n.id)) return false;
    return true;
  }, [filter, visibleAt]);

  useEffect(() => {
    if (view === null || container.current === null) return;

    const g = new Graph({ multi: true });
    for (const n of view.nodes) {
      if (!shown(n)) continue;
      g.addNode(n.id, {
        label: n.purged ? `${n.id} (purged)` : n.label.slice(0, 44),
        size: n.purged ? 6 : 10,
        color: n.purged ? '#4a4f5c' : n.kind === 'decision' ? '#bb9af7' : '#7aa2f7',
        x: Math.random(), y: Math.random(),
      });
    }
    for (const e of view.edges) {
      if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
      g.addEdgeWithKey(e.id, e.source, e.target, {
        label: e.type, size: e.hasEvidence ? 3 : 1.5,
        color: EDGE_COLOUR[e.type] ?? '#565f89', type: 'arrow',
      });
    }
    if (g.order > 0) forceAtlas2.assign(g, { iterations: 220, settings: { gravity: 1.2, scalingRatio: 14 } });

    sigmaRef.current?.kill();
    const s = new Sigma(g, container.current, {
      renderEdgeLabels: true,
      labelColor: { color: '#e6e9ef' },
      edgeLabelColor: { color: '#8b93a7' },
      defaultEdgeType: 'arrow',
    });
    s.on('clickNode', ({ node }) => { setSelected({ kind: 'node', id: node }); setEvidence(null); });
    s.on('clickEdge', ({ edge }) => { setSelected({ kind: 'edge', id: edge }); setEvidence(null); });
    s.on('clickStage', () => { setSelected(null); setEvidence(null); });
    sigmaRef.current = s;
    return () => { s.kill(); sigmaRef.current = null; };
  }, [view, shown]);

  // Details-on-demand: the quote behind an edge is fetched when asked for, never baked into the
  // graph payload — so a purge is reflected the moment it happens.
  useEffect(() => {
    if (selected?.kind !== 'edge') return;
    fetch(`/api/evidence?edge=${encodeURIComponent(selected.id)}`)
      .then((r) => r.json())
      .then(setEvidence)
      .catch(() => setEvidence(null));
  }, [selected]);

  const node = selected?.kind === 'node' ? view?.nodes.find((n) => n.id === selected.id) : undefined;
  const edge = selected?.kind === 'edge' ? view?.edges.find((e) => e.id === selected.id) : undefined;

  return (
    <div className="app">
      <header>
        <h1>Context Graph Explorer</h1>
        {view !== null && (
          <>
            <span className={`chip ${view.chain.valid ? 'ok' : 'bad'}`}>
              {view.chain.valid ? '✓ chain verifies' : `✗ ${view.chain.problems} problem(s)`}
            </span>
            <span className="chip">{view.chain.total} records</span>
            {view.chain.purged > 0 && <span className="chip">{view.chain.purged} purged</span>}
          </>
        )}
        <span className="chip">read-only</span>
        <div className="spacer" />
        <label>
          filter
          <input type="search" value={filter} placeholder="id or text"
                 onChange={(e) => setFilter(e.currentTarget.value)} />
        </label>
        <label>
          as of {asOfInstant === null ? 'now' : asOfInstant.slice(0, 10)}
          <input type="range" min={0} max={100} value={asOf}
                 onChange={(e) => setAsOf(Number(e.currentTarget.value))} />
        </label>
      </header>

      <div id="graph" ref={container} />

      <aside>
        {error !== null && <p className="warn">{error}</p>}
        {view === null && error === null && <p className="muted">loading…</p>}

        {selected === null && view !== null && (
          <>
            <h2>the store</h2>
            <dl>
              <dt>records</dt><dd>{view.chain.total}</dd>
              <dt>nodes shown</dt><dd>{view.nodes.filter(shown).length} of {view.nodes.length}</dd>
              <dt>edges</dt><dd>{view.edges.length}</dd>
              <dt>chain</dt>
              <dd className={view.chain.valid ? '' : 'warn'}>
                {view.chain.valid ? 'verifies' : `${view.chain.problems} problem(s)`}
              </dd>
            </dl>
            <p className="muted">Click a node or an edge. An edge with evidence is drawn thicker.</p>
            <div className="legend">
              <span><i className="dot" style={{ background: '#7aa2f7' }} />node</span>
              <span><i className="dot" style={{ background: '#bb9af7' }} />decision</span>
              <span><i className="dot" style={{ background: '#4a4f5c' }} />purged</span>
              <span><i className="dot" style={{ background: '#f7768e' }} />CAUSED</span>
              <span><i className="dot" style={{ background: '#e0af68' }} />INFLUENCED</span>
              <span><i className="dot" style={{ background: '#9ece6a' }} />PRECEDENT_FOR</span>
            </div>
          </>
        )}

        {node !== undefined && (
          <>
            <h2>{node.kind}</h2>
            <dl>
              <dt>id</dt><dd>{node.id}</dd>
              <dt>label</dt><dd>{node.purged ? <span className="warn">purged</span> : node.label}</dd>
              <dt>recorded</dt><dd>{node.recordedAt}</dd>
              <dt>valid from</dt><dd>{node.validFrom ?? <span className="muted">unbounded</span>}</dd>
              <dt>valid until</dt><dd>{node.validUntil ?? <span className="muted">unbounded</span>}</dd>
            </dl>
            {node.purged && (
              <p className="muted">
                The content was purged. The record, its digest and its place in the chain remain —
                that is what lets the chain still verify.
              </p>
            )}
          </>
        )}

        {edge !== undefined && (
          <>
            <h2>{edge.type}</h2>
            <dl>
              <dt>from</dt><dd>{edge.source}</dd>
              <dt>to</dt><dd>{edge.target}</dd>
              <dt>weight</dt><dd>{edge.weight}</dd>
            </dl>
            <h2>evidence</h2>
            {evidence === null && <p className="muted">asserted by hand — no span recorded</p>}
            {evidence !== null && (
              <>
                <dl>
                  <dt>rule</dt><dd>{evidence.rule ?? <span className="muted">none</span>}</dd>
                  <dt>read from</dt><dd>{evidence.source}</dd>
                </dl>
                {evidence.quote.ok
                  ? <blockquote>{evidence.quote.quote}</blockquote>
                  : (
                    <p className="warn">
                      unresolvable: {evidence.quote.reason}
                      {evidence.quote.reason === 'source_purged' && (
                        <span className="muted">
                          {' '}— the text this edge was read from has been erased, which is correct
                          and not a fault.
                        </span>
                      )}
                    </p>
                  )}
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
