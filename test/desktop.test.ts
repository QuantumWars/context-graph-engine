import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Phase 20. `DEC-021`: the desktop app reads in-process and its IPC surface cannot write. */

const SRC = join(import.meta.dir, '..', 'desktop', 'src');
const main = readFileSync(join(SRC, 'main.js'), 'utf8');
const preload = readFileSync(join(SRC, 'preload.js'), 'utf8');

describe('the IPC surface is read-only', () => {
  test('every channel begins `read:`', () => {
    const channels = [...main.matchAll(/'(read:[a-z-]+|[a-z]+:[a-z-]+)':/g)].map((m) => m[1] as string);
    expect(channels.length).toBeGreaterThan(0);                       // anti-vacuity
    for (const c of channels) {
      expect({ channel: c, readOnly: c.startsWith('read:') }).toEqual({ channel: c, readOnly: true });
    }
  });

  test('no channel names a mutating operation', () => {
    for (const word of ['append', 'write', 'merge', 'confirm', 'retract', 'purge', 'delete']) {
      expect({ word, present: /'[a-z]+:[a-z-]*(append|write|merge|confirm|retract|purge|delete)/.test(main) })
        .toEqual({ word, present: false });
    }
  });

  test('the preload exposes only the read bridge', () => {
    // The renderer can reach nothing this file does not hand it.
    expect(preload).toContain('contextBridge.exposeInMainWorld');
    const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1] as string);
    expect(invoked.length).toBeGreaterThan(0);
    for (const c of invoked) expect(c.startsWith('read:')).toBe(true);
    // `ipcRenderer.send` and `.sendSync` would bypass the handler table entirely.
    expect(preload).not.toContain('ipcRenderer.send');
  });
});

describe('the renderer is sandboxed', () => {
  test('contextIsolation on, nodeIntegration off, sandbox on', () => {
    expect(main).toMatch(/contextIsolation:\s*true/);
    expect(main).toMatch(/nodeIntegration:\s*false/);
    expect(main).toMatch(/sandbox:\s*true/);
  });

  test('and the check can see them flipped', () => {
    // Proving the assertion is not vacuous, without editing the real file.
    expect(/nodeIntegration:\s*false/.test('nodeIntegration: true')).toBe(false);
  });
});

describe('one reader of the log', () => {
  test('the desktop reads through graphView, not a private path into the file', () => {
    // DEC-021: a private reader is how two views come to disagree about what the store contains.
    const adapter = readFileSync(join(SRC, 'read-graph.ts'), 'utf8');
    expect(adapter).toContain('graphView');
    expect(adapter).toContain('Store.open');
    expect(adapter).not.toContain('log.jsonl');
    expect(adapter).not.toContain('readFileSync');
  });

  test('main loads the bundle rather than shelling out to bun', () => {
    // The first version used execFileSync('bun', …), which cannot work inside a packaged .app:
    // neither bun nor the engine source is in the bundle.
    expect(main).toContain('graph-reader.bundle.mjs');
    expect(main).not.toContain('execFileSync');
  });
});
