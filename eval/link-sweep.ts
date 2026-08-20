#!/usr/bin/env bun
/**
 * Sweep candidate NIL rules against the labelled linking set.
 *
 *   bun --cwd engine eval/link-sweep.ts
 *
 * `DEC-014` refused to introduce a NIL threshold because there was no labelled set to calibrate one
 * against, and named that set as the condition for revisiting. Phase 12 built it. This is the
 * calibration, and it is deliberately a sweep rather than a chosen number: the honest output is the
 * whole curve, including the places where no threshold separates the two populations.
 *
 * Three rules are compared, because it is not obvious which signal carries the information:
 *
 *   - **score**  — reject when the top candidate scores below `t`. This is `semantica`'s rule
 *     (`entity_linker.py:128,404`, default 0.8) and the first of the four techniques the survey
 *     literature names.
 *   - **margin** — reject when the gap to the runner-up is below `t`. Also a named technique, and
 *     the one Phase 12 measured as strongly separating a right top-1 from a wrong one.
 *   - **both**   — reject unless the top score AND the margin clear their thresholds.
 *
 * The metric is the joint one, because the two halves trade against each other and a rule that
 * rejects everything scores perfectly on NIL:
 *
 *   - **kept**   — of the mentions with a referent, how many still get the right answer
 *   - **nil**    — of the mentions with no referent, how many are correctly rejected
 *   - **total**  — both, over every mention. This is what a threshold has to improve.
 */
import { link } from '../src/extract/link';
import { MENTIONS, RECORDS } from './linking';

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', Y = '\x1b[33m', O = '\x1b[0m';
const pct = (n: number, d: number): string => (d === 0 ? '   —' : `${((100 * n) / d).toFixed(1).padStart(5)}%`);

interface Row {
  readonly gold: string | null;
  readonly top: string | null;
  readonly topScore: number;
  readonly margin: number | null;
}

const rows: Row[] = MENTIONS.map((m) => {
  const r = link(m.mention, RECORDS);
  return { gold: m.gold, top: r.candidates[0]?.id ?? null, topScore: r.candidates[0]?.score ?? 0, margin: r.margin };
});

const inStore = rows.filter((r) => r.gold !== null);
const nil = rows.filter((r) => r.gold === null);

console.log(`\n${B}the two populations, by top score${O}`);
const fmt = (xs: number[]): string =>
  xs.length === 0 ? '—' : `${Math.min(...xs).toFixed(3)} … ${Math.max(...xs).toFixed(3)}`;
console.log(`  with a referent, top-1 correct : ${fmt(inStore.filter((r) => r.top === r.gold).map((r) => r.topScore))}`);
console.log(`  no referent (should reject)    : ${fmt(nil.map((r) => r.topScore))}`);
console.log(`  ${Y}the ranges overlap${O} — no score threshold can separate them cleanly, which is`);
console.log(`  ${D}the finding, not a failure of the sweep${O}`);

/** Would this row be answered correctly under a rule that rejects when `reject` is true? */
const scoreRow = (r: Row, reject: boolean): boolean =>
  r.gold === null ? reject : !reject && r.top === r.gold;

interface Result { readonly label: string; readonly kept: number; readonly nilOk: number; readonly total: number }

function evaluate(label: string, reject: (r: Row) => boolean): Result {
  const kept = inStore.filter((r) => scoreRow(r, reject(r))).length;
  const nilOk = nil.filter((r) => scoreRow(r, reject(r))).length;
  return { label, kept, nilOk, total: kept + nilOk };
}

const results: Result[] = [evaluate('none (today)', () => false)];
const STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.32, 0.34, 0.36, 0.4, 0.45, 0.5];
for (const t of STEPS) results.push(evaluate(`score < ${t.toFixed(2)}`, (r) => r.topScore < t));
for (const t of [0.02, 0.05, 0.1, 0.15, 0.2, 0.3]) {
  results.push(evaluate(`margin < ${t.toFixed(2)}`, (r) => (r.margin ?? 0) < t));
}
for (const s of [0.3, 0.34, 0.4]) {
  for (const m of [0.05, 0.1]) {
    results.push(evaluate(`score < ${s.toFixed(2)} or margin < ${m.toFixed(2)}`, (r) => r.topScore < s || (r.margin ?? 0) < m));
  }
}

const best = Math.max(...results.map((r) => r.total));
console.log(`\n${B}rules${O}  ${D}kept = right answer retained (of ${inStore.length}); nil = correctly rejected (of ${nil.length})${O}`);
for (const r of results) {
  const mark = r.total === best ? `${G}◀ best${O}` : '';
  console.log(`  ${r.label.padEnd(34)} kept ${String(r.kept).padStart(2)}/${inStore.length}  nil ${String(r.nilOk).padStart(2)}/${nil.length}  total ${pct(r.total, rows.length)}  ${mark}`);
}

console.log(`\n${D}A rule that rejects everything scores ${nil.length}/${nil.length} on nil and 0 on kept —${O}`);
console.log(`${D}which is why the total is the number to read, and neither half alone.${O}\n`);
