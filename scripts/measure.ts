#!/usr/bin/env bun
/**
 * Measure what `DEC-007` says is unmeasured: rebuild-on-load, and purge, at real sizes.
 *
 * Not a test. A test asserts a threshold, and there is no threshold to assert yet — the point is
 * to replace the words "unmeasured" in a decision record with a number and the command that
 * produced it. Run it again to check the number still holds.
 */
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from './../src/store/store';
import { resolveWorkspace, storePaths } from './../src/store/paths';

const SIZES = [100, 500, 2000];
const ms = (t: number): string => `${t.toFixed(1)}ms`;

console.log(`bun ${Bun.version} · ${process.platform}/${process.arch}\n`);
console.log('  n      append/rec   load(total)  load/rec   purge      file');
console.log('  ' + '-'.repeat(62));

for (const n of SIZES) {
  const dir = mkdtempSync(join(tmpdir(), 'ge-bench-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const paths = storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: dir } }));

  const t0 = performance.now();
  const w = await Store.open(paths);
  for (let i = 0; i < n; i++) {
    await w.append({ kind: 'node', id: `r${i}`, content: { text: `record ${i} with some realistic body text`, i } });
  }
  const tAppend = performance.now() - t0;

  const t1 = performance.now();
  const r = await Store.open(paths);          // read + verify + rebuild views
  const tLoad = performance.now() - t1;
  if (r.all().length !== n) throw new Error(`expected ${n}, got ${r.all().length}`);

  const t2 = performance.now();
  await r.purge('r0', 'measurement');
  const tPurge = performance.now() - t2;

  const bytes = statSync(paths.log).size;
  console.log(
    `  ${String(n).padEnd(6)} ${ms(tAppend / n).padEnd(12)} ${ms(tLoad).padEnd(12)} ` +
    `${ms(tLoad / n).padEnd(10)} ${ms(tPurge).padEnd(10)} ${(bytes / 1024).toFixed(0)}KB`,
  );
  rmSync(dir, { recursive: true, force: true });
}
console.log('\n  load  = read every line + verify the whole chain + rebuild every view');
console.log('  purge = read, rewrite the entire file, append a tombstone — all under one lock');
