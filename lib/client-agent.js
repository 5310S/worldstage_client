'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { defaultClientConfig, sanitizeClientConfig } = require('./client-config');
const {
  appendWorkspaceEvent,
  assembleWorkspaceArtifact,
  prepareJobWorkspace,
  writeDownloadManifest,
  writeWorkspaceChunk,
  workspaceRootPath,
  writeWorkspaceJobState
} = require('./client-workspace');
const {
  answerSession,
  announceSeederPeer,
  announceViewerPeer,
  bootstrapDownloadControlPlane,
  fetchSessions,
  fetchSessionRecord,
  publishSessionCandidate,
  seederPeerIdForVideo,
  updateDownloadChunk
} = require('./control-plane');
const {
  fetchRemoteCommands,
  fetchRemoteIntents,
  mergeRemoteIntentsIntoJobs,
  publishRemoteClientStatus,
  publishRemoteCommandResult,
  publishRemoteIntentEvent
} = require('./remote-intents');
const {
  VALID_JOB_STATUSES,
  clone,
  createQueuedJobRecord,
  nowIso,
  readClientState,
  writeClientState
} = require('./client-state');
const {
  claimPairingLink,
  pairingConfigUpdate,
  parsePairingLink
} = require('./pairing-link');

class WorldStageClientAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.clock = typeof options.clock === 'function' ? options.clock : Date.now;
    this.configPath = path.resolve(options.configPath || path.join(process.cwd(), 'client-config.json'));
    this.statePath = path.resolve(options.statePath || path.join(process.cwd(), 'client-state.json'));
    this.defaultDownloadDirectory = String(options.defaultDownloadDirectory || '').trim();
    this.defaultSiteOrigin = String(options.defaultSiteOrigin || '').trim() || 'https://5310s.com';
    this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
    this.timer = null;
    this.config = this.readConfig();
    this.state = readClientState(this.statePath, { clock: this.clock });
    this.persistConfig();
    this.persistState();
  }

  readConfig() {
    const defaults = defaultClientConfig({
      defaultDownloadDirectory: this.defaultDownloadDirectory,
      defaultSiteOrigin: this.defaultSiteOrigin
    });
    if (!fs.existsSync(this.configPath)) return defaults;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return sanitizeClientConfig(parsed, {
        defaultDownloadDirectory: this.defaultDownloadDirectory,
        defaultSiteOrigin: this.defaultSiteOrigin
      });
    } catch (_) {
      return defaults;
    }
  }

  persistConfig() {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  persistState() {
    this.state = writeClientState(this.statePath, this.state, { clock: this.clock });
  }

  summary() {
    const jobs = Array.isArray(this.state.jobs) ? this.state.jobs : [];
    const jobCounts = jobs.reduce((counts, job) => {
      const key = String(job.status || 'queued').trim() || 'queued';
      counts[key] = Number(counts[key] || 0) + 1;
      return counts;
    }, {});
    const transportAvailable = Boolean(this.config.accountToken);
    let transportNote = 'Add a WorldStage account token so the desktop client can open download sessions, exchange WebRTC candidates, and seed completed local copies in the background.';
    if (transportAvailable && this.config.deviceToken) {
      transportNote = 'Background download transport is available and the website bridge is active. The client can claim remote intents, bootstrap sessions, exchange ICE candidates, store verified chunks locally, and answer download requests from completed local copies.';
    } else if (transportAvailable) {
      transportNote = 'Background download and seeding transport is available for local intents. Add the device token to let 5310s.com push remote download-and-seed work into this running client.';
    }

    return {
      deviceId: this.state.device.id,
      agentStatus: this.state.agent.status,
      siteOrigin: this.config.siteOrigin,
      transportAvailable,
      transportNote,
      queuedJobCount: Number(jobCounts.queued || 0),
      runningJobCount: Number(jobCounts.running || 0),
      completedJobCount: Number(jobCounts.completed || 0),
      failedJobCount: Number(jobCounts.failed || 0),
      blockedJobCount: Number(jobCounts.blocked || 0),
      libraryItemCount: Array.isArray(this.state.library) ? this.state.library.length : 0,
      downloadDirectory: this.config.downloadDirectory,
      backgroundOnClose: this.config.backgroundOnClose
    };
  }

  snapshot() {
    return {
      config: clone(this.config),
      state: clone(this.state),
      summary: this.summary(),
      paths: {
        configPath: this.configPath,
        statePath: this.statePath,
        workspaceRootPath: workspaceRootPath(this.config.downloadDirectory)
      }
    };
  }

  emitChange() {
    this.emit('changed', this.snapshot());
  }

  workspaceFromJob(job = {}) {
    return {
      rootPath: String(job.workspacePath || '').trim(),
      jobStatePath: String(job.jobStatePath || '').trim(),
      partialDirectory: String(job.partialDirectory || '').trim(),
      artifactDirectory: String(job.artifactDirectory || '').trim(),
      stagingDirectory: String(job.stagingDirectory || '').trim(),
      logsDirectory: String(job.logsDirectory || '').trim(),
      eventLogPath: String(job.eventLogPath || '').trim(),
      downloadManifestPath: String(job.downloadManifestPath || '').trim()
    };
  }

  readJobManifestDigest(job = {}) {
    const filePath = String(job.downloadManifestPath || '').trim();
    if (!filePath || !fs.existsSync(filePath)) return '';
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return String(parsed.fileHash || '').trim().toLowerCase();
    } catch (_) {
      return '';
    }
  }

  upsertLibraryEntry(job, localPath) {
    const addedAtIso = nowIso(this.clock);
    const nextRecord = {
      videoId: String(job.videoId || '').trim(),
      videoTitle: String(job.videoTitle || '').trim(),
      localPath: String(localPath || '').trim(),
      manifestPath: String(job.downloadManifestPath || '').trim(),
      fileName: String(job.fileName || '').trim(),
      mimeType: String(job.mimeType || '').trim(),
      sizeBytes: Math.max(0, Math.trunc(Number(job.sizeBytes || 0) || 0)),
      chunkSize: Math.max(0, Math.trunc(Number(job.chunkSize || 0) || 0)),
      chunkCount: Math.max(0, Math.trunc(Number(job.chunkCount || 0) || 0)),
      manifestDigest: this.readJobManifestDigest(job),
      seedPeerId: job.seedAfterDownload === false
        ? ''
        : seederPeerIdForVideo(this.state.device.id, job.videoId),
      seedState: job.seedAfterDownload === false
        ? 'local_only'
        : 'ready_to_seed',
      seedLastAnnouncedAtIso: '',
      seedLastError: '',
      addedAtIso
    };

    const index = this.state.library.findIndex((entry) => {
      return entry.videoId === nextRecord.videoId
        || (nextRecord.localPath && entry.localPath === nextRecord.localPath);
    });

    if (index >= 0) {
      this.state.library[index] = {
        ...this.state.library[index],
        ...nextRecord,
        addedAtIso: this.state.library[index].addedAtIso || addedAtIso
      };
      return this.state.library[index];
    }

    this.state.library.unshift(nextRecord);
    return nextRecord;
  }

  async syncLibrarySeederEntry(record, options = {}) {
    if (!record || typeof record !== 'object') return null;
    if (!String(record.videoId || '').trim()) return record;
    if (record.seedState === 'local_only') return record;
    if (record.seedState === 'seed_paused') return record;

    const iso = String(options.iso || nowIso(this.clock)).trim() || nowIso(this.clock);
    const seedPeerId = seederPeerIdForVideo(this.state.device.id, record.videoId);
    record.seedPeerId = seedPeerId;

    const localPath = String(record.localPath || '').trim();
    const manifestPath = String(record.manifestPath || '').trim();
    if (!localPath || !fs.existsSync(localPath)) {
      record.seedState = 'seed_source_missing';
      record.seedLastError = 'local_file_missing';
      return record;
    }
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      record.seedState = 'seed_source_missing';
      record.seedLastError = 'seed_manifest_missing';
      return record;
    }

    if (!this.config.siteOrigin || !this.config.accountToken) {
      record.seedState = 'ready_to_seed';
      record.seedLastError = '';
      return record;
    }

    try {
      const peer = await announceSeederPeer({
        siteOrigin: this.config.siteOrigin,
        accountToken: this.config.accountToken,
        peerId: seedPeerId,
        videoId: record.videoId,
        fetchImpl: this.fetchImpl
      });
      record.seedPeerId = String(peer.peerId || seedPeerId).trim() || seedPeerId;
      record.seedState = 'seeding';
      record.seedLastAnnouncedAtIso = iso;
      record.seedLastError = '';
      return record;
    } catch (error) {
      record.seedState = 'seed_announce_failed';
      record.seedLastError = String(error && error.message ? error.message : error);
      return record;
    }
  }

  async syncLibrarySeedPeers(iso = nowIso(this.clock)) {
    if (!Array.isArray(this.state.library) || !this.state.library.length) return;
    for (const entry of this.state.library) {
      await this.syncLibrarySeederEntry(entry, { iso });
    }
  }

  findLibraryEntry(input = {}) {
    const videoId = String(input.videoId || '').trim();
    const localPath = String(input.localPath || '').trim();
    const seedPeerId = String(input.seedPeerId || '').trim();
    const entry = this.state.library.find((candidate) => {
      if (videoId && String(candidate && candidate.videoId || '').trim() === videoId) return true;
      if (localPath && String(candidate && candidate.localPath || '').trim() === localPath) return true;
      if (seedPeerId && String(candidate && candidate.seedPeerId || '').trim() === seedPeerId) return true;
      return false;
    });
    if (!entry) throw new Error('library_entry_not_found');
    return entry;
  }

  async refreshLibraryItem(input = {}) {
    const entry = this.findLibraryEntry(input);
    await this.syncLibrarySeederEntry(entry, {
      iso: nowIso(this.clock)
    });
    this.refreshTransportState();
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  pauseLibraryItem(input = {}) {
    const entry = this.findLibraryEntry(input);
    entry.seedState = entry.seedState === 'local_only' ? 'local_only' : 'seed_paused';
    entry.seedLastError = '';
    this.refreshTransportState();
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  async resumeLibraryItem(input = {}) {
    const entry = this.findLibraryEntry(input);
    entry.seedState = entry.seedState === 'local_only' ? 'local_only' : 'ready_to_seed';
    entry.seedLastError = '';
    await this.syncLibrarySeederEntry(entry, {
      iso: nowIso(this.clock)
    });
    this.refreshTransportState();
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  removeLibraryItem(input = {}) {
    const entry = this.findLibraryEntry(input);
    this.state.library = this.state.library.filter((candidate) => candidate !== entry);
    this.refreshTransportState();
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  findManagedJob(input = {}) {
    const jobId = String(input.jobId || '').trim();
    const remoteIntentId = String(input.remoteIntentId || '').trim();
    const videoId = String(input.videoId || '').trim();
    if (jobId) return this.findJob(jobId);
    const job = this.state.jobs.find((entry) => {
      if (remoteIntentId && entry.remoteIntentId === remoteIntentId) return true;
      if (videoId && entry.videoId === videoId) return true;
      return false;
    });
    if (!job) throw new Error('job_not_found');
    return job;
  }

  resetJobWorkspace(job) {
    const partialDirectory = String(job && job.partialDirectory || '').trim();
    const stagingDirectory = String(job && job.stagingDirectory || '').trim();
    const artifactDirectory = String(job && job.artifactDirectory || '').trim();

    for (const directory of [partialDirectory, stagingDirectory, artifactDirectory]) {
      if (!directory) continue;
      fs.rmSync(directory, { recursive: true, force: true });
      fs.mkdirSync(directory, { recursive: true });
    }
  }

  removeJobWorkspace(job) {
    const workspacePath = String(job && job.workspacePath || '').trim();
    if (!workspacePath) return;
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }

  resetJobTransferState(job) {
    job.controlPeerId = '';
    job.downloadId = '';
    job.sessionId = '';
    job.targetPeerId = '';
    job.sessionTransport = '';
    job.sessionStatus = '';
    job.sessionAnsweredAtIso = '';
    job.lastSessionSyncAtIso = '';
    job.sessionAnswer = null;
    job.creatorCandidates = [];
    job.fileName = '';
    job.mimeType = '';
    job.sizeBytes = 0;
    job.chunkSize = 0;
    job.chunkCount = 0;
    job.verifiedChunkCount = 0;
    job.receivedBytes = 0;
    job.localFilePath = '';
    job.startedAtIso = '';
    job.completedAtIso = '';
  }

  refreshTransportState() {
    const runningJobCount = this.state.jobs.filter((job) => job.status === 'running').length;
    const blockedJobCount = this.state.jobs.filter((job) => job.status === 'blocked').length;
    this.state.transport.activeTransferCount = runningJobCount;
    this.state.transport.hostState = runningJobCount > 0
      ? 'active'
      : blockedJobCount > 0
        ? 'prepared'
        : 'idle';

    if (runningJobCount > 0) {
      this.state.agent.transportState = 'transport_host_active';
      return;
    }
    if (blockedJobCount > 0) {
      this.state.agent.transportState = 'workspace_prepared';
      return;
    }
    if (this.config.deviceToken && this.config.siteOrigin) {
      this.state.agent.transportState = 'intent_bridge_ready';
      return;
    }
    this.state.agent.transportState = 'not_connected';
  }

  findJob(jobId) {
    const key = String(jobId || '').trim();
    if (!key) throw new Error('job_id_required');
    const job = this.state.jobs.find((entry) => entry.id === key);
    if (!job) throw new Error('job_not_found');
    return job;
  }

  persistJobUpdate(job, event, options = {}) {
    const iso = nowIso(this.clock);
    if (job.status === 'running' && !job.startedAtIso) job.startedAtIso = iso;
    if ((job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') && !job.completedAtIso) {
      job.completedAtIso = iso;
    }
    const workspace = this.workspaceFromJob(job);
    if (workspace.jobStatePath) {
      writeWorkspaceJobState(workspace, job, {
        clock: this.clock
      });
    }

    if (event && event.eventType && workspace.eventLogPath) {
      appendWorkspaceEvent(workspace, {
        eventType: String(event.eventType || '').trim(),
        source: String(event.source || 'agent').trim() || 'agent',
        jobId: job.id,
        remoteIntentId: job.remoteIntentId,
        status: job.status,
        runnerState: job.runnerState,
        progressPercent: job.progressPercent,
        note: String(event.note != null ? event.note : job.note || '').trim(),
        failureCode: String(event.failureCode != null ? event.failureCode : job.failureCode || '').trim(),
        occurredAtIso: String(event.occurredAtIso || iso).trim() || iso
      }, {
        clock: this.clock
      });
    }

    this.refreshTransportState();
    if (options.persistState !== false) this.persistState();
    if (options.emitChange !== false) this.emitChange();
    return this.snapshot();
  }

  async commitTransportEvent(job, event = {}) {
    const iso = String(event.occurredAtIso || nowIso(this.clock)).trim() || nowIso(this.clock);
    const normalizedEventType = String(event.eventType || 'status_update').trim() || 'status_update';

    this.persistJobUpdate(job, {
      ...event,
      eventType: normalizedEventType,
      occurredAtIso: iso
    }, {
      persistState: false,
      emitChange: false
    });

    const remoteResult = await this.reportRemoteJobEvent(job, {
      eventType: normalizedEventType,
      status: job.status,
      runnerState: job.runnerState,
      progressPercent: job.progressPercent,
      note: String(event.note != null ? event.note : job.note || '').trim(),
      failureCode: String(event.failureCode != null ? event.failureCode : job.failureCode || '').trim()
    }, iso);

    const remoteEventType = remoteResult.reported
      ? 'remote_event_reported'
      : remoteResult.result === 'not_applicable' || remoteResult.result === 'remote_report_unconfigured'
        ? 'remote_event_skipped'
        : 'remote_event_failed';

    const workspace = this.workspaceFromJob(job);
    if (workspace.eventLogPath) {
      appendWorkspaceEvent(workspace, {
        eventType: remoteEventType,
        source: 'agent',
        jobId: job.id,
        remoteIntentId: job.remoteIntentId,
        status: job.status,
        runnerState: job.runnerState,
        progressPercent: job.progressPercent,
        note: remoteResult.result,
        occurredAtIso: iso
      }, {
        clock: this.clock
      });
    }

    this.refreshTransportState();
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  async bootstrapControlPlaneJob(input = {}) {
    const jobId = String(input.jobId || '').trim();
    if (!jobId) throw new Error('job_id_required');
    const job = this.state.jobs.find((entry) => entry.id === jobId);
    if (!job) throw new Error('job_not_found');

    if (!this.config.accountToken) {
      return this.applyTransportUpdate({
        jobId,
        status: 'blocked',
        runnerState: 'awaiting_account_token',
        note: 'Add a WorldStage account token so the client can announce a viewer peer, create a download record, and open a transfer session.',
        failureCode: 'account_token_unconfigured',
        eventType: 'control_plane_auth_required'
      });
    }

    const offer = input.offer && typeof input.offer === 'object' ? input.offer : null;
    if (!offer || !String(offer.type || '').trim() || !String(offer.sdp || '').trim()) {
      return this.applyTransportUpdate({
        jobId,
        status: 'blocked',
        runnerState: 'awaiting_webrtc_offer',
        note: 'The transport host has not produced a WebRTC offer for this download yet.',
        failureCode: 'offer_required',
        eventType: 'control_plane_offer_required'
      });
    }

    try {
      const bootstrap = await bootstrapDownloadControlPlane({
        siteOrigin: this.config.siteOrigin,
        accountToken: this.config.accountToken,
        deviceId: this.state.device.id,
        job,
        offer,
        fetchImpl: this.fetchImpl
      });

      return this.applyTransportUpdate({
        jobId,
        status: 'running',
        runnerState: 'awaiting_session_answer',
        progressPercent: Math.max(Number(job.progressPercent || 0) || 0, 12),
        note: bootstrap.session.targetPeerId
          ? `Transfer session ${bootstrap.session.sessionId} opened for ${bootstrap.session.targetPeerId}. Waiting for that seeder to answer.`
          : `Transfer session ${bootstrap.session.sessionId} opened. Waiting for a seeding peer to answer.`,
        failureCode: '',
        eventType: 'control_plane_bootstrapped',
        controlPeerId: String(bootstrap.peer.peerId || '').trim(),
        downloadId: String(bootstrap.download.downloadId || '').trim(),
        sessionId: String(bootstrap.session.sessionId || '').trim(),
        targetPeerId: String(bootstrap.session.targetPeerId || '').trim(),
        sessionTransport: String(bootstrap.session.transport || '').trim(),
        sessionStatus: String(bootstrap.session.status || '').trim(),
        lastSessionSyncAtIso: nowIso(this.clock)
      });
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      const statusCode = Number(error && error.statusCode || 0);
      const authFailure = statusCode === 401
        || message === 'auth_required'
        || message === 'invalid_auth_token'
        || message === 'invalid_authorization_header'
        || message === 'account_token_unconfigured';

      return this.applyTransportUpdate({
        jobId,
        status: 'blocked',
        runnerState: authFailure ? 'awaiting_account_token' : 'control_plane_bootstrap_failed',
        note: authFailure
          ? 'The configured WorldStage account token was rejected. Add a valid token before retrying background downloads.'
          : `Control-plane bootstrap failed: ${message}`,
        failureCode: message,
        eventType: 'control_plane_bootstrap_failed'
      });
    }
  }

  async reportRemoteJobEvent(job, event, iso = nowIso(this.clock)) {
    const resultBase = {
      reported: false,
      result: 'not_applicable'
    };

    if (!job || !job.remoteIntentId) {
      this.state.transport.lastRemoteReportAtIso = iso;
      this.state.transport.lastRemoteReportResult = 'not_applicable';
      return resultBase;
    }

    if (!this.config.siteOrigin || !this.config.deviceToken) {
      this.state.transport.lastRemoteReportAtIso = iso;
      this.state.transport.lastRemoteReportResult = 'remote_report_unconfigured';
      return {
        reported: false,
        result: 'remote_report_unconfigured'
      };
    }

    try {
      const response = await publishRemoteIntentEvent({
        siteOrigin: this.config.siteOrigin,
        deviceId: this.state.device.id,
        deviceToken: this.config.deviceToken,
        intentId: job.remoteIntentId,
        event: {
          ...event,
          jobId: job.id,
          workspaceId: job.workspaceId,
          occurredAtIso: iso
        },
        fetchImpl: this.fetchImpl
      });
      this.state.transport.lastRemoteReportAtIso = iso;
      this.state.transport.lastRemoteReportResult = 'remote_event_reported';
      this.state.agent.lastError = '';
      return {
        reported: true,
        result: 'remote_event_reported',
        response
      };
    } catch (error) {
      const statusCode = Number(error && error.statusCode || 0);
      this.state.transport.lastRemoteReportAtIso = iso;
      this.state.transport.lastRemoteReportResult = statusCode === 404
        ? 'remote_bridge_unavailable'
        : statusCode === 401 || statusCode === 403
          ? 'device_token_rejected'
          : 'remote_event_failed';
      this.state.agent.lastError = String(error && error.message ? error.message : error);
      return {
        reported: false,
        result: this.state.transport.lastRemoteReportResult,
        error
      };
    }
  }

  buildRemoteStatusPayload(iso = nowIso(this.clock)) {
    const jobs = Array.isArray(this.state.jobs) ? this.state.jobs : [];
    const library = Array.isArray(this.state.library) ? this.state.library : [];
    const counts = jobs.reduce((result, job) => {
      const key = String(job && job.status || '').trim();
      if (!key) return result;
      result[key] = Number(result[key] || 0) + 1;
      return result;
    }, {
      queued: 0,
      running: 0,
      blocked: 0,
      completed: 0,
      failed: 0
    });

    return {
      reportedAtIso: iso,
      device: {
        id: this.state.device.id,
        name: this.config.deviceName,
        registeredAtIso: this.state.device.registeredAtIso,
        lastSeenAtIso: this.state.device.lastSeenAtIso,
        claimedByAccountId: this.state.device.claimedByAccountId,
        claimedByHandle: this.state.device.claimedByHandle
      },
      agent: {
        status: this.state.agent.status,
        transportState: this.state.agent.transportState,
        lastCycleAtIso: this.state.agent.lastCycleAtIso,
        lastSyncResult: this.state.agent.lastSyncResult,
        pollIntervalMs: this.config.pollIntervalMs,
        backgroundOnClose: this.config.backgroundOnClose,
        autoStartAgent: this.config.autoStartAgent
      },
      counts: {
        queued: Number(counts.queued || 0),
        running: Number(counts.running || 0),
        blocked: Number(counts.blocked || 0),
        completed: Number(counts.completed || 0),
        failed: Number(counts.failed || 0),
        library: library.length
      },
      jobs: jobs.map((job) => ({
        id: String(job.id || '').trim(),
        videoId: String(job.videoId || '').trim(),
        videoTitle: String(job.videoTitle || '').trim(),
        remoteIntentId: String(job.remoteIntentId || '').trim(),
        status: String(job.status || '').trim(),
        runnerState: String(job.runnerState || '').trim(),
        progressPercent: Math.max(0, Math.min(100, Number(job.progressPercent || 0) || 0)),
        seedAfterDownload: job.seedAfterDownload !== false,
        updatedAtIso: String(job.updatedAtIso || '').trim()
      })),
      library: library.map((entry) => ({
        videoId: String(entry.videoId || '').trim(),
        videoTitle: String(entry.videoTitle || '').trim(),
        fileName: String(entry.fileName || '').trim(),
        sizeBytes: Math.max(0, Math.trunc(Number(entry.sizeBytes || 0) || 0)),
        seedPeerId: String(entry.seedPeerId || '').trim(),
        seedState: String(entry.seedState || '').trim(),
        seedLastAnnouncedAtIso: String(entry.seedLastAnnouncedAtIso || '').trim(),
        seedLastError: String(entry.seedLastError || '').trim()
      }))
    };
  }

  async reportRemoteClientStatus(iso = nowIso(this.clock)) {
    if (!this.config.siteOrigin) {
      this.state.transport.lastRemoteStatusAtIso = iso;
      this.state.transport.lastRemoteStatusResult = 'site_origin_unconfigured';
      return {
        reported: false,
        result: 'site_origin_unconfigured'
      };
    }

    if (!this.config.deviceToken) {
      this.state.transport.lastRemoteStatusAtIso = iso;
      this.state.transport.lastRemoteStatusResult = 'device_token_unconfigured';
      return {
        reported: false,
        result: 'device_token_unconfigured'
      };
    }

    try {
      const response = await publishRemoteClientStatus({
        siteOrigin: this.config.siteOrigin,
        deviceId: this.state.device.id,
        deviceToken: this.config.deviceToken,
        status: this.buildRemoteStatusPayload(iso),
        fetchImpl: this.fetchImpl
      });
      this.state.transport.lastRemoteStatusAtIso = iso;
      this.state.transport.lastRemoteStatusResult = 'remote_status_reported';
      const responseDevice = response && response.device && typeof response.device === 'object'
        ? response.device
        : null;
      if (responseDevice) {
        if (responseDevice.registeredAtIso) this.state.device.registeredAtIso = String(responseDevice.registeredAtIso).trim();
        if (Object.prototype.hasOwnProperty.call(responseDevice, 'claimedByAccountId')) {
          this.state.device.claimedByAccountId = String(responseDevice.claimedByAccountId || '').trim();
        }
        if (Object.prototype.hasOwnProperty.call(responseDevice, 'claimedByHandle')) {
          this.state.device.claimedByHandle = String(responseDevice.claimedByHandle || '').trim();
        }
      }
      return {
        reported: true,
        result: 'remote_status_reported',
        response
      };
    } catch (error) {
      const statusCode = Number(error && error.statusCode || 0);
      this.state.transport.lastRemoteStatusAtIso = iso;
      this.state.transport.lastRemoteStatusResult = statusCode === 404
        ? 'remote_status_bridge_unavailable'
        : statusCode === 401 || statusCode === 403
          ? 'device_token_rejected'
          : 'remote_status_failed';
      return {
        reported: false,
        result: this.state.transport.lastRemoteStatusResult,
        error
      };
    }
  }

  async reportRemoteCommandResult(command, result, iso = nowIso(this.clock)) {
    if (!command || !command.id) {
      this.state.transport.lastRemoteCommandAtIso = iso;
      this.state.transport.lastRemoteCommandResult = 'command_result_not_applicable';
      return {
        reported: false,
        result: 'command_result_not_applicable'
      };
    }

    if (!this.config.siteOrigin || !this.config.deviceToken) {
      this.state.transport.lastRemoteCommandAtIso = iso;
      this.state.transport.lastRemoteCommandResult = 'remote_command_unconfigured';
      return {
        reported: false,
        result: 'remote_command_unconfigured'
      };
    }

    try {
      const response = await publishRemoteCommandResult({
        siteOrigin: this.config.siteOrigin,
        deviceId: this.state.device.id,
        deviceToken: this.config.deviceToken,
        commandId: command.id,
        result,
        fetchImpl: this.fetchImpl
      });
      this.state.transport.lastRemoteCommandAtIso = iso;
      this.state.transport.lastRemoteCommandResult = 'remote_command_reported';
      this.state.agent.lastError = '';
      return {
        reported: true,
        result: 'remote_command_reported',
        response
      };
    } catch (error) {
      const statusCode = Number(error && error.statusCode || 0);
      this.state.transport.lastRemoteCommandAtIso = iso;
      this.state.transport.lastRemoteCommandResult = statusCode === 404
        ? 'remote_command_bridge_unavailable'
        : statusCode === 401 || statusCode === 403
          ? 'device_token_rejected'
          : 'remote_command_failed';
      return {
        reported: false,
        result: this.state.transport.lastRemoteCommandResult,
        error
      };
    }
  }

  async applyRemoteCommand(command, iso = nowIso(this.clock)) {
    const normalized = command && typeof command === 'object' ? command : {};
    const commandName = String(normalized.command || '').trim();
    const libraryLocator = {
      videoId: normalized.videoId,
      localPath: normalized.localPath,
      seedPeerId: normalized.seedPeerId
    };
    const jobLocator = {
      jobId: normalized.jobId,
      remoteIntentId: normalized.remoteIntentId,
      videoId: normalized.videoId
    };

    try {
      if (commandName === 'pause_seed') {
        this.pauseLibraryItem(libraryLocator);
        await this.reportRemoteCommandResult(normalized, {
          result: 'applied',
          note: 'Seed paused.',
          occurredAtIso: iso
        }, iso);
        return;
      }

      if (commandName === 'resume_seed') {
        await this.resumeLibraryItem(libraryLocator);
        await this.reportRemoteCommandResult(normalized, {
          result: 'applied',
          note: 'Seed resumed.',
          occurredAtIso: iso
        }, iso);
        return;
      }

      if (commandName === 'refresh_seed') {
        await this.refreshLibraryItem(libraryLocator);
        await this.reportRemoteCommandResult(normalized, {
          result: 'applied',
          note: 'Seed refreshed.',
          occurredAtIso: iso
        }, iso);
        return;
      }

      if (commandName === 'remove_seed') {
        this.removeLibraryItem(libraryLocator);
        await this.reportRemoteCommandResult(normalized, {
          result: 'applied',
          note: 'Seed removed from the desktop library.',
          occurredAtIso: iso
        }, iso);
        return;
      }

      if (commandName === 'cancel_job') {
        await this.cancelJob({
          ...jobLocator,
          runnerState: 'canceled_by_remote_command',
          note: 'The website canceled this download on the home client.',
          failureCode: 'job_canceled_by_remote_command',
          eventType: 'job_canceled'
        });
        await this.reportRemoteCommandResult(normalized, {
          result: 'applied',
          note: 'Job canceled.',
          occurredAtIso: iso
        }, iso);
        return;
      }

      if (commandName === 'retry_job') {
        await this.retryJob({
          ...jobLocator,
          note: 'The website requested a fresh background retry for this download.',
          eventType: 'job_retried'
        });
        await this.reportRemoteCommandResult(normalized, {
          result: 'applied',
          note: 'Job reset for retry.',
          occurredAtIso: iso
        }, iso);
        return;
      }

      if (commandName === 'remove_job') {
        this.removeJob(jobLocator);
        await this.reportRemoteCommandResult(normalized, {
          result: 'applied',
          note: 'Job removed from the desktop queue.',
          occurredAtIso: iso
        }, iso);
        return;
      }

      await this.reportRemoteCommandResult(normalized, {
        result: 'ignored',
        note: `Unsupported command: ${commandName || 'unknown'}.`,
        errorCode: 'unsupported_command',
        occurredAtIso: iso
      }, iso);
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      const ignored = message === 'library_entry_not_found' || message === 'job_not_found';
      await this.reportRemoteCommandResult(normalized, {
        result: ignored ? 'ignored' : 'failed',
        note: ignored
          ? message === 'job_not_found'
            ? 'The requested job is not available on this client.'
            : 'The requested library item is not available on this client.'
          : `Command failed: ${message}`,
        errorCode: message,
        occurredAtIso: iso
      }, iso);
    }
  }

  async syncRemoteCommands(iso = nowIso(this.clock)) {
    if (!this.config.siteOrigin) {
      this.state.transport.pendingRemoteCommandCount = 0;
      this.state.transport.lastRemoteCommandAtIso = iso;
      this.state.transport.lastRemoteCommandResult = 'site_origin_unconfigured';
      return;
    }

    if (!this.config.deviceToken) {
      this.state.transport.pendingRemoteCommandCount = 0;
      this.state.transport.lastRemoteCommandAtIso = iso;
      this.state.transport.lastRemoteCommandResult = 'device_token_unconfigured';
      return;
    }

    try {
      const remote = await fetchRemoteCommands({
        siteOrigin: this.config.siteOrigin,
        deviceId: this.state.device.id,
        deviceToken: this.config.deviceToken,
        cursor: this.state.transport.lastCommandCursor,
        fetchImpl: this.fetchImpl
      });
      const commands = Array.isArray(remote.commands) ? remote.commands : [];
      this.state.transport.lastCommandCursor = remote.cursor;
      this.state.transport.pendingRemoteCommandCount = commands.length;
      this.state.transport.lastRemoteCommandAtIso = iso;
      this.state.transport.lastRemoteCommandResult = commands.length
        ? 'remote_commands_received'
        : 'remote_commands_idle';
      this.state.agent.lastError = '';
      for (const command of commands) {
        await this.applyRemoteCommand(command, iso);
      }
      this.state.transport.pendingRemoteCommandCount = 0;
    } catch (error) {
      const statusCode = Number(error && error.statusCode || 0);
      this.state.transport.pendingRemoteCommandCount = 0;
      this.state.transport.lastRemoteCommandAtIso = iso;
      this.state.transport.lastRemoteCommandResult = statusCode === 404
        ? 'remote_command_bridge_unavailable'
        : statusCode === 401 || statusCode === 403
          ? 'device_token_rejected'
          : 'remote_command_failed';
      this.state.agent.lastError = String(error && error.message ? error.message : error);
    }
  }

  prepareNextQueuedJob(iso = nowIso(this.clock)) {
    const queuedJob = this.state.jobs.find((job) => job.status === 'queued');
    if (!queuedJob) return null;

    const preparedJob = {
      ...queuedJob,
      status: 'blocked',
      runnerState: 'awaiting_transport_worker',
      claimedAtIso: queuedJob.claimedAtIso || iso,
      progressPercent: Math.max(queuedJob.progressPercent, 1),
      updatedAtIso: iso,
      note: queuedJob.source === 'remote'
        ? 'Remote intent claimed locally. Workspace prepared; waiting for the desktop transport worker.'
        : 'Local intent claimed. Workspace prepared; waiting for the desktop transport worker.'
    };

    const workspace = prepareJobWorkspace({
      downloadDirectory: this.config.downloadDirectory,
      job: preparedJob,
      clock: this.clock
    });

    queuedJob.status = preparedJob.status;
    queuedJob.runnerState = preparedJob.runnerState;
    queuedJob.workspaceId = workspace.workspaceId;
    queuedJob.workspacePath = workspace.rootPath;
    queuedJob.manifestPath = workspace.manifestPath;
    queuedJob.jobStatePath = workspace.jobStatePath;
    queuedJob.partialDirectory = workspace.partialDirectory;
    queuedJob.stagingDirectory = workspace.stagingDirectory;
    queuedJob.artifactDirectory = workspace.artifactDirectory;
    queuedJob.logsDirectory = workspace.logsDirectory;
    queuedJob.eventLogPath = workspace.eventLogPath;
    queuedJob.downloadManifestPath = workspace.downloadManifestPath;
    queuedJob.claimedAtIso = preparedJob.claimedAtIso;
    queuedJob.progressPercent = preparedJob.progressPercent;
    queuedJob.updatedAtIso = preparedJob.updatedAtIso;
    queuedJob.note = preparedJob.note;

    writeWorkspaceJobState(workspace, queuedJob, {
      clock: this.clock
    });
    appendWorkspaceEvent(workspace, {
      eventType: 'workspace_prepared',
      source: 'agent',
      jobId: queuedJob.id,
      remoteIntentId: queuedJob.remoteIntentId,
      status: queuedJob.status,
      runnerState: queuedJob.runnerState,
      progressPercent: queuedJob.progressPercent,
      note: queuedJob.note,
      occurredAtIso: iso
    }, {
      clock: this.clock
    });

    return queuedJob;
  }

  async applyTransportUpdate(input = {}) {
    const job = this.findJob(input.jobId);

    const iso = nowIso(this.clock);
    const requestedStatus = String(input.status || '').trim();
    if (requestedStatus && !VALID_JOB_STATUSES.has(requestedStatus)) {
      throw new Error('invalid_job_status');
    }

    if (requestedStatus) job.status = requestedStatus;
    if (Object.prototype.hasOwnProperty.call(input, 'runnerState')) {
      job.runnerState = String(input.runnerState || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'note')) {
      job.note = String(input.note || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'failureCode')) {
      job.failureCode = String(input.failureCode || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'progressPercent')) {
      job.progressPercent = Math.max(0, Math.min(100, Number(input.progressPercent || 0) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'controlPeerId')) {
      job.controlPeerId = String(input.controlPeerId || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'downloadId')) {
      job.downloadId = String(input.downloadId || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'sessionId')) {
      job.sessionId = String(input.sessionId || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'targetPeerId')) {
      job.targetPeerId = String(input.targetPeerId || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'sessionTransport')) {
      job.sessionTransport = String(input.sessionTransport || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'sessionStatus')) {
      job.sessionStatus = String(input.sessionStatus || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'lastSessionSyncAtIso')) {
      job.lastSessionSyncAtIso = String(input.lastSessionSyncAtIso || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'sessionAnswer')) {
      const answer = input.sessionAnswer && typeof input.sessionAnswer === 'object' ? input.sessionAnswer : null;
      job.sessionAnswer = answer
        ? {
          type: String(answer.type || '').trim(),
          sdp: String(answer.sdp || ''),
          createdAtIso: String(answer.createdAtIso || '').trim()
        }
        : null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'creatorCandidates')) {
      job.creatorCandidates = Array.isArray(input.creatorCandidates)
        ? input.creatorCandidates.map((candidate) => ({
          candidate: String(candidate && candidate.candidate || '').trim(),
          sdpMid: candidate && candidate.sdpMid != null ? String(candidate.sdpMid).trim() : null,
          sdpMLineIndex: candidate && candidate.sdpMLineIndex != null ? Math.max(0, Math.trunc(Number(candidate.sdpMLineIndex) || 0)) : null,
          usernameFragment: candidate && candidate.usernameFragment != null ? String(candidate.usernameFragment).trim() : null
        })).filter((candidate) => candidate.candidate)
        : [];
    }
    if (Object.prototype.hasOwnProperty.call(input, 'fileName')) {
      job.fileName = String(input.fileName || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'mimeType')) {
      job.mimeType = String(input.mimeType || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(input, 'sizeBytes')) {
      job.sizeBytes = Math.max(0, Math.trunc(Number(input.sizeBytes || 0) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'chunkSize')) {
      job.chunkSize = Math.max(0, Math.trunc(Number(input.chunkSize || 0) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'chunkCount')) {
      job.chunkCount = Math.max(0, Math.trunc(Number(input.chunkCount || 0) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'verifiedChunkCount')) {
      job.verifiedChunkCount = Math.max(0, Math.trunc(Number(input.verifiedChunkCount || 0) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'receivedBytes')) {
      job.receivedBytes = Math.max(0, Math.trunc(Number(input.receivedBytes || 0) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(input, 'localFilePath')) {
      job.localFilePath = String(input.localFilePath || '').trim();
    }

    if (job.status === 'running' && !job.startedAtIso) job.startedAtIso = iso;
    if (job.sessionStatus === 'answered' && !job.sessionAnsweredAtIso) job.sessionAnsweredAtIso = iso;
    if ((job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') && !job.completedAtIso) {
      job.completedAtIso = iso;
    }
    job.updatedAtIso = iso;

    this.state.transport.lastHostActivityAtIso = iso;
    this.state.transport.lastHostResult = String(input.eventType || job.runnerState || job.status).trim() || 'status_update';

    return this.commitTransportEvent(job, {
      eventType: String(input.eventType || 'status_update').trim() || 'status_update',
      source: 'transport_host',
      occurredAtIso: iso
    });
  }

  async publishViewerCandidate(input = {}) {
    const job = this.findJob(input.jobId);
    if (!this.config.siteOrigin) throw new Error('site_origin_unconfigured');
    if (!this.config.accountToken) throw new Error('account_token_unconfigured');
    if (!job.sessionId) throw new Error('session_id_required');
    if (!job.controlPeerId) throw new Error('peer_id_required');

    await publishSessionCandidate({
      siteOrigin: this.config.siteOrigin,
      accountToken: this.config.accountToken,
      sessionId: job.sessionId,
      role: String(input.role || 'viewer').trim() || 'viewer',
      peerId: job.controlPeerId,
      candidate: input.candidate,
      fetchImpl: this.fetchImpl
    });

    this.state.transport.lastHostActivityAtIso = nowIso(this.clock);
    this.state.transport.lastHostResult = 'candidate_published';
    return this.commitTransportEvent(job, {
      eventType: 'candidate_published',
      source: 'transport_host',
      note: 'Published a local ICE candidate to the control plane.'
    });
  }

  async listSeedSessions(input = {}) {
    const videoId = String(input.videoId || '').trim();
    const seedPeerId = String(input.seedPeerId || '').trim();
    if (!videoId) throw new Error('video_id_required');
    if (!seedPeerId) throw new Error('peer_id_required');
    if (!this.config.siteOrigin) throw new Error('site_origin_unconfigured');
    if (!this.config.accountToken) throw new Error('account_token_unconfigured');

    const sessions = await fetchSessions({
      siteOrigin: this.config.siteOrigin,
      accountToken: this.config.accountToken,
      videoId,
      fetchImpl: this.fetchImpl
    });

    return sessions.filter((session) => {
      const status = String(session && session.status || '').trim();
      if (!status || status === 'closed') return false;
      const targetPeerId = String(session && session.targetPeerId || '').trim();
      const creatorPeerId = String(session && session.creatorPeerId || '').trim();
      if (targetPeerId && targetPeerId !== seedPeerId) return false;
      if (creatorPeerId && creatorPeerId !== seedPeerId) return false;
      return true;
    });
  }

  async answerSeedSession(input = {}) {
    const sessionId = String(input.sessionId || '').trim();
    const creatorPeerId = String(input.creatorPeerId || '').trim();
    const answer = input.answer && typeof input.answer === 'object' ? input.answer : null;
    if (!sessionId) throw new Error('session_id_required');
    if (!creatorPeerId) throw new Error('peer_id_required');
    if (!this.config.siteOrigin) throw new Error('site_origin_unconfigured');
    if (!this.config.accountToken) throw new Error('account_token_unconfigured');
    return answerSession({
      siteOrigin: this.config.siteOrigin,
      accountToken: this.config.accountToken,
      sessionId,
      creatorPeerId,
      answer,
      fetchImpl: this.fetchImpl
    });
  }

  async publishCreatorCandidate(input = {}) {
    const sessionId = String(input.sessionId || '').trim();
    const peerId = String(input.peerId || '').trim();
    if (!sessionId) throw new Error('session_id_required');
    if (!peerId) throw new Error('peer_id_required');
    if (!this.config.siteOrigin) throw new Error('site_origin_unconfigured');
    if (!this.config.accountToken) throw new Error('account_token_unconfigured');
    return publishSessionCandidate({
      siteOrigin: this.config.siteOrigin,
      accountToken: this.config.accountToken,
      sessionId,
      role: 'creator',
      peerId,
      candidate: input.candidate,
      fetchImpl: this.fetchImpl
    });
  }

  async recordTransportManifest(input = {}) {
    const job = this.findJob(input.jobId);
    const manifest = input.manifest && typeof input.manifest === 'object' ? input.manifest : null;
    if (!manifest) throw new Error('manifest_required');
    const iso = nowIso(this.clock);

    job.fileName = String(manifest.name || `${job.videoId}.bin`).trim();
    job.mimeType = String(manifest.mimeType || 'application/octet-stream').trim();
    job.sizeBytes = Math.max(0, Math.trunc(Number(manifest.size || manifest.sizeBytes || 0) || 0));
    job.chunkSize = Math.max(0, Math.trunc(Number(manifest.chunkSize || 0) || 0));
    job.chunkCount = Math.max(0, Math.trunc(Number(manifest.chunkCount || 0) || 0));
    job.runnerState = 'receiving_chunks';
    job.note = `Manifest received for ${job.fileName}. Starting chunk transfer.`;
    job.failureCode = '';
    job.updatedAtIso = iso;

    writeDownloadManifest(this.workspaceFromJob(job), {
      name: job.fileName,
      mimeType: job.mimeType,
      size: job.sizeBytes,
      chunkSize: job.chunkSize,
      chunkCount: job.chunkCount,
      chunkHashes: Array.isArray(manifest.chunkHashes) ? manifest.chunkHashes.slice() : [],
      fileHash: String(manifest.fileHash || '').trim()
    });

    this.state.transport.lastHostActivityAtIso = iso;
    this.state.transport.lastHostResult = 'manifest_received';
    return this.commitTransportEvent(job, {
      eventType: 'manifest_received',
      source: 'transport_host'
    });
  }

  async markRequestedChunk(input = {}) {
    const job = this.findJob(input.jobId);
    if (!this.config.siteOrigin) throw new Error('site_origin_unconfigured');
    if (!this.config.accountToken) throw new Error('account_token_unconfigured');
    if (!job.downloadId) throw new Error('download_id_required');

    const chunkIndex = Math.max(0, Math.trunc(Number(input.chunkIndex || 0) || 0));
    await updateDownloadChunk({
      siteOrigin: this.config.siteOrigin,
      accountToken: this.config.accountToken,
      downloadId: job.downloadId,
      chunkIndex,
      payload: {
        status: 'requested',
        sessionId: job.sessionId,
        sourcePeerId: job.targetPeerId
      },
      fetchImpl: this.fetchImpl
    });

    job.runnerState = 'receiving_chunks';
    job.note = `Requesting chunk ${chunkIndex + 1} of ${job.chunkCount || '?'}.`;
    job.updatedAtIso = nowIso(this.clock);
    this.state.transport.lastHostActivityAtIso = job.updatedAtIso;
    this.state.transport.lastHostResult = 'chunk_requested';
    return this.commitTransportEvent(job, {
      eventType: 'chunk_requested',
      source: 'transport_host'
    });
  }

  async markFailedChunk(input = {}) {
    const job = this.findJob(input.jobId);
    if (!this.config.siteOrigin) throw new Error('site_origin_unconfigured');
    if (!this.config.accountToken) throw new Error('account_token_unconfigured');
    if (!job.downloadId) throw new Error('download_id_required');

    const chunkIndex = Math.max(0, Math.trunc(Number(input.chunkIndex || 0) || 0));
    const reason = String(input.reason || 'download_failed').trim() || 'download_failed';
    await updateDownloadChunk({
      siteOrigin: this.config.siteOrigin,
      accountToken: this.config.accountToken,
      downloadId: job.downloadId,
      chunkIndex,
      payload: {
        status: 'failed',
        sessionId: job.sessionId,
        sourcePeerId: job.targetPeerId,
        error: reason
      },
      fetchImpl: this.fetchImpl
    });

    job.status = 'blocked';
    job.runnerState = 'chunk_transfer_failed';
    job.failureCode = reason;
    job.note = `Chunk ${chunkIndex + 1} failed: ${reason}`;
    job.updatedAtIso = nowIso(this.clock);
    this.state.transport.lastHostActivityAtIso = job.updatedAtIso;
    this.state.transport.lastHostResult = 'chunk_failed';
    return this.commitTransportEvent(job, {
      eventType: 'chunk_failed',
      source: 'transport_host',
      failureCode: reason
    });
  }

  async recordVerifiedChunk(input = {}) {
    const job = this.findJob(input.jobId);
    if (!this.config.siteOrigin) throw new Error('site_origin_unconfigured');
    if (!this.config.accountToken) throw new Error('account_token_unconfigured');
    if (!job.downloadId) throw new Error('download_id_required');

    const chunkIndex = Math.max(0, Math.trunc(Number(input.chunkIndex || 0) || 0));
    const receivedHash = String(input.receivedHash || '').trim().toLowerCase();
    const bytes = input.bytes;
    if (!receivedHash) throw new Error('received_hash_required');
    if (bytes == null) throw new Error('chunk_bytes_required');

    const buffer = Buffer.from(bytes);
    writeWorkspaceChunk(this.workspaceFromJob(job), chunkIndex, buffer);

    const download = await updateDownloadChunk({
      siteOrigin: this.config.siteOrigin,
      accountToken: this.config.accountToken,
      downloadId: job.downloadId,
      chunkIndex,
      payload: {
        status: 'verified',
        sessionId: job.sessionId,
        sourcePeerId: job.targetPeerId,
        receivedBytes: buffer.byteLength,
        receivedHash
      },
      fetchImpl: this.fetchImpl
    });

    const chunks = Array.isArray(download.chunks) ? download.chunks : [];
    const verifiedChunks = chunks.filter((chunk) => String(chunk.status || '').trim() === 'verified');
    const receivedBytes = verifiedChunks.reduce((sum, chunk) => sum + Math.max(0, Number(chunk.receivedBytes || 0) || 0), 0);
    const progressPercent = job.sizeBytes > 0
      ? Math.min(99, Math.round((receivedBytes / job.sizeBytes) * 100))
      : (job.chunkCount > 0 ? Math.min(99, Math.round((verifiedChunks.length / job.chunkCount) * 100)) : job.progressPercent);

    job.verifiedChunkCount = verifiedChunks.length;
    job.receivedBytes = receivedBytes;
    job.progressPercent = Math.max(Number(job.progressPercent || 0) || 0, progressPercent);
    job.updatedAtIso = nowIso(this.clock);
    this.state.transport.lastHostActivityAtIso = job.updatedAtIso;
    this.state.transport.lastHostResult = 'chunk_verified';

    if (String(download.status || '').trim() === 'completed') {
      const artifactPath = assembleWorkspaceArtifact(this.workspaceFromJob(job), {
        chunkCount: job.chunkCount,
        name: job.fileName
      }, {
        videoId: job.videoId,
        fileName: job.fileName
      });

      job.status = 'completed';
      job.runnerState = 'local_copy_ready';
      job.localFilePath = artifactPath;
      job.progressPercent = 100;
      job.note = 'Local copy is complete and registered for background seeding.';
      job.failureCode = '';
      const libraryEntry = this.upsertLibraryEntry(job, artifactPath);
      await this.syncLibrarySeederEntry(libraryEntry, { iso: job.updatedAtIso });
      if (libraryEntry.seedState !== 'seeding') {
        job.note = `Local copy is complete, but background seeding is not active yet: ${libraryEntry.seedLastError || libraryEntry.seedState}.`;
      }

      try {
        await announceViewerPeer({
          siteOrigin: this.config.siteOrigin,
          accountToken: this.config.accountToken,
          peerId: job.controlPeerId,
          channelId: job.channelId,
          fetchImpl: this.fetchImpl
        });
      } catch (error) {
        job.note = `Local copy is complete, but the viewer-only reset failed: ${String(error && error.message ? error.message : error)}`;
      }

      return this.commitTransportEvent(job, {
        eventType: 'download_completed',
        source: 'transport_host'
      });
    }

    job.runnerState = 'receiving_chunks';
    job.note = `Verified chunk ${chunkIndex + 1} of ${job.chunkCount || '?'}.`;
    return this.commitTransportEvent(job, {
      eventType: 'chunk_verified',
      source: 'transport_host'
    });
  }

  async cancelJob(input = {}) {
    const job = this.findManagedJob(input);
    if (job.status === 'completed') throw new Error('job_already_completed');
    if (job.status === 'failed' || job.status === 'canceled') throw new Error('job_not_cancelable');

    const iso = nowIso(this.clock);
    job.status = 'canceled';
    job.runnerState = String(input.runnerState || 'canceled_by_user').trim() || 'canceled_by_user';
    job.note = String(input.note || 'The desktop client canceled this download before completion.').trim();
    job.failureCode = String(input.failureCode || 'job_canceled').trim() || 'job_canceled';
    job.updatedAtIso = iso;

    return this.commitTransportEvent(job, {
      eventType: String(input.eventType || 'job_canceled').trim() || 'job_canceled',
      source: 'agent',
      occurredAtIso: iso
    });
  }

  async retryJob(input = {}) {
    const job = this.findManagedJob(input);
    if (job.status === 'running') throw new Error('job_retry_not_allowed');
    if (job.status === 'completed') throw new Error('job_already_completed');
    if (job.status === 'queued') throw new Error('job_already_queued');

    const iso = nowIso(this.clock);
    const hasWorkspace = Boolean(String(job.workspacePath || '').trim());
    this.resetJobTransferState(job);
    if (hasWorkspace) this.resetJobWorkspace(job);

    job.status = hasWorkspace ? 'blocked' : 'queued';
    job.runnerState = hasWorkspace ? 'awaiting_transport_worker' : '';
    job.note = String(
      input.note
      || (hasWorkspace
        ? 'The desktop client reset this download and prepared it for a fresh transport attempt.'
        : 'The desktop client re-queued this download for the next background preparation cycle.')
    ).trim();
    job.failureCode = '';
    job.progressPercent = hasWorkspace ? 1 : 0;
    job.updatedAtIso = iso;

    return this.commitTransportEvent(job, {
      eventType: String(input.eventType || 'job_retried').trim() || 'job_retried',
      source: 'agent',
      occurredAtIso: iso
    });
  }

  removeJob(input = {}) {
    const job = this.findManagedJob(input);
    if (job.status === 'running') throw new Error('job_active');
    if (job.status === 'completed' && (job.localFilePath || this.state.library.some((entry) => entry.videoId === job.videoId))) {
      throw new Error('job_removal_requires_library_action');
    }

    this.removeJobWorkspace(job);
    this.state.jobs = this.state.jobs.filter((candidate) => candidate !== job);
    this.refreshTransportState();
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  async syncRunningJobSessions(iso = nowIso(this.clock)) {
    if (!this.config.accountToken || !this.config.siteOrigin) return;

    const runningJobs = this.state.jobs.filter((job) => {
      return job.status === 'running'
        && job.sessionId
        && job.downloadId
        && job.controlPeerId;
    });

    let stateChanged = false;
    for (const job of runningJobs) {
      try {
        const session = await fetchSessionRecord({
          siteOrigin: this.config.siteOrigin,
          accountToken: this.config.accountToken,
          sessionId: job.sessionId,
          downloadId: job.downloadId,
          viewerPeerId: job.controlPeerId,
          videoId: job.videoId,
          fetchImpl: this.fetchImpl
        });
        if (!session) continue;

        const sessionStatus = String(session.status || '').trim();
        const targetPeerId = String(session.targetPeerId || job.targetPeerId || '').trim();
        const sessionAnswer = session.answer && typeof session.answer === 'object'
          ? {
            type: String(session.answer.type || '').trim(),
            sdp: String(session.answer.sdp || ''),
            createdAtIso: String(session.answer.createdAtIso || '').trim()
          }
          : null;
        const creatorCandidates = Array.isArray(session.creatorCandidates)
          ? session.creatorCandidates.map((candidate) => ({
            candidate: String(candidate && candidate.candidate || '').trim(),
            sdpMid: candidate && candidate.sdpMid != null ? String(candidate.sdpMid).trim() : null,
            sdpMLineIndex: candidate && candidate.sdpMLineIndex != null ? Math.max(0, Math.trunc(Number(candidate.sdpMLineIndex) || 0)) : null,
            usernameFragment: candidate && candidate.usernameFragment != null ? String(candidate.usernameFragment).trim() : null
          })).filter((candidate) => candidate.candidate)
          : [];

        const sessionChanged = sessionStatus !== job.sessionStatus
          || targetPeerId !== job.targetPeerId
          || JSON.stringify(sessionAnswer) !== JSON.stringify(job.sessionAnswer || null)
          || JSON.stringify(creatorCandidates) !== JSON.stringify(job.creatorCandidates || []);

        job.sessionStatus = String(session.status || '').trim();
        job.targetPeerId = targetPeerId;
        job.sessionAnswer = sessionAnswer;
        job.creatorCandidates = creatorCandidates;
        job.lastSessionSyncAtIso = iso;

        if (job.sessionStatus === 'answered' && job.runnerState !== 'awaiting_candidate_exchange') {
          await this.applyTransportUpdate({
            jobId: job.id,
            status: 'running',
            runnerState: 'awaiting_candidate_exchange',
            progressPercent: Math.max(Number(job.progressPercent || 0) || 0, 18),
            note: 'A seeding peer answered the session. Applying the answer and exchanging ICE candidates now.',
            eventType: 'control_plane_answered',
            sessionStatus: job.sessionStatus,
            targetPeerId: job.targetPeerId,
            lastSessionSyncAtIso: iso,
            sessionAnswer: job.sessionAnswer,
            creatorCandidates: job.creatorCandidates
          });
          continue;
        }

        if (job.sessionStatus === 'closed') {
          await this.applyTransportUpdate({
            jobId: job.id,
            status: 'blocked',
            runnerState: 'control_plane_session_closed',
            progressPercent: Number(job.progressPercent || 0) || 0,
            note: 'The control-plane session closed before transfer started. A fresh offer is required to retry.',
            failureCode: 'session_closed',
            eventType: 'control_plane_session_closed',
            sessionStatus: job.sessionStatus,
            lastSessionSyncAtIso: iso
          });
          continue;
        }

        if (sessionChanged) stateChanged = true;
      } catch (error) {
        this.state.agent.lastError = String(error && error.message ? error.message : error);
      }
    }

    if (stateChanged) {
      this.persistState();
      this.emitChange();
    }
  }

  async runCycle() {
    const iso = nowIso(this.clock);
    this.state.device.lastSeenAtIso = iso;
    this.state.agent.lastCycleAtIso = iso;
    this.state.agent.lastSyncAttemptAtIso = iso;
    this.state.transport.lastRemoteSyncAtIso = iso;

    if (!this.config.siteOrigin) {
      this.state.agent.lastSyncResult = 'site_origin_unconfigured';
      this.state.agent.lastError = '';
      this.state.transport.pendingRemoteIntentCount = 0;
    } else if (!this.config.deviceToken) {
      this.state.agent.lastSyncResult = 'device_token_unconfigured';
      this.state.agent.lastError = '';
      this.state.transport.pendingRemoteIntentCount = 0;
    } else {
      try {
        const remote = await fetchRemoteIntents({
          siteOrigin: this.config.siteOrigin,
          deviceId: this.state.device.id,
          deviceToken: this.config.deviceToken,
          cursor: this.state.transport.lastIntentCursor,
          fetchImpl: this.fetchImpl
        });
        const merged = mergeRemoteIntentsIntoJobs(this.state, remote.intents, {
          clock: this.clock
        });
        this.state.jobs = merged.jobs;
        this.state.transport.lastIntentCursor = remote.cursor;
        this.state.transport.pendingRemoteIntentCount = merged.createdJobs.length;
        this.state.agent.lastSyncResult = merged.createdJobs.length > 0 ? 'remote_intents_received' : 'remote_intents_idle';
        this.state.agent.transportState = 'intent_bridge_ready';
        this.state.agent.lastError = '';
        if (!this.state.device.registeredAtIso) this.state.device.registeredAtIso = iso;
      } catch (error) {
        const statusCode = Number(error && error.statusCode || 0);
        this.state.transport.pendingRemoteIntentCount = 0;
        this.state.agent.lastError = String(error && error.message ? error.message : error);
        this.state.agent.lastSyncResult = statusCode === 404
          ? 'remote_bridge_unavailable'
          : statusCode === 401 || statusCode === 403
            ? 'device_token_rejected'
            : 'remote_sync_failed';
      }
    }

    this.state.jobs.forEach((job) => {
      if (job.status !== 'queued') return;
      if (job.source !== 'manual') return;
      job.note = 'Queued locally. Workspace preparation runs in the background before transport starts.';
      job.updatedAtIso = iso;
    });

    this.prepareNextQueuedJob(iso);
    await this.syncRemoteCommands(iso);
    await this.syncRunningJobSessions(iso);
    await this.syncLibrarySeedPeers(iso);
    await this.reportRemoteClientStatus(iso);
    this.refreshTransportState();

    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  async start(options = {}) {
    if (!this.timer) {
      this.state.agent.status = 'running';
      if (!this.state.agent.startedAtIso) this.state.agent.startedAtIso = nowIso(this.clock);
      this.persistState();
      this.timer = setInterval(() => {
        this.runCycle().catch((error) => {
          this.state.agent.lastError = String(error && error.message ? error.message : error);
          this.state.agent.lastSyncResult = 'cycle_error';
          this.persistState();
          this.emitChange();
        });
      }, this.config.pollIntervalMs);
      this.timer.unref();
    }
    this.emitChange();
    if (options.immediate === false) return this.snapshot();
    return this.runCycle();
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state.agent.status = 'paused';
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  async destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  saveConfig(input = {}) {
    const merged = sanitizeClientConfig({
      ...this.config,
      ...input
    }, {
      defaultDownloadDirectory: this.defaultDownloadDirectory,
      defaultSiteOrigin: this.defaultSiteOrigin
    });

    const restartTimer = Boolean(this.timer) && merged.pollIntervalMs !== this.config.pollIntervalMs;
    this.config = merged;
    this.persistConfig();

    if (restartTimer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.runCycle().catch((error) => {
          this.state.agent.lastError = String(error && error.message ? error.message : error);
          this.state.agent.lastSyncResult = 'cycle_error';
          this.persistState();
          this.emitChange();
        });
      }, this.config.pollIntervalMs);
      this.timer.unref();
    }

    this.emitChange();
    return this.snapshot();
  }

  async applyPairingLink(link, options = {}) {
    const parsed = parsePairingLink(link, {
      defaultSiteOrigin: this.defaultSiteOrigin
    });
    let resolved = { ...parsed };
    if ((!resolved.deviceToken || !resolved.accountToken) && resolved.pairingCode) {
      const claimed = await claimPairingLink(resolved, {
        defaultSiteOrigin: this.defaultSiteOrigin,
        fetchImpl: this.fetchImpl,
        deviceName: this.config.deviceName || resolved.deviceName || options.deviceName
      });
      resolved = {
        ...resolved,
        ...claimed
      };
    }
    const configUpdate = pairingConfigUpdate(resolved);
    if (options.applyRecommendedDefaults !== false) {
      if (!Object.prototype.hasOwnProperty.call(configUpdate, 'backgroundOnClose')) configUpdate.backgroundOnClose = true;
      if (!Object.prototype.hasOwnProperty.call(configUpdate, 'launchOnLogin')) configUpdate.launchOnLogin = true;
      if (!Object.prototype.hasOwnProperty.call(configUpdate, 'autoStartAgent')) configUpdate.autoStartAgent = true;
    }
    const snapshot = this.saveConfig(configUpdate);
    return {
      snapshot,
      pairing: resolved
    };
  }

  setWindowVisible(visible) {
    this.state.ui.windowVisible = Boolean(visible);
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  enqueueDownloadJob(payload = {}) {
    const job = createQueuedJobRecord({
      videoId: payload.videoId,
      videoTitle: payload.videoTitle,
      channelId: payload.channelId,
      source: payload.source || 'manual',
      remoteIntentId: payload.remoteIntentId,
      note: 'Queued from the desktop scaffold.'
    }, {
      clock: this.clock
    });

    this.state.jobs.unshift(job);
    this.refreshTransportState();
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }

  clearFinishedJobs() {
    this.state.jobs = this.state.jobs.filter((job) => {
      return job.status !== 'completed'
        && job.status !== 'failed'
        && job.status !== 'canceled';
    });
    this.refreshTransportState();
    this.persistState();
    this.emitChange();
    return this.snapshot();
  }
}

module.exports = {
  WorldStageClientAgent
};
