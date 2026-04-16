'use strict';

const fs = require('fs');
const path = require('path');

const CLIENT_WORKSPACE_VERSION = 1;

function nowIso(clock = Date.now) {
  return new Date(clock()).toISOString();
}

function slugSegment(value, fallback = 'video') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function workspaceRootPath(downloadDirectory) {
  const base = path.resolve(String(downloadDirectory || process.cwd()).trim() || process.cwd());
  return path.join(base, '.worldstage-client');
}

function workspacePaths(downloadDirectory, job = {}) {
  const rootPath = workspaceRootPath(downloadDirectory);
  const workspaceId = `${String(job.id || 'job').trim() || 'job'}-${slugSegment(job.videoTitle || job.videoId || job.id, 'video')}`.slice(0, 96);
  const jobRootPath = path.join(rootPath, 'jobs', workspaceId);

  return {
    workspaceId,
    rootPath: jobRootPath,
    manifestPath: path.join(jobRootPath, 'manifest.json'),
    jobStatePath: path.join(jobRootPath, 'job-state.json'),
    partialDirectory: path.join(jobRootPath, 'partials'),
    stagingDirectory: path.join(jobRootPath, 'staging'),
    artifactDirectory: path.join(jobRootPath, 'artifacts'),
    logsDirectory: path.join(jobRootPath, 'logs'),
    eventLogPath: path.join(jobRootPath, 'logs', 'events.ndjson'),
    downloadManifestPath: path.join(jobRootPath, 'staging', 'download-manifest.json')
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function prepareJobWorkspace(options = {}) {
  const job = options.job && typeof options.job === 'object' ? options.job : {};
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const preparedAtIso = nowIso(clock);
  const workspace = workspacePaths(options.downloadDirectory, job);

  fs.mkdirSync(workspace.partialDirectory, { recursive: true });
  fs.mkdirSync(workspace.stagingDirectory, { recursive: true });
  fs.mkdirSync(workspace.artifactDirectory, { recursive: true });
  fs.mkdirSync(workspace.logsDirectory, { recursive: true });

  const manifest = {
    version: CLIENT_WORKSPACE_VERSION,
    preparedAtIso,
    job: {
      id: String(job.id || '').trim(),
      action: String(job.action || '').trim(),
      source: String(job.source || '').trim(),
      status: String(job.status || '').trim(),
      videoId: String(job.videoId || '').trim(),
      videoTitle: String(job.videoTitle || '').trim(),
      channelId: String(job.channelId || '').trim(),
      remoteIntentId: String(job.remoteIntentId || '').trim(),
      seedAfterDownload: job.seedAfterDownload !== false
    },
    workspace: {
      id: workspace.workspaceId,
      rootPath: workspace.rootPath,
      manifestPath: workspace.manifestPath,
      jobStatePath: workspace.jobStatePath,
      partialDirectory: workspace.partialDirectory,
      stagingDirectory: workspace.stagingDirectory,
      artifactDirectory: workspace.artifactDirectory,
      logsDirectory: workspace.logsDirectory,
      eventLogPath: workspace.eventLogPath,
      downloadManifestPath: workspace.downloadManifestPath
    },
    transport: {
      runnerState: 'awaiting_transport_worker',
      note: 'Workspace prepared locally. Waiting for the desktop transport worker.'
    }
  };

  writeJson(workspace.manifestPath, manifest);
  writeJson(workspace.jobStatePath, {
    writtenAtIso: preparedAtIso,
    job: {
      id: String(job.id || '').trim(),
      status: String(job.status || '').trim(),
      progressPercent: Number(job.progressPercent || 0) || 0
    }
  });

  return {
    ...workspace,
    preparedAtIso,
    manifest
  };
}

function writeWorkspaceJobState(workspace, job = {}, options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const writtenAtIso = nowIso(clock);
  const jobStatePath = String(workspace && workspace.jobStatePath || '').trim();

  if (!jobStatePath) throw new Error('workspace_job_state_path_required');

  writeJson(jobStatePath, {
    writtenAtIso,
    job: {
      id: String(job.id || '').trim(),
      action: String(job.action || '').trim(),
      source: String(job.source || '').trim(),
      status: String(job.status || '').trim(),
      runnerState: String(job.runnerState || '').trim(),
      videoId: String(job.videoId || '').trim(),
      videoTitle: String(job.videoTitle || '').trim(),
      channelId: String(job.channelId || '').trim(),
      remoteIntentId: String(job.remoteIntentId || '').trim(),
      note: String(job.note || '').trim(),
      failureCode: String(job.failureCode || '').trim(),
      progressPercent: Number(job.progressPercent || 0) || 0,
      claimedAtIso: String(job.claimedAtIso || '').trim(),
      startedAtIso: String(job.startedAtIso || '').trim(),
      completedAtIso: String(job.completedAtIso || '').trim(),
      updatedAtIso: String(job.updatedAtIso || '').trim()
    }
  });
}

function appendWorkspaceEvent(workspace, event = {}, options = {}) {
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;
  const eventLogPath = String(
    workspace && (workspace.eventLogPath
      || (workspace.logsDirectory ? path.join(workspace.logsDirectory, 'events.ndjson') : ''))
      || ''
  ).trim();

  if (!eventLogPath) throw new Error('workspace_event_log_path_required');

  fs.mkdirSync(path.dirname(eventLogPath), { recursive: true });
  const record = {
    writtenAtIso: nowIso(clock),
    eventType: String(event.eventType || '').trim(),
    source: String(event.source || 'transport_host').trim() || 'transport_host',
    jobId: String(event.jobId || '').trim(),
    remoteIntentId: String(event.remoteIntentId || '').trim(),
    status: String(event.status || '').trim(),
    runnerState: String(event.runnerState || '').trim(),
    progressPercent: Number(event.progressPercent || 0) || 0,
    note: String(event.note || '').trim(),
    failureCode: String(event.failureCode || '').trim(),
    occurredAtIso: String(event.occurredAtIso || nowIso(clock)).trim() || nowIso(clock)
  };
  fs.appendFileSync(eventLogPath, `${JSON.stringify(record)}\n`);
  return record;
}

function chunkFileName(chunkIndex) {
  const normalized = Math.max(0, Math.trunc(Number(chunkIndex || 0)));
  return `chunk-${String(normalized).padStart(6, '0')}.part`;
}

function workspaceChunkPath(workspace, chunkIndex) {
  const partialDirectory = String(workspace && workspace.partialDirectory || '').trim();
  if (!partialDirectory) throw new Error('workspace_partial_directory_required');
  return path.join(partialDirectory, chunkFileName(chunkIndex));
}

function sanitizeArtifactName(value, fallback = 'download.bin') {
  const base = path.basename(String(value || '').trim() || fallback);
  const normalized = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

function writeDownloadManifest(workspace, manifest = {}) {
  const filePath = String(workspace && workspace.downloadManifestPath || '').trim();
  if (!filePath) throw new Error('workspace_download_manifest_path_required');
  writeJson(filePath, manifest);
  return filePath;
}

function writeWorkspaceChunk(workspace, chunkIndex, bytes) {
  const filePath = workspaceChunkPath(workspace, chunkIndex);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(bytes));
  return filePath;
}

function assembleWorkspaceArtifact(workspace, manifest = {}, options = {}) {
  const artifactDirectory = String(workspace && workspace.artifactDirectory || '').trim();
  if (!artifactDirectory) throw new Error('workspace_artifact_directory_required');
  const chunkCount = Math.max(0, Math.trunc(Number(manifest.chunkCount || 0)));
  if (!chunkCount) throw new Error('manifest_chunk_count_required');

  fs.mkdirSync(artifactDirectory, { recursive: true });
  const outputName = sanitizeArtifactName(options.fileName || manifest.name || `${options.videoId || 'download'}.bin`);
  const outputPath = path.join(artifactDirectory, outputName);
  const fd = fs.openSync(outputPath, 'w');

  try {
    for (let index = 0; index < chunkCount; index += 1) {
      const chunkPath = workspaceChunkPath(workspace, index);
      if (!fs.existsSync(chunkPath)) throw new Error(`workspace_chunk_missing_${index}`);
      const chunk = fs.readFileSync(chunkPath);
      fs.writeSync(fd, chunk);
    }
  } finally {
    fs.closeSync(fd);
  }

  return outputPath;
}

module.exports = {
  CLIENT_WORKSPACE_VERSION,
  appendWorkspaceEvent,
  assembleWorkspaceArtifact,
  chunkFileName,
  prepareJobWorkspace,
  slugSegment,
  sanitizeArtifactName,
  workspaceChunkPath,
  workspacePaths,
  workspaceRootPath,
  writeDownloadManifest,
  writeWorkspaceChunk,
  writeWorkspaceJobState
};
