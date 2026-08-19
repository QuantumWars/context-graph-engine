#!/usr/bin/env bun
/**
 * Run every arm over the labelled set and print the comparison.
 *
 *   bun --cwd engine eval/run.ts            summary
 *   bun --cwd engine eval/run.ts --detail   plus per-query results
 */
import { QUERIES } from './dataset';
import { engineArm, lexicalOnlyArm, returnAllArm, runArm, type Arm } from './harness';

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', R = '\x1b[31m', O = '\x1b[0m';
const pct = (x: number): string => (x * 100).toFixed(1).padStart(5) + '%';

const ARMS: { name: string; arm: Arm; note: string }[] = [
  { name: 'engine', arm: engineArm, note: 'lexical + structural, floored, RRF-fused, may abstain' },
  { name: 'lexical-only', arm: lexicalOnlyArm, note: 'baseline: one channel, no floor, never abstains' },
  { name: 'return-all', arm: returnAllArm, note: 'baseline: returns the corpus. Should score badly.' },
];

console.log(`\n${B}Evaluation — ${QUERIES.length} queries, k=10${O}`);
console.log(`${D}labels written by the session that wrote the retrieval code; see eval/dataset.ts${O}\n`);
console.log(`  ${'arm'.padEnd(14)} ${'score'.padStart(7)} ${'P@10'.padStart(6)} ${'R@10'.padStart(6)} ${'MRR'.padStart(6)}  falseServe  falseAbstain  forbidden`);
console.log('  ' + '-'.repeat(84));

const results = ARMS.map(({ name, arm, note }) => {
  const r = runArm(arm, { k: 10 });
  const c = name === 'engine' ? G : D;
  console.log(
    `  ${c}${name.padEnd(14)}${O} ${r.score.toFixed(3).padStart(7)} ${pct(r.report.precision)} ` +
    `${pct(r.report.recall)} ${pct(r.report.mrr)}  ${String(r.report.falseServe).padStart(10)}  ` +
    `${String(r.report.falseAbstain).padStart(12)}  ${String(r.report.forbidden).padStart(9)}`,
  );
  return { name, r, note };
});

console.log('');
for (const { name, note } of ARMS) console.log(`  ${D}${name.padEnd(14)} ${note}${O}`);

const engine = results.find((x) => x.name === 'engine')!;
const best = results.reduce((a, b) => (b.r.score > a.r.score ? b : a));
console.log('');
if (best.name === 'engine') {
  console.log(`  ${G}✓${O} the engine beats every baseline`);
} else {
  console.log(`  ${R}✗${O} ${best.name} (${best.r.score.toFixed(3)}) beats the engine (${engine.r.score.toFixed(3)})`);
  console.log(`  ${D}That is a finding about the engine, not a reason to change the baseline.${O}`);
}
console.log(`  correct abstentions: ${engine.r.report.correctAbstain} of ${QUERIES.filter((q) => q.relevant.length === 0).length}`);

if (process.argv.includes('--detail')) {
  console.log(`\n${B}Per query — engine arm${O}`);
  for (const { query, returned } of engine.r.perQuery) {
    const rel = new Set(query.relevant);
    const hits = returned.filter((id) => rel.has(id)).length;
    const want = query.relevant.length;
    const mark = want === 0 ? (returned.length === 0 ? `${G}abstained${O}` : `${R}served ${returned.length}${O}`)
                            : (hits === want ? `${G}${hits}/${want}${O}` : `${R}${hits}/${want}${O}`);
    console.log(`\n  ${B}${query.id}${O} ${query.query}   ${mark}`);
    console.log(`    ${D}want: ${query.relevant.join(', ') || '(nothing)'}${O}`);
    console.log(`    ${D}got : ${returned.slice(0, 6).join(', ') || '(nothing)'}${returned.length > 6 ? ' …' : ''}${O}`);
    const bad = (query.irrelevant ?? []).filter((id) => returned.includes(id));
    if (bad.length > 0) console.log(`    ${R}forbidden returned: ${bad.join(', ')}${O}`);
  }
}
console.log('');
