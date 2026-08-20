// The only bridge between the renderer and the main process.
//
// Read-only by construction: this exposes exactly the `read:` channels and nothing else, so the
// renderer has no way to reach a writable path even if one existed. DEC-021.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('graph', {
  read: () => ipcRenderer.invoke('read:graph'),
  workspace: () => ipcRenderer.invoke('read:workspace'),
  chooseWorkspace: () => ipcRenderer.invoke('read:choose-workspace'),
});
