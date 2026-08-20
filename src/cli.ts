#!/usr/bin/env bun
/**
 * The CLI — the one runnable thing this phase can be pointed at.
 *
 * `build-phase-machine` defines a phase as "the largest unit of work that ends with one runnable
 * thing you can point at". Not "the store layer" — `engine record` runs and a decision survives a
 * restart.
 *
 * Exit codes: 0 success · 1 the operation failed · 2 the invocation was wrong.
 * A broken store reports what is wrong; it never shows a stack trace, because a stack trace tells
 * a user nothing they can act on.
 */

import { resolveWorkspace, storePaths, WorkspaceError } from './store/paths';
import { Store, StoreError } from './store/store';
import { readLog } from './store/log';
import { retrieve, type Doc, type Link } from './retrieval/channels';
import { assertCausalEdgeType } from './decision/causal';
import { chainPath } from './decision/path';

const B = '\x1b[1m', D = '\x1b[2m', G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', O = '\x1b[0m';

interface Args {
  readonly cmd: string;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

function parse(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    } else positional.push(a);
  }
  return { cmd: positional[0] ?? '', positional: positional.slice(1), flags };
}

const USAGE = `${B}context graph engine${O}

  ${B}engine record${O} <id> --text <s> [--kind node|decision] [--valid-from <iso>] [--valid-until <iso>]
  ${B}engine link${O}   <source> <target> --type CAUSED|INFLUENCED|PRECEDENT_FOR [--weight 0..1]
  ${B}engine retract${O} <id> [--reason <s>] [--at <iso>]   close its window at <iso> (default: now);
                                                       the content stays answerable
  ${B}engine purge${O}   <id> [--reason <s>]      remove the content; leave a tombstone
  ${B}engine at${O}      <iso> [--as-of <iso>]    point-in-time snapshot (two time axes)
  ${B}engine why${O}     <id> [--direction upstream|downstream] [--depth 5]
  ${B}engine find${O}    <query...> [--no-record]  lexical + structural, fused (records the decision)
  ${B}engine suggest${O} [--min 0.6]                records that look like the same thing (writes nothing)
  ${B}engine merge${O}   <id> <id> [...] --canonical <id> [--reason <s>]
                                               assert they ARE one thing; reads then resolve to
                                               the canonical. Retract the merge to undo it.
  ${B}engine extract${O} <id>                       relations the record's TEXT states (writes nothing)
  ${B}engine confirm${O} <id> --n <i> --from <id> --to <id> [--note <s>]
                                               turn proposal #i into an edge, carrying the span
                                               it was read from. You choose the endpoints.
  ${B}engine view${O}    <id>                          everything merged with this record, composed
  ${B}engine refers${O}  <phrase...> [--limit 5]        which records a phrase might refer to
  ${B}engine evidence${O} <edge-id>                 resolve an edge's span back to the text now
  ${B}engine verify${O}                           check the whole chain
  ${B}engine log${O}      [--raw]                 list the records

${D}Store location comes from --workspace, then GRAPH_ENGINE_WORKSPACE, then CLAUDE_PROJECT_DIR.
There is deliberately no current-directory fallback — see DEC-002.${O}
`;

async function openStore(flags: Args['flags']): Promise<Store> {
  const explicit = typeof flags['workspace'] === 'string' ? flags['workspace'] : undefined;
  const env = explicit !== undefined ? { GRAPH_ENGINE_WORKSPACE: explicit } : process.env;
  const ws = resolveWorkspace({ env, startDir: process.cwd() });
  return Store.open(storePaths(ws));
}

function need(args: Args, i: number, what: string): string {
  const v = args.positional[i];
  if (v === undefined) { console.error(`${R}error${O}: missing <${what}>\n\n${USAGE}`); process.exit(2); }
  return v;
}

async function main(): Promise<number> {
  const args = parse(process.argv.slice(2));

  if (args.cmd === '' || args.cmd === 'help' || args.flags['help'] === true) {
    console.log(USAGE);
    return 0;
  }

  const known = ['record', 'link', 'retract', 'purge', 'at', 'why', 'find', 'suggest', 'merge', 'extract', 'confirm', 'refers', 'view', 'evidence', 'verify', 'log'];
  if (!known.includes(args.cmd)) {
    console.error(`${R}error${O}: unknown command ${JSON.stringify(args.cmd)}\n${D}known: ${known.join(', ')}${O}\n`);
    return 2;
  }

  const store = await openStore(args.flags);
  const str = (k: string): string | undefined => (typeof args.flags[k] === 'string' ? args.flags[k] as string : undefined);

  switch (args.cmd) {
    case 'record': {
      const id = need(args, 0, 'id');
      const text = str('text');
      if (text === undefined) { console.error(`${R}error${O}: --text is required`); return 2; }
      const kind = str('kind') === 'decision' ? 'decision' as const : 'node' as const;
      const rec = await store.append({
        kind, id, content: { text },
        validFrom: str('valid-from') ?? null, validUntil: str('valid-until') ?? null,
      });
      console.log(`${G}recorded${O} ${kind} ${B}${id}${O}  seq=${rec.seq}  digest=${rec.digest.slice(0, 12)}…`);
      return 0;
    }
    case 'link': {
      const source = need(args, 0, 'source'), target = need(args, 1, 'target');
      const type = assertCausalEdgeType(str('type') ?? 'INFLUENCED');
      const weight = Number(str('weight') ?? '1');
      const id = `${source}->${target}:${type}`;
      const rec = await store.append({ kind: 'edge', id, content: { note: str('note') ?? '' }, source, target, edgeType: type, weight });
      console.log(`${G}linked${O} ${source} --${type}(${weight})--> ${target}  seq=${rec.seq}`);
      return 0;
    }
    case 'retract': {
      const id = need(args, 0, 'id');
      const r = await store.retract(id, str('reason') ?? null, str('at'));
      console.log(`${Y}retracted${O} ${B}${id}${O} — window closed at ${String(r.meta.validFrom)}  ${D}(recorded ${r.meta.recordedAt}; content kept)${O}`);
      return 0;
    }
    case 'purge': {
      const id = need(args, 0, 'id');
      const t = await store.purge(id, str('reason') ?? null);
      console.log(`${Y}purged${O} ${B}${id}${O} at ${t.meta.recordedAt}`);
      console.log(`${D}  tombstone scope: ${String(t.meta.scope)} — this store only. Copies elsewhere are not reached.${O}`);
      return 0;
    }
    case 'at': {
      const when = need(args, 0, 'iso-timestamp');
      const asOf = str('as-of');
      const snap = asOf === undefined ? store.stateAt(when) : store.stateAt(when, asOf);
      console.log(`${B}valid at${O} ${snap.validAt}${asOf ? `  ${B}as the store stood at${O} ${asOf}` : ''}`);
      console.log(`  nodes: ${snap.nodes.map((n) => n.id).join(', ') || D + '(none)' + O}`);
      console.log(`  edges: ${snap.edges.map((e) => e.id).join(', ') || D + '(none)' + O}`);
      if (snap.rejected.length > 0) {
        console.log(`  ${Y}rejected${O}: ${snap.rejected.map((r) => `${r.id}.${r.field} (${r.reason})`).join(', ')}`);
      }
      return 0;
    }
    case 'why': {
      const id = need(args, 0, 'id');
      const dir = str('direction') === 'downstream' ? 'downstream' as const : 'upstream' as const;
      const reports = store.why(id, dir, Number(str('depth') ?? '5'));
      if (reports.length === 0) { console.log(`${D}no causal chains ${dir} of ${id}${O}`); return 0; }
      for (const r of reports) {
        console.log(`\n${B}${chainPath(r.hops, dir).join(' → ')}${O}`);
        console.log(`  hops ${r.hopCount}  band ${r.distanceBand}`);
        console.log(`  product  ${r.productConfidence.toFixed(3)}  ${D}assumes independence — a lower bound${O}`);
        console.log(`  weakest  ${r.weakestConfidence.toFixed(3)}  ${D}assumption-free${O}`);
        console.log(`  ${Y}weakest link${O}: ${r.weakestLink!.from} --${r.weakestLink!.type}(${r.weakestLink!.weight})--> ${r.weakestLink!.to}`);
      }
      return 0;
    }
    case 'find': {
      const query = args.positional.join(' ');
      if (query === '') { console.error(`${R}error${O}: give a query`); return 2; }
      const docs: Doc[] = store.searchable().map((d) => ({ id: d.id, text: d.text }));
      const links: Link[] = store.listEdges().map((e) => ({ source: String(e.meta.source), target: String(e.meta.target) }));
      const { decision, items } = retrieve(docs, links, query);
      // DEC-005 lists retrieval decisions as stored. A query therefore appends.
      if (args.flags['no-record'] !== true) await store.recordRetrieval(decision);

      console.log(`${B}${decision.outcome}${O}  ${D}query ${decision.queryHash} (${decision.queryChars} chars)${O}`);
      for (const c of decision.channels) {
        const top = c.topScore === null ? '—' : c.topScore.toFixed(3);
        const m = c.margin === null ? '—' : (c.margin >= 0 ? '+' : '') + c.margin.toFixed(3);
        console.log(`  ${c.channel.padEnd(11)} considered=${String(c.considered).padEnd(3)} top=${top.padEnd(7)} floor=${String(c.floor).padEnd(6)} margin=${m}`);
      }
      if (decision.reason !== null) console.log(`  ${Y}reason${O}: ${decision.reason}`);
      for (const i of items) {
        console.log(`  ${G}→${O} ${i.id}  ${i.fusedScore.toFixed(5)}  ${D}${i.contributions.map((c) => `${c.channel}#${c.rank}`).join(' ')}${O}`);
      }
      return 0;
    }
    case 'extract': {
      const id = need(args, 0, 'record-id');
      // DEC-013: this writes nothing. The proposals are derived, and the quotes are resolved for
      // reading rather than stored anywhere.
      const proposals = store.propose(id);
      if (proposals.length === 0) {
        console.log(`${D}nothing in ${id}'s text states a relation any rule recognises${O}`);
        return 0;
      }
      proposals.forEach((p, i) => {
        console.log(`\n${B}#${i}${O}  ${p.predicate}  ${D}[${p.rule}]${O}`);
        console.log(`  subject  ${JSON.stringify(p.subjectText)}`);
        console.log(`  object   ${JSON.stringify(p.objectText)}`);
        console.log(`  ${Y}stated by${O} ${JSON.stringify(p.triggerText)}`);
        // 3 is a DISPLAY cap chosen here, at the surface that displays it — DEC-014 keeps the
        // number out of the linker, because it shortens a list rather than deciding an identity.
        for (const [role, lr] of [['subject', p.subjectLink], ['object', p.objectLink]] as const) {
          const top = lr.candidates.slice(0, 3);
          if (top.length === 0) { console.log(`  ${D}${role} → no candidate records${O}`); continue; }
          const m = lr.margin === null ? '' : `  ${D}margin ${lr.margin.toFixed(3)}${O}`;
          const vc = lr.verdict === 'weak' ? Y : D;
          console.log(`  ${vc}${role} → ${lr.verdict}${O}${m}${lr.verdict === 'weak' ? `  ${Y}(probably none of these)${O}` : ''}`);
          for (const c of top) console.log(`      ${c.score.toFixed(3)}  ${c.id}`);
        }
        // Pre-fill an endpoint ONLY when there is exactly one candidate. That is a fact about the
        // list, not a threshold — DEC-014 forbids one. Filling in rank 1 from an ambiguous list
        // would put the engine's guess on the command line the caller runs, which is the very
        // thing "reports, never decides" exists to prevent: the margin printed two lines above
        // does not survive a copy-paste.
        const only = (lr: typeof p.subjectLink): string =>
          lr.candidates.length === 1 ? (lr.candidates[0] as { id: string }).id : '<record>';
        const guessFrom = only(p.subjectLink);
        const guessTo = only(p.objectLink);
        console.log(`  ${D}to accept: engine confirm ${id} --n ${i} --from ${guessFrom} --to ${guessTo}${O}`);
      });
      console.log(`\n${D}Nothing was written. These say what the TEXT states; they do not say which${O}`);
      console.log(`${D}records the subject and object are — nothing here recognises entities, so you${O}`);
      console.log(`${D}name the endpoints yourself.${O}`);
      return 0;
    }
    case 'confirm': {
      const id = need(args, 0, 'record-id');
      const from = str('from'), to = str('to');
      if (from === undefined || to === undefined) {
        console.error(`${R}error${O}: --from and --to are required — an extractor does not know which records these are`);
        return 2;
      }
      const n = Number(str('n') ?? '0');
      // Re-running extraction is deterministic: the record is immutable (DEC-007) and the rules are
      // a module constant, so proposal #n is the same one `extract` printed.
      const proposals = store.propose(id);
      const p = proposals[n];
      if (p === undefined) {
        console.error(`${R}error${O}: no proposal #${n} for ${id} — extract found ${proposals.length}`);
        return 2;
      }
      const rec = await store.confirm(p, from, to, str('note') ?? null);
      console.log(`${G}confirmed${O} ${from} --${p.predicate}--> ${to}  seq=${rec.seq}`);
      console.log(`${D}  evidence: ${JSON.stringify(p.triggerText)} in ${id} [${p.rule}]${O}`);
      console.log(`${D}  the edge stores offsets, not that text — purge ${id} and the evidence goes with it.${O}`);
      return 0;
    }
    case 'view': {
      const id = need(args, 0, 'id');
      const v = store.mergedView(id);
      console.log(`${B}${v.requested}${O}${v.via === null ? `  ${D}(in no merge)${O}` : `  ${D}→ ${v.canonical} via ${v.via}${O}`}`);
      if (v.members.length > 1) console.log(`  ${D}members: ${v.members.join(', ')}${O}`);
      console.log(`  ${JSON.stringify(v.content)}`);
      for (const c of v.conflicts) {
        console.log(`  ${Y}conflict${O} on ${B}${c.field}${O}:`);
        for (const val of c.values) console.log(`      ${JSON.stringify(val.value)}  ${D}from ${val.from.join(', ')}${O}`);
      }
      if (v.unavailable.length > 0) {
        console.log(`  ${Y}unavailable${O}: ${v.unavailable.join(', ')} ${D}(purged — their fields are absent above)${O}`);
      }
      if (v.conflicts.length > 0) {
        console.log(`\n${D}The canonical's value is the one shown. A conflict is often why a merge was wrong.${O}`);
      }
      return 0;
    }
    case 'refers': {
      const phrase = args.positional.join(' ');
      if (phrase === '') { console.error(`${R}error${O}: give a phrase`); return 2; }
      const r = store.linkMention(phrase, { limit: Number(str('limit') ?? '5') });
      const verdictColour = r.verdict === 'weak' || r.verdict === 'no_candidates' ? Y : G;
      console.log(`${B}${JSON.stringify(r.mention)}${O}  ${verdictColour}${r.verdict}${O}${r.margin === null ? '' : `  ${D}margin ${r.margin.toFixed(3)}${O}`}`);
      if (r.verdict === 'weak') {
        console.log(`  ${Y}nothing here matches well.${O} ${D}Most phrases that refer to nothing land here.${O}`);
        console.log(`  ${D}The candidates below are shown anyway, and are probably not the answer.${O}`);
      }
      if (r.candidates.length === 0) { console.log(`  ${D}no record shares enough with that phrase to be a candidate${O}`); return 0; }
      for (const c of r.candidates) console.log(`  ${c.score.toFixed(3)}  ${B}${c.id}${O}  ${D}${c.name.slice(0, 50)}${O}`);
      console.log(`\n${D}Ranked, not decided. No threshold was applied — the margin is the gap to the${O}`);
      console.log(`${D}runner-up, and a small one means rank 1 is not an answer.${O}`);
      return 0;
    }
    case 'evidence': {
      const edgeId = need(args, 0, 'edge-id');
      const ev = store.evidenceFor(edgeId);
      if (ev === null) { console.log(`${D}${edgeId} carries no extraction provenance — it was asserted by hand${O}`); return 0; }
      console.log(`${B}${ev.edge}${O}  ${D}[${ev.rule ?? 'no rule recorded'}]${O}`);
      console.log(`  read from ${B}${ev.source}${O}`);
      if (ev.quote.ok) console.log(`  ${G}states${O}: ${JSON.stringify(ev.quote.quote)}`);
      else console.log(`  ${Y}unresolvable${O}: ${ev.quote.reason}`);
      return 0;
    }
    case 'suggest': {
      // Derived, never stored — DEC-012. This verb writes nothing, deliberately.
      const proposals = store.suggest(Number(str('min') ?? '0.6'));
      if (proposals.length === 0) { console.log(`${D}nothing looks duplicated above that score${O}`); return 0; }
      for (const p of proposals) {
        console.log(`\n${B}${p.members.join('  ')}${O}`);
        const w = p.weakestLink;
        if (w !== null) {
          console.log(`  weakest link ${Y}${w.score.toFixed(3)}${O}  ${D}${w.a} ~ ${w.b}${O}`);
        }
        console.log(`  ${D}to accept: engine merge ${p.members.join(' ')} --canonical ${p.members[0]}${O}`);
      }
      console.log(`\n${D}These are suggestions and nothing was written. Similarity is not transitive —${O}`);
      console.log(`${D}check the weakest link before accepting a group of more than two.${O}`);
      return 0;
    }
    case 'merge': {
      const members = args.positional;
      const canonical = str('canonical');
      if (canonical === undefined) { console.error(`${R}error${O}: --canonical is required — say which record the others resolve to`); return 2; }
      const rec = await store.merge(members, canonical, str('reason') ?? null);
      console.log(`${G}merged${O} ${members.join(' + ')} ${B}→ ${canonical}${O}  seq=${rec.seq}`);
      console.log(`${D}  nothing was rewritten; reads for the others now answer from ${canonical} and name ${rec.id}.${O}`);
      console.log(`${D}  to undo: engine retract ${rec.id}${O}`);
      return 0;
    }
    case 'verify': {
      const r = store.verify();
      if (r.valid) { console.log(`${G}✓${O} chain verifies — ${r.total} record(s), ${r.purged} purged, 0 problems`); return 0; }
      console.log(`${R}✗${O} chain INVALID — ${r.problems.length} problem(s)`);
      for (const p of r.problems) console.log(`    ${R}${p.reason}${O} at seq ${p.seq} (${p.id})`);
      return 1;
    }
    case 'log': {
      const raw = readLog(storePaths(resolveWorkspace({
        env: typeof args.flags['workspace'] === 'string' ? { GRAPH_ENGINE_WORKSPACE: args.flags['workspace'] } : process.env,
        startDir: process.cwd(),
      })));
      if (args.flags['raw'] === true) { for (const r of raw) console.log(JSON.stringify(r)); return 0; }
      console.log(`${D}seq  kind         id                        digest        content${O}`);
      for (const r of raw) {
        const c = r.content === null ? `${Y}⌀ purged${O}` : JSON.stringify(r.content).slice(0, 38);
        console.log(`${String(r.seq).padEnd(4)} ${r.kind.padEnd(12)} ${r.id.slice(0, 25).padEnd(25)} ${r.digest.slice(0, 12)}… ${c}`);
      }
      return 0;
    }
    default:
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    // A user gets a reason, not a stack trace. The reason codes are the stable part.
    if (e instanceof StoreError || e instanceof WorkspaceError) {
      console.error(`${R}error${O}: ${e.message}`);
      process.exit(1);
    }
    console.error(`${R}error${O}: ${(e as Error).message}`);
    process.exit(1);
  });
