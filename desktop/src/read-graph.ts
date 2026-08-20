/**
 * The desktop app's reader.
 *
 * `DEC-021`: the desktop app and the web explorer read through the **same** `Store` API. This is a
 * thin adapter around `graphView`, not a second path into the log — a private reader is how two
 * views come to disagree about what the store contains.
 *
 * Bundled to `graph-reader.bundle.mjs` and imported by the Electron main process, the same pattern
 * `mcp/server.bundle.mjs` uses. A packaged `.app` has neither `bun` on its PATH nor the engine's
 * source inside it, so a subprocess is not an option — measured before this was written.
 */
import { graphView, type GraphView } from '../../explorer/server/server';
import { Store } from '../../src/store/store';
import { resolveWorkspace, storePaths } from '../../src/store/paths';

export async function readGraph(workspace: string): Promise<GraphView> {
  const store = await Store.open(storePaths(resolveWorkspace({ env: { GRAPH_ENGINE_WORKSPACE: workspace } })));
  return graphView(store);
}
