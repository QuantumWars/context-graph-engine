import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Task 3.1 — one agent session, driven the way a user drives it.
 *
 * Through the CLI, not the API. The API is reachable from a test by definition; the CLI is the
 * only surface that proves the pieces are reachable from outside the process.
 */

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
let ws: string;

function run(...args: string[]): { code: number; out: string } {
  const p = Bun.spawnSync(['bun', CLI, ...args, '--workspace', ws], { stdout: 'pipe', stderr: 'pipe' });
  const raw = new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr);
  return { code: p.exitCode, out: raw.replace(/\x1b\[[0-9;]*m/g, '') };
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'ge-scenario-'));
  mkdirSync(join(ws, '.claude'), { recursive: true });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe('a multi-day agent session', () => {
  test('three days of work, ending in a chain that verifies', async () => {
    const calls: string[] = [];
    const R = (...a: string[]): { code: number; out: string } => {
      calls.push(a[0] as string);
      const r = run(...a);
      if (r.code !== 0) throw new Error(`${a.join(' ')} exited ${r.code}\n${r.out}`);
      return r;
    };

    // ── Day 1 · Monday. An incident, and what was decided about it. ──────────────
    R('record', 'incident', '--kind', 'decision',
      '--text', 'friday deploy took checkout down for 40 minutes',
      '--valid-from', '2026-03-02T09:00:00Z');
    R('record', 'freeze', '--kind', 'decision',
      '--text', 'no deploys after thursday until we have a gate',
      '--valid-from', '2026-03-02T17:00:00Z');
    R('link', 'incident', 'freeze', '--type', 'CAUSED', '--weight', '0.95');

    // Something that should never have been captured — a key pasted from a tool result.
    R('record', 'runbook', '--kind', 'node',
      '--text', 'restart with token sk-live-3d91ffab22 then drain the queue',
      '--valid-from', '2026-03-02T18:00:00Z');

    // The transaction axis needs two distinct recording instants, and now() has one-second
    // resolution, so cross a real second boundary rather than faking a clock. A seam that let
    // a caller set recordedAt would be a seam that lets them lie about it.
    const beforeDay2 = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    await Bun.sleep(1100);

    // ── Day 2 · Tuesday. The gate ships; the freeze is no longer true. ───────────
    R('record', 'gate', '--kind', 'decision',
      '--text', 'deploy gate merged, requires a green canary',
      '--valid-from', '2026-03-03T11:00:00Z');
    R('link', 'freeze', 'gate', '--type', 'CAUSED', '--weight', '0.8');
    // The freeze stopped being true when the gate shipped — in March, not today.
    R('retract', 'freeze', '--reason', 'superseded by the gate', '--at', '2026-03-03T11:00:00Z');

    // ── Day 3 · Wednesday. The credential is noticed. ────────────────────────────
    expect(readFileSync(join(ws, '.claude', 'graph-engine', 'log.jsonl'), 'utf8'))
      .toContain('sk-live-3d91ffab22');                      // it really is in there
    R('purge', 'runbook', '--reason', 'contained a live credential');

    // ── What the session can now answer ─────────────────────────────────────────

    // 1. The credential is gone from the file, and the chain still verifies.
    expect(readFileSync(join(ws, '.claude', 'graph-engine', 'log.jsonl'), 'utf8'))
      .not.toContain('sk-live-3d91ffab22');
    const verify = R('verify');
    expect(verify.out).toContain('chain verifies');
    expect(verify.out).toContain('1 purged');

    // 2. What was TRUE on day 2 — the freeze was still in force that morning.
    const trueThen = R('at', '2026-03-03T09:00:00Z').out;
    expect(trueThen).toContain('freeze');

    // 3. …and NOT today, because it was retracted.
    const trueNow = R('at', '2026-06-01T00:00:00Z').out;
    expect(trueNow).not.toContain('freeze');
    expect(trueNow).toContain('gate');

    // 4. THE TWO AXES. Same valid time, different belief times. As the store stood before
    //    day 2, the gate had not been recorded — so a decision made then could not have used
    //    it. If the axes were collapsed, `gate` would appear in both and this fails.
    const believedThen = R('at', '2026-06-01T00:00:00Z', '--as-of', beforeDay2).out;
    expect(believedThen).not.toContain('gate');
    expect(trueNow).toContain('gate');

    // 5. Why did the gate happen? Two hops back to the incident.
    const why = R('why', 'gate', '--direction', 'upstream').out;
    expect(why).toContain('incident');
    expect(why).toContain('weakest link');
    expect(why).toMatch(/hops 2/);

    // 6. Precedent retrieval finds the incident from a query about it.
    const found = R('find', 'deploy', 'took', 'checkout', 'down').out;
    expect(found).toContain('served');
    expect(found).toContain('incident');

    // 7. Survives reload — every call above was already a separate process, and this is one more.
    expect(R('log').out).toContain('tombstone');
    expect(R('verify').out).toContain('chain verifies');

    // The acceptance asks for at least 12 invocations across 3 days.
    expect(calls.length).toBeGreaterThanOrEqual(12);
  }, 30_000);
});
