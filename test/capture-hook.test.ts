import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECISION_PATH, decisionsWritten, titleOf } from '../../.claude/hooks/capture-decisions.mjs';

/** Phase 21. `DEC-022`: capture reads the artifacts a session created, never its transcript. */

const HOOK = readFileSync(join(import.meta.dir, '..', '..', '.claude', 'hooks', 'capture-decisions.mjs'), 'utf8');
// Comments stripped. The first version of this guard failed on the hook's OWN comment saying
// "`transcript_path` appears nowhere in this file" — a claim of absence that created the presence.
const CODE = HOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('DEC-022 — the transcript is never opened', () => {
  test('the hook does not reference transcript_path', () => {
    // The whole record turns on this. The obvious implementation reads the transcript and infers
    // decisions from prose; this one cannot, because it never learns where the transcript is.
    expect(CODE).not.toContain('transcript_path');
    expect(CODE.length).toBeGreaterThan(500);            // anti-vacuity: the code really was read
  });

  test('and the check would catch it if it did', () => {
    expect(`${CODE}\nconst t = input.transcript_path;`).toContain('transcript_path');
  });

  test('it reads only the event log and the paths that log names', () => {
    expect(CODE).toContain('events.jsonl');
    // No directory walk, no glob — it cannot discover a file the session did not write.
    expect(CODE).not.toContain('readdirSync');
    expect(CODE).not.toContain('Glob');
  });
});

describe('what counts as a decision is a path, not a judgement', () => {
  test('a DEC file is captured; a summary, a source file and DECISIONS.md are not', () => {
    const yes = 'engine/build/DEC-022-the-hook-captures-artifacts.md';
    expect(DECISION_PATH.exec(yes)?.[1]).toBe('DEC-022');
    for (const no of ['engine/build/phase-20-summary.md', 'engine/src/store/store.ts', 'notes/DECISIONS.md']) {
      expect({ path: no, matched: DECISION_PATH.test(no) }).toEqual({ path: no, matched: false });
    }
  });

  test('the id is the number, so renaming the slug is not a second decision', () => {
    expect(DECISION_PATH.exec('build/DEC-007-hash-a-salted-commitment.md')?.[1]).toBe('DEC-007');
    expect(DECISION_PATH.exec('build/DEC-007-renamed-entirely.md')?.[1]).toBe('DEC-007');
  });

  test('one decision edited many times is captured once', () => {
    const events = [
      { tool: 'Write', target: 'build/DEC-022-x.md' },
      { tool: 'Edit', target: 'build/DEC-022-x.md' },
      { tool: 'Edit', target: 'build/DEC-022-x.md' },
      { tool: 'Write', target: 'build/DEC-021-y.md' },
    ];
    expect(decisionsWritten(events).map((d) => d.id)).toEqual(['DEC-022', 'DEC-021']);
  });

  test('a tool that does not write is ignored', () => {
    // A Read or a Bash that merely mentions the path must not capture anything.
    const events = [
      { tool: 'Read', target: 'build/DEC-022-x.md' },
      { tool: 'Bash', target: 'cat build/DEC-022-x.md' },
    ];
    expect(decisionsWritten(events)).toEqual([]);
  });
});

describe('the captured text is the decision’s own words', () => {
  test('the title line, verbatim, with the number stripped', () => {
    expect(titleOf('# DEC-022 — Session capture reads the artifacts a session created\n\nbody'))
      .toBe('Session capture reads the artifacts a session created');
  });

  test('a file with no heading captures nothing rather than guessing', () => {
    expect(titleOf('no heading at all\n\njust prose')).toBeNull();
    expect(titleOf('')).toBeNull();
    expect(titleOf('# \n')).toBeNull();
  });

  test('nothing summarises, so no text can be invented', () => {
    // `f-fake-example` is in the store: an invented example read as a real decision. A hook that
    // summarised prose would industrialise that failure, unattended, on every session.
    const body = '# DEC-001 — A short title\n\nWe also decided several other things in this body.';
    expect(titleOf(body)).toBe('A short title');
    expect(titleOf(body)).not.toContain('other things');
  });
});
