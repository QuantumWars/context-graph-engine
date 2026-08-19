#!/usr/bin/env bun
/**
 * Load this repository's own build history into a real store.
 *
 * The engine's first non-synthetic corpus is the decision history that produced it: eleven `DEC-`
 * records, seven phase summaries, six research notes, and the real links between them —
 * supersessions (`DEC-007` supersedes `DEC-006`, `DEC-010` supersedes `DEC-001`) and every
 * cross-reference one document makes to another.
 *
 * This is not a demo fixture. Every record is a decision someone actually made, every edge is a
 * reference that actually exists in the text, and the graph shape was not chosen to flatter
 * anything — it is whatever the documents happen to say.
 *
 *   bun --cwd engine scripts/seed-from-build.ts <workspace-dir>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Store } from '../src/store/store';
import { resolveWorkspace, storePaths } from '../src/store/paths';

const ROOT = join(import.meta.dir, '..');
const target = process.argv[2];
if (target === undefined) {
  console.error('usage: seed-from-build.ts <workspace-dir>');
  process.exit(2);
}

interface Doc { id: string; kind: 'decision' | 'node'; title: string; body: string;
  refs: string[]; supersedes: string[] }

/** First heading, then the first few prose paragraphs — enough to be searchable, not the whole file. */
function summarise(text: string): { title: string; body: string } {
  const lines = text.split('\n');
  const title = (lines.find((l) => l.startsWith('# ')) ?? '').replace(/^#\s*/, '').trim();
  const prose = lines
    .filter((l) => !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('```') && !l.startsWith('>'))
    .map((l) => l.trim())
    .filter((l) => l.length > 30)
    .slice(0, 6)
    .join(' ');
  return { title, body: prose.slice(0, 900) };
}

const docs: Doc[] = [];

function collect(dir: string, match: RegExp, id: (f: string) => string, kind: Doc['kind']): void {
  for (const f of readdirSync(join(ROOT, dir)).sort()) {
    if (!match.test(f)) continue;
    const raw = readFileSync(join(ROOT, dir, f), 'utf8');
    const { title, body } = summarise(raw);
    const refs = [...new Set([...raw.matchAll(/\bDEC-(\d{3})\b/g)].map((m) => `DEC-${m[1]}`))];
    // Supersession is read from the text, not assumed — it is the strongest link a decision
    // record can carry and deserves its own edge type.
    const supersedes = [...new Set([...raw.matchAll(/Supersedes `?(DEC-\d{3})`?/gi)].map((m) => m[1] as string))];
    docs.push({ id: id(f), kind, title, body, refs, supersedes });
  }
}

collect('build', /^DEC-\d{3}.*\.md$/, (f) => basename(f).slice(0, 7), 'decision');
collect('build', /^phase-\d-summary\.md$/, (f) => basename(f, '.md'), 'decision');
collect('docs/research', /\.md$/, (f) => `research-${basename(f, '.md').slice(0, 2)}`, 'node');
collect('docs/future-work', /^\d\d.*\.md$/, (f) => `future-${basename(f, '.md').slice(0, 2)}`, 'node');

const ids = new Set(docs.map((d) => d.id));
const ws = resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: target } });
const store = await Store.open(storePaths(ws));

for (const d of docs) {
  await store.append({ kind: d.kind, id: d.id, content: { text: `${d.title}. ${d.body}` } });
}

let influenced = 0, superseded = 0;
for (const d of docs) {
  for (const ref of d.supersedes) {
    if (!ids.has(ref) || ref === d.id) continue;
    // The superseded decision CAUSED the one that replaced it — a real, asserted link.
    await store.append({
      kind: 'edge', id: `${ref}->${d.id}:CAUSED`, content: {},
      source: ref, target: d.id, edgeType: 'CAUSED', weight: 0.95,
    });
    superseded++;
  }
  for (const ref of d.refs) {
    if (ref === d.id || !ids.has(ref) || d.supersedes.includes(ref)) continue;
    await store.append({
      kind: 'edge', id: `${ref}->${d.id}:INFLUENCED`, content: {},
      source: ref, target: d.id, edgeType: 'INFLUENCED', weight: 0.6,
    });
    influenced++;
  }
}

const report = store.verify();
console.log(`  records : ${docs.length}  (${docs.filter((d) => d.kind === 'decision').length} decisions)`);
console.log(`  edges   : ${influenced + superseded}  (${superseded} CAUSED from supersession, ${influenced} INFLUENCED from citation)`);
console.log(`  total   : ${store.all().length} log entries`);
console.log(`  chain   : ${report.valid ? 'verifies' : 'INVALID'} — ${report.total} entries, ${report.problems.length} problems`);
console.log(`  store   : ${storePaths(ws).log}`);
