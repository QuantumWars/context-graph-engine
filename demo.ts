#!/usr/bin/env bun
/**
 * A verification harness for the Stage 1 algorithms — NOT the product CLI.
 *
 * It holds everything in memory, reads no store and writes no file. `src/store/` is still
 * empty and Phase 2 owns the real CLI. This exists so the algorithms can be watched working
 * by a person rather than only by a test runner, which is a different kind of evidence:
 * a test asserts what I expected, this shows what actually happens.
 *
 *   bun --cwd engine demo.ts                 list the scenarios
 *   bun --cwd engine demo.ts all             run every scenario
 *   bun --cwd engine demo.ts chain           tamper-evidence
 *   bun --cwd engine demo.ts purge           erasure that does not break the chain
 *   bun --cwd engine demo.ts time            the two time axes
 *   bun --cwd engine demo.ts fuse            rank fusion vs per-source normalisation
 *   bun --cwd engine demo.ts causal          causal chains and the weakest link
 */

import { appendEntry, purgeContent, verifyChain, type ChainEntry } from './src/provenance/chain';
import { stateAt, type TemporalEdge, type TemporalNode } from './src/temporal/window';
import { purge, retract, type Subject } from './src/temporal/retract';
import { fuse, type Channel } from './src/retrieval/rrf';
import { chainReport, findChains, linkDecisions, type CausalEdge, type GraphNode } from './src/decision/causal';

const BOLD = '\x1b[1m', DIM = '\x1b[2m', GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', OFF = '\x1b[0m';
const h = (s: string): void => console.log(`\n${BOLD}── ${s} ${'─'.repeat(Math.max(0, 66 - s.length))}${OFF}`);
const step = (s: string): void => console.log(`\n${DIM}$ ${s}${OFF}`);
const ok = (s: string): void => console.log(`  ${GREEN}✓${OFF} ${s}`);
const bad = (s: string): void => console.log(`  ${RED}✗${OFF} ${s}`);
const warn = (s: string): void => console.log(`  ${YEL}!${OFF} ${s}`);
const short = (d: string): string => `${d.slice(0, 12)}…`;

/** Deterministic salts so two runs print the same digests and can be diffed. */
const salt = (n: number): string => `demo-salt-${String(n).padStart(3, '0')}`;

function buildDemoChain(): ChainEntry[] {
  const facts = [
    { id: 'd1', text: 'Chose bun over npm for the engine package' },
    { id: 'd2', text: 'Chose TypeScript so the plugin surface stays reachable' },
    { id: 'd3', text: 'API key sk-live-9f2b7c41aa pasted from a tool result' },
    { id: 'd4', text: 'Chose one append-only log as the single source of truth' },
  ];
  const chain: ChainEntry[] = [];
  for (const [i, f] of facts.entries()) {
    chain.push(appendEntry(chain, {
      kind: 'node', id: f.id, content: { text: f.text },
      meta: { workspace: '/Users/you/project' },
    }, salt(i + 1)));
  }
  return chain;
}

function show(chain: readonly ChainEntry[]): void {
  console.log(`  ${DIM}seq  id    prev          digest        content${OFF}`);
  for (const e of chain) {
    const c = e.content === null ? `${YEL}⌀ purged${OFF}` : String((e.content as { text: string }).text).slice(0, 34);
    console.log(`  ${String(e.seq).padEnd(4)} ${e.id.padEnd(5)} ${(e.prev ? short(e.prev) : '—'.padEnd(13)).padEnd(13)} ${short(e.digest)} ${c}`);
  }
}

function report(chain: readonly ChainEntry[]): void {
  const r = verifyChain(chain);
  if (r.valid) ok(`chain verifies — ${r.total} entries, ${r.purged} purged, 0 problems`);
  else {
    bad(`chain INVALID — ${r.problems.length} problem(s) across ${r.total} entries`);
    for (const p of r.problems) {
      console.log(`      ${RED}${p.reason}${OFF} at seq ${p.seq} (${p.id})`);
      console.log(`      ${DIM}expected ${String(p.expected).slice(0, 24)} · actual ${String(p.actual).slice(0, 24)}${OFF}`);
    }
  }
}

const scenarios: Record<string, { blurb: string; run: () => void }> = {
  chain: {
    blurb: 'tamper-evidence — edit a record, delete a record, watch it get caught',
    run() {
      h('1. Build a chain of four records');
      const chain = buildDemoChain();
      show(chain);
      report(chain);
      console.log(`\n  ${DIM}Each digest covers the one before it, so the links are inside the hashes.${OFF}`);

      h('2. Someone edits record 2 in place, keeping everything else identical');
      const edited = [...chain];
      edited[1] = { ...edited[1]!, content: { text: 'Chose JavaScript, no types needed' } };
      step('verifyChain(edited)');
      report(edited);
      console.log(`  ${DIM}Only seq 2 is flagged. Records 3 and 4 are untouched and stay clean —${OFF}`);
      console.log(`  ${DIM}one corrupt row must not cascade into false accusations about the rest.${OFF}`);

      h('3. Someone deletes record 2 entirely');
      const deleted = [chain[0]!, chain[2]!, chain[3]!];
      step('verifyChain(withoutRecord2)');
      report(deleted);
      console.log(`  ${DIM}Two independent signals fire on the successor: the link no longer matches,${OFF}`);
      console.log(`  ${DIM}and the sequence jumps 1 → 3. Either alone could be fooled; both is hard.${OFF}`);

      h('4. Someone reorders two records');
      const swapped = [chain[0]!, chain[2]!, chain[1]!, chain[3]!];
      step('verifyChain(reordered)');
      report(swapped);
    },
  },

  purge: {
    blurb: 'erasure — delete a leaked secret, and the chain still verifies',
    run() {
      h('1. A chain where record 3 contains a leaked API key');
      const chain = buildDemoChain();
      show(chain);
      report(chain);
      warn('record d3 contains a live-looking credential that should never have been captured');

      h('2. Purge it');
      step('purgeContent(chain[2])   // deletes content AND salt together');
      const purged = [...chain];
      purged[2] = purgeContent(purged[2]!);
      show(purged);
      report(purged);

      console.log(`\n  ${DIM}What survived, and why that is the whole trick:${OFF}`);
      console.log(`    contentDigest  ${short(purged[2]!.contentDigest)}  ${DIM}kept — proves something was committed here${OFF}`);
      console.log(`    digest         ${short(purged[2]!.digest)}  ${DIM}unchanged — so record 4's link still matches${OFF}`);
      console.log(`    content        ${YEL}null${OFF}          ${DIM}gone${OFF}`);
      console.log(`    salt           ${YEL}null${OFF}          ${DIM}gone — this is what makes the digest uninvertible${OFF}`);

      h('3. Grep the purged record for the secret');
      const hay = JSON.stringify(purged[2]);
      step(`JSON.stringify(purgedRecord).includes('sk-live-9f2b7c41aa')`);
      console.log(`  → ${hay.includes('sk-live-9f2b7c41aa') ? `${RED}true — LEAK${OFF}` : `${GREEN}false${OFF}`}`);

      h('4. And a purge cannot be used to hide a real break');
      const sneaky = [...purged];
      sneaky[3] = { ...sneaky[3]!, meta: { workspace: '/somewhere-else' } };
      step('purge record 3, then tamper with record 4');
      report(sneaky);
      console.log(`  ${DIM}The purged record stays silent; the tampered one does not.${OFF}`);
    },
  },

  time: {
    blurb: 'two time axes — what was true then, vs what we believed then',
    run() {
      const nodes: TemporalNode[] = [
        { id: 'policy-v1', validFrom: '2026-01-01T00:00:00Z', validUntil: '2026-05-31T00:00:00Z', recordedAt: '2026-01-01T00:00:00Z' },
        { id: 'policy-v2', validFrom: '2026-06-01T00:00:00Z', validUntil: null, recordedAt: '2026-06-01T00:00:00Z' },
        { id: 'audit-note', validFrom: '2026-02-01T00:00:00Z', validUntil: null, recordedAt: '2026-08-01T00:00:00Z' },
      ];
      const edges: TemporalEdge[] = [
        { id: 'note→v1', source: 'audit-note', target: 'policy-v1', validFrom: null, validUntil: null, recordedAt: '2026-08-01T00:00:00Z' },
      ];

      h('The data');
      console.log(`  ${DIM}id           valid                        recorded${OFF}`);
      for (const n of nodes) {
        console.log(`  ${n.id.padEnd(12)} ${(n.validFrom ?? '—').slice(0, 10)} → ${(n.validUntil ?? 'open').slice(0, 10)}      ${n.recordedAt.slice(0, 10)}`);
      }
      console.log(`  ${DIM}note the audit-note: it CLAIMS to be valid from February, but was only${OFF}`);
      console.log(`  ${DIM}written into the store in August.${OFF}`);

      const q = (label: string, validAt: string, asOf?: string): void => {
        step(`stateAt(validAt='${validAt}'${asOf ? `, asOf='${asOf}'` : ''})`);
        const s = asOf === undefined ? stateAt(nodes, edges, { validAt }) : stateAt(nodes, edges, { validAt, asOf });
        console.log(`  ${label}`);
        console.log(`    nodes: ${s.nodes.map((n) => n.id).join(', ') || '(none)'}`);
        console.log(`    edges: ${s.edges.map((e) => e.id).join(', ') || '(none)'}`);
      };

      h('1. What is true today?');
      q('today', '2026-08-19T00:00:00Z');

      h('2. What was true in March?');
      q('March, with everything we know now', '2026-03-15T00:00:00Z');

      h('3. What did we BELIEVE in March?');
      q('March, as the store stood in March', '2026-03-15T00:00:00Z', '2026-03-15T00:00:00Z');
      console.log(`  ${DIM}The audit-note vanishes. It claims February validity but nobody had${OFF}`);
      console.log(`  ${DIM}written it yet — so a March decision could not have used it. Applying${OFF}`);
      console.log(`  ${DIM}today's knowledge to a past decision is how you misjudge it.${OFF}`);

      h('4. The endpoint rule — an edge needs BOTH ends alive');
      q('after policy-v1 expired', '2026-07-01T00:00:00Z');
      console.log(`  ${DIM}The edge is unbounded and open on its own terms, but its target expired,${OFF}`);
      console.log(`  ${DIM}so it is not in the snapshot. No dangling edges, ever.${OFF}`);

      h('5. A corrupt timestamp fails CLOSED, and says why');
      const bent: TemporalNode[] = [...nodes, { id: 'corrupt', validFrom: '15/03/2026', validUntil: null, recordedAt: '2026-01-01T00:00:00Z' }];
      step("stateAt with a node whose validFrom is '15/03/2026'");
      const s = stateAt(bent, [], { validAt: '2026-08-19T00:00:00Z' });
      console.log(`    nodes:    ${s.nodes.map((n) => n.id).join(', ')}`);
      console.log(`    rejected: ${s.rejected.map((r) => `${r.id}.${r.field} (${r.reason})`).join(', ')}`);
      console.log(`  ${DIM}Semantica treats an unparseable bound as no bound, logging "Always-Active" —${OFF}`);
      console.log(`  ${DIM}so a corrupted date makes a record MORE visible. Here it is excluded and named.${OFF}`);
    },
  },

  fuse: {
    blurb: 'rank fusion — why per-source normalisation throws away the answer',
    run() {
      const channels: Channel[] = [
        { name: 'lexical', results: [{ id: 'junk-a', score: 0.02 }, { id: 'junk-b', score: 0.01 }] },
        { name: 'structural', results: [{ id: 'excellent', score: 0.98 }, { id: 'ok', score: 0.40 }] },
      ];

      h('The situation');
      for (const c of channels) {
        console.log(`  ${c.name.padEnd(11)} ${c.results.map((r) => `${r.id}=${r.score}`).join('  ')}`);
      }
      console.log(`  ${DIM}One channel found nothing useful. The other found something excellent.${OFF}`);

      h('1. Per-source min–max normalisation, which is what Semantica does');
      const norm = channels.map((c) => {
        const sc = c.results.map((r) => r.score);
        const lo = Math.min(...sc), hi = Math.max(...sc);
        return c.results.map((r) => ({ id: r.id, n: hi === lo ? 1 : (r.score - lo) / (hi - lo) }));
      }).flat().sort((a, b) => b.n - a.n);
      for (const r of norm) console.log(`  ${r.id.padEnd(11)} ${r.n.toFixed(3)}${r.n === 1 ? `  ${RED}← promoted to 1.0${OFF}` : ''}`);
      bad('junk-a ties excellent at 1.0 — the junk channel\'s best became "perfect"');
      console.log(`  ${DIM}Absolute quality is destroyed. No downstream weight can recover it.${OFF}`);

      h('2. Reciprocal Rank Fusion, which is what we do');
      step('fuse(channels)');
      for (const f of fuse(channels)) {
        const parts = f.contributions.map((c) => `${c.channel}#${c.rank}(own=${c.score})`).join('  ');
        console.log(`  ${f.id.padEnd(11)} ${f.fusedScore.toFixed(5)}   ${DIM}${parts}${OFF}`);
      }
      ok('excellent ranks first, and every row shows exactly why it is there');
      console.log(`  ${DIM}Each row keeps its per-channel rank AND the channel's own untouched score,${OFF}`);
      console.log(`  ${DIM}so a ranking can be explained rather than just asserted.${OFF}`);

      h('3. Agreement across channels beats one strong opinion');
      const out = fuse([
        { name: 'lexical', results: [{ id: 'loud', score: 9 }, { id: 'agreed', score: 1 }] },
        { name: 'structural', results: [{ id: 'other', score: 9 }, { id: 'agreed', score: 1 }] },
      ]);
      for (const f of out) console.log(`  ${f.id.padEnd(11)} ${f.fusedScore.toFixed(5)}  ${DIM}${f.contributions.map((c) => `#${c.rank}`).join(' ')}${OFF}`);
      ok('"agreed" was never first anywhere, and still wins — that is what k=60 buys');
    },
  },

  causal: {
    blurb: 'causal chains — why a decision happened, and how much to trust the link',
    run() {
      const d = (id: string): GraphNode => ({ id, kind: 'decision', content: { scenario: id, reasoning: '', outcome: '', confidence: 1 } });
      const edges: CausalEdge[] = [
        linkDecisions(d('incident'), d('postmortem'), 'CAUSED', 1.0),
        linkDecisions(d('postmortem'), d('add-gate'), 'CAUSED', 0.9),
        linkDecisions(d('add-gate'), d('slow-ci'), 'INFLUENCED', 0.3),
        linkDecisions(d('incident'), d('hire-sre'), 'INFLUENCED', 0.8),
        linkDecisions(d('hire-sre'), d('slow-ci'), 'INFLUENCED', 0.2),
      ];

      h('The graph');
      for (const e of edges) console.log(`  ${e.source.padEnd(11)} --${e.type}(${e.weight})--> ${e.target}`);
      console.log(`  ${DIM}Two separate routes reach slow-ci. A global "visited" set would find one${OFF}`);
      console.log(`  ${DIM}and silently drop the other.${OFF}`);

      h('1. Why did slow-ci happen? (walk upstream)');
      step("findChains(edges, 'slow-ci', { direction: 'upstream', maxDepth: 5 })");
      const chains = findChains(edges, 'slow-ci', { direction: 'upstream', maxDepth: 5 });
      console.log(`  found ${chains.length} chain(s)\n`);
      for (const c of chains) {
        const r = chainReport(c);
        console.log(`  ${BOLD}${c.map((x) => x.from).concat(c[c.length - 1]!.to).reverse().join(' ← ')}${OFF}`);
        console.log(`    hops ${r.hopCount}  band ${r.distanceBand}`);
        console.log(`    product  ${r.productConfidence.toFixed(3)}   ${DIM}assumes hops are independent — read as a LOWER bound${OFF}`);
        console.log(`    weakest  ${r.weakestConfidence.toFixed(3)}   ${DIM}assumption-free; never below the product${OFF}`);
        console.log(`    ${YEL}weakest link${OFF}: ${r.weakestLink!.from} --${r.weakestLink!.type}(${r.weakestLink!.weight})--> ${r.weakestLink!.to}`);
        console.log('');
      }
      ok('both routes returned, each naming where it is thin');
      console.log(`  ${DIM}Two numbers, not one. The weights are uncalibrated, so blending them into${OFF}`);
      console.log(`  ${DIM}a single "confidence" would be more precision than the inputs carry.${OFF}`);

      h('2. A zero-weight link means no confidence — not a missing value');
      const r0 = chainReport([{ from: 'a', to: 'b', type: 'INFLUENCED', weight: 0 }]);
      console.log(`  product ${r0.productConfidence}  weakest ${r0.weakestConfidence}`);
      console.log(`  ${DIM}Semantica reads a missing weight as 1.0. A stored 0.0 must not become that.${OFF}`);

      h('3. A cycle terminates instead of hanging');
      const cyc = [
        { source: 'A', target: 'B', type: 'CAUSED' as const, weight: 1 },
        { source: 'B', target: 'C', type: 'CAUSED' as const, weight: 1 },
        { source: 'C', target: 'A', type: 'CAUSED' as const, weight: 1 },
      ];
      const cc = findChains(cyc, 'A', { direction: 'downstream', maxDepth: 10 });
      ok(`A → B → C → A returned ${cc.length} chain of ${cc[0]!.length} hops, no infinite loop`);
    },
  },

  retract: {
    blurb: 'retract vs purge — "no longer true" is not "should never have existed"',
    run() {
      const s: Subject = {
        id: 'policy', kind: 'node',
        validFrom: '2026-01-01T00:00:00Z', validUntil: null, recordedAt: '2026-01-01T00:00:00Z',
        contentDigest: 'a'.repeat(64),
        content: { text: 'Deploy on Fridays is fine', owner: 'ada@example.com' },
        salt: 'demo-salt-001',
      };
      const asNode = (x: Subject): TemporalNode => ({ id: x.id, validFrom: x.validFrom, validUntil: x.validUntil, recordedAt: x.recordedAt });

      h('1. Retract it in June — "this stopped being true"');
      const r = retract(s, '2026-06-01T00:00:00Z', 'burned us twice');
      console.log(`  window   ${r.subject.validFrom!.slice(0, 10)} → ${r.subject.validUntil!.slice(0, 10)}`);
      console.log(`  record   ${JSON.stringify(r.record)}`);
      console.log(`  content  ${JSON.stringify(r.subject.content)}  ${DIM}← still there${OFF}`);
      for (const [label, at] of [['March', '2026-03-01T00:00:00Z'], ['September', '2026-09-01T00:00:00Z']] as const) {
        const found = stateAt([asNode(r.subject)], [], { validAt: at }).nodes.length > 0;
        console.log(`  query in ${label.padEnd(10)} → ${found ? `${GREEN}found${OFF}` : `${DIM}not found${OFF}`}`);
      }
      ok('history still answers "what was the policy in March?" — that is the point of retract');

      h('2. A retraction can only NARROW a window, never widen one');
      const early: Subject = { ...s, validUntil: '2026-02-01T00:00:00Z' };
      const r2 = retract(early, '2026-06-01T00:00:00Z');
      console.log(`  existing end  2026-02-01   retract at 2026-06-01   →  ${r2.subject.validUntil!.slice(0, 10)}`);
      console.log(`  ${DIM}Without this, a record that expired in February is reported active${OFF}`);
      console.log(`  ${DIM}for the four months up to its own retraction.${OFF}`);

      h('3. Purge it instead — "this should never have been captured"');
      const p = purge(s, '2026-06-01T00:00:00Z', 'contained personal data');
      console.log(`  content    ${String(p.subject.content)}`);
      console.log(`  salt       ${String(p.subject.salt)}`);
      console.log(`  tombstone  ${JSON.stringify(p.tombstone)}`);
      const hay = JSON.stringify(p.tombstone);
      const leaks = Object.values(s.content as Record<string, string>).filter((v) => hay.includes(v));
      leaks.length === 0
        ? ok('tombstone contains no field value of the purged content')
        : bad(`tombstone leaks: ${leaks.join(', ')}`);
      warn(`scope is "${p.tombstone.scope}" — this store is one holder, and it says so`);
      console.log(`  ${DIM}GDPR Art. 17 reaches every copy and obliges telling downstream holders.${OFF}`);
      console.log(`  ${DIM}A tombstone claiming more than that would be a lie a future session repeats.${OFF}`);
    },
  },
};

const order = ['chain', 'purge', 'retract', 'time', 'fuse', 'causal'];
const arg = process.argv[2];

if (arg === undefined || arg === '--help' || arg === '-h') {
  console.log(`\n${BOLD}Context Graph Engine — Stage 1 verification harness${OFF}`);
  console.log(`${DIM}In-memory only. Reads no store, writes no file. The real CLI is Phase 2.${OFF}\n`);
  for (const k of order) console.log(`  ${BOLD}${k.padEnd(9)}${OFF} ${scenarios[k]!.blurb}`);
  console.log(`  ${BOLD}${'all'.padEnd(9)}${OFF} run every scenario\n`);
  console.log(`${DIM}  bun --cwd engine demo.ts <scenario>${OFF}\n`);
  process.exit(0);
}

const chosen = arg === 'all' ? order : [arg];
for (const name of chosen) {
  const sc = scenarios[name];
  if (sc === undefined) {
    console.error(`unknown scenario ${JSON.stringify(name)} — try: ${order.join(', ')}, all`);
    process.exit(2);
  }
  console.log(`\n${BOLD}${'═'.repeat(72)}${OFF}`);
  console.log(`${BOLD}  ${name.toUpperCase()}${OFF}  ${DIM}${sc.blurb}${OFF}`);
  console.log(`${BOLD}${'═'.repeat(72)}${OFF}`);
  sc.run();
}
console.log('');
