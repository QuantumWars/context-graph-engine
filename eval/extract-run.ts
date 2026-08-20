#!/usr/bin/env bun
/**
 * Measure rule-based extraction against the labelled set.
 *
 *   bun --cwd engine eval/extract-run.ts
 *
 * Reports precision, recall and F1 over emitted relations under the strict criterion, plus the
 * silence rate on texts that should emit nothing — reported separately, because a single number
 * that rewarded silence would make an extractor emitting nothing at all look excellent.
 */
import { extract } from '../src/extract/rules';
import { resolveSpan, type Span } from '../src/extract/span';
import { byFamily, judgeText, scoreExtraction, type EmittedRelation, type TextOutcome } from './extract-metrics';
import { ALL as TEXTS } from './extraction';

const B = '\x1b[1m', D = '\x1b[2m', Y = '\x1b[33m', R = '\x1b[31m', O = '\x1b[0m';
const pct = (x: number): string => `${(100 * x).toFixed(1).padStart(5)}%`;

const quote = (span: Span, text: string): string => {
  const r = resolveSpan(span, { content: { text } });
  return r.ok ? r.quote : `<${r.reason}>`;
};

const outcomes: TextOutcome[] = TEXTS.map((t) => {
  const emitted: EmittedRelation[] = extract(t.id, t.text).map((e) => ({
    predicate: e.predicate,
    subject: quote(e.subject, t.text),
    object: quote(e.object, t.text),
  }));
  return judgeText(t.id, t.family, t.gold, emitted);
});

const s = scoreExtraction(outcomes);

console.log(`\n${B}extraction — ${s.texts} labelled texts, ${s.gold} gold relations${O}`);
console.log(`${D}labels and code written by the same session; see eval/extraction.ts${O}\n`);

console.log(`  ${B}strict triple matching${O}  ${D}predicate + subject + object must all be right${O}`);
console.log(`    precision  ${pct(s.precision)}   ${D}${s.truePositives}/${s.emitted} emitted were correct${O}`);
console.log(`    recall     ${pct(s.recall)}   ${D}${s.truePositives}/${s.gold} gold relations found${O}`);
console.log(`    F1         ${pct(s.f1)}`);

console.log(`\n  ${B}silence${O}  ${D}reported apart, so an extractor that emits nothing cannot look good${O}`);
console.log(`    silent on  ${pct(s.silenceRate)}   ${D}${s.silent}/${s.negatives} texts that state no relation${O}`);

console.log(`\n  ${B}by family${O}`);
for (const [family, f] of [...byFamily(outcomes)].sort()) {
  const isNeg = family.startsWith('negative');
  const headline = isNeg ? `silence ${pct(f.silenceRate)}` : `recall ${pct(f.recall)}  precision ${pct(f.precision)}`;
  const extra = isNeg && f.falsePositives > 0 ? `  ${R}${f.falsePositives} false positive(s)${O}` : '';
  console.log(`    ${family.padEnd(22)} ${headline}${extra}`);
}

const wrong = outcomes.filter((o) => o.falsePositives.length > 0 || o.falseNegatives.length > 0);
if (wrong.length > 0) {
  console.log(`\n  ${B}every text that got something wrong${O}`);
  for (const o of wrong) {
    const t = TEXTS.find((x) => x.id === o.id)!;
    console.log(`\n    ${B}${o.id}${O} ${D}[${o.family}]${O}  ${JSON.stringify(t.text.slice(0, 66))}`);
    for (const fp of o.falsePositives) {
      console.log(`      ${R}emitted, not stated${O}  ${fp.predicate}  ${JSON.stringify(fp.subject)} → ${JSON.stringify(fp.object)}`);
    }
    for (const fn of o.falseNegatives) {
      console.log(`      ${Y}stated, not emitted${O}  ${fn.predicate}  ${JSON.stringify(fn.subject)} → ${JSON.stringify(fn.object)}`);
    }
    if (t.note !== undefined) console.log(`      ${D}${t.note}${O}`);
  }
}

console.log(`\n${D}${s.negatives} of ${s.texts} texts state no relation. A set of only positive texts${O}`);
console.log(`${D}cannot see finding A-8 at all: an extractor that fires on everything scores 100% recall.${O}\n`);
