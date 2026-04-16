'use strict';

const { createQueuedJobRecord } = require('./client-state');

const REMOTE_INTENTS_PATH = '/api/worldstage/client/intents';
const REMOTE_INTENT_EVENTS_SUFFIX = '/events';
const REMOTE_COMMANDS_PATH = '/api/worldstage/client/commands';
const REMOTE_COMMAND_RESULTS_SUFFIX = '/results';
const REMOTE_STATUS_PATH = '/api/worldstage/client/status';

function normalizeRemoteIntentRecord(record = {}) {
  return {
    id: String(record.id || record.intentId || '').trim(),
    action: String(record.action || 'download_and_seed').trim() || 'download_and_seed',
    videoId: String(record.videoId || '').trim(),
    videoTitle: String(record.videoTitle || '').trim(),
    channelId: String(record.channelId || '').trim(),
    note: String(record.note || '').trim(),
    createdAtIso: String(record.createdAtIso || '').trim()
  };
}

function buildRemoteIntentUrl(siteOrigin, options = {}) {
  const url = new URL(REMOTE_INTENTS_PATH, String(siteOrigin || '').trim());
  if (options.deviceId) url.searchParams.set('deviceId', String(options.deviceId).trim());
  if (options.cursor) url.searchParams.set('cursor', String(options.cursor).trim());
  return url.toString();
}

function buildRemoteIntentEventUrl(siteOrigin, intentId) {
  return new URL(
    `${REMOTE_INTENTS_PATH}/${encodeURIComponent(String(intentId || '').trim())}${REMOTE_INTENT_EVENTS_SUFFIX}`,
    String(siteOrigin || '').trim()
  ).toString();
}

function buildRemoteCommandUrl(siteOrigin, options = {}) {
  const url = new URL(REMOTE_COMMANDS_PATH, String(siteOrigin || '').trim());
  if (options.deviceId) url.searchParams.set('deviceId', String(options.deviceId).trim());
  if (options.cursor) url.searchParams.set('cursor', String(options.cursor).trim());
  return url.toString();
}

function buildRemoteCommandResultUrl(siteOrigin, commandId) {
  return new URL(
    `${REMOTE_COMMANDS_PATH}/${encodeURIComponent(String(commandId || '').trim())}${REMOTE_COMMAND_RESULTS_SUFFIX}`,
    String(siteOrigin || '').trim()
  ).toString();
}

function buildRemoteStatusUrl(siteOrigin, options = {}) {
  const url = new URL(REMOTE_STATUS_PATH, String(siteOrigin || '').trim());
  if (options.deviceId) url.searchParams.set('deviceId', String(options.deviceId).trim());
  return url.toString();
}

function normalizeRemoteIntentEventRecord(record = {}) {
  return {
    eventType: String(record.eventType || 'status_update').trim() || 'status_update',
    jobId: String(record.jobId || '').trim(),
    status: String(record.status || '').trim(),
    runnerState: String(record.runnerState || '').trim(),
    progressPercent: Math.max(0, Math.min(100, Number(record.progressPercent || 0) || 0)),
    note: String(record.note || '').trim(),
    failureCode: String(record.failureCode || '').trim(),
    workspaceId: String(record.workspaceId || '').trim(),
    occurredAtIso: String(record.occurredAtIso || '').trim()
  };
}

function normalizeRemoteCommandRecord(record = {}) {
  return {
    id: String(record.id || record.commandId || '').trim(),
    command: String(record.command || record.type || '').trim(),
    jobId: String(record.jobId || '').trim(),
    remoteIntentId: String(record.remoteIntentId || '').trim(),
    videoId: String(record.videoId || '').trim(),
    localPath: String(record.localPath || '').trim(),
    seedPeerId: String(record.seedPeerId || '').trim(),
    note: String(record.note || '').trim(),
    issuedAtIso: String(record.issuedAtIso || record.createdAtIso || '').trim()
  };
}

function normalizeRemoteCommandResultRecord(record = {}) {
  return {
    commandId: String(record.commandId || '').trim(),
    result: String(record.result || 'ignored').trim() || 'ignored',
    note: String(record.note || '').trim(),
    errorCode: String(record.errorCode || '').trim(),
    occurredAtIso: String(record.occurredAtIso || '').trim()
  };
}

function normalizeRemoteClientStatusRecord(record = {}) {
  const device = record.device && typeof record.device === 'object' ? record.device : {};
  const agent = record.agent && typeof record.agent === 'object' ? record.agent : {};
  const counts = record.counts && typeof record.counts === 'object' ? record.counts : {};
  return {
    reportedAtIso: String(record.reportedAtIso || '').trim(),
    device: {
      id: String(device.id || '').trim(),
      name: String(device.name || '').trim(),
      registeredAtIso: String(device.registeredAtIso || '').trim(),
      lastSeenAtIso: String(device.lastSeenAtIso || '').trim(),
      claimedByAccountId: String(device.claimedByAccountId || '').trim(),
      claimedByHandle: String(device.claimedByHandle || '').trim()
    },
    agent: {
      status: String(agent.status || '').trim(),
      transportState: String(agent.transportState || '').trim(),
      lastCycleAtIso: String(agent.lastCycleAtIso || '').trim(),
      lastSyncResult: String(agent.lastSyncResult || '').trim(),
      pollIntervalMs: Math.max(0, Math.trunc(Number(agent.pollIntervalMs || 0) || 0)),
      backgroundOnClose: agent.backgroundOnClose !== false,
      autoStartAgent: agent.autoStartAgent !== false
    },
    counts: {
      queued: Math.max(0, Math.trunc(Number(counts.queued || 0) || 0)),
      running: Math.max(0, Math.trunc(Number(counts.running || 0) || 0)),
      blocked: Math.max(0, Math.trunc(Number(counts.blocked || 0) || 0)),
      completed: Math.max(0, Math.trunc(Number(counts.completed || 0) || 0)),
      failed: Math.max(0, Math.trunc(Number(counts.failed || 0) || 0)),
      library: Math.max(0, Math.trunc(Number(counts.library || 0) || 0))
    },
    jobs: Array.isArray(record.jobs)
      ? record.jobs.map((entry) => ({
        id: String(entry && entry.id || '').trim(),
        videoId: String(entry && entry.videoId || '').trim(),
        videoTitle: String(entry && entry.videoTitle || '').trim(),
        remoteIntentId: String(entry && entry.remoteIntentId || '').trim(),
        status: String(entry && entry.status || '').trim(),
        runnerState: String(entry && entry.runnerState || '').trim(),
        progressPercent: Math.max(0, Math.min(100, Number(entry && entry.progressPercent || 0) || 0)),
        seedAfterDownload: entry && entry.seedAfterDownload !== false,
        updatedAtIso: String(entry && entry.updatedAtIso || '').trim()
      })).filter((entry) => entry.id)
      : [],
    library: Array.isArray(record.library)
      ? record.library.map((entry) => ({
        videoId: String(entry && entry.videoId || '').trim(),
        videoTitle: String(entry && entry.videoTitle || '').trim(),
        fileName: String(entry && entry.fileName || '').trim(),
        sizeBytes: Math.max(0, Math.trunc(Number(entry && entry.sizeBytes || 0) || 0)),
        seedPeerId: String(entry && entry.seedPeerId || '').trim(),
        seedState: String(entry && entry.seedState || '').trim(),
        seedLastAnnouncedAtIso: String(entry && entry.seedLastAnnouncedAtIso || '').trim(),
        seedLastError: String(entry && entry.seedLastError || '').trim()
      })).filter((entry) => entry.videoId)
      : []
  };
}

async function fetchRemoteIntents(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const deviceId = String(options.deviceId || '').trim();
  const deviceToken = String(options.deviceToken || '').trim();
  const cursor = String(options.cursor || '').trim();
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!deviceId) throw new Error('device_id_unavailable');
  if (!deviceToken) throw new Error('device_token_unconfigured');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const response = await fetchImpl(buildRemoteIntentUrl(siteOrigin, { deviceId, cursor }), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${deviceToken}`
    }
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(String(payload.error || `remote_intents_status_${response.status}`));
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    cursor: String(payload.cursor || payload.nextCursor || cursor).trim(),
    intents: Array.isArray(payload.intents)
      ? payload.intents.map((entry) => normalizeRemoteIntentRecord(entry)).filter((entry) => entry.id)
      : []
  };
}

async function fetchRemoteCommands(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const deviceId = String(options.deviceId || '').trim();
  const deviceToken = String(options.deviceToken || '').trim();
  const cursor = String(options.cursor || '').trim();
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!deviceId) throw new Error('device_id_unavailable');
  if (!deviceToken) throw new Error('device_token_unconfigured');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const response = await fetchImpl(buildRemoteCommandUrl(siteOrigin, { deviceId, cursor }), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${deviceToken}`
    }
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(String(payload.error || `remote_commands_status_${response.status}`));
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    cursor: String(payload.cursor || payload.nextCursor || cursor).trim(),
    commands: Array.isArray(payload.commands)
      ? payload.commands.map((entry) => normalizeRemoteCommandRecord(entry)).filter((entry) => entry.id && entry.command)
      : []
  };
}

async function publishRemoteIntentEvent(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const deviceId = String(options.deviceId || '').trim();
  const deviceToken = String(options.deviceToken || '').trim();
  const intentId = String(options.intentId || '').trim();
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const event = normalizeRemoteIntentEventRecord(options.event);

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!deviceId) throw new Error('device_id_unavailable');
  if (!deviceToken) throw new Error('device_token_unconfigured');
  if (!intentId) throw new Error('intent_id_required');
  if (!event.jobId) throw new Error('job_id_required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const response = await fetchImpl(buildRemoteIntentEventUrl(siteOrigin, intentId), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceToken}`
    },
    body: JSON.stringify({
      deviceId,
      event
    })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(String(payload.error || `remote_intent_event_status_${response.status}`));
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    accepted: payload.accepted !== false,
    eventId: String(payload.eventId || '').trim(),
    intentStatus: String(payload.intentStatus || '').trim()
  };
}

async function publishRemoteClientStatus(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const deviceId = String(options.deviceId || '').trim();
  const deviceToken = String(options.deviceToken || '').trim();
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const status = normalizeRemoteClientStatusRecord(options.status);

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!deviceId) throw new Error('device_id_unavailable');
  if (!deviceToken) throw new Error('device_token_unconfigured');
  if (!status.device.id) throw new Error('status_device_id_required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const response = await fetchImpl(buildRemoteStatusUrl(siteOrigin, { deviceId }), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceToken}`
    },
    body: JSON.stringify({
      deviceId,
      status
    })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(String(payload.error || `remote_status_status_${response.status}`));
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    accepted: payload.accepted !== false,
    statusId: String(payload.statusId || '').trim(),
    device: payload.device && typeof payload.device === 'object' ? payload.device : null
  };
}

async function publishRemoteCommandResult(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const deviceId = String(options.deviceId || '').trim();
  const deviceToken = String(options.deviceToken || '').trim();
  const commandId = String(options.commandId || '').trim();
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const result = normalizeRemoteCommandResultRecord({
    ...options.result,
    commandId
  });

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!deviceId) throw new Error('device_id_unavailable');
  if (!deviceToken) throw new Error('device_token_unconfigured');
  if (!commandId) throw new Error('command_id_required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const response = await fetchImpl(buildRemoteCommandResultUrl(siteOrigin, commandId), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deviceToken}`
    },
    body: JSON.stringify({
      deviceId,
      result
    })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(String(payload.error || `remote_command_result_status_${response.status}`));
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    accepted: payload.accepted !== false,
    resultId: String(payload.resultId || '').trim(),
    commandStatus: String(payload.commandStatus || '').trim()
  };
}

function mergeRemoteIntentsIntoJobs(state, intents, options = {}) {
  const sourceState = state && typeof state === 'object' ? state : {};
  const jobs = Array.isArray(sourceState.jobs) ? sourceState.jobs.slice() : [];
  const existingIds = new Set(
    jobs
      .map((job) => String(job && job.remoteIntentId || '').trim())
      .filter(Boolean)
  );
  const nextJobs = jobs.slice();
  const createdJobs = [];

  for (const intent of Array.isArray(intents) ? intents : []) {
    const normalized = normalizeRemoteIntentRecord(intent);
    if (!normalized.id || existingIds.has(normalized.id)) continue;
    const job = createQueuedJobRecord({
      source: 'remote',
      remoteIntentId: normalized.id,
      videoId: normalized.videoId,
      videoTitle: normalized.videoTitle,
      channelId: normalized.channelId,
      note: normalized.note || 'Queued from remote site intent.'
    }, options);
    existingIds.add(normalized.id);
    nextJobs.unshift(job);
    createdJobs.push(job);
  }

  return {
    jobs: nextJobs,
    createdJobs
  };
}

module.exports = {
  REMOTE_COMMANDS_PATH,
  REMOTE_COMMAND_RESULTS_SUFFIX,
  REMOTE_INTENTS_PATH,
  REMOTE_INTENT_EVENTS_SUFFIX,
  REMOTE_STATUS_PATH,
  buildRemoteCommandResultUrl,
  buildRemoteCommandUrl,
  buildRemoteIntentEventUrl,
  buildRemoteIntentUrl,
  buildRemoteStatusUrl,
  fetchRemoteCommands,
  fetchRemoteIntents,
  mergeRemoteIntentsIntoJobs,
  normalizeRemoteClientStatusRecord,
  normalizeRemoteCommandRecord,
  normalizeRemoteCommandResultRecord,
  normalizeRemoteIntentEventRecord,
  normalizeRemoteIntentRecord,
  publishRemoteClientStatus,
  publishRemoteCommandResult,
  publishRemoteIntentEvent
};
