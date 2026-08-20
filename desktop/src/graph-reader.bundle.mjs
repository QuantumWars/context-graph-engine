// ../src/provenance/chain.ts
import { createHash } from "node:crypto";

// ../src/provenance/canonical.ts
class CanonicalError extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CanonicalError";
    this.code = code;
  }
}
function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function write(value, out) {
  if (value === null) {
    out.push("null");
    return;
  }
  switch (typeof value) {
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalError("non_finite_number", `${String(value)} has no JSON representation and must not be silently coerced`);
      }
      out.push(JSON.stringify(value));
      return;
    case "string":
      out.push(JSON.stringify(value));
      return;
    case "object":
      break;
    default:
      throw new CanonicalError("unsupported_type", `${typeof value} cannot appear in a canonical record`);
  }
  if (Array.isArray(value)) {
    out.push("[");
    for (let i = 0;i < value.length; i++) {
      if (i > 0)
        out.push(",");
      const item = value[i];
      if (item === undefined) {
        throw new CanonicalError("unsupported_type", `undefined at array index ${i} has no canonical form`);
      }
      write(item, out);
    }
    out.push("]");
    return;
  }
  const obj = value;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort(byCodeUnit);
  out.push("{");
  for (let i = 0;i < keys.length; i++) {
    if (i > 0)
      out.push(",");
    const k = keys[i];
    out.push(JSON.stringify(k), ":");
    write(obj[k], out);
  }
  out.push("}");
}
function canonicalJson(value) {
  if (value === undefined) {
    throw new CanonicalError("undefined_root", "undefined is not a canonicalisable value");
  }
  const out = [];
  write(value, out);
  return out.join("");
}

// ../src/provenance/chain.ts
function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function isPurged(entry) {
  return entry.salt === null && entry.content === null;
}
function computeContentDigest(salt, content) {
  return sha256(`${salt.length}:${salt}${canonicalJson(content)}`);
}
function computeDigest(f) {
  return sha256(canonicalJson({
    contentDigest: f.contentDigest,
    id: f.id,
    kind: f.kind,
    meta: f.meta,
    prev: f.prev,
    seq: f.seq
  }));
}
function appendEntry(chain, input, salt) {
  const head = chain.length > 0 ? chain[chain.length - 1] : undefined;
  const contentDigest = computeContentDigest(salt, input.content);
  const attested = {
    kind: input.kind,
    id: input.id,
    seq: head ? head.seq + 1 : 1,
    prev: head ? head.digest : null,
    contentDigest,
    meta: input.meta ?? {}
  };
  return { ...attested, digest: computeDigest(attested), salt, content: input.content };
}
function verifyChain(entries) {
  const problems = [];
  let expectedPrev = null;
  let expectedSeq = null;
  let purged = 0;
  for (const e of entries) {
    const gone = isPurged(e);
    if (gone)
      purged++;
    if (!gone) {
      if (e.salt === null || e.content === null) {
        problems.push({
          id: e.id,
          seq: e.seq,
          reason: "content_tampered",
          expected: "salt and content both present, or both absent",
          actual: e.salt === null ? "salt removed, content kept" : "content removed, salt kept"
        });
      } else {
        const recomputed = computeContentDigest(e.salt, e.content);
        if (recomputed !== e.contentDigest) {
          problems.push({
            id: e.id,
            seq: e.seq,
            reason: "content_tampered",
            expected: e.contentDigest,
            actual: recomputed
          });
        }
      }
    }
    const recomputedDigest = computeDigest(e);
    if (recomputedDigest !== e.digest) {
      problems.push({
        id: e.id,
        seq: e.seq,
        reason: "digest_mismatch",
        expected: e.digest,
        actual: recomputedDigest
      });
    }
    if (e.prev !== expectedPrev) {
      problems.push({
        id: e.id,
        seq: e.seq,
        reason: "chain_break",
        expected: expectedPrev,
        actual: e.prev
      });
    }
    const wantSeq = expectedSeq === null ? 1 : expectedSeq + 1;
    if (e.seq !== wantSeq) {
      problems.push({
        id: e.id,
        seq: e.seq,
        reason: "sequence_gap",
        expected: wantSeq,
        actual: e.seq
      });
    }
    expectedPrev = e.digest;
    expectedSeq = e.seq;
  }
  return { valid: problems.length === 0, total: entries.length, purged, problems };
}
function purgeContent(entry) {
  return { ...entry, salt: null, content: null };
}

// ../src/temporal/window.ts
var DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
var HAS_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;
var CALENDAR = /^(\d{4})-(\d{2})-(\d{2})/;
function isRealCalendarDate(s) {
  const m = CALENDAR.exec(s);
  if (m === null)
    return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1)
    return false;
  const leap = y % 4 === 0 && y % 100 !== 0 || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}
function parseInstant(value) {
  const s = value.trim();
  if (s === "")
    return { ok: false, reason: "malformed_temporal_value" };
  if (!isRealCalendarDate(s))
    return { ok: false, reason: "malformed_temporal_value" };
  if (DATE_ONLY.test(s)) {
    const ms2 = Date.parse(`${s}T00:00:00Z`);
    return Number.isNaN(ms2) ? { ok: false, reason: "malformed_temporal_value" } : { ok: true, ms: ms2 };
  }
  if (!s.includes("T"))
    return { ok: false, reason: "malformed_temporal_value" };
  if (!HAS_OFFSET.test(s))
    return { ok: false, reason: "ambiguous_timezone" };
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? { ok: false, reason: "malformed_temporal_value" } : { ok: true, ms };
}
function resolve(r) {
  const rejections = [];
  const recorded = parseInstant(r.recordedAt);
  if (!recorded.ok) {
    rejections.push({ id: r.id, field: "recordedAt", reason: recorded.reason, value: r.recordedAt });
  }
  let from = null;
  if (r.validFrom !== null) {
    const p = parseInstant(r.validFrom);
    if (!p.ok)
      rejections.push({ id: r.id, field: "validFrom", reason: p.reason, value: r.validFrom });
    else
      from = p.ms;
  }
  let until = null;
  if (r.validUntil !== null) {
    const p = parseInstant(r.validUntil);
    if (!p.ok)
      rejections.push({ id: r.id, field: "validUntil", reason: p.reason, value: r.validUntil });
    else
      until = p.ms;
  }
  if (from !== null && until !== null && from > until) {
    rejections.push({ id: r.id, field: "window", reason: "inverted_window", value: `${r.validFrom}/${r.validUntil}` });
  }
  if (rejections.length > 0)
    return { rejections };
  return { ms: { from, until, recorded: recorded.ms } };
}
function withinWindow(at, from, until) {
  if (from !== null && at < from)
    return false;
  if (until !== null && at > until)
    return false;
  return true;
}
function stateAt(nodes, edges, opts) {
  const rejected = [];
  const at = parseInstant(opts.validAt);
  if (!at.ok) {
    throw new Error(`${at.reason}: validAt ${JSON.stringify(opts.validAt)} is not a usable instant`);
  }
  let asOfMs = null;
  if (opts.asOf !== undefined) {
    const p = parseInstant(opts.asOf);
    if (!p.ok) {
      throw new Error(`${p.reason}: asOf ${JSON.stringify(opts.asOf)} is not a usable instant`);
    }
    asOfMs = p.ms;
  }
  const admit = (r) => {
    const res = resolve(r);
    if ("rejections" in res) {
      rejected.push(...res.rejections);
      return false;
    }
    if (asOfMs !== null && res.ms.recorded > asOfMs)
      return false;
    return withinWindow(at.ms, res.ms.from, res.ms.until);
  };
  const activeNodes = nodes.filter(admit);
  const activeIds = new Set(activeNodes.map((n) => n.id));
  const activeEdges = edges.filter((e) => admit(e) && activeIds.has(e.source) && activeIds.has(e.target));
  return {
    validAt: opts.validAt,
    asOf: opts.asOf ?? null,
    nodes: activeNodes,
    edges: activeEdges,
    rejected
  };
}

// ../src/temporal/retract.ts
class TemporalInputError extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "TemporalInputError";
    this.code = code;
  }
}
function requireInstant(value, what) {
  const p = parseInstant(value);
  if (!p.ok)
    throw new TemporalInputError(p.reason, `${what} ${JSON.stringify(value)}`);
  return p.ms;
}
function closingValidUntil(current, at) {
  const atMs = requireInstant(at, "retraction instant");
  if (current === null)
    return at;
  const existing = parseInstant(current);
  if (!existing.ok)
    return at;
  return existing.ms <= atMs ? current : at;
}

// ../src/decision/causal.ts
class CausalError extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CausalError";
    this.code = code;
  }
}
function findChains(edges, startId, opts) {
  if (!Number.isInteger(opts.maxDepth) || opts.maxDepth < 1) {
    throw new CausalError("invalid_max_depth", `maxDepth must be a positive integer, got ${String(opts.maxDepth)}`);
  }
  const out = [];
  const step = (current, path, onPath) => {
    if (path.length >= opts.maxDepth) {
      if (path.length > 0)
        out.push([...path]);
      return;
    }
    const next = edges.filter((e) => opts.direction === "downstream" ? e.source === current : e.target === current);
    const advanced = next.filter((e) => {
      const other = opts.direction === "downstream" ? e.target : e.source;
      return !onPath.has(other);
    });
    if (advanced.length === 0) {
      if (path.length > 0)
        out.push([...path]);
      return;
    }
    for (const e of advanced) {
      const other = opts.direction === "downstream" ? e.target : e.source;
      path.push({ from: e.source, to: e.target, type: e.type, weight: e.weight });
      step(other, path, new Set([...onPath, other]));
      path.pop();
    }
  };
  step(startId, [], new Set([startId]));
  return out;
}
var BAND_DIRECT_MAX = 1;
var BAND_NEAR_MAX = 3;
var BAND_MID_MAX = 6;
function classifyDistance(hopCount) {
  if (hopCount <= BAND_DIRECT_MAX)
    return "direct";
  if (hopCount <= BAND_NEAR_MAX)
    return "near";
  if (hopCount <= BAND_MID_MAX)
    return "mid-range";
  return "distant";
}
function chainReport(hops) {
  let product = 1;
  let weakest = null;
  for (const hop of hops) {
    product *= hop.weight;
    if (weakest === null || hop.weight < weakest.weight)
      weakest = hop;
  }
  return {
    hops,
    hopCount: hops.length,
    productConfidence: hops.length === 0 ? 1 : product,
    weakestConfidence: weakest === null ? 1 : weakest.weight,
    weakestLink: weakest,
    distanceBand: classifyDistance(hops.length)
  };
}

// ../src/store/log.ts
import { existsSync as existsSync2, readFileSync, writeFileSync as writeFileSync2 } from "node:fs";
import { appendFile } from "node:fs/promises";

// ../src/store/lock.ts
import { open, rename, rm, stat } from "node:fs/promises";
var DEFAULTS = {
  timeoutMs: 5000,
  retryMs: 15,
  staleMs: 30000
};

class LockTimeoutError extends Error {
  constructor(lockPath, timeoutMs, staleMs) {
    super(`withFileLock: timed out after ${timeoutMs}ms waiting for ${lockPath} — either another ` + `process genuinely holds it, or a crash left a stale lock older than ${staleMs}ms that a ` + `concurrent waiter hasn't broken yet.`);
    this.name = "LockTimeoutError";
  }
}
async function tryAcquire(lockPath) {
  try {
    const handle = await open(lockPath, "wx");
    try {
      await handle.writeFile(`${process.pid}
`);
    } finally {
      await handle.close();
    }
    return true;
  } catch (err) {
    if (err.code === "EEXIST")
      return false;
    throw err;
  }
}
async function breakIfStale(lockPath, staleMs) {
  try {
    const st = await stat(lockPath);
    if (Date.now() - st.mtimeMs > staleMs) {
      await rm(lockPath, { force: true });
    }
  } catch {}
}
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
async function withFileLock(path, fn, opts = {}) {
  const { timeoutMs, retryMs, staleMs } = { ...DEFAULTS, ...opts };
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;; ) {
    if (await tryAcquire(lockPath))
      break;
    await breakIfStale(lockPath, staleMs);
    if (Date.now() >= deadline)
      throw new LockTimeoutError(lockPath, timeoutMs, staleMs);
    await sleep(retryMs);
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

// ../src/store/records.ts
var RECORD_KINDS = ["node", "edge", "decision", "retraction", "tombstone", "retrieval", "merge"];
function isRecordKind(v) {
  return typeof v === "string" && RECORD_KINDS.includes(v);
}

// ../src/store/paths.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolve2 } from "node:path";

class WorkspaceError extends Error {
  code = "workspace_unresolved";
  constructor(message) {
    super(`workspace_unresolved: ${message}`);
    this.name = "WorkspaceError";
  }
}
var MARKERS = [".claude", ".git"];
function resolveWorkspace(opts = {}) {
  const env = opts.env ?? process.env;
  const explicit = env["GRAPH_ENGINE_WORKSPACE"];
  if (explicit !== undefined && explicit !== "") {
    return { root: resolve2(explicit), method: "env:GRAPH_ENGINE_WORKSPACE" };
  }
  const platform = env["CLAUDE_PROJECT_DIR"];
  if (platform !== undefined && platform !== "") {
    return { root: resolve2(platform), method: "env:CLAUDE_PROJECT_DIR" };
  }
  const start = opts.startDir;
  if (start === undefined) {
    throw new WorkspaceError("no GRAPH_ENGINE_WORKSPACE, no CLAUDE_PROJECT_DIR, and no startDir was given. " + "This engine does not fall back to the current working directory — DEC-002 rejects it " + "by name, because a directory change would silently swap which store is read.");
  }
  let dir = resolve2(start);
  for (;; ) {
    if (MARKERS.some((m) => existsSync(join(dir, m)))) {
      return { root: dir, method: "marker-walk" };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new WorkspaceError(`walked from ${JSON.stringify(resolve2(start))} to the filesystem root without finding ` + `any of ${MARKERS.join(", ")}. Set GRAPH_ENGINE_WORKSPACE to say explicitly which ` + "project this store belongs to.");
    }
    dir = parent;
  }
}
function storePaths(workspace) {
  const dir = join(workspace.root, ".claude", "graph-engine");
  return { workspace, dir, log: join(dir, "log.jsonl") };
}
function ensureStoreDir(paths) {
  if (!existsSync(paths.dir)) {
    mkdirSync(paths.dir, { recursive: true, mode: 448 });
  }
  const ignore = join(paths.dir, ".gitignore");
  if (!existsSync(ignore)) {
    writeFileSync(ignore, `# Captured context. Never committed — see DEC-005 and the monorepo constitution.
*
`, { mode: 384 });
  }
}

// ../src/store/log.ts
class LogError extends Error {
  code;
  line;
  constructor(code, line, message) {
    super(`${code}: line ${line}: ${message}`);
    this.name = "LogError";
    this.code = code;
    this.line = line;
  }
}
function readLog(paths) {
  if (!existsSync2(paths.log))
    return [];
  const text = readFileSync(paths.log, "utf8");
  const out = [];
  const lines = text.split(`
`);
  for (let i = 0;i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "")
      continue;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new LogError("malformed_line", i + 1, `not valid JSON (${e.message})`);
    }
    const rec = parsed;
    if (!isRecordKind(rec.kind)) {
      throw new LogError("unknown_kind", i + 1, `${JSON.stringify(String(rec.kind))} is not a record kind`);
    }
    out.push(rec);
  }
  return out;
}
function assertWorkspace(paths, records) {
  for (const r of records) {
    if (r.meta.workspace !== paths.workspace.root) {
      throw new LogError("workspace_mismatch", 0, `record ${JSON.stringify(r.id)} is stamped ${JSON.stringify(r.meta.workspace)} ` + `(via ${r.meta.workspaceMethod}) but this store is ${JSON.stringify(paths.workspace.root)} ` + `(via ${paths.workspace.method}). Refusing to write across a workspace boundary.`);
    }
  }
}
var serialise = (records) => records.length === 0 ? "" : records.map((r) => canonicalJson(r)).join(`
`) + `
`;
async function withLoggedMutation(paths, decide) {
  ensureStoreDir(paths);
  return withFileLock(paths.log, async () => {
    const current = readLog(paths);
    const m = await decide(current);
    if (m.rewrite !== undefined) {
      assertWorkspace(paths, m.rewrite);
      writeFileSync2(paths.log, serialise(m.rewrite), { encoding: "utf8", mode: 384 });
    } else if (m.append !== undefined && m.append.length > 0) {
      assertWorkspace(paths, m.append);
      await appendFile(paths.log, serialise(m.append), "utf8");
    }
    return m.value;
  });
}

// ../src/retrieval/channels.ts
class ContradictoryDecisionError extends Error {
  code = "contradictory_decision";
  constructor(message) {
    super(`contradictory_decision: ${message}`);
    this.name = "ContradictoryDecisionError";
  }
}
function assertConsistent(d) {
  if (d.outcome === "served" && d.served.length === 0) {
    throw new ContradictoryDecisionError('outcome is "served" but nothing was served');
  }
  if (d.outcome === "abstained" && d.served.length > 0) {
    throw new ContradictoryDecisionError(`outcome is "abstained" but ${d.served.length} item(s) were served`);
  }
  if (d.outcome !== "served" && d.reason === null) {
    throw new ContradictoryDecisionError(`outcome is "${d.outcome}" with no reason recorded`);
  }
}

// ../src/resolve/similarity.ts
var WEIGHTS = { name: 0.7, type: 0.2, props: 0.1 };
var MAX_SCORE_WITHOUT_PROPS = WEIGHTS.name + WEIGHTS.type;
function trigrams(s) {
  const t = ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const out = new Set;
  for (let i = 0;i + 3 <= t.length; i++)
    out.add(t.slice(i, i + 3));
  return out;
}
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0)
    return 1;
  let shared = 0;
  for (const x of a)
    if (b.has(x))
      shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}
function similarity(a, b) {
  const name = jaccard(trigrams(a.name), trigrams(b.name));
  const type = a.type === undefined || b.type === undefined ? 0 : a.type === b.type ? 1 : 0;
  const ka = Object.keys(a.props ?? {});
  const kb = Object.keys(b.props ?? {});
  const shared = ka.filter((k) => kb.includes(k));
  const props = shared.length === 0 ? 0 : shared.filter((k) => (a.props ?? {})[k] === (b.props ?? {})[k]).length / shared.length;
  return {
    total: WEIGHTS.name * name + WEIGHTS.type * type + WEIGHTS.props * props,
    name,
    type,
    props
  };
}

// ../src/resolve/blocking.ts
var TOKEN_PREFIX = 4;
var MIN_TOKEN_LENGTH = 3;
function tokens(name) {
  const parts = name.toLowerCase().replace(/[_\-/.]+/g, " ").split(/\s+/).filter(Boolean);
  const kept = parts.filter((t) => t.length >= MIN_TOKEN_LENGTH);
  return kept.length > 0 ? kept : parts.length > 0 ? [parts.join("")] : [];
}
function soundex(word) {
  const w = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (w === "")
    return "";
  const map = {
    B: "1",
    F: "1",
    P: "1",
    V: "1",
    C: "2",
    G: "2",
    J: "2",
    K: "2",
    Q: "2",
    S: "2",
    X: "2",
    Z: "2",
    D: "3",
    T: "3",
    L: "4",
    M: "5",
    N: "5",
    R: "6"
  };
  let out = w[0];
  for (const ch of w.slice(1)) {
    const d = map[ch];
    if (d !== undefined && d !== out[out.length - 1])
      out += d;
  }
  return (out + "000").slice(0, 4);
}
function blockKeys(c, o = {}) {
  const keys = new Set;
  const ts = tokens(c.name);
  if (ts.length === 0) {
    keys.add("nameless:");
    return keys;
  }
  for (const t of ts)
    keys.add(`tok:${t.slice(0, TOKEN_PREFIX)}`);
  if (o.typeScoped === true) {
    keys.add(`type:${(c.type ?? "unknown").toLowerCase()}:${ts[0].slice(0, TOKEN_PREFIX)}`);
  }
  if (o.phonetic === true)
    for (const t of ts)
      keys.add(`pho:${soundex(t)}`);
  return keys;
}
function capBySimilarity(pairs, max) {
  if (max === undefined || max <= 0)
    return pairs;
  const byRecord = new Map;
  const push = (id, p) => {
    const arr = byRecord.get(id);
    if (arr === undefined)
      byRecord.set(id, [p]);
    else
      arr.push(p);
  };
  for (const p of pairs) {
    push(p.a, p);
    push(p.b, p);
  }
  const kept = new Set;
  for (const [, ps] of byRecord) {
    ps.sort((x, y) => y.score - x.score || (`${x.a} ${x.b}` < `${y.a} ${y.b}` ? -1 : 1));
    for (const p of ps.slice(0, max))
      kept.add(`${p.a} ${p.b}`);
  }
  return pairs.filter((p) => kept.has(`${p.a} ${p.b}`));
}
function block(records, o = {}) {
  const blocks = new Map;
  const byId = new Map;
  for (const r of records) {
    byId.set(r.id, r);
    for (const k of blockKeys(r, o)) {
      const arr = blocks.get(k);
      if (arr === undefined)
        blocks.set(k, [r.id]);
      else
        arr.push(r.id);
    }
  }
  const seen = new Set;
  const pairs = [];
  for (const [, ids] of blocks) {
    for (let i = 0;i < ids.length; i++) {
      for (let j = i + 1;j < ids.length; j++) {
        const x = ids[i];
        const y = ids[j];
        const [a, b] = x < y ? [x, y] : [y, x];
        const key = `${a} ${b}`;
        if (seen.has(key))
          continue;
        seen.add(key);
        pairs.push({ a, b, score: similarity(byId.get(a), byId.get(b)).total });
      }
    }
  }
  const n = records.length;
  return {
    pairs: capBySimilarity(pairs, o.maxCandidates),
    allPairs: n * (n - 1) / 2,
    compared: pairs.length,
    blocks: blocks.size
  };
}

// ../src/extract/span.ts
function spannableText(content) {
  if (content === null || typeof content !== "object" || Array.isArray(content))
    return null;
  const t = content["text"];
  return typeof t === "string" ? t : null;
}
function resolveSpan(span, source, opts = {}) {
  if (source === undefined)
    return { ok: false, reason: "source_not_found" };
  if (opts.purged === true || source.content === null)
    return { ok: false, reason: "source_purged" };
  const text = spannableText(source.content);
  if (text === null)
    return { ok: false, reason: "source_has_no_text" };
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) {
    return { ok: false, reason: "span_not_integral" };
  }
  if (span.end < span.start)
    return { ok: false, reason: "span_inverted" };
  if (span.start < 0 || span.end > text.length)
    return { ok: false, reason: "span_out_of_bounds" };
  return { ok: true, quote: text.slice(span.start, span.end) };
}
function spanOf(source, start, end) {
  return { source, start, end };
}

// ../src/extract/polarity.ts
var POLARITY_CUES = [
  "not",
  "never",
  "no",
  "nor",
  "neither",
  "without",
  "nobody",
  "nothing",
  "none",
  "cannot",
  "hardly",
  "rarely",
  "seldom",
  "unable",
  "fails",
  "failed",
  "didn't",
  "doesn't",
  "wasn't",
  "weren't",
  "isn't",
  "aren't",
  "hasn't",
  "haven't",
  "denies",
  "denied",
  "refuted",
  "disproved",
  "rules out",
  "ruled out",
  "may",
  "might",
  "could",
  "possibly",
  "perhaps",
  "probably",
  "unclear",
  "unknown",
  "uncertain",
  "suspect",
  "suspected",
  "allegedly",
  "apparently",
  "seems",
  "seemed",
  "appears",
  "appeared",
  "likely",
  "unlikely",
  "presumably",
  "supposedly",
  "whether",
  "if",
  "unless",
  "would",
  "should",
  "assuming",
  "suppose",
  "hypothetically",
  "had",
  "believes",
  "believed",
  "thinks",
  "thought",
  "claims",
  "claimed",
  "alleges",
  "alleged"
];
var PSEUDO_CUES = [
  "no one disputes",
  "nobody disputes",
  "no one denies",
  "nobody denies",
  "not rule out",
  "cannot be ruled out",
  "no doubt",
  "not only"
];
var CLAUSE_BOUNDARY = /[.;:!?,]|\s+(?:and|but|however|though|although|because|so|yet|while|whereas)\s+/gi;
function governingClause(text, offset) {
  const before = text.slice(0, offset);
  let start = 0;
  CLAUSE_BOUNDARY.lastIndex = 0;
  for (let m = CLAUSE_BOUNDARY.exec(before);m !== null; m = CLAUSE_BOUNDARY.exec(before)) {
    start = m.index + m[0].length;
  }
  return before.slice(start);
}
var SUBJECT_BOUNDARY = /[.;:!?,]|\s+(?:that|which|who|whom|whose|and|but|however|though|although|because|so|yet|while|whereas)\s+/gi;
function trimmedSubjectStart(text, subjectStart, subjectEnd) {
  const within = text.slice(subjectStart, subjectEnd);
  let cut = 0;
  SUBJECT_BOUNDARY.lastIndex = 0;
  for (let m = SUBJECT_BOUNDARY.exec(within);m !== null; m = SUBJECT_BOUNDARY.exec(within)) {
    cut = m.index + m[0].length;
  }
  return subjectStart + cut;
}
function assertsRelation(text, triggerStart) {
  let clause = governingClause(text, triggerStart).toLowerCase();
  for (const pseudo of PSEUDO_CUES)
    clause = clause.split(pseudo).join(" ");
  for (const cue of POLARITY_CUES) {
    const pattern = new RegExp(`(?:^|[^a-z'])${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z'])`, "i");
    if (pattern.test(clause))
      return { asserted: false, cue };
  }
  return { asserted: true, cue: null };
}

// ../src/extract/rules.ts
var DEFAULT_RULES = [
  {
    id: "caused-direct",
    predicate: "CAUSED",
    pattern: /(?<subject>[\w-]+(?:\s+[\w-]+){0,3}?)(?:\s*,[^,.;:!?]*,)?\s+(?<verb>caused|led\s+to|resulted\s+in)\s+(?<object>[\w-]+(?:\s+[\w-]+){0,3})/gid
  },
  {
    id: "influenced-direct",
    predicate: "INFLUENCED",
    pattern: /(?<subject>[\w-]+(?:\s+[\w-]+){0,3}?)(?:\s*,[^,.;:!?]*,)?\s+(?<verb>influenced|informed|shaped)\s+(?<object>[\w-]+(?:\s+[\w-]+){0,3})/gid
  },
  {
    id: "precedent-for",
    predicate: "PRECEDENT_FOR",
    pattern: /(?<subject>[\w-]+(?:\s+[\w-]+){0,3}?)(?:\s*,[^,.;:!?]*,)?\s+(?<verb>set\s+(?:a\s+)?precedent\s+for|is\s+precedent\s+for)\s+(?<object>[\w-]+(?:\s+[\w-]+){0,3})/gid
  }
];
function extract(sourceId, text, rules = DEFAULT_RULES) {
  return extractWithSuppressed(sourceId, text, rules).relations;
}
function extractWithSuppressed(sourceId, text, rules = DEFAULT_RULES) {
  const out = [];
  const suppressed = [];
  for (const rule of rules) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("d") ? rule.pattern.flags : `${rule.pattern.flags}d`);
    for (const m of text.matchAll(re)) {
      const g = m.indices?.groups;
      const whole = m.indices?.[0];
      if (g === undefined || whole === undefined)
        continue;
      const s = g["subject"];
      const o = g["object"];
      const v = g["verb"];
      if (s === undefined || o === undefined || v === undefined)
        continue;
      const polarity = assertsRelation(text, v[0]);
      if (!polarity.asserted) {
        suppressed.push({ rule: rule.id, cue: polarity.cue, trigger: spanOf(sourceId, whole[0], whole[1]) });
        continue;
      }
      out.push({
        predicate: rule.predicate,
        rule: rule.id,
        subject: spanOf(sourceId, trimmedSubjectStart(text, s[0], s[1]), s[1]),
        object: spanOf(sourceId, o[0], o[1]),
        trigger: spanOf(sourceId, whole[0], whole[1])
      });
    }
  }
  return { relations: out, suppressed };
}

// ../src/extract/acronym.ts
function acronymsIn(text) {
  const out = [];
  for (const raw of text.split(/\s+/)) {
    const t = raw.replace(/[^A-Za-z0-9]/g, "");
    if (t.length >= 2 && /^[A-Z0-9]+$/.test(t) && /[A-Z]/.test(t))
      out.push(t);
  }
  return out;
}
function initialismSpan(short, long) {
  const s = short.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.length < 2)
    return null;
  const words = long.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  if (words.length === 0)
    return null;
  for (let start = 0;start < words.length; start++) {
    if (!words[start].startsWith(s[0]))
      continue;
    let si = 1;
    let last = start;
    for (let wi = start;wi < words.length && si < s.length; wi++) {
      const w = words[wi];
      const from = wi === start ? 1 : 0;
      for (let ci = from;ci < w.length && si < s.length; ci++) {
        if (w[ci] === s[si]) {
          si++;
          last = wi;
        }
      }
      if (si < s.length && wi + 1 < words.length && words[wi + 1].startsWith(s[si])) {
        si++;
        last = wi + 1;
      }
    }
    if (si === s.length)
      return words.slice(start, last + 1);
  }
  return null;
}
function expandAgainst(text, long) {
  let out = text;
  for (const a of acronymsIn(text)) {
    const span = initialismSpan(a, long);
    if (span === null)
      continue;
    out = out.replace(new RegExp(`\\b${a}\\b`, "g"), span.join(" "));
  }
  return out;
}

// ../src/extract/link.ts
var MENTION_PROBE_ID = "(mention)";
var LINK_WEAK_MARGIN = 0.1;
var TYPE_NOUNS = [
  "service",
  "services",
  "team",
  "teams",
  "rota",
  "project",
  "projects",
  "rewrite",
  "migration",
  "document",
  "doc",
  "docs",
  "runbook",
  "policy",
  "contract",
  "review",
  "report",
  "postmortem",
  "incident",
  "outage",
  "spike",
  "failure",
  "decision",
  "gate",
  "indexer",
  "owner",
  "workshop"
];
function inferType(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = words.length - 1;i >= 0; i--) {
    const w = words[i];
    if (TYPE_NOUNS.includes(w))
      return w.replace(/s$/, "");
  }
  return;
}
var NON_DISTINGUISHING = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "and",
  "or",
  "on",
  "in",
  "at",
  "by",
  "with",
  "we",
  "our"
]);
function typeOnlyMatch(mention, recordName) {
  const type = inferType(mention);
  if (type === undefined)
    return false;
  const words = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter((w) => w !== "" && !NON_DISTINGUISHING.has(w)));
  const rec = words(recordName);
  const shared = [...words(mention)].filter((w) => rec.has(w));
  return shared.length > 0 && shared.every((w) => w.replace(/s$/, "") === type);
}
function link(mention, records, opts = {}) {
  const mentionType = opts.type ?? inferType(mention);
  const probe = mentionType === undefined ? { id: MENTION_PROBE_ID, name: mention } : { id: MENTION_PROBE_ID, name: mention, type: mentionType };
  const keys = blockKeys(probe, { phonetic: true });
  const scored = [];
  const excluded = new Set(opts.exclude ?? []);
  for (const r of records) {
    if (excluded.has(r.id))
      continue;
    if (opts.type !== undefined && r.type !== opts.type)
      continue;
    let shares = false;
    for (const k of blockKeys(r, { phonetic: true })) {
      if (keys.has(k)) {
        shares = true;
        break;
      }
    }
    if (!shares)
      continue;
    const recType = inferType(r.name) ?? r.type;
    const typed = recType === undefined ? { id: r.id, name: r.name } : { id: r.id, name: r.name, type: recType };
    const expanded = expandAgainst(probe.name, r.name);
    const scoreProbe = expanded === probe.name ? probe : mentionType === undefined ? { id: probe.id, name: expanded } : { id: probe.id, name: expanded, type: mentionType };
    scored.push({ id: r.id, name: r.name, score: similarity(scoreProbe, typed).total });
  }
  scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const top = scored[0];
  const next = scored[1];
  const margin = top === undefined || next === undefined ? null : top.score - next.score;
  const verdict = top === undefined ? "no_candidates" : margin === 0 ? "tie" : (margin ?? 1) < LINK_WEAK_MARGIN ? "weak" : typeOnlyMatch(mention, top.name) ? "weak" : "ranked";
  const capped = opts.limit === undefined ? scored : scored.slice(0, opts.limit);
  return { mention, verdict, candidates: capped, margin };
}

// ../src/resolve/cluster.ts
var SUGGEST_MIN_SCORE = 0.7;
function cluster(ids, pairs, minScore) {
  const parent = new Map;
  for (const id of ids)
    parent.set(id, id);
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r)
      r = parent.get(r);
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c);
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const accepted = pairs.filter((p) => p.score >= minScore).slice().sort((a, b) => b.score - a.score || (`${a.a} ${a.b}` < `${b.a} ${b.b}` ? -1 : 1));
  const mergeEdges = [];
  for (const p of accepted) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra === rb)
      continue;
    parent.set(ra, rb);
    mergeEdges.push(p);
  }
  const groups = new Map;
  for (const id of ids) {
    const r = find(id);
    const g = groups.get(r);
    if (g === undefined)
      groups.set(r, [id]);
    else
      g.push(id);
  }
  const out = [];
  for (const [, members] of groups) {
    members.sort();
    const inside = new Set(members);
    const held = mergeEdges.filter((p) => inside.has(p.a) && inside.has(p.b));
    out.push({
      id: members[0],
      members,
      weakestLink: held.length === 0 ? null : held.reduce((w, p) => p.score < w.score ? p : w),
      merges: held.length
    });
  }
  out.sort((a, b) => a.id < b.id ? -1 : 1);
  return out;
}
function merged(clusters) {
  return clusters.filter((c) => c.members.length > 1);
}

// ../src/store/store.ts
class StoreError extends Error {
  code;
  detail;
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "StoreError";
    this.code = code;
    this.detail = detail;
  }
}
var realDeps = {
  now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  salt: () => {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
};
function spannableTextOf(content) {
  if (content === null || typeof content !== "object" || Array.isArray(content))
    return null;
  const t = content["text"];
  return typeof t === "string" ? t : null;
}
function quoteOf(span, rec) {
  const r = resolveSpan(span, rec);
  return r.ok ? r.quote : null;
}
function nameOf(content) {
  if (content === null || typeof content !== "object" || Array.isArray(content))
    return "";
  const c = content;
  for (const k of ["name", "title", "text", "scenario"]) {
    const v = c[k];
    if (typeof v === "string" && v.trim() !== "")
      return v;
  }
  return "";
}
function activeMergesIn(records, at, bound = "inclusive") {
  const merges = records.filter((r) => r.kind === "merge");
  return merges.filter((m) => {
    let end = m.meta.validUntil;
    for (const r of records) {
      if (r.kind !== "retraction" || r.meta.subject !== m.id)
        continue;
      end = closingValidUntil(end, r.meta.validFrom ?? r.meta.recordedAt);
    }
    if (end === null)
      return true;
    const a = parseInstant(at), e = parseInstant(end);
    if (!a.ok || !e.ok)
      return true;
    return bound === "after" ? a.ms < e.ms : a.ms <= e.ms;
  });
}

class Store {
  paths;
  deps;
  records;
  constructor(paths, deps, records) {
    this.paths = paths;
    this.deps = deps;
    this.records = records;
  }
  static async open(paths, deps = realDeps) {
    ensureStoreDir(paths);
    const records = [...readLog(paths)];
    const report = verifyChain(records);
    if (!report.valid) {
      const first = report.problems[0];
      throw new StoreError("chain_invalid", `${report.problems.length} problem(s) in ${paths.log}; first is ${first.reason} at seq ` + `${first.seq} (${first.id}). Refusing to load — a partial graph from a tampered log ` + "would answer questions without saying the record was altered.");
    }
    return new Store(paths, deps, records);
  }
  async append(input) {
    const rec = await withLoggedMutation(this.paths, (current) => {
      if (current.some((r) => r.id === input.id)) {
        throw new StoreError("duplicate_id", `${JSON.stringify(input.id)} is already in this store`);
      }
      const built = this.build(current, input.kind, input.id, input.content, {
        recordedAt: this.deps.now(),
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        ...input.source !== undefined ? { source: input.source } : {},
        ...input.target !== undefined ? { target: input.target } : {},
        ...input.edgeType !== undefined ? { edgeType: input.edgeType } : {},
        ...input.weight !== undefined ? { weight: input.weight } : {}
      });
      this.records = [...current, built];
      return { append: [built], value: built };
    });
    return rec;
  }
  async retract(id, reason = null, at) {
    return withLoggedMutation(this.paths, (current) => {
      const target = current.find((r) => r.id === id);
      if (target === undefined) {
        throw new StoreError("not_found", `no record with id ${JSON.stringify(id)}`);
      }
      const recordedAt = this.deps.now();
      const closedAt = at ?? recordedAt;
      const p = parseInstant(closedAt);
      if (!p.ok) {
        throw new StoreError("not_found", `retraction instant ${JSON.stringify(closedAt)} is unusable: ${p.reason}`);
      }
      const record = this.build(current, "retraction", `${id}:retracted:${closedAt}`, { reason }, {
        recordedAt,
        validFrom: closedAt,
        validUntil: null,
        subject: id,
        subjectKind: this.subjectKind(target),
        reason
      });
      this.records = [...current, record];
      return { append: [record], value: record };
    });
  }
  effectiveValidUntil(rec) {
    let end = rec.meta.validUntil;
    for (const r of this.records) {
      if (r.kind !== "retraction" || r.meta.subject !== rec.id)
        continue;
      end = closingValidUntil(end, r.meta.validFrom ?? r.meta.recordedAt);
    }
    return end;
  }
  async purge(id, reason = null) {
    return withLoggedMutation(this.paths, (current) => {
      const target = current.find((r) => r.id === id);
      if (target === undefined) {
        throw new StoreError("not_found", `no record with id ${JSON.stringify(id)}`);
      }
      if (target.content === null && target.salt === null) {
        throw new StoreError("already_purged", `${JSON.stringify(id)} has already been purged`);
      }
      const blocking = activeMergesIn(current, this.deps.now(), "after").find((m) => m.meta.canonical === id);
      if (blocking !== undefined) {
        throw new StoreError("canonical_of_active_merge", `${JSON.stringify(id)} is the canonical record of merge ${JSON.stringify(blocking.id)}, ` + `so purging it would make every member read as empty while their own content remains on ` + `disk. Retract the merge first, or purge each member: ${(blocking.meta.members ?? []).join(", ")}.`);
      }
      const at = this.deps.now();
      const tombstone = this.build(current, "tombstone", `${id}:purged:${at}`, { reason }, {
        recordedAt: at,
        validFrom: at,
        validUntil: null,
        subject: id,
        subjectKind: this.subjectKind(target),
        reason,
        contentDigest: target.contentDigest,
        scope: "this-store-only"
      });
      const emptied = purgeContent(target);
      const next = [...current.map((r) => r.id === id ? emptied : r), tombstone];
      this.records = next;
      return { rewrite: next, value: tombstone };
    });
  }
  async recordRetrieval(decision) {
    assertConsistent(decision);
    return withLoggedMutation(this.paths, (current) => {
      const at = this.deps.now();
      const rec = this.build(current, "retrieval", `retrieval:${decision.queryHash}:${at}`, {
        outcome: decision.outcome,
        queryHash: decision.queryHash,
        queryChars: decision.queryChars,
        served: decision.served.map((x) => x.id),
        channels: decision.channels.map((c) => ({
          channel: c.channel,
          considered: c.considered,
          topScore: c.topScore,
          floor: c.floor,
          margin: c.margin
        })),
        reason: decision.reason
      }, { recordedAt: at, validFrom: at, validUntil: null });
      this.records = [...current, rec];
      return { append: [rec], value: rec };
    });
  }
  suggest(minScore = SUGGEST_MIN_SCORE) {
    const named = this.live().filter((r) => r.kind === "node" || r.kind === "decision").map((r) => ({ id: r.id, name: nameOf(r.content), type: r.kind })).filter((c) => c.name !== "");
    if (named.length < 2)
      return [];
    const pairs = block(named, { typeScoped: true, phonetic: true }).pairs;
    return merged(cluster(named.map((c) => c.id), pairs, minScore));
  }
  async merge(members, canonical, reason = null) {
    return withLoggedMutation(this.paths, (current) => {
      if (members.length < 2) {
        throw new StoreError("merge_too_small", `a merge needs at least two members, got ${members.length}`);
      }
      if (!members.includes(canonical)) {
        throw new StoreError("canonical_not_a_member", `${JSON.stringify(canonical)} is not among the members`);
      }
      for (const m of members) {
        if (!current.some((r) => r.id === m)) {
          throw new StoreError("not_found", `no record with id ${JSON.stringify(m)}`);
        }
      }
      const existing = activeMergesIn(current, this.deps.now());
      for (const m of members) {
        if (existing.some((x) => (x.meta.members ?? []).includes(m))) {
          throw new StoreError("member_already_merged", `${JSON.stringify(m)} is already in an active merge`);
        }
      }
      const at = this.deps.now();
      const rec = this.build(current, "merge", `merge:${[...members].sort().join("+")}`, { reason }, {
        recordedAt: at,
        validFrom: at,
        validUntil: null,
        members: [...members].sort(),
        canonical,
        reason
      });
      this.records = [...current, rec];
      return { append: [rec], value: rec };
    });
  }
  propose(id, rules) {
    const rec = this.byId(id);
    if (rec === undefined)
      return [];
    const text = spannableTextOf(rec.content);
    if (text === null)
      return [];
    const found = rules === undefined ? extract(id, text) : extract(id, text, rules);
    const pool = this.linkables();
    return found.map((e) => {
      const subjectText = quoteOf(e.subject, rec);
      const objectText = quoteOf(e.object, rec);
      return {
        ...e,
        subjectText,
        objectText,
        triggerText: quoteOf(e.trigger, rec),
        subjectLink: link(subjectText ?? "", pool, { exclude: [id] }),
        objectLink: link(objectText ?? "", pool, { exclude: [id] })
      };
    });
  }
  async confirm(p, from, to, note = null) {
    return withLoggedMutation(this.paths, (current) => {
      const live = current.filter((r) => r.content !== null);
      for (const [label, endpoint] of [["from", from], ["to", to]]) {
        if (!live.some((r) => r.id === endpoint)) {
          throw new StoreError("endpoint_not_found", `${label} endpoint ${JSON.stringify(endpoint)} is not a live record in this store`);
        }
      }
      const src = current.find((r) => r.id === p.trigger.source);
      const q = resolveSpan(p.trigger, src === undefined ? undefined : { content: src.content });
      if (!q.ok) {
        throw new StoreError("span_unresolvable", `the trigger span does not resolve against ${JSON.stringify(p.trigger.source)}: ${q.reason}`);
      }
      const at = this.deps.now();
      const rec = this.build(current, "edge", `${from}->${to}:${p.predicate}`, note === null ? {} : { note }, {
        recordedAt: at,
        validFrom: at,
        validUntil: null,
        source: from,
        target: to,
        edgeType: p.predicate,
        rule: p.rule,
        subjectSpan: { ...p.subject },
        objectSpan: { ...p.object },
        triggerSpan: { ...p.trigger }
      });
      this.records = [...current, rec];
      return { append: [rec], value: rec };
    });
  }
  linkMention(mention, opts = {}) {
    return link(mention, this.linkables(), opts);
  }
  mergedView(id, at) {
    const r = at === undefined ? this.resolveId(id) : this.resolveId(id, at);
    const mergeRec = activeMergesIn(this.records, at ?? this.deps.now()).find((m) => (m.meta.members ?? []).includes(r.canonical));
    const members = mergeRec === undefined ? [r.canonical] : [...mergeRec.meta.members ?? [r.canonical]];
    const unavailable = [];
    const ordered = [r.canonical, ...members.filter((m) => m !== r.canonical)];
    const composed = {};
    const seen = new Map;
    for (const m of ordered) {
      const rec = this.byId(m);
      if (rec === undefined || rec.content === null) {
        unavailable.push(m);
        continue;
      }
      const c = rec.content;
      if (typeof c !== "object" || Array.isArray(c))
        continue;
      for (const [k, v] of Object.entries(c)) {
        if (!(k in composed))
          composed[k] = v;
        const bucket = seen.get(k) ?? [];
        const same = bucket.find((b) => JSON.stringify(b.value) === JSON.stringify(v));
        if (same === undefined)
          bucket.push({ value: v, from: [m] });
        else
          same.from.push(m);
        seen.set(k, bucket);
      }
    }
    const conflicts = [];
    for (const [field, values] of seen) {
      if (values.length > 1)
        conflicts.push({ field, values: values.map((v) => ({ value: v.value, from: v.from })) });
    }
    return {
      requested: id,
      canonical: r.canonical,
      via: mergeRec?.id ?? null,
      members: ordered,
      content: Object.keys(composed).length === 0 ? null : composed,
      conflicts,
      unavailable
    };
  }
  evidenceFor(edgeId) {
    const edge = this.byId(edgeId);
    if (edge === undefined || edge.meta.triggerSpan === undefined)
      return null;
    const spanOfMeta = (m) => ({ source: m.source, start: m.start, end: m.end });
    const trigger = spanOfMeta(edge.meta.triggerSpan);
    const src = this.byId(trigger.source);
    return {
      edge: edgeId,
      rule: typeof edge.meta.rule === "string" ? edge.meta.rule : null,
      source: trigger.source,
      quote: resolveSpan(trigger, src === undefined ? undefined : { content: src.content })
    };
  }
  contentOf(id) {
    return this.byId(this.resolveId(id).canonical)?.content ?? null;
  }
  resolveId(id, at) {
    const when = at ?? this.deps.now();
    for (const m of activeMergesIn(this.records, when)) {
      const members = m.meta.members ?? [];
      if (members.includes(id) && m.meta.canonical !== undefined && m.meta.canonical !== id) {
        return { requested: id, canonical: m.meta.canonical, via: m.id };
      }
    }
    return { requested: id, canonical: id, via: null };
  }
  getNode(id) {
    return this.live().find((r) => r.id === id && r.kind === "node");
  }
  listNodes() {
    return this.live().filter((r) => r.kind === "node");
  }
  getDecision(id) {
    return this.live().find((r) => r.id === id && r.kind === "decision");
  }
  listDecisions() {
    return this.live().filter((r) => r.kind === "decision");
  }
  getEdge(id) {
    return this.live().find((r) => r.id === id && r.kind === "edge");
  }
  listEdges() {
    return this.live().filter((r) => r.kind === "edge");
  }
  stateAt(validAt, asOf) {
    const subjects = this.live().filter((r) => r.kind === "node" || r.kind === "decision");
    const nodes = subjects.map((r) => ({
      id: r.id,
      validFrom: r.meta.validFrom,
      validUntil: this.effectiveValidUntil(r),
      recordedAt: r.meta.recordedAt
    }));
    const edges = this.live().filter((r) => r.kind === "edge" && typeof r.meta.source === "string" && typeof r.meta.target === "string").map((r) => ({
      id: r.id,
      source: r.meta.source,
      target: r.meta.target,
      validFrom: r.meta.validFrom,
      validUntil: this.effectiveValidUntil(r),
      recordedAt: r.meta.recordedAt
    }));
    return asOf === undefined ? stateAt(nodes, edges, { validAt }) : stateAt(nodes, edges, { validAt, asOf });
  }
  why(decisionId, direction = "upstream", maxDepth = 5) {
    return findChains(this.causalEdges(), decisionId, { direction, maxDepth }).map(chainReport);
  }
  searchable() {
    return this.live().filter((r) => r.content !== null && r.kind !== "retrieval").map((r) => ({ id: r.id, text: JSON.stringify(r.content) }));
  }
  all() {
    return this.records;
  }
  verify() {
    return verifyChain(this.records);
  }
  linkables() {
    return this.live().filter((r) => r.kind === "node" || r.kind === "decision").map((r) => ({ id: r.id, name: nameOf(r.content), type: r.kind })).filter((c) => c.name !== "");
  }
  live() {
    return this.records.filter((r) => r.content !== null && r.kind !== "retraction" && r.kind !== "tombstone" && r.kind !== "merge");
  }
  causalEdges() {
    return this.live().filter((r) => r.kind === "edge").map((r) => ({
      source: String(r.meta.source),
      target: String(r.meta.target),
      type: r.meta.edgeType ?? "INFLUENCED",
      weight: typeof r.meta.weight === "number" ? r.meta.weight : 1
    }));
  }
  byId(id) {
    return this.records.find((r) => r.id === id);
  }
  subjectKind(r) {
    return r.kind === "edge" ? "edge" : r.kind === "decision" ? "decision" : "node";
  }
  build(chain, kind, id, content, meta) {
    const full = {
      ...meta,
      workspace: this.paths.workspace.root,
      workspaceMethod: this.paths.workspace.method,
      recordedAt: meta.recordedAt,
      validFrom: meta.validFrom,
      validUntil: meta.validUntil
    };
    const entry = appendEntry(chain, { kind, id, content, meta: full }, this.deps.salt());
    return { ...entry, kind, meta: full };
  }
}

// ../explorer/server/server.ts
var labelOf = (r) => {
  const c = r.content;
  if (c === null)
    return "(purged)";
  if (typeof c !== "object" || Array.isArray(c))
    return r.id;
  const o = c;
  for (const k of ["name", "title", "text", "scenario"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "")
      return v;
  }
  return r.id;
};
function graphView(store) {
  const all = store.all();
  const v = store.verify();
  const nodes = all.filter((r) => r.kind === "node" || r.kind === "decision").map((r) => ({
    id: r.id,
    kind: r.kind,
    label: labelOf(r),
    validFrom: r.meta.validFrom ?? null,
    validUntil: r.meta.validUntil ?? null,
    recordedAt: String(r.meta.recordedAt),
    purged: r.content === null
  }));
  const edges = store.listEdges().map((e) => ({
    id: e.id,
    source: String(e.meta.source),
    target: String(e.meta.target),
    type: String(e.meta.edgeType ?? "INFLUENCED"),
    weight: typeof e.meta.weight === "number" ? e.meta.weight : 1,
    hasEvidence: e.meta.triggerSpan !== undefined
  }));
  return {
    nodes,
    edges,
    chain: { valid: v.valid, total: v.total, purged: v.purged, problems: v.problems.length }
  };
}
if (false) {}

// src/read-graph.ts
async function readGraph(workspace) {
  const store = await Store.open(storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: workspace } })));
  return graphView(store);
}
export {
  readGraph
};
