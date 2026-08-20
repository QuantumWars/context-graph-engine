# PHASE 19 SUMMARY — A read-only explorer — 2026-08-20

**No pre-written prompt.** The operator chose the stack after the trade-off was put; `DEC-020`
records the decision, which was made before any code because it changes the trust boundary.

## 1. Verdict

**Phase closed.** A React + sigma/graphology explorer over the same `Store` API the CLI uses, with
an HTTP surface that reads and cannot write.

```
$ bun run --cwd engine check
 472 pass
 0 fail
 1333 expect() calls
Ran 472 tests across 30 files. [4.88s]

$ bun run --cwd engine/explorer build
dist/assets/index-DzJbCQW1.js   322.40 kB │ gzip: 90.10 kB
✓ built in 618ms
```

---

## Task 19.1 — Decide the boundary before building

Acceptance: the stack and the trust boundary recorded before code, with the reference's exposure
model compared rather than assumed.

**Met.** `DEC-020`. **The comparison is what shaped it.** `semantica`'s explorer has:

```
44 GET routes   ·   34 mutating routes   (POST /api/enrich/dedup, POST /api/reason, annotations)
```

and an exposure model that is genuinely good — loopback default, a **specific** warning naming what
becomes readable, **fail-closed** when bound beyond loopback with no key, and `hmac.compare_digest`
for the comparison. All four were ported.

The write surface was not. Every route here is a `GET`, and `serve()` refuses any other method
before routing. The engine's posture is that an assertion needs a caller who names it — `DEC-012`
for identity, `DEC-013` for an extracted edge — and a browser button is not one. `DEC-004` makes
purge irreversible, which settles it.

**One correction to my own decision record before building on it:** it first placed `explorer/`
*beside* `engine/`. `engine/` is its own git repository, so a sibling importing `engine/src/` is a
cross-repository relative import — exactly what broke when the engine was split out and forced the
file lock to be vendored (`DEC-010`). Moved inside.

---

## Task 19.2 — A server that cannot write

Acceptance: the route table is assertable; a mutating route turns a test red; purged content cannot
reach a payload.

**Met.** Five `GET` routes — `/api/graph`, `/api/at`, `/api/evidence`, `/api/why`, `/api/view`.

```
GET  /api/graph      200 nodes: 3 edges: 1 chain: {"valid":true,"total":4,"purged":0,"problems":0}
GET  /api/evidence   200 {"ok":true,"quote":"The friday deploy caused a checkout outage"}
GET  /api/health     200 {"ok":true,"readOnly":true}
POST /api/graph      405 {"error":"the explorer is read-only — DEC-020"}
```

The purge test is the one that matters, and it proves its own scan first:

```
leaked secret in payload? no
nodes: d-friday, d-gate, note-1, secret(purged)
```

A record whose content was a credential appears as `(purged)` with the content absent — asserted
present *before* the purge, so the absence afterwards means something.

**The quote behind an edge is fetched on demand**, never baked into the graph payload, so a purge is
reflected the moment it happens rather than at the next page load. That is the research's
"provenance-backed details-on-demand", and it is also the honest implementation.

---

## Task 19.3 — The view

Acceptance: a node-link graph, details-on-demand with provenance, a temporal control, and filtering
— the four things the research says a knowledge-graph UI needs.

**Met.** Measured:

```
$ python3 -c "import json;print(' '.join(sorted(json.load(open('package.json'))['dependencies'])))"
graphology graphology-layout-forceatlas2 react react-dom sigma

$ grep -o "s.on('[a-zA-Z]*'" src/App.tsx | sort -u
s.on('clickEdge'
s.on('clickNode'
s.on('clickStage'

$ bun run build
dist/assets/index-JJFaifsO.css    1.97 kB │ gzip:  0.86 kB
dist/assets/index-DzJbCQW1.js   322.40 kB │ gzip: 90.10 kB
✓ built in 618ms
```

Node-link via sigma with a ForceAtlas2 layout; edges coloured by causal type and drawn
thicker when they carry evidence; click a node or edge for a panel; a filter box; a time slider that
resolves to an instant and asks `/api/at` — **the engine decides what was valid then, not the
browser**.

The research is explicit that node-link clutters at hundreds of edges, so the filter is the
scalability story rather than decoration. That is stated in the component.

**Five dependencies, not nineteen.** The reference carries monaco, vis-timeline, @xyflow/react,
react-query, arborist and dropzone; none of those is used by these views. Taking the approach is not
the same as taking the tree.

## 2. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| every route is a `GET` | (asserted over the exported route table; a `POST` fails the set comparison) | asserted |
| no route names a mutating operation | (asserted against a forbidden-word list, with the scan proven) | asserted |
| purged content never served | asserted present, then absent, across a real purge | asserted |
| fail-closed beyond loopback | `authorise({host:'0.0.0.0'}, null)` → 503 | asserted |

## 3. Still open

- **No test drives the browser.** The server is tested; the React app is typechecked and built, and
  its behaviour is unverified. A Playwright pass is the honest next step and `semantica` ships one.
- **`/api/view` and `/api/why` are served but unused by the UI.** They are reachable and tested;
  the panel does not call them yet.
- **No pagination or level-of-detail.** The filter is the only scalability control, and the research
  says node-link needs more than that past a few hundred edges.
- **The engine now has a network surface**, corrected in `ARCHITECTURE.md` §1 rather than left
  standing.
