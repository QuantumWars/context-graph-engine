#!/usr/bin/env bun
/**
 * The explorer's read-only HTTP surface.
 *
 * `DEC-020`. Every route is a `GET`; there is no path here that appends, merges, confirms, retracts
 * or purges. The engine's posture is that an assertion needs a caller who names it — `DEC-012` for
 * identity, `DEC-013` for an extracted edge, `DEC-014` for a link — and a browser button puts those
 * behind a click by someone who did not see the reasoning.
 *
 * THE EXPOSURE MODEL IS PORTED FROM `semantica/explorer`, which gets this right and is worth
 * copying rather than reinventing (`explorer/__init__.py:84-101`, `dependencies.py:31-60`):
 *
 *   - a named set of loopback hosts, and loopback is the default;
 *   - a **specific** warning when binding beyond it, naming what becomes readable;
 *   - **fail closed** — bound beyond loopback with no key, requests are refused rather than served;
 *   - a constant-time comparison for the key.
 *
 * What is NOT ported is its write surface: 34 mutating routes against 44 read routes. Ours has
 * none, and `serve()` returns its route table so a test can assert that.
 */

import { timingSafeEqual } from 'node:crypto';
import { Store } from '../../src/store/store';
import { resolveWorkspace, storePaths } from '../../src/store/paths';
import type { StoredRecord } from '../../src/store/records';

/** Hosts that are only reachable from this machine. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1', 'localhost'];

export interface ServeOptions {
  readonly host?: string;
  readonly port?: number;
  readonly workspace?: string;
  /** Explicit opt-in to serving with no key. Never a default. */
  readonly allowAnonymous?: boolean;
  readonly apiKey?: string;
}

/** A view of the store, shaped for drawing. Derived on every request; nothing is cached. */
export interface GraphView {
  readonly nodes: readonly {
    id: string; kind: string; label: string; validFrom: string | null; validUntil: string | null;
    recordedAt: string; purged: boolean;
  }[];
  readonly edges: readonly {
    id: string; source: string; target: string; type: string; weight: number; hasEvidence: boolean;
  }[];
  readonly chain: { valid: boolean; total: number; purged: number; problems: number };
}

const labelOf = (r: StoredRecord): string => {
  const c = r.content;
  if (c === null) return '(purged)';
  if (typeof c !== 'object' || Array.isArray(c)) return r.id;
  const o = c as Record<string, unknown>;
  for (const k of ['name', 'title', 'text', 'scenario']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return r.id;
};

/**
 * Build the graph view.
 *
 * Reads through the same `Store` API the CLI uses, so a purged record is already `null` here and
 * its content cannot leak into a payload — `DEC-020` requires a test that proves it.
 */
export function graphView(store: Store): GraphView {
  const all = store.all();
  const v = store.verify();
  const nodes = all
    .filter((r) => r.kind === 'node' || r.kind === 'decision')
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      label: labelOf(r),
      validFrom: (r.meta.validFrom ?? null) as string | null,
      validUntil: (r.meta.validUntil ?? null) as string | null,
      recordedAt: String(r.meta.recordedAt),
      purged: r.content === null,
    }));
  const edges = store.listEdges().map((e) => ({
    id: e.id,
    source: String(e.meta.source),
    target: String(e.meta.target),
    type: String(e.meta.edgeType ?? 'INFLUENCED'),
    weight: typeof e.meta.weight === 'number' ? e.meta.weight : 1,
    hasEvidence: e.meta.triggerSpan !== undefined,
  }));
  return {
    nodes, edges,
    chain: { valid: v.valid, total: v.total, purged: v.purged, problems: v.problems.length },
  };
}

/** A route, and the method it answers. Exported so a test can assert none of them mutates. */
export interface Route {
  readonly method: 'GET';
  readonly path: string;
  readonly handler: (store: Store, url: URL) => unknown;
}

export const ROUTES: readonly Route[] = [
  { method: 'GET', path: '/api/graph', handler: (s) => graphView(s) },
  {
    method: 'GET', path: '/api/at',
    handler: (s, url) => {
      const at = url.searchParams.get('validAt');
      if (at === null) throw new Error('validAt is required');
      const asOf = url.searchParams.get('asOf');
      const snap = asOf === null ? s.stateAt(at) : s.stateAt(at, asOf);
      return {
        validAt: snap.validAt,
        nodes: snap.nodes.map((n) => n.id),
        edges: snap.edges.map((e) => e.id),
        rejected: snap.rejected,
      };
    },
  },
  {
    method: 'GET', path: '/api/evidence',
    handler: (s, url) => {
      const id = url.searchParams.get('edge');
      if (id === null) throw new Error('edge is required');
      return s.evidenceFor(id);
    },
  },
  {
    method: 'GET', path: '/api/why',
    handler: (s, url) => {
      const id = url.searchParams.get('id');
      if (id === null) throw new Error('id is required');
      const dir = url.searchParams.get('direction') === 'downstream' ? 'downstream' as const : 'upstream' as const;
      return s.why(id, dir, 5);
    },
  },
  {
    method: 'GET', path: '/api/view',
    handler: (s, url) => {
      const id = url.searchParams.get('id');
      if (id === null) throw new Error('id is required');
      return s.mergedView(id);
    },
  },
];

/**
 * Is this request allowed?
 *
 * Fails closed, following the reference: bound beyond loopback with no key configured, every
 * request is refused rather than served unauthenticated. `allowAnonymous` is the explicit opt-in.
 */
export function authorise(
  opts: ServeOptions,
  presentedKey: string | null,
): { readonly ok: true } | { readonly ok: false; readonly status: number; readonly reason: string } {
  const host = opts.host ?? '127.0.0.1';
  if (LOOPBACK_HOSTS.includes(host)) return { ok: true };
  if (opts.allowAnonymous === true) return { ok: true };

  const expected = opts.apiKey;
  if (expected === undefined || expected === '') {
    return {
      ok: false, status: 503,
      reason: `bound to ${host} with no API key configured, so every request is refused. `
        + 'Set an API key, or bind to 127.0.0.1, or opt in to anonymous access explicitly.',
    };
  }
  if (presentedKey === null) return { ok: false, status: 401, reason: 'X-API-Key header is required' };

  // Constant-time, and length-guarded because timingSafeEqual throws on a length mismatch.
  const a = Buffer.from(presentedKey);
  const b = Buffer.from(expected);
  const same = a.length === b.length && timingSafeEqual(a, b);
  return same ? { ok: true } : { ok: false, status: 401, reason: 'X-API-Key does not match' };
}

/** The warning printed when binding beyond loopback. Specific, following the reference. */
export function bindingWarning(host: string, opts: ServeOptions): string | null {
  if (LOOPBACK_HOSTS.includes(host)) return null;
  if (opts.allowAnonymous === true) {
    return `WARNING: binding to ${host} with anonymous access enabled exposes the store to any host `
      + 'that can reach this port. Everything the agent recorded — decisions, notes, retrieved '
      + 'text — becomes readable. It stays read-only, but it is readable.';
  }
  if (opts.apiKey === undefined || opts.apiKey === '') {
    return `WARNING: binding to ${host} with no API key set — every request will be refused with `
      + '503 until one is configured.';
  }
  return `Note: bound to ${host}; an X-API-Key header is required on every request.`;
}

export async function serve(opts: ServeOptions = {}): Promise<{ readonly port: number; readonly stop: () => void }> {
  const host = opts.host ?? '127.0.0.1';
  const paths = storePaths(resolveWorkspace(
    opts.workspace === undefined ? { env: process.env, startDir: process.cwd() } : { env: { GRAPH_ENGINE_WORKSPACE: opts.workspace } },
  ));

  const warn = bindingWarning(host, opts);
  if (warn !== null) console.error(warn);

  const server = Bun.serve({
    hostname: host,
    port: opts.port ?? 4321,
    async fetch(req) {
      const url = new URL(req.url);

      // Read-only by construction: anything that is not a GET is refused before routing.
      if (req.method !== 'GET') {
        return Response.json({ error: 'the explorer is read-only — DEC-020' }, { status: 405 });
      }

      const auth = authorise(opts, req.headers.get('X-API-Key'));
      if (!auth.ok) return Response.json({ error: auth.reason }, { status: auth.status });

      const route = ROUTES.find((r) => r.path === url.pathname);
      if (route === undefined) {
        if (url.pathname === '/api/health') return Response.json({ ok: true, readOnly: true });
        return Response.json({ error: 'no such route' }, { status: 404 });
      }

      try {
        const store = await Store.open(paths);
        return Response.json(route.handler(store, url));
      } catch (e) {
        // A reason, never a stack trace — the same rule the CLI follows.
        return Response.json({ error: (e as Error).message }, { status: 400 });
      }
    },
  });

  return { port: server.port ?? (opts.port ?? 4321), stop: () => server.stop(true) };
}

if (import.meta.main) {
  const arg = (n: string): string | undefined => {
    const i = process.argv.indexOf(`--${n}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const port = arg('port');
  const opts: ServeOptions = {
    ...(arg('host') === undefined ? {} : { host: arg('host') as string }),
    ...(port === undefined ? {} : { port: Number(port) }),
    ...(arg('workspace') === undefined ? {} : { workspace: arg('workspace') as string }),
    ...(process.env['EXPLORER_API_KEY'] === undefined ? {} : { apiKey: process.env['EXPLORER_API_KEY'] }),
    ...(process.env['EXPLORER_ALLOW_ANONYMOUS'] === 'true' ? { allowAnonymous: true } : {}),
  };
  const { port: p } = await serve(opts);
  console.log(`explorer API on http://${opts.host ?? '127.0.0.1'}:${p}  (read-only)`);
}
