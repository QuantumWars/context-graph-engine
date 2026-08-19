#!/usr/bin/env bun
/**
 * Measure blocking against the labelled duplicate set.
 *
 *   bun --cwd engine eval/resolve-run.ts
 *
 * Reports PC, PQ and RR for several key configurations and for the all-pairs baseline. All-pairs
 * has PC of 1 by definition and RR of 0 — it is here because a blocking scheme is only interesting
 * relative to comparing everything, and printing it stops the other rows being read as absolute.
 */
import { block, type BlockOptions } from '../src/resolve/blocking';
import { scoreBlocking } from './resolve-metrics';
import { DUPLICATES, RECORDS } from './duplicates';

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', R = '\x1b[31m', O = '\x1b[0m';
const pct = (x: number): string => `${(x * 100).toFixed(1).padStart(5)}%`;

const CONFIGS: { name: string; opts: BlockOptions }[] = [
  { name: 'token only', opts: {} },
  { name: '+ type-scoped', opts: { typeScoped: true } },
  { name: '+ phonetic', opts: { phonetic: true } },
  { name: 'token+type+phon', opts: { typeScoped: true, phonetic: true } },
  { name: '+ cap 3', opts: { typeScoped: true, phonetic: true, maxCandidates: 3 } },
];

console.log(`\n${B}Blocking — ${RECORDS.length} records, ${DUPLICATES.length} labelled duplicate pairs${O}`);
console.log(`${D}labels written by the session that wrote the blocker; see eval/duplicates.ts${O}\n`);
console.log(`  ${'configuration'.padEnd(17)} ${'PC'.padStart(6)} ${'PQ'.padStart(6)} ${'RR'.padStart(6)}  compared  missed`);
console.log(`  ${'-'.repeat(64)}`);

const all = RECORDS.length * (RECORDS.length - 1) / 2;

// The baseline: compare everything. Perfect recall, no saving.
const allCand = RECORDS.flatMap((r, i) => RECORDS.slice(i + 1).map((s) => ({ a: r.id, b: s.id })));
const base = scoreBlocking(allCand, DUPLICATES, all);
console.log(`  ${D}${'all-pairs'.padEnd(17)}${O} ${pct(base.pc)} ${pct(base.pq)} ${pct(base.rr)}  ${String(base.candidates).padStart(8)}  ${String(base.missed.length).padStart(6)}`);

for (const { name, opts } of CONFIGS) {
  const r = block(RECORDS, opts);
  const s = scoreBlocking(r.pairs, DUPLICATES, all);
  const flag = s.pc === 1 ? G : R;
  console.log(`  ${flag}${name.padEnd(17)}${O} ${pct(s.pc)} ${pct(s.pq)} ${pct(s.rr)}  ${String(s.candidates).padStart(8)}  ${String(s.missed.length).padStart(6)}`);
  if (s.missed.length > 0) console.log(`  ${R}    lost: ${s.missed.join(' · ')}${O}`);
}

console.log(`\n  ${D}PC is recall and is not symmetric with the others: a pair blocking drops is gone,`);
console.log(`  because nothing downstream ever looks at it. PQ and RR only cost time.${O}\n`);
