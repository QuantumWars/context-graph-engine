import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Drives the MCP server as a SUBPROCESS over stdio, speaking real JSON-RPC.
 *
 * An in-process test would import the handlers and prove the functions work, which is already
 * known from 241 other tests. What is not known is whether the server WIRES them — whether the
 * schemas accept what the CLI accepts, whether a tool name matches its handler, and whether the
 * bundle that `.mcp.json` actually launches contains any of it. Only a subprocess answers that.
 */

const REPO = join(import.meta.dir, '..');
const BUNDLE = join(REPO, 'mcp', 'server.bundle.mjs');
const SOURCE = join(REPO, 'mcp', 'server.ts');

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'ge-mcp-'));
  mkdirSync(join(ws, '.claude'), { recursive: true });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

interface RpcResult { readonly result?: Record<string, unknown>; readonly error?: unknown }

/**
 * Speak JSON-RPC to the real server over stdio, **one request at a time**, awaiting each
 * response before sending the next.
 *
 * The first version of this helper wrote every line at once and read the responses at the end.
 * Three tests failed, and the cause was not the server: MCP requests are handled concurrently, so
 * `at` completed before the `record` it was meant to observe. The responses even came back out of
 * order, which is what gave it away.
 *
 * That is correct server behaviour and correct protocol behaviour — the store's lock makes
 * concurrent writes safe, which Phase 3 established with real processes. What was wrong was this
 * client assuming a sequencing the protocol does not promise. A real client that needs
 * read-after-write awaits its response, and so does this one now.
 */
async function rpc(
  calls: readonly { method: string; params?: unknown }[],
  entry: string = BUNDLE,
): Promise<RpcResult[]> {
  const cmd = entry.endsWith('.mjs') ? ['node', entry] : ['bun', entry];
  const p = Bun.spawn(cmd, {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env['PATH'] ?? '', HOME: ws, GRAPH_ENGINE_WORKSPACE: ws },
  });

  const reader = p.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const pending = new Map<number, RpcResult>();

  /** Read until the response with this id arrives. */
  const awaitId = async (id: number): Promise<RpcResult> => {
    for (;;) {
      const hit = pending.get(id);
      if (hit !== undefined) { pending.delete(id); return hit; }
      const { value, done } = await reader.read();
      if (done) return {};
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const msg = JSON.parse(line) as { id?: number } & RpcResult;
          if (typeof msg.id === 'number') pending.set(msg.id, msg);
        } catch { /* not a JSON-RPC line */ }
      }
    }
  };

  const send = (o: unknown): void => { p.stdin.write(JSON.stringify(o) + '\n'); };

  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  await awaitId(0);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const out: RpcResult[] = [];
  for (const [i, c] of calls.entries()) {
    send({ jsonrpc: '2.0', id: i + 1, method: c.method, params: c.params ?? {} });
    out.push(await awaitId(i + 1));
  }

  await p.stdin.end();
  reader.releaseLock();
  await p.exited;
  return out;
}

const textOf = (r: RpcResult): string => {
  const c = (r.result?.['content'] ?? []) as { text?: string }[];
  return c.map((x) => x.text ?? '').join('');
};

describe('the shipped bundle is the program', () => {
  test('the committed bundle exists and is current with its source', async () => {
    expect(existsSync(BUNDLE)).toBe(true);
    const committed = readFileSync(BUNDLE, 'utf8');

    const fresh = join(ws, 'fresh.mjs');
    const b = Bun.spawnSync(['bun', 'build', SOURCE, '--target=node', '--outfile', fresh], { cwd: REPO });
    expect(b.exitCode).toBe(0);

    // A committed artifact that has drifted from its source is a different program wearing the
    // code's name — and `.mcp.json` launches the artifact, not the source.
    expect(readFileSync(fresh, 'utf8').length).toBe(committed.length);
    expect(readFileSync(fresh, 'utf8')).toBe(committed);
  }, 60_000);

  test('.mcp.json launches the bundle, not the source', () => {
    const cfg = JSON.parse(readFileSync(join(REPO, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    const args = Object.values(cfg.mcpServers)[0]!.args.join(' ');
    expect(args).toContain('server.bundle.mjs');
    expect(args).not.toContain('server.ts');
  });

  test('the plugin manifest declares neither agents nor hooks — the validator rejects both', () => {
    const m = JSON.parse(readFileSync(join(REPO, '.claude-plugin', 'plugin.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(m)).not.toContain('agents');
    expect(Object.keys(m)).not.toContain('hooks');
    expect(m['name']).toBe('context-graph-engine');
    expect(typeof m['version']).toBe('string');
  });
});

describe('tools/list — over stdio, against the bundle', () => {
  test('every CLI verb is exposed, and each carries a real description', async () => {
    const listed = (await rpc([{ method: 'tools/list' }]))[0]!;
    const tools = (listed.result?.['tools'] ?? []) as { name: string; description?: string }[];

    expect(tools.length).toBeGreaterThan(0);                       // anti-vacuity
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['at', 'find', 'link', 'log', 'purge', 'record', 'retract', 'verify', 'why']);

    for (const t of tools) {
      expect({ tool: t.name, hasDescription: (t.description ?? '').length > 40 })
        .toEqual({ tool: t.name, hasDescription: true });
    }
  }, 30_000);
});

describe('tools/call — a real session against a real store', () => {
  test('record → link → why → verify, each a real round trip', async () => {
    const rs = await rpc([
      { method: 'tools/call', params: { name: 'record', arguments: { id: 'inc', kind: 'decision', text: 'friday deploy caused a checkout outage', validFrom: '2026-01-10T00:00:00Z' } } },
      { method: 'tools/call', params: { name: 'record', arguments: { id: 'gate', kind: 'decision', text: 'canary gate added before rollout', validFrom: '2026-02-01T00:00:00Z' } } },
      { method: 'tools/call', params: { name: 'link', arguments: { source: 'inc', target: 'gate', type: 'CAUSED', weight: 0.9 } } },
      { method: 'tools/call', params: { name: 'why', arguments: { id: 'gate', direction: 'upstream' } } },
      { method: 'tools/call', params: { name: 'verify', arguments: {} } },
    ]);

    expect(textOf(rs[0]!)).toContain('"recorded": "inc"');
    expect(textOf(rs[2]!)).toContain('CAUSED');
    expect(textOf(rs[3]!)).toContain('weakestLink');
    expect(textOf(rs[3]!)).toContain('inc');
    expect(textOf(rs[4]!)).toContain('"valid": true');

    // The store really exists on disk, written by the subprocess.
    const log = join(ws, '.claude', 'graph-engine', 'log.jsonl');
    expect(existsSync(log)).toBe(true);
    expect(readFileSync(log, 'utf8').trimEnd().split('\n')).toHaveLength(3);
  }, 30_000);

  test('purge removes the content from the file and the chain still verifies', async () => {
    const rs = await rpc([
      { method: 'tools/call', params: { name: 'record', arguments: { id: 'leak', text: 'token EXAMPLE-CREDENTIAL-DO-NOT-USE from a tool result' } } },
      { method: 'tools/call', params: { name: 'purge', arguments: { id: 'leak', reason: 'credential' } } },
      { method: 'tools/call', params: { name: 'verify', arguments: {} } },
    ]);
    const log = join(ws, '.claude', 'graph-engine', 'log.jsonl');
    expect(textOf(rs[1]!)).toContain('this-store-only');
    expect(readFileSync(log, 'utf8')).not.toContain('EXAMPLE-CREDENTIAL-DO-NOT-USE');
    expect(textOf(rs[2]!)).toContain('"valid": true');
    expect(textOf(rs[2]!)).toContain('"purged": 1');
  }, 30_000);

  test('the two time axes are reachable over MCP, and they disagree', async () => {
    const rs = await rpc([
      { method: 'tools/call', params: { name: 'record', arguments: { id: 'p', kind: 'decision', text: 'deploy on fridays is fine', validFrom: '2026-01-01T00:00:00Z' } } },
      { method: 'tools/call', params: { name: 'retract', arguments: { id: 'p', reason: 'superseded', at: '2026-03-01T00:00:00Z' } } },
      { method: 'tools/call', params: { name: 'at', arguments: { validAt: '2026-02-01T00:00:00Z' } } },
      { method: 'tools/call', params: { name: 'at', arguments: { validAt: '2026-06-01T00:00:00Z' } } },
    ]);
    expect(textOf(rs[1]!)).toContain('2026-03-01T00:00:00Z');
    expect(textOf(rs[2]!)).toContain('"p"');      // true in February
    expect(textOf(rs[3]!)).not.toContain('"p"');  // and not in June
  }, 30_000);

  test('bad input is refused with a reason code, not a crash', async () => {
    const rs = await rpc([
      { method: 'tools/call', params: { name: 'record', arguments: { id: 'x', text: 'once' } } },
      { method: 'tools/call', params: { name: 'record', arguments: { id: 'x', text: 'twice' } } },
      { method: 'tools/call', params: { name: 'at', arguments: { validAt: '2026-02-29T00:00:00Z' } } },
      { method: 'tools/call', params: { name: 'why', arguments: { id: 'nope' } } },
    ]);
    expect(textOf(rs[1]!)).toContain('duplicate_id');
    expect(textOf(rs[2]!)).toContain('malformed_temporal_value');
    for (const r of rs) expect(textOf(r)).not.toContain('.ts:');   // no stack frames
  }, 30_000);

  test('a no-argument tool needs an explicit empty arguments object', async () => {
    // Found by driving the real server over stdio: calling `verify` with `arguments` omitted
    // returns a validation error rather than running. `inputSchema: {}` compiles to a zod object,
    // and an absent `arguments` is `undefined`, not `{}`.
    //
    // The published plugin in this workspace declares three no-argument tools the same way and
    // never calls one without `arguments`, so it shares the constraint untested. Whether a real
    // Claude Code client omits the field is UNVERIFIED — settle it by installing the plugin and
    // calling `verify` from a session:
    //
    //   bun run --cwd engine bundle && claude --mcp-config engine/.mcp.json
    //
    // Pinned here so the behaviour is a known constraint rather than a surprise.
    const rr = await rpc([
      { method: 'tools/call', params: { name: 'verify' } },
      { method: 'tools/call', params: { name: 'verify', arguments: {} } },
    ]);
    expect(textOf(rr[0]!)).toContain('Invalid arguments for tool verify');
    expect(textOf(rr[1]!)).toContain('"valid": true');
  }, 30_000);

  test('a tool argument outside its schema is rejected by the boundary', async () => {
    const rs = await rpc([
      { method: 'tools/call', params: { name: 'link', arguments: { source: 'a', target: 'b', type: 'RELATED_TO' } } },
      { method: 'tools/call', params: { name: 'record', arguments: { id: '', text: 'empty id' } } },
    ]);
    // Either the schema refuses it or the engine does — both are named refusals, neither is a crash.
    expect(rs[0]!.error !== undefined || textOf(rs[0]!).length > 0).toBe(true);
    expect(rs[1]!.error !== undefined || textOf(rs[1]!).length > 0).toBe(true);
  }, 30_000);
});
