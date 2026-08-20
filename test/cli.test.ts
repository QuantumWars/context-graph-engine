import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
let ws: string;

/** Run the real CLI as a subprocess, the way a user does. Colour codes stripped for assertions. */
function run(...args: string[]): { code: number; out: string } {
  const p = Bun.spawnSync(['bun', CLI, ...args, '--workspace', ws], { stdout: 'pipe', stderr: 'pipe' });
  const raw = new TextDecoder().decode(p.stdout) + new TextDecoder().decode(p.stderr);
  // eslint-disable-next-line no-control-regex
  return { code: p.exitCode, out: raw.replace(/\x1b\[[0-9;]*m/g, '') };
}
const logPath = (): string => join(ws, '.claude', 'graph-engine', 'log.jsonl');

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'ge-cli-'));
  mkdirSync(join(ws, '.claude'), { recursive: true });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe('the CLI is usable without reading the source', () => {
  test('--help exits 0 and lists every subcommand', () => {
    const r = run('--help');
    expect(r.code).toBe(0);
    for (const c of ['record', 'link', 'retract', 'purge', 'at', 'why', 'find', 'verify', 'log']) {
      expect(r.out).toContain(`engine ${c}`);
    }
  });

  test('an unknown subcommand exits non-zero and says what is known', () => {
    const r = run('frobnicate');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('unknown command');
    expect(r.out).toContain('known:');
  });

  test('a missing required flag exits 2, not 0 and not a crash', () => {
    const r = run('record', 'x');
    expect(r.code).toBe(2);
    expect(r.out).toContain('--text is required');
  });

  test('a corrupt store reports the reason, never a stack trace', () => {
    run('record', 'a', '--text', 'first');
    const lines = readFileSync(logPath(), 'utf8').trimEnd().split('\n');
    const rec = JSON.parse(lines[0] as string) as { content: { text: string } };
    expect(rec.content.text).toBe('first');           // the fixture really changes something
    rec.content.text = 'tampered';
    writeFileSync(logPath(), JSON.stringify(rec) + '\n');

    const r = run('verify');
    expect(r.code).toBe(1);
    expect(r.out).toContain('chain_invalid');
    expect(r.out).toContain('content_tampered');
    expect(r.out).not.toContain('at <anonymous>');    // no stack trace
    expect(r.out).not.toContain('.ts:');
  });
});

describe('one full session against a real store on disk', () => {
  test('record → link → retract → purge → at → why → find → verify', () => {
    // 1. two decisions plus one that should never have been captured
    expect(run('record', 'd-friday', '--kind', 'decision', '--text',
      'deploying on friday caused a production incident', '--valid-from', '2026-01-10T00:00:00Z').code).toBe(0);
    expect(run('record', 'd-gate', '--kind', 'decision', '--text',
      'added a deploy gate to the pipeline', '--valid-from', '2026-02-01T00:00:00Z').code).toBe(0);
    expect(run('record', 'd-leak', '--kind', 'decision', '--text',
      'rotate key sk-live-9f2b7c41aa before the demo', '--valid-from', '2026-02-05T00:00:00Z').code).toBe(0);

    // 2. link them
    expect(run('link', 'd-friday', 'd-gate', '--type', 'CAUSED', '--weight', '0.9').code).toBe(0);

    // The store is real, and the secret really is in it before the purge — otherwise step 6
    // would prove nothing.
    expect(readFileSync(logPath(), 'utf8')).toContain('sk-live-9f2b7c41aa');

    // 3. survives a fresh process: every command above was a separate `bun` invocation.
    expect(run('verify').out).toContain('chain verifies — 4 record(s)');

    // 4. retract — no longer true, still answerable
    expect(run('retract', 'd-friday', '--reason', 'policy replaced').code).toBe(0);

    // 5. purge — should never have been captured
    const purged = run('purge', 'd-leak', '--reason', 'live credential');
    expect(purged.code).toBe(0);
    expect(purged.out).toContain('this-store-only');   // honest scope, on the user's screen

    // 6. the secret is gone from the FILE, and the chain still verifies
    expect(readFileSync(logPath(), 'utf8')).not.toContain('sk-live-9f2b7c41aa');
    const v = run('verify');
    expect(v.code).toBe(0);
    expect(v.out).toContain('6 record(s), 1 purged, 0 problems');

    // 7. point in time, both sides of the retraction
    expect(run('at', '2026-01-20T00:00:00Z').out).toContain('d-friday');
    const later = run('at', '2026-12-01T00:00:00Z').out;
    expect(later).not.toContain('d-friday');
    expect(later).toContain('d-gate');

    // 8. the causal chain names its weakest link
    const why = run('why', 'd-gate', '--direction', 'upstream');
    expect(why.out).toContain('weakest link');
    expect(why.out).toContain('CAUSED(0.9)');
    expect(why.out).toContain('product');

    // 9. retrieval serves, with margins on screen
    const found = run('find', 'deploy', 'friday', 'incident');
    expect(found.out).toContain('served');
    expect(found.out).toContain('d-friday');
    expect(found.out).toMatch(/lexical\s+considered=\d+\s+top=[\d.]+\s+floor=[\d.]+\s+margin=\+/);

    // 10. and abstains distinguishably, with a reason
    const none = run('find', 'quantum', 'entanglement');
    expect(none.out).toContain('abstained');
    expect(none.out).toContain('no_candidates');
    expect(none.out).not.toContain('served');

    // 11. the purged record is visibly a shell, not a deletion
    const log = run('log').out;
    expect(log).toContain('purged');
    expect(log).toContain('tombstone');
    expect(log).toContain('retraction');
  });
});

describe('the workspace boundary is enforced at the CLI', () => {
  test('two workspaces do not see each other', () => {
    run('record', 'mine', '--text', 'only in this workspace');
    const other = mkdtempSync(join(tmpdir(), 'ge-other-'));
    mkdirSync(join(other, '.claude'), { recursive: true });
    const p = Bun.spawnSync(['bun', CLI, 'log', '--workspace', other], { stdout: 'pipe', stderr: 'pipe' });
    const out = new TextDecoder().decode(p.stdout);
    expect(out).not.toContain('mine');
    rmSync(other, { recursive: true, force: true });
  });
});

describe('Phase 10 — linking reports, and the command line does not decide for you', () => {
  function seedThree(): void {
    run('record', 'd-friday', '--kind', 'decision', '--text', 'we stopped shipping on fridays');
    run('record', 'd-gate', '--kind', 'decision', '--text', 'we added a pre-deploy gate');
    run('record', 'note-1', '--text', 'The friday deploy caused a checkout outage.');
  }

  test('refers ranks candidates and prints the margin', () => {
    seedThree();
    const r = run('refers', 'pre-deploy', 'gate');
    expect(r.code).toBe(0);
    expect(r.out).toContain('ranked');
    expect(r.out).toContain('margin');
    expect(r.out).toContain('d-gate');
    expect(r.out).toContain('Ranked, not decided');
  });

  test('a phrase nothing matches says no_candidates rather than offering a poor match', () => {
    seedThree();
    const r = run('refers', 'quantum', 'tunnelling');
    expect(r.code).toBe(0);
    expect(r.out).toContain('no_candidates');
    expect(r.out).not.toContain('d-gate');
  });

  test('extract shows candidate endpoints with their scores', () => {
    seedThree();
    const r = run('extract', 'note-1');
    expect(r.out).toContain('subject → ranked');
    expect(r.out).toContain('d-friday');
  });

  test('AN AMBIGUOUS ENDPOINT IS NOT PRE-FILLED into the command line', () => {
    // The margin printed above the suggestion does not survive a copy-paste. Filling rank 1 into
    // the command a caller runs would put the engine's guess into their assertion, which is what
    // DEC-014 exists to prevent. Only a single-candidate list — a fact, not a threshold — is filled.
    seedThree();
    const r = run('extract', 'note-1');
    const line = r.out.split('\n').find((l) => l.includes('to accept:'))!;
    expect(line).toContain('--from <record>');
    // And the list it refused to pick from really did have more than one candidate.
    expect(r.out).toContain('d-gate');
    expect(r.out).toContain('d-friday');
  });

  test('a lone candidate IS pre-filled, because there is nothing to choose between', () => {
    run('record', 'only-one', '--text', 'parking permit renewal happens yearly');
    run('record', 'src', '--text', 'parking permit renewal caused a queue');
    const r = run('extract', 'src');
    const line = r.out.split('\n').find((l) => l.includes('to accept:'))!;
    expect(line).toContain('--from only-one');
  });

  test('refers writes nothing', () => {
    seedThree();
    const before = readFileSync(logPath(), 'utf8');
    run('refers', 'pre-deploy', 'gate');
    run('extract', 'note-1');
    expect(readFileSync(logPath(), 'utf8')).toBe(before);
  });
});
