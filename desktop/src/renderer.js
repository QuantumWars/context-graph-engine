// Canvas renderer with a hand-written force layout.
//
// The approach is ported from `project-graphx/app/src/renderer.js`, which has been run at 590 nodes
// and 2,288 edges — a scale this engine has never seen. Three details are taken deliberately,
// because each is the kind of thing found by watching a layout misbehave rather than by reasoning:
//
//   1. A MINIMUM-DISTANCE FLOOR under repulsion. `1/distSq` has a real singularity as two nodes
//      converge; without a floor the force goes to infinity and the graph explodes on the first
//      tick where two nodes land on the same point.
//   2. A PER-TICK SPEED CAP, independent of damping. Damping alone bounds the steady state, not a
//      single bad frame.
//   3. FILTER-AWARE PHYSICS. A node hidden by the filter must not shove visible nodes around, or
//      the filter stops being a real control and becomes a cosmetic one.
//
// DEC-021: everything here is read-only. `window.graph` exposes three `read:` channels and nothing
// else, so there is no path from this file to a write.

const MIN_DIST_SQ = 900;      // repulsion denominator floor — the singularity guard
const MAX_SPEED = 140;        // world units per tick, independent of DAMPING
const DAMPING = 0.86;
const REPULSION = 5200;
const SPRING = 0.012;
const HOME_PULL = 0.0016;     // keeps disconnected components from drifting off-screen

const EDGE_COLOUR = {
  CAUSED: '#f7768e',
  INFLUENCED: '#e0af68',
  PRECEDENT_FOR: '#9ece6a',
};
const NODE_COLOUR = { decision: '#bb9af7', node: '#7aa2f7' };
const PURGED = '#4a4f5c';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const panel = document.getElementById('panel');
const statusEl = document.getElementById('status');
const filterEl = document.getElementById('filter');

let view = null;
let nodes = [];
let edges = [];
let selected = null;
let filter = '';
let camera = { x: 0, y: 0, zoom: 1 };
let dragging = null;
let panning = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

const passesFilter = (n) =>
  filter === '' || `${n.id} ${n.label}`.toLowerCase().includes(filter.toLowerCase());

function load(v) {
  view = v;
  const spread = 260;
  nodes = v.nodes.map((n, i) => ({
    ...n,
    x: Math.cos((i / v.nodes.length) * Math.PI * 2) * spread + (Math.random() - 0.5) * 40,
    y: Math.sin((i / v.nodes.length) * Math.PI * 2) * spread + (Math.random() - 0.5) * 40,
    vx: 0, vy: 0,
    r: n.purged ? 6 : 11,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  edges = v.edges
    .map((e) => ({ ...e, a: byId.get(e.source), b: byId.get(e.target) }))
    .filter((e) => e.a && e.b);

  statusEl.innerHTML =
    `<span class="${v.chain.valid ? 'ok' : 'bad'}">${v.chain.valid ? '✓ chain verifies' : `✗ ${v.chain.problems} problem(s)`}</span>` +
    `<span class="chip">${v.chain.total} records</span>` +
    (v.chain.purged ? `<span class="chip">${v.chain.purged} purged</span>` : '') +
    `<span class="chip">${v.nodes.length} nodes · ${v.edges.length} edges</span>` +
    `<span class="chip">read-only</span>`;
  showSummary();
}

function tick() {
  // Only visible nodes take part. A hidden node keeps its position and exerts nothing — detail 3.
  const live = nodes.filter(passesFilter);

  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < MIN_DIST_SQ) {
        // Detail 1: the floor. Also nudge them apart deterministically when exactly coincident,
        // or dx/dy stay 0 and they never separate.
        if (distSq === 0) { dx = (i - j) || 1; dy = 1; }
        distSq = MIN_DIST_SQ;
      }
      const f = REPULSION / distSq;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
  }

  for (const e of edges) {
    if (!passesFilter(e.a) || !passesFilter(e.b)) continue;
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    e.a.vx += dx * SPRING; e.a.vy += dy * SPRING;
    e.b.vx -= dx * SPRING; e.b.vy -= dy * SPRING;
  }

  for (const n of live) {
    n.vx -= n.x * HOME_PULL; n.vy -= n.y * HOME_PULL;
    n.vx *= DAMPING; n.vy *= DAMPING;
    // Detail 2: the cap, applied after damping and independent of it.
    const speed = Math.hypot(n.vx, n.vy);
    if (speed > MAX_SPEED) { const s = MAX_SPEED / speed; n.vx *= s; n.vy *= s; }
    if (n !== dragging) { n.x += n.vx; n.y += n.vy; }
  }
}

const toScreen = (n) => ({
  x: n.x * camera.zoom + camera.x + canvas.clientWidth / 2,
  y: n.y * camera.zoom + camera.y + canvas.clientHeight / 2,
});

function draw() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  if (!view) return;

  for (const e of edges) {
    if (!passesFilter(e.a) || !passesFilter(e.b)) continue;
    const a = toScreen(e.a), b = toScreen(e.b);
    const isSel = selected && selected.kind === 'edge' && selected.id === e.id;
    ctx.strokeStyle = isSel ? '#ffffff' : (EDGE_COLOUR[e.type] || '#565f89');
    ctx.lineWidth = (e.hasEvidence ? 2.4 : 1.1) * (isSel ? 2 : 1);
    ctx.globalAlpha = isSel ? 1 : 0.75;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    // Arrowhead, placed short of the target so it does not vanish under the node.
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const tipX = b.x - Math.cos(ang) * (e.b.r * camera.zoom + 3);
    const tipY = b.y - Math.sin(ang) * (e.b.r * camera.zoom + 3);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(ang - 0.4) * 9, tipY - Math.sin(ang - 0.4) * 9);
    ctx.lineTo(tipX - Math.cos(ang + 0.4) * 9, tipY - Math.sin(ang + 0.4) * 9);
    ctx.fillStyle = ctx.strokeStyle; ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const n of nodes) {
    if (!passesFilter(n)) continue;
    const p = toScreen(n);
    const isSel = selected && selected.kind === 'node' && selected.id === n.id;
    ctx.beginPath();
    ctx.arc(p.x, p.y, n.r * camera.zoom, 0, Math.PI * 2);
    ctx.fillStyle = n.purged ? PURGED : (NODE_COLOUR[n.kind] || '#7aa2f7');
    ctx.fill();
    if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }

    if (camera.zoom > 0.55) {
      ctx.fillStyle = '#e6e9ef';
      ctx.font = '11px ui-sans-serif, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      const label = n.purged ? `${n.id} (purged)` : n.id;
      ctx.fillText(label.slice(0, 30), p.x, p.y + n.r * camera.zoom + 13);
    }
  }
}

function frame() { tick(); draw(); requestAnimationFrame(frame); }

// ── picking ───────────────────────────────────────────────────────────────────
function nodeAt(mx, my) {
  for (const n of nodes) {
    if (!passesFilter(n)) continue;
    const p = toScreen(n);
    if (Math.hypot(p.x - mx, p.y - my) <= n.r * camera.zoom + 4) return n;
  }
  return null;
}
function edgeAt(mx, my) {
  for (const e of edges) {
    if (!passesFilter(e.a) || !passesFilter(e.b)) continue;
    const a = toScreen(e.a), b = toScreen(e.b);
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L === 0) continue;
    const t = Math.max(0, Math.min(1, ((mx - a.x) * (b.x - a.x) + (my - a.y) * (b.y - a.y)) / (L * L)));
    const px = a.x + t * (b.x - a.x), py = a.y + t * (b.y - a.y);
    if (Math.hypot(px - mx, py - my) < 6) return e;
  }
  return null;
}

canvas.addEventListener('mousedown', (ev) => {
  const n = nodeAt(ev.offsetX, ev.offsetY);
  if (n) { dragging = n; selected = { kind: 'node', id: n.id }; showNode(n); return; }
  const e = edgeAt(ev.offsetX, ev.offsetY);
  if (e) { selected = { kind: 'edge', id: e.id }; showEdge(e); return; }
  selected = null; showSummary();
  panning = { x: ev.offsetX - camera.x, y: ev.offsetY - camera.y };
});
canvas.addEventListener('mousemove', (ev) => {
  if (dragging) {
    dragging.x = (ev.offsetX - camera.x - canvas.clientWidth / 2) / camera.zoom;
    dragging.y = (ev.offsetY - camera.y - canvas.clientHeight / 2) / camera.zoom;
    dragging.vx = 0; dragging.vy = 0;
  } else if (panning) {
    camera.x = ev.offsetX - panning.x; camera.y = ev.offsetY - panning.y;
  }
});
window.addEventListener('mouseup', () => { dragging = null; panning = null; });
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  camera.zoom = Math.max(0.2, Math.min(3, camera.zoom * (ev.deltaY < 0 ? 1.1 : 1 / 1.1)));
}, { passive: false });

filterEl.addEventListener('input', () => { filter = filterEl.value; });

// ── panel ─────────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function showSummary() {
  if (!view) return;
  panel.innerHTML = `
    <h2>the store</h2>
    <dl>
      <dt>records</dt><dd>${view.chain.total}</dd>
      <dt>nodes</dt><dd>${view.nodes.length}</dd>
      <dt>edges</dt><dd>${view.edges.length}</dd>
      <dt>chain</dt><dd class="${view.chain.valid ? 'ok' : 'bad'}">${view.chain.valid ? 'verifies' : view.chain.problems + ' problem(s)'}</dd>
    </dl>
    <p class="muted">Drag a node. Scroll to zoom. Drag the background to pan. An edge with evidence is drawn thicker.</p>
    <div class="legend">
      <span><i class="dot" style="background:#7aa2f7"></i>node</span>
      <span><i class="dot" style="background:#bb9af7"></i>decision</span>
      <span><i class="dot" style="background:#4a4f5c"></i>purged</span>
      <span><i class="dot" style="background:#f7768e"></i>CAUSED</span>
      <span><i class="dot" style="background:#e0af68"></i>INFLUENCED</span>
      <span><i class="dot" style="background:#9ece6a"></i>PRECEDENT_FOR</span>
    </div>`;
}

function showNode(n) {
  panel.innerHTML = `
    <h2>${esc(n.kind)}</h2>
    <dl>
      <dt>id</dt><dd>${esc(n.id)}</dd>
      <dt>label</dt><dd>${n.purged ? '<span class="bad">purged</span>' : esc(n.label)}</dd>
      <dt>recorded</dt><dd>${esc(n.recordedAt)}</dd>
      <dt>valid from</dt><dd>${n.validFrom ? esc(n.validFrom) : '<span class="muted">unbounded</span>'}</dd>
      <dt>valid until</dt><dd>${n.validUntil ? esc(n.validUntil) : '<span class="muted">unbounded</span>'}</dd>
    </dl>
    ${n.purged ? '<p class="muted">The content was purged. The record, its digest and its place in the chain remain — that is what lets the chain still verify.</p>' : ''}`;
}

function showEdge(e) {
  panel.innerHTML = `
    <h2>${esc(e.type)}</h2>
    <dl>
      <dt>from</dt><dd>${esc(e.source)}</dd>
      <dt>to</dt><dd>${esc(e.target)}</dd>
      <dt>weight</dt><dd>${esc(e.weight)}</dd>
      <dt>evidence</dt><dd>${e.hasEvidence ? 'a span was recorded' : '<span class="muted">asserted by hand</span>'}</dd>
    </dl>
    ${e.hasEvidence ? '<p class="muted">The quote is resolved from the source record on demand, so a purge is reflected immediately.</p>' : ''}`;
}

// ── boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  resize();
  const { workspace } = await window.graph.workspace();
  document.getElementById('ws').textContent = workspace || 'no workspace';
  const v = await window.graph.read();
  if (v.error) {
    panel.innerHTML = `<h2>cannot read</h2><p class="bad">${esc(v.error)}</p>
      <p class="muted">Choose the folder that contains <code>.claude/graph-engine/log.jsonl</code>.</p>`;
  } else {
    load(v);
  }
  frame();
}

document.getElementById('choose').addEventListener('click', async () => {
  const { workspace } = await window.graph.chooseWorkspace();
  document.getElementById('ws').textContent = workspace || 'no workspace';
  const v = await window.graph.read();
  if (!v.error) load(v);
});

boot();
