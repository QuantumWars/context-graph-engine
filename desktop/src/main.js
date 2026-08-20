// Electron main process. Reads the store directly — DEC-021.
//
// There is no HTTP server here and no port. `DEC-020` accepted a listener for the web explorer
// because a browser cannot read a file; a main process can, so the whole exposure model — binding,
// keys, failing closed — becomes unnecessary rather than carefully managed.
//
// Every IPC channel is named `read:`. A test asserts the handler table, so a writable channel
// cannot be added quietly. An assertion into this store needs a caller who names it, and a menu
// item is not one.

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

/** Where the store is. Set by the picker, or from the environment on first run. */
let workspace = process.env.GRAPH_ENGINE_WORKSPACE || process.env.CLAUDE_PROJECT_DIR || null;

/**
 * Ask the engine for the graph.
 *
 * Loaded from `graph-reader.bundle.mjs`, the same pattern `mcp/server.bundle.mjs` uses. The first
 * version shelled out to `bun`; a packaged `.app` has neither `bun` on its PATH nor the engine's
 * source inside it, so that could never have worked outside the development tree. Bundling keeps
 * ONE reader of the log — the same `Store` API the CLI and the web explorer use — which is what
 * `DEC-021` requires.
 */
let readerPromise = null;
function reader() {
  if (readerPromise === null) {
    readerPromise = import('./graph-reader.bundle.mjs');
  }
  return readerPromise;
}
async function readGraph(ws) {
  const { readGraph: read } = await reader();
  return read(ws);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#0f1115',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // The renderer never touches fs. Both of these stay as they are — DEC-021.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

/** The read-only IPC surface. Exported shape is asserted by a test. */
const HANDLERS = {
  'read:graph': async () => {
    if (!workspace) return { error: 'no workspace chosen' };
    try {
      return await readGraph(workspace);
    } catch (e) {
      return { error: String(e && e.message ? e.message : e).slice(0, 400) };
    }
  },
  'read:workspace': () => ({ workspace }),
  'read:choose-workspace': async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose a workspace (the folder containing .claude/)',
      properties: ['openDirectory'],
    });
    if (r.canceled || r.filePaths.length === 0) return { workspace };
    workspace = r.filePaths[0];
    return { workspace };
  },
};

app.whenReady().then(() => {
  for (const [channel, handler] of Object.entries(HANDLERS)) {
    ipcMain.handle(channel, (_event, ...args) => handler(...args));
  }

  // If no workspace was given, try the directory the app was launched from.
  if (!workspace) {
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, '.claude', 'graph-engine', 'log.jsonl'))) workspace = cwd;
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

module.exports = { HANDLERS };
