#!/usr/bin/env bun
/**
 * Sweep each constant over a range and report what the labelled set says.
 *
 * One constant varies at a time, the others held at their shipped values. That is a weaker
 * design than a joint search and it is deliberate: with 19 queries a joint search would fit
 * the noise, and a value chosen by overfitting a small set is worse than an honest placeholder
 * because it looks measured.
 *
 *   bun --cwd engine eval/sweep.ts
 */
import { LEXICAL_FLOOR, STRUCTURAL_FLOOR } from '../src/retrieval/channels';
import { RRF_K } from '../src/retrieval/rrf';
import { engineArm, runArm, type ArmOptions } from './harness';

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', Y = '\x1b[33m', O = '\x1b[0m';
const pct = (x: number): string => (x * 100).toFixed(1).padStart(5) + '%';

export interface SweepRow {
  readonly value: number;
  readonly score: number;
  readonly precision: number;
  readonly recall: number;
  readonly mrr: number;
  readonly falseServe: number;
  readonly falseAbstain: number;
}

export function sweep(name: keyof ArmOptions, values: readonly number[], base: ArmOptions = {}): readonly SweepRow[] {
  return values.map((value) => {
    const r = runArm(engineArm, { k: 10, ...base, [name]: value });
    return {
      value, score: r.score,
      precision: r.report.precision, recall: r.report.recall, mrr: r.report.mrr,
      falseServe: r.report.falseServe, falseAbstain: r.report.falseAbstain,
    };
  });
}

export function best(rows: readonly SweepRow[]): SweepRow {
  return rows.reduce((a, b) => (b.score > a.score ? b : a));
}

function table(label: string, shipped: number, rows: readonly SweepRow[]): SweepRow {
  const b = best(rows);
  console.log(`\n${B}${label}${O}  ${D}shipped: ${shipped}${O}`);
  console.log(`  ${'value'.padStart(8)} ${'score'.padStart(7)} ${'P@10'.padStart(6)} ${'R@10'.padStart(6)} ${'MRR'.padStart(6)}  fServe  fAbstain`);
  console.log('  ' + '-'.repeat(62));
  for (const r of rows) {
    const mark = r.value === b.value ? `${G}◄ best${O}` : r.value === shipped ? `${Y}◄ shipped${O}` : '';
    console.log(
      `  ${String(r.value).padStart(8)} ${r.score.toFixed(3).padStart(7)} ${pct(r.precision)} ${pct(r.recall)} ` +
      `${pct(r.mrr)}  ${String(r.falseServe).padStart(6)}  ${String(r.falseAbstain).padStart(8)}  ${mark}`,
    );
  }
  // A tie is not a preference. Reporting "prefers 1 over 60" when both score 0.819 would be a
  // misleading instrument, and this file exists to produce trustworthy ones.
  const shippedRow = rows.find((r) => r.value === shipped);
  const spread = Math.max(...rows.map((r) => r.score)) - Math.min(...rows.map((r) => r.score));
  if (spread < 1e-9) {
    console.log(`  ${Y}→ FLAT: every value tested scores ${b.score.toFixed(3)}. This constant does not ` +
      `discriminate on this set,${O}`);
    console.log(`  ${Y}  so the sweep cannot calibrate it and it stays a declared placeholder.${O}`);
  } else if (shippedRow !== undefined && b.score - shippedRow.score > 1e-9) {
    console.log(`  ${Y}→ the sweep prefers ${b.value} over the shipped ${shipped} ` +
      `(${b.score.toFixed(3)} vs ${shippedRow.score.toFixed(3)})${O}`);
  } else {
    console.log(`  ${G}→ the sweep agrees with the shipped value${O}`);
  }
  return b;
}

console.log(`\n${B}Constant sweep${O}  ${D}19 queries, k=10, one constant at a time${O}`);

table('LEXICAL_FLOOR', LEXICAL_FLOOR,
  sweep('lexicalFloor', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2]));

table('STRUCTURAL_FLOOR', STRUCTURAL_FLOOR,
  sweep('structuralFloor', [1, 2, 3, 4]));

table('RRF_K', RRF_K,
  sweep('rrfK', [1, 5, 10, 20, 30, 60, 120, 300]));

console.log('');
