#!/usr/bin/env bun
/**
 * The MCP surface — the only directory in this engine permitted a third-party import.
 *
 * `DEC-011` fixes the boundary and what it costs. This file **contains no algorithm and no
 * storage logic**: it parses a request, dispatches to code that already exists and is already
 * tested, and serialises the result. A defect here must not be able to produce a wrong record.
 *
 * `DEC-003` still holds at this boundary: a tool argument is untrusted input, no stored string
 * selects a code path, and every schema below is a closed shape validated before anything runs.
 *
 * Workspace resolution is deliberately the same as the CLI's, which means it **throws rather than
 * guessing** when nothing says which project this is (`DEC-002`). An MCP server that silently
 * answered from the wrong project's store would be the worst possible version of that bug,
 * because nobody is watching a subprocess's working directory.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { Store, StoreError } from '../src/store/store';
import { resolveWorkspace, storePaths, WorkspaceError } from '../src/store/paths';
import { readLog } from '../src/store/log';
import { retrieve, type Doc, type Link } from '../src/retrieval/channels';
import { assertCausalEdgeType } from '../src/decision/causal';
import { chainPath } from '../src/decision/path';

const ISO = z.string().describe('ISO-8601 instant with an explicit offset, or a YYYY-MM-DD date');

function paths() {
  return storePaths(resolveWorkspace({ env: process.env, startDir: process.cwd() }));
}

/** Every tool returns text. Errors carry their reason code and never a stack frame. */
function ok(body: unknown) {
  return { content: [{ type: 'text' as const, text: typeof body === 'string' ? body : JSON.stringify(body, null, 2) }] };
}
function fail(e: unknown) {
  const msg = e instanceof StoreError || e instanceof WorkspaceError || e instanceof Error
    ? e.message : String(e);
  return { content: [{ type: 'text' as const, text: `error: ${msg}` }], isError: true };
}

const server = new McpServer({ name: 'context-graph-engine', version: '0.1.0' });

server.registerTool('record', {
  title: 'Record a decision or a note',
  description:
    'Append one record to the context graph. Use kind "decision" for something that was decided ' +
    'and "node" for a fact or note. The record is immutable once written and becomes part of a ' +
    'tamper-evident chain. Give validFrom when the fact became true in the world, which is not ' +
    'the same as now.',
  inputSchema: {
    id: z.string().min(1).describe('stable identifier, unique in this store'),
    text: z.string().min(1).describe('the content. Do not put credentials here.'),
    kind: z.enum(['decision', 'node']).default('node'),
    validFrom: ISO.optional(), validUntil: ISO.optional(),
  },
}, async ({ id, text, kind, validFrom, validUntil }) => {
  try {
    const s = await Store.open(paths());
    const r = await s.append({ kind, id, content: { text }, validFrom: validFrom ?? null, validUntil: validUntil ?? null });
    return ok({ recorded: r.id, kind: r.kind, seq: r.seq, digest: r.digest.slice(0, 16) });
  } catch (e) { return fail(e); }
});

server.registerTool('link', {
  title: 'Link two decisions causally',
  description:
    'Assert that one decision CAUSED, INFLUENCED, or is a PRECEDENT_FOR another. These are what ' +
    'a caller asserted, as distinct from anything inferred — only asserted edges are traversed by ' +
    '"why". Weight is 0..1 and a weight of 0 means the link carries no confidence, which is not ' +
    'the same as leaving it out.',
  inputSchema: {
    source: z.string().min(1), target: z.string().min(1),
    type: z.enum(['CAUSED', 'INFLUENCED', 'PRECEDENT_FOR']),
    weight: z.number().min(0).max(1).default(1),
  },
}, async ({ source, target, type, weight }) => {
  try {
    const s = await Store.open(paths());
    const edgeType = assertCausalEdgeType(type);
    const r = await s.append({
      kind: 'edge', id: `${source}->${target}:${edgeType}`, content: {},
      source, target, edgeType, weight,
    });
    return ok({ linked: `${source} --${edgeType}(${weight})--> ${target}`, seq: r.seq });
  } catch (e) { return fail(e); }
});

server.registerTool('retract', {
  title: 'Retract — this is no longer true',
  description:
    'Close a record\'s validity window. The content stays and history still answers for it, so a ' +
    'point-in-time query before the retraction still returns it. Give "at" as the instant the ' +
    'fact stopped being true, which is usually not now. Use purge instead if it should never ' +
    'have been captured.',
  inputSchema: { id: z.string().min(1), reason: z.string().optional(), at: ISO.optional() },
}, async ({ id, reason, at }) => {
  try {
    const s = await Store.open(paths());
    const r = await s.retract(id, reason ?? null, at);
    return ok({ retracted: id, windowClosedAt: r.meta.validFrom, recordedAt: r.meta.recordedAt, contentKept: true });
  } catch (e) { return fail(e); }
});

server.registerTool('purge', {
  title: 'Purge — this should never have been captured',
  description:
    'Remove a record\'s content from the store and leave a tombstone. Irreversible: afterwards ' +
    'nobody can prove what the content was, only that something was committed here and removed. ' +
    'The chain still verifies. Reaches this store only — a copy something else made is not reached.',
  inputSchema: { id: z.string().min(1), reason: z.string().optional() },
}, async ({ id, reason }) => {
  try {
    const s = await Store.open(paths());
    const t = await s.purge(id, reason ?? null);
    return ok({ purged: id, purgedAt: t.meta.purgedAt ?? t.meta.recordedAt, scope: t.meta.scope,
      warning: 'this store only; copies elsewhere are not reached' });
  } catch (e) { return fail(e); }
});

server.registerTool('at', {
  title: 'Point-in-time snapshot',
  description:
    'What was true at validAt. Give asOf as well to ask a different question: what the store ' +
    'BELIEVED at that moment, ignoring anything recorded later. That second axis is what explains ' +
    'a past decision — a decision made in March was not wrong because April corrected the record.',
  inputSchema: { validAt: ISO, asOf: ISO.optional() },
}, async ({ validAt, asOf }) => {
  try {
    const s = await Store.open(paths());
    const snap = asOf === undefined ? s.stateAt(validAt) : s.stateAt(validAt, asOf);
    return ok({ validAt: snap.validAt, asOf: snap.asOf,
      nodes: snap.nodes.map((n) => n.id), edges: snap.edges.map((e) => e.id), rejected: snap.rejected });
  } catch (e) { return fail(e); }
});

server.registerTool('why', {
  title: 'Why was this decided',
  description:
    'Walk the causal chain from a decision. Returns every path with two confidence numbers, ' +
    'deliberately not blended: product assumes the hops are independent and is a lower bound, ' +
    'weakest is the weakest-link reading and assumes nothing. The weakest hop is named so you can ' +
    'see where the chain is thin rather than only that it is.',
  inputSchema: {
    id: z.string().min(1),
    direction: z.enum(['upstream', 'downstream']).default('upstream'),
    depth: z.number().int().min(1).max(20).default(5),
  },
}, async ({ id, direction, depth }) => {
  try {
    const s = await Store.open(paths());
    const chains = s.why(id, direction, depth);
    return ok(chains.map((c) => ({
      path: chainPath(c.hops, direction),
      hops: c.hopCount, band: c.distanceBand,
      productConfidence: c.productConfidence, weakestConfidence: c.weakestConfidence,
      weakestLink: c.weakestLink,
    })));
  } catch (e) { return fail(e); }
});

server.registerTool('find', {
  title: 'Find precedent',
  description:
    'Retrieve across a lexical and a structural channel. Returns the decision record as well as ' +
    'the results: what was considered, what was served, and each channel\'s top score, floor and ' +
    'margin. An empty result with outcome "abstained" is a deliberate answer, not a failure — ' +
    'read the reason.',
  inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) },
}, async ({ query, limit }) => {
  try {
    const s = await Store.open(paths());
    const docs: Doc[] = s.searchable().map((d) => ({ id: d.id, text: d.text }));
    const links: Link[] = s.listEdges().map((e) => ({ source: String(e.meta.source), target: String(e.meta.target) }));
    const { decision, items } = retrieve(docs, links, query, { limit });
    await s.recordRetrieval(decision);
    return ok({ outcome: decision.outcome, reason: decision.reason, channels: decision.channels,
      results: items.map((i) => ({ id: i.id, fusedScore: i.fusedScore, contributions: i.contributions })) });
  } catch (e) { return fail(e); }
});

server.registerTool('verify', {
  title: 'Verify the chain',
  description:
    'Check every record: content commitment, self-digest, chain link and sequence contiguity. ' +
    'Detects edits, deletions, reordering and replay. Does NOT detect records truncated off the ' +
    'end, or a wholesale rewrite by someone holding the code — the chain proves what is present ' +
    'has not been altered, not that everything ever written is still present.',
  inputSchema: {},
}, async () => {
  try {
    const s = await Store.open(paths());
    return ok(s.verify());
  } catch (e) { return fail(e); }
});

server.registerTool('log', {
  title: 'List the records',
  description: 'Every record in append order, with its kind, sequence and whether it has been purged.',
  inputSchema: { limit: z.number().int().min(1).max(500).default(100) },
}, async ({ limit }) => {
  try {
    const raw = readLog(paths()).slice(-limit);
    return ok(raw.map((r) => ({ seq: r.seq, kind: r.kind, id: r.id,
      purged: r.content === null, digest: r.digest.slice(0, 16) })));
  } catch (e) { return fail(e); }
});

await server.connect(new StdioServerTransport());
