'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CLIENT_STATE_VERSION = 1;
const VALID_JOB_STATUSES = new Set([
  'queued',
  'running',
  'completed',
  'failed',
  'blocked',
  'canceled'
]);

function nowIso(clock = Date.now) {
  return new Date(clock()).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function issueDeviceId() {
  return `wscd_${crypto.randomBytes(8).toString('hex')}`;
}

function issueJobId() {
  return `wscj_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeJobRecord(record = {}, options = {}) {
  const iso = options.nowIso || nowIso(options.clock);
  const status = VALID_JOB_STATUSES.has(String(record.status || '').trim())
    ? String(record.status || '').trim()
    : 'queued';

  return {
    id: String(record.id || issueJobId()).trim(),
    action: String(record.action || 'download_and_seed').trim() || 'download_and_seed',
    source: String(record.source || 'manual').trim() || 'manual',
    status,
    runnerState: String(record.runnerState || '').trim(),
    videoId: String(record.videoId || '').trim(),
    videoTitle: String(record.videoTitle || '').trim(),
    channelId: String(record.channelId || '').trim(),
    remoteIntentId: String(record.remoteIntentId || '').trim(),
    note: String(record.note || '').trim(),
    failureCode: String(record.failureCode || '').trim(),
    progressPercent: Math.max(0, Math.min(100, Number(record.progressPercent || 0) || 0)),
    seedAfterDownload: record.seedAfterDownload !== false,
    workspaceId: String(record.workspaceId || '').trim(),
    workspacePath: String(record.workspacePath || '').trim(),
    manifestPath: String(record.manifestPath || '').trim(),
    jobStatePath: String(record.jobStatePath || '').trim(),
    downloadManifestPath: String(record.downloadManifestPath || '').trim(),
    partialDirectory: String(record.partialDirectory || '').trim(),
    stagingDirectory: String(record.stagingDirectory || '').trim(),
    artifactDirectory: String(record.artifactDirectory || '').trim(),
    logsDirectory: String(record.logsDirectory || '').trim(),
    eventLogPath: String(record.eventLogPath || '').trim(),
    controlPeerId: String(record.controlPeerId || '').trim(),
    downloadId: String(record.downloadId || '').trim(),
    sessionId: String(record.sessionId || '').trim(),
    targetPeerId: String(record.targetPeerId || '').trim(),
    sessionTransport: String(record.sessionTransport || '').trim(),
    sessionStatus: String(record.sessionStatus || '').trim(),
    sessionAnsweredAtIso: String(record.sessionAnsweredAtIso || '').trim(),
    lastSessionSyncAtIso: String(record.lastSessionSyncAtIso || '').trim(),
    sessionAnswer: record.sessionAnswer && typeof record.sessionAnswer === 'object'
      ? {
        type: String(record.sessionAnswer.type || '').trim(),
        sdp: String(record.sessionAnswer.sdp || ''),
        createdAtIso: String(record.sessionAnswer.createdAtIso || '').trim()
      }
      : null,
    creatorCandidates: Array.isArray(record.creatorCandidates)
      ? record.creatorCandidates.map((candidate) => ({
        candidate: String(candidate && candidate.candidate || '').trim(),
        sdpMid: candidate && candidate.sdpMid != null ? String(candidate.sdpMid).trim() : null,
        sdpMLineIndex: candidate && candidate.sdpMLineIndex != null ? Math.max(0, Math.trunc(Number(candidate.sdpMLineIndex) || 0)) : null,
        usernameFragment: candidate && candidate.usernameFragment != null ? String(candidate.usernameFragment).trim() : null
      })).filter((candidate) => candidate.candidate)
      : [],
    fileName: String(record.fileName || '').trim(),
    mimeType: String(record.mimeType || '').trim(),
    sizeBytes: Math.max(0, Math.trunc(Number(record.sizeBytes || 0) || 0)),
    chunkSize: Math.max(0, Math.trunc(Number(record.chunkSize || 0) || 0)),
    chunkCount: Math.max(0, Math.trunc(Number(record.chunkCount || 0) || 0)),
    verifiedChunkCount: Math.max(0, Math.trunc(Number(record.verifiedChunkCount || 0) || 0)),
    receivedBytes: Math.max(0, Math.trunc(Number(record.receivedBytes || 0) || 0)),
    localFilePath: String(record.localFilePath || '').trim(),
    claimedAtIso: String(record.claimedAtIso || '').trim(),
    startedAtIso: String(record.startedAtIso || '').trim(),
    completedAtIso: String(record.completedAtIso || '').trim(),
    createdAtIso: String(record.createdAtIso || iso).trim() || iso,
    updatedAtIso: String(record.updatedAtIso || record.createdAtIso || iso).trim() || iso
  };
}

function createQueuedJobRecord(payload = {}, options = {}) {
  const iso = nowIso(options.clock);
  return normalizeJobRecord({
    ...payload,
    id: issueJobId(),
    action: 'download_and_seed',
    status: 'queued',
    createdAtIso: iso,
    updatedAtIso: iso
  }, options);
}

function defaultClientState(options = {}) {
  const iso = nowIso(options.clock);
  return {
    version: CLIENT_STATE_VERSION,
    device: {
      id: issueDeviceId(),
      registeredAtIso: '',
      lastSeenAtIso: '',
      claimedByAccountId: '',
      claimedByHandle: ''
    },
    agent: {
      status: 'idle',
      startedAtIso: '',
      lastCycleAtIso: '',
      lastSyncAttemptAtIso: '',
      lastSyncResult: 'not_started',
      lastError: '',
      transportState: 'not_connected'
    },
    jobs: [],
    library: [],
    transport: {
      pendingRemoteIntentCount: 0,
      pendingRemoteCommandCount: 0,
      activeTransferCount: 0,
      lastIntentCursor: '',
      lastCommandCursor: '',
      lastRemoteSyncAtIso: '',
      hostState: 'idle',
      lastHostActivityAtIso: '',
      lastHostResult: 'not_started',
      lastRemoteCommandAtIso: '',
      lastRemoteCommandResult: 'not_started',
      lastRemoteStatusAtIso: '',
      lastRemoteStatusResult: 'not_started',
      lastRemoteReportAtIso: '',
      lastRemoteReportResult: 'not_started'
    },
    ui: {
      windowVisible: true,
      lastOpenedAtIso: iso
    }
  };
}

function sanitizeClientState(input = {}, options = {}) {
  const defaults = defaultClientState(options);
  const device = input.device && typeof input.device === 'object' ? input.device : {};
  const agent = input.agent && typeof input.agent === 'object' ? input.agent : {};
  const transport = input.transport && typeof input.transport === 'object' ? input.transport : {};
  const ui = input.ui && typeof input.ui === 'object' ? input.ui : {};

  return {
    version: CLIENT_STATE_VERSION,
    device: {
      id: String(device.id || defaults.device.id).trim() || defaults.device.id,
      registeredAtIso: String(device.registeredAtIso || '').trim(),
      lastSeenAtIso: String(device.lastSeenAtIso || '').trim(),
      claimedByAccountId: String(device.claimedByAccountId || '').trim(),
      claimedByHandle: String(device.claimedByHandle || '').trim()
    },
    agent: {
      status: String(agent.status || defaults.agent.status).trim() || defaults.agent.status,
      startedAtIso: String(agent.startedAtIso || '').trim(),
      lastCycleAtIso: String(agent.lastCycleAtIso || '').trim(),
      lastSyncAttemptAtIso: String(agent.lastSyncAttemptAtIso || '').trim(),
      lastSyncResult: String(agent.lastSyncResult || defaults.agent.lastSyncResult).trim() || defaults.agent.lastSyncResult,
      lastError: String(agent.lastError || '').trim(),
      transportState: String(agent.transportState || defaults.agent.transportState).trim() || defaults.agent.transportState
    },
    jobs: Array.isArray(input.jobs)
      ? input.jobs.map((record) => normalizeJobRecord(record, options))
      : [],
    library: Array.isArray(input.library)
      ? input.library.map((record) => ({
        videoId: String(record && record.videoId || '').trim(),
        videoTitle: String(record && record.videoTitle || '').trim(),
        localPath: String(record && record.localPath || '').trim(),
        manifestPath: String(record && record.manifestPath || '').trim(),
        fileName: String(record && record.fileName || '').trim(),
        mimeType: String(record && record.mimeType || '').trim(),
        sizeBytes: Math.max(0, Math.trunc(Number(record && record.sizeBytes || 0) || 0)),
        chunkSize: Math.max(0, Math.trunc(Number(record && record.chunkSize || 0) || 0)),
        chunkCount: Math.max(0, Math.trunc(Number(record && record.chunkCount || 0) || 0)),
        manifestDigest: String(record && record.manifestDigest || '').trim(),
        seedPeerId: String(record && record.seedPeerId || '').trim(),
        seedState: String(record && record.seedState || '').trim(),
        seedLastAnnouncedAtIso: String(record && record.seedLastAnnouncedAtIso || '').trim(),
        seedLastError: String(record && record.seedLastError || '').trim(),
        addedAtIso: String(record && record.addedAtIso || '').trim()
      }))
      : [],
    transport: {
      pendingRemoteIntentCount: Math.max(0, Math.trunc(Number(transport.pendingRemoteIntentCount || 0))),
      pendingRemoteCommandCount: Math.max(0, Math.trunc(Number(transport.pendingRemoteCommandCount || 0))),
      activeTransferCount: Math.max(0, Math.trunc(Number(transport.activeTransferCount || 0))),
      lastIntentCursor: String(transport.lastIntentCursor || '').trim(),
      lastCommandCursor: String(transport.lastCommandCursor || '').trim(),
      lastRemoteSyncAtIso: String(transport.lastRemoteSyncAtIso || '').trim(),
      hostState: String(transport.hostState || defaults.transport.hostState).trim() || defaults.transport.hostState,
      lastHostActivityAtIso: String(transport.lastHostActivityAtIso || '').trim(),
      lastHostResult: String(transport.lastHostResult || defaults.transport.lastHostResult).trim() || defaults.transport.lastHostResult,
      lastRemoteCommandAtIso: String(transport.lastRemoteCommandAtIso || '').trim(),
      lastRemoteCommandResult: String(transport.lastRemoteCommandResult || defaults.transport.lastRemoteCommandResult).trim() || defaults.transport.lastRemoteCommandResult,
      lastRemoteStatusAtIso: String(transport.lastRemoteStatusAtIso || '').trim(),
      lastRemoteStatusResult: String(transport.lastRemoteStatusResult || defaults.transport.lastRemoteStatusResult).trim() || defaults.transport.lastRemoteStatusResult,
      lastRemoteReportAtIso: String(transport.lastRemoteReportAtIso || '').trim(),
      lastRemoteReportResult: String(transport.lastRemoteReportResult || defaults.transport.lastRemoteReportResult).trim() || defaults.transport.lastRemoteReportResult
    },
    ui: {
      windowVisible: ui.windowVisible !== false,
      lastOpenedAtIso: String(ui.lastOpenedAtIso || defaults.ui.lastOpenedAtIso).trim() || defaults.ui.lastOpenedAtIso
    }
  };
}

function readClientState(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return defaultClientState(options);
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitizeClientState(parsed, options);
  } catch (_) {
    return defaultClientState(options);
  }
}

function writeClientState(filePath, state, options = {}) {
  ensureParentDirectory(filePath);
  const normalized = sanitizeClientState(state, options);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
  return normalized;
}

module.exports = {
  CLIENT_STATE_VERSION,
  VALID_JOB_STATUSES,
  clone,
  createQueuedJobRecord,
  defaultClientState,
  issueDeviceId,
  issueJobId,
  nowIso,
  normalizeJobRecord,
  readClientState,
  sanitizeClientState,
  writeClientState
};
