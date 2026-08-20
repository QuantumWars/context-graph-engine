#!/usr/bin/env bun
/**
 * Measure entity linking against the labelled set.
 *
 *   bun --cwd engine eval/link-run.ts
 *
 * Reports Recall@any, Recall@k and Top-1 for mentions with a referent, NIL accuracy for those
 * without, a per-family breakdown, and the margin split — whether the gap to the runner-up is
 * actually larger behind a correct answer than behind a wrong one.
 *
 * That last one is not decoration. `DEC-014` returns a margin instead of applying a threshold, on
 * the argument that the gap is the honest signal. If the split comes out flat, the margin is
 * decoration and the decision record has to say so.
 */
import { link } from '../src/extract/link';
import { byFamily, judge, marginSplit, scoreLinking, type Judged } from './link-metrics';
import { MENTIONS, RECORDS } from './linking';

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', O = '\x1b[0m';
const pct = (n: number, d: number): string => (d === 0 ? '    —' : `${((100 * n) / d).toFixed(1).padStart(5)}%`);

const K = 3;

const judged: Judged[] = MENTIONS.map((m) =>
  judge(m.mention, m.gold, m.family, link(m.mention, RECORDS)),
);

const s = scoreLinking(judged, K);

console.log(`\n${B}linking — ${RECORDS.length} records, ${MENTIONS.length} labelled mentions${O}`);
console.log(`${D}labels and code written by the same session; see eval/linking.ts${O}\n`);

console.log(`  ${B}candidate generation${O}`);
console.log(`    Recall@any   ${pct(s.recallAtAny, s.inStore)}   ${D}${s.recallAtAny}/${s.inStore} — gold reachable at all${O}`);
console.log(`    Recall@${K}     ${pct(s.recallAtK, s.inStore)}   ${D}${s.recallAtK}/${s.inStore}${O}`);
if (s.missed.length > 0) {
  console.log(`    ${R}lost outright${O}: ${s.missed.join(' · ')}`);
  console.log(`    ${D}a mention the generator drops is gone — no scorer downstream ever sees it${O}`);
}

console.log(`\n  ${B}ranking${O}`);
console.log(`    Top-1        ${pct(s.top1, s.inStore)}   ${D}${s.top1}/${s.inStore}${O}`);

console.log(`\n  ${B}the reject option${O}`);
console.log(`    NIL correct  ${pct(s.nilCorrect, s.nil)}   ${D}${s.nilCorrect}/${s.nil} answered "nothing here"${O}`);

console.log(`\n  ${B}by family${O}`);
for (const [family, e] of [...byFamily(judged)].sort()) {
  const isNil = family.startsWith('nil');
  const hit = isNil ? e.nilCorrect : e.top1;
  console.log(`    ${family.padEnd(13)} ${String(hit).padStart(2)}/${String(e.total).padEnd(2)}  ${pct(hit, e.total)}`);
}

const m = marginSplit(judged);
console.log(`\n  ${B}is the margin worth anything?${O}  ${D}DEC-014 rests on this${O}`);
console.log(`    median margin when top-1 is RIGHT  ${m.medianWhenCorrect === null ? '   —' : m.medianWhenCorrect.toFixed(4)}  ${D}(n=${m.correctCount})${O}`);
console.log(`    median margin when top-1 is WRONG  ${m.medianWhenWrong === null ? '   —' : m.medianWhenWrong.toFixed(4)}  ${D}(n=${m.wrongCount})${O}`);
if (m.separation === null) {
  console.log(`    ${Y}separation undefined${O} — one side has no cases, so this set cannot answer it`);
} else if (m.separation > 0) {
  console.log(`    ${G}separation +${m.separation.toFixed(4)}${O} — a wider gap does mean a better answer, on this set`);
} else {
  console.log(`    ${R}separation ${m.separation.toFixed(4)}${O} — the margin does NOT separate right from wrong here`);
}

console.log(`\n  ${B}every mention${O}`);
for (const j of judged) {
  const ok = j.gold === null ? j.verdict === 'no_candidates' : j.goldRank === 1;
  const mark = ok ? `${G}ok  ${O}` : `${R}MISS${O}`;
  const got = j.top === null ? '(nothing)' : `${j.top} @${(j.topScore ?? 0).toFixed(3)}`;
  const want = j.gold ?? '(nothing)';
  const rank = j.gold === null ? '' : j.goldRank === null ? `  ${R}gold not a candidate${O}` : `  ${D}gold at rank ${j.goldRank}${O}`;
  console.log(`    ${mark} ${j.mention.padEnd(38)} ${D}want${O} ${want.padEnd(22)} ${D}got${O} ${got}${rank}`);
}

console.log(`\n${D}24 mentions over 20 records is small: one label moves a metric by about four points.${O}`);
console.log(`${D}Enough to catch a regression and to test the margin claim. Not a benchmark.${O}\n`);
