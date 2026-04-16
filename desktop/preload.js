'use strict';

const { clipboard, contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('worldstageClient', {
  getState: () => ipcRenderer.invoke('client:get-state'),
  readClipboardText: () => clipboard.readText(),
  saveConfig: (config) => ipcRenderer.invoke('client:save-config', config),
  applyPairingLink: (payload) => ipcRenderer.invoke('client:apply-pairing-link', payload),
  startAgent: () => ipcRenderer.invoke('client:start-agent'),
  stopAgent: () => ipcRenderer.invoke('client:stop-agent'),
  enqueueDownloadJob: (payload) => ipcRenderer.invoke('client:enqueue-download-job', payload),
  clearFinishedJobs: () => ipcRenderer.invoke('client:clear-finished-jobs'),
  cancelJob: (payload) => ipcRenderer.invoke('client:cancel-job', payload),
  retryJob: (payload) => ipcRenderer.invoke('client:retry-job', payload),
  removeJob: (payload) => ipcRenderer.invoke('client:remove-job', payload),
  refreshLibraryItem: (payload) => ipcRenderer.invoke('client:refresh-library-item', payload),
  pauseLibraryItem: (payload) => ipcRenderer.invoke('client:pause-library-item', payload),
  resumeLibraryItem: (payload) => ipcRenderer.invoke('client:resume-library-item', payload),
  removeLibraryItem: (payload) => ipcRenderer.invoke('client:remove-library-item', payload),
  openDownloadDirectory: () => ipcRenderer.invoke('client:open-download-directory'),
  openPath: (payload) => ipcRenderer.invoke('client:open-path', payload),
  showItemInFolder: (payload) => ipcRenderer.invoke('client:show-item-in-folder', payload),
  openWorldStage: () => ipcRenderer.invoke('client:open-worldstage'),
  reloadWorldStage: () => ipcRenderer.invoke('client:reload-worldstage'),
  openUserDataDirectory: () => ipcRenderer.invoke('client:open-user-data-directory'),
  showWindow: () => ipcRenderer.invoke('client:show-window'),
  checkForUpdates: () => ipcRenderer.invoke('client:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('client:install-update'),
  openReleasePage: () => ipcRenderer.invoke('client:open-release-page'),
  onStateChanged: (handler) => {
    const listener = (_event, snapshot) => handler(snapshot);
    ipcRenderer.on('client:state-changed', listener);
    return () => ipcRenderer.removeListener('client:state-changed', listener);
  }
});
