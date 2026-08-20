# DEC-021 — The desktop app reads the store in its main process, and ships no server

_Decided 2026-08-20 · status: current — narrows `DEC-020`, which stays current for the web explorer_

The operator asked for a desktop app packaged as a `.dmg`, rendering the graph the way
`project-graphx` does.

**Electron, at `engine/desktop/`.** Main process, preload, renderer — the shape `project-graphx`
already uses.

**The store is read in the main process, directly through `Store`.** There is no HTTP server, no
port, and no listener. The renderer receives data over `contextBridge` IPC.

**The IPC surface is read-only**, and named so: every channel begins `read:`. There is no channel
that appends, merges, confirms, retracts or purges.

**Rendering is canvas with a hand-written force layout**, ported in approach from
`project-graphx/app/src/renderer.js`.

**Packaged with `electron-packager`, then `hdiutil` for the `.dmg`.** `hdiutil` ships with macOS, so
the disk image costs no dependency.

## Why

**Because it removes the network surface Phase 19 added.** `DEC-020` accepted an HTTP server on
loopback because a browser cannot read a file. Electron's main process can. A desktop app that
reads the store in-process has no port to bind, no key to configure, and nothing to fail closed —
the whole exposure model becomes unnecessary rather than carefully managed. That is a strictly
better position and it is the main reason to prefer this over wrapping the web explorer.

**Because `project-graphx` has already solved rendering at a scale ours has not seen.** 590 nodes
and 2,288 edges against our 18 and 15. Its renderer is 1,452 lines of raw canvas with a hand-written
force layout carrying two hard-won details worth taking: a **minimum-distance floor** under
repulsion, because `1/distSq` has a real singularity as two nodes converge, and a **per-tick speed
cap** independent of damping. Both are the kind of thing found by watching a layout explode, not by
reasoning.

**Because its filter-aware physics is the scalability answer.** Nodes hidden by a filter do not
shove visible ones. That is what lets a filter be a real control rather than a cosmetic one, and the
research is explicit that node-link clutters past a few hundred edges.

**Because `hdiutil` is already on the machine.** `electron-packager` produces a `.app`, not a
`.dmg`. The alternative is `electron-builder`, which produces the disk image and brings a large
dependency tree to do it. `hdiutil create -srcfolder` is one command and no dependency.

## What was rejected

- **Wrapping the web explorer in Electron.** Rejected: it keeps the HTTP server, the port and the
  auth model for no gain, when the main process can read the file directly.
- **Reusing sigma/graphology from `explorer/`.** Rejected in favour of the reference's canvas
  renderer, which is the thing the operator asked for and which has been run at 590 nodes. The web
  explorer keeps sigma; they do not have to agree.
- **`electron-builder`.** Rejected: a large dependency to produce a disk image `hdiutil` already
  makes.
- **Any writable IPC channel.** Rejected for `DEC-020`'s reason, which does not weaken on the
  desktop: an assertion into this store needs a caller who names it, and a menu item is not one.
- **Code-signing and notarisation.** Not rejected — **not done**, and the `.dmg` will therefore warn
  on first open. Stated rather than discovered.

## What this constrains

- Every IPC channel name begins `read:`. A test asserts the handler table, so a writable channel
  cannot be added without turning it red.
- `nodeIntegration` stays off and `contextIsolation` stays on. The renderer never touches `fs`.
- Purged content must not reach the renderer, for the same reason and by the same test as the web
  explorer.
- The desktop app and the web explorer read through the same `Store` API. Neither may grow a private
  path into the log.

## How to reverse it

Cheap. `engine/desktop/` is self-contained, nothing in `engine/` imports it, and deleting it leaves
the CLI, the MCP server and the web explorer untouched.
