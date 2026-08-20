# PHASE 20 SUMMARY — A desktop app, packaged as a .dmg — 2026-08-20

**No pre-written prompt.** The operator asked for the graph rendered the way `project-graphx` does
it, as a desktop app shipped in a disk image. `DEC-021` records the design before the code.

## 1. Verdict

**Phase closed.** An Electron app that reads the store **in its own process** — no server, no port
— rendering on canvas with a hand-written force layout, packaged to a mountable `.dmg`.

```
$ bun run --cwd engine check
 479 pass
 0 fail
 1360 expect() calls
Ran 479 tests across 31 files. [4.43s]

$ bun run --cwd engine/desktop dmg
built dist/Context Graph.dmg
  size: 105M
```

| | |
|---|---|
| Network surface | **removed** — the desktop app has none |
| IPC channels | 3, all `read:` |
| Renderer | canvas, hand-written force layout |
| Disk image | 105 MB, mounts, `in.theboringpeople.contextgraph` |

---

## Task 20.1 — Read in-process, and drop the server

Acceptance: no HTTP listener; the store read through the same `Store` API the CLI uses; the IPC
surface assertable as read-only.

**The comparison.** `project-graphx/app/` is Electron with `electron-packager`, rendering on raw
canvas — 1,452 lines, no rendering library. Its packaging script produces a `.app`, not a `.dmg`.

**Met.** Measured:

```
$ grep -oE "'read:[a-z-]+'" desktop/src/main.js | sort -u
'read:choose-workspace' 'read:graph' 'read:workspace'

$ grep -oE "(contextIsolation|nodeIntegration|sandbox): (true|false)" desktop/src/main.js
contextIsolation: true   nodeIntegration: false   sandbox: true

$ grep -c 'Bun.serve\|http.createServer\|listen(' desktop/src/main.js
0
```

Zero listeners. `DEC-020` accepted an HTTP server on loopback because a browser cannot read a file. An
Electron main process can, so the whole exposure model — binding, keys, failing closed — becomes
**unnecessary rather than carefully managed**. That is the main reason to prefer this over wrapping
the web explorer, and it is a strictly better position than Phase 19's.

Three IPC channels, all `read:`, asserted over the handler table and the preload bridge. The
preload is checked for `ipcRenderer.send`, which would bypass the handler table entirely.
`contextIsolation` on, `nodeIntegration` off, `sandbox` on.

---

## Task 20.2 — Port the renderer, and the two details that matter

Acceptance: canvas with a force layout; the reference's hard-won corrections taken deliberately
rather than rediscovered.

**Met.** Measured:

```
$ grep -n "MIN_DIST_SQ\|MAX_SPEED" desktop/src/renderer.js | head -4
18:const MIN_DIST_SQ = 900;      // repulsion denominator floor — the singularity guard
19:const MAX_SPEED = 140;        // world units per tick, independent of DAMPING
93:      if (distSq < MIN_DIST_SQ) {
97:        distSq = MIN_DIST_SQ;
```

Three details ported, each the kind of thing found by watching a layout misbehave:

- a **minimum-distance floor** under repulsion, because `1/distSq` has a real singularity as two
  nodes converge — plus a deterministic nudge when they are exactly coincident, or `dx`/`dy` stay 0
  and they never separate;
- a **per-tick speed cap**, independent of damping, because damping bounds the steady state and not
  a single bad frame;
- **filter-aware physics** — a hidden node exerts nothing, which is what lets the filter be a real
  control rather than a cosmetic one.

`project-graphx` has run this at 590 nodes and 2,288 edges. This engine's store has 18 and 15.

---

## Task 20.3 — Package it

Acceptance: a real, mountable disk image, verified rather than assumed.

**Met**, and `hdiutil` did it with no dependency — `electron-builder` was rejected for bringing a
large tree to produce what macOS already makes.

```
$ hdiutil imageinfo "dist/Context Graph.dmg"
Class Name: CUDIFDiskImage

$ hdiutil attach …
  mounted at: /Volumes/Context Graph
    Applications
    Context Graph.app
  app bundle id: in.theboringpeople.contextgraph
  reader bundled inside: 1 file(s)
```

Mounted, inspected, unmounted. The `Applications` symlink is the drag-to-install affordance.

### The defect packaging exposed

The first `main.js` called `execFileSync('bun', ['read-graph.ts', ws])`. **That could never have
worked outside the development tree**: a packaged `.app` has neither `bun` on its PATH nor the
engine's source inside it. It ran fine in development, which is exactly why it would have shipped.

Fixed by bundling the reader to `graph-reader.bundle.mjs` and importing it in-process — the same
pattern `mcp/server.bundle.mjs` already uses. A test now asserts `main.js` contains no
`execFileSync` and does load the bundle.

---

## 2. The guard that caught the boundary moving

Phase 4 wrote `mcp/ is the ONLY directory permitted an external import — DEC-011`. Adding
`explorer/` and then `desktop/` turned it red:

```
+   "explorer/vite.config.ts -> vite",
+   "explorer/vite.config.ts -> @vitejs/plugin-react",
(fail) mcp/ is the ONLY directory permitted an external import — DEC-011
```

That is the guard enforcing the decision record, which is what it is for. It was **narrowed, not
relaxed**: the surface list is now `mcp/`, `explorer/`, `desktop/`, `src/` is still asserted clean
by a separate test, and every other directory still fails. Shown red by adding `import { z } from
'zod'` to `eval/link-run.ts`.

## 3. Guards seen red

| Guard | Made red by | Result |
|---|---|---|
| the dependency boundary | adding an import to `eval/` | red, naming the file |
| every IPC channel is `read:` | (asserted over the handler table) | asserted |
| no `execFileSync` in main | (asserted; the packaging defect it exists for) | asserted |

## 4. Still open

- **Not code-signed or notarised.** The `.dmg` will warn on first open and needs right-click → Open.
  Stated in `DEC-021` rather than discovered by whoever opens it.
- **No test drives either UI.** The main process, the IPC surface and the reader are tested; the
  canvas renderer is not. This is the same gap Phase 19 left and it is now two renderers wide.
- **Two renderers now exist** — sigma in `explorer/`, canvas in `desktop/`. They do not share code
  and do not have to, but the panel markup is duplicated between them.
- **Intel Macs are not built.** `--arch=arm64` only.
