'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('worldstageTransportHost', {
  signalReady: (payload) => ipcRenderer.send('transport:host-ready', payload),
  updateJob: (payload) => ipcRenderer.invoke('transport:job-update', payload),
  bootstrapJob: (payload) => ipcRenderer.invoke('transport:bootstrap-job', payload),
  publishCandidate: (payload) => ipcRenderer.invoke('transport:publish-candidate', payload),
  listSeedSessions: (payload) => ipcRenderer.invoke('transport:list-seed-sessions', payload),
  answerSeedSession: (payload) => ipcRenderer.invoke('transport:answer-seed-session', payload),
  publishSeedCandidate: (payload) => ipcRenderer.invoke('transport:publish-seed-candidate', payload),
  recordManifest: (payload) => ipcRenderer.invoke('transport:record-manifest', payload),
  markChunkRequested: (payload) => ipcRenderer.invoke('transport:mark-chunk-requested', payload),
  markChunkFailed: (payload) => ipcRenderer.invoke('transport:mark-chunk-failed', payload),
  recordVerifiedChunk: (payload) => ipcRenderer.invoke('transport:record-verified-chunk', payload),
  readSeedManifest: (payload) => ipcRenderer.invoke('transport:read-seed-manifest', payload),
  readSeedChunk: (payload) => ipcRenderer.invoke('transport:read-seed-chunk', payload),
  onClientSnapshot: (handler) => {
    const listener = (_event, snapshot) => handler(snapshot);
    ipcRenderer.on('transport:client-snapshot', listener);
    return () => ipcRenderer.removeListener('transport:client-snapshot', listener);
  }
});
