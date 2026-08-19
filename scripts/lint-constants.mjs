#!/usr/bin/env node
/**
 * Every numeric constant on a decision path must say where its value came from.
 *
 * Three statuses are acceptable, and they must appear in the doc comment attached to the
 * declaration: **calibrated**, **declared placeholder**, or **no provenance** — the last one
 * stated explicitly, because "we do not know" is a legitimate thing to say and silence is not.
 *
 * This exists because the system this engine was rebuilt from shipped 89 CLI commands and an
 * evaluation package of ten lines reading `__status__ = "coming_soon"`, so every weight and
 * threshold in it was uncalibrated by construction and nothing in the repository could
 * establish otherwise. A comment is not a guarantee; a check that fails is.
 *
 *   node scripts/lint-constants.mjs
 *
 * Exit: 0 every constant accounted for · 1 at least one is not · 2 could not run.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = ['src', 'eval'];
const STATUS = /PROVENANCE:\s*\*\*(calibrated|declared placeholder|no provenance)\.?\*\*/i;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

let files;
try {
  files = SCAN.flatMap((d) => walk(join(ROOT, d)));
} catch (e) {
  console.error(`lint-constants: cannot run — ${e.message}`);
  console.error('lint-constants: this is exit 2, not a pass.');
  process.exit(2);
}

if (files.length === 0) {
  console.error(`lint-constants: found no .ts files under ${SCAN.join(', ')} — a checker that`);
  console.error('scans nothing and prints PASS is the bug this exists to prevent.');
  process.exit(2);
}

const problems = [];
let checked = 0;

for (const file of files) {
  const body = readFileSync(file, 'utf8');
  const lines = body.split('\n');

  lines.forEach((line, i) => {
    // An exported const bound to a bare number. Arrays, objects and strings are not thresholds.
    const m = /^export const ([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*-?\d/.exec(line);
    if (m === null) return;
    checked++;

    // Walk back over the doc comment or line comments immediately above.
    let j = i - 1;
    const above = [];
    while (j >= 0) {
      const t = lines[j].trim();
      if (t === '' && above.length === 0) { j--; continue; }
      if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/') || t.startsWith('//')) {
        above.unshift(t); j--; continue;
      }
      break;
    }
    const comment = above.join('\n');
    if (!STATUS.test(comment)) {
      problems.push({
        file: relative(ROOT, file),
        line: i + 1,
        name: m[1],
        why: above.length === 0
          ? 'no comment at all'
          : 'a comment, but no `PROVENANCE: **calibrated|declared placeholder|no provenance**`',
      });
    }
  });
}

if (problems.length > 0) {
  console.error(`lint-constants: FAIL — ${problems.length} of ${checked} constant(s) have no provenance\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  ${p.name}`);
    console.error(`    ${p.why}`);
  }
  console.error('\n  Say one of: calibrated (and name the run), declared placeholder (and name');
  console.error('  what would calibrate it), or no provenance (and say so plainly).');
  process.exit(1);
}

console.log(`lint-constants: PASS — ${checked} constant(s), every one accounted for`);
process.exit(0);
