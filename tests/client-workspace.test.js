#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createQueuedJobRecord } = require('../lib/client-state');
const {
  CLIENT_WORKSPACE_VERSION,
  appendWorkspaceEvent,
  assembleWorkspaceArtifact,
  chunkFileName,
  prepareJobWorkspace,
  sanitizeArtifactName,
  slugSegment,
  workspaceChunkPath,
  workspaceRootPath,
  writeDownloadManifest,
  writeWorkspaceChunk,
  writeWorkspaceJobState
} = require('../lib/client-workspace');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstage-client-workspace-'));

try {
  const downloadDirectory = path.join(tmpDir, 'downloads');
  const job = createQueuedJobRecord({
    videoId: 'video-alpha',
    videoTitle: 'Alpha Build'
  });
  const workspace = prepareJobWorkspace({
    downloadDirectory,
    job,
    clock: () => Date.parse('2026-01-01T00:00:00.000Z')
  });

  assert.equal(slugSegment('Alpha Build!!!'), 'alpha-build');
  assert.equal(workspaceRootPath(downloadDirectory), path.join(downloadDirectory, '.worldstage-client'));
  assert.ok(fs.existsSync(workspace.partialDirectory));
  assert.ok(fs.existsSync(workspace.stagingDirectory));
  assert.ok(fs.existsSync(workspace.artifactDirectory));
  assert.ok(fs.existsSync(workspace.manifestPath));
  assert.ok(fs.existsSync(workspace.jobStatePath));
  assert.equal(workspace.eventLogPath, path.join(workspace.logsDirectory, 'events.ndjson'));
  assert.equal(workspace.downloadManifestPath, path.join(workspace.stagingDirectory, 'download-manifest.json'));
  assert.equal(chunkFileName(7), 'chunk-000007.part');
  assert.equal(workspaceChunkPath(workspace, 7), path.join(workspace.partialDirectory, 'chunk-000007.part'));
  assert.equal(sanitizeArtifactName('Alpha Build?.mp4'), 'Alpha Build-.mp4');

  const manifest = JSON.parse(fs.readFileSync(workspace.manifestPath, 'utf8'));
  assert.equal(manifest.version, CLIENT_WORKSPACE_VERSION);
  assert.equal(manifest.job.id, job.id);
  assert.equal(manifest.job.videoId, 'video-alpha');
  assert.equal(manifest.transport.runnerState, 'awaiting_transport_worker');
  assert.equal(manifest.workspace.eventLogPath, workspace.eventLogPath);
  assert.equal(manifest.workspace.downloadManifestPath, workspace.downloadManifestPath);

  writeWorkspaceJobState(workspace, {
    ...job,
    status: 'blocked',
    runnerState: 'awaiting_transport_worker',
    progressPercent: 25
  }, {
    clock: () => Date.parse('2026-01-01T00:05:00.000Z')
  });

  const jobState = JSON.parse(fs.readFileSync(workspace.jobStatePath, 'utf8'));
  assert.equal(jobState.job.status, 'blocked');
  assert.equal(jobState.job.runnerState, 'awaiting_transport_worker');
  assert.equal(jobState.job.progressPercent, 25);

  appendWorkspaceEvent(workspace, {
    eventType: 'transport_claimed',
    jobId: job.id,
    status: 'running',
    runnerState: 'awaiting_control_plane_session',
    progressPercent: 25
  }, {
    clock: () => Date.parse('2026-01-01T00:10:00.000Z')
  });

  const eventLog = fs.readFileSync(workspace.eventLogPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(eventLog.length, 1);
  assert.equal(eventLog[0].eventType, 'transport_claimed');

  writeDownloadManifest(workspace, {
    name: 'Alpha Build.mp4',
    mimeType: 'video/mp4',
    chunkCount: 2,
    fileHash: 'hash-alpha'
  });
  const downloadManifest = JSON.parse(fs.readFileSync(workspace.downloadManifestPath, 'utf8'));
  assert.equal(downloadManifest.fileHash, 'hash-alpha');

  writeWorkspaceChunk(workspace, 0, Buffer.from('alpha'));
  writeWorkspaceChunk(workspace, 1, Buffer.from('beta'));
  const artifactPath = assembleWorkspaceArtifact(workspace, {
    chunkCount: 2,
    name: 'Alpha Build.mp4'
  });
  assert.ok(fs.existsSync(artifactPath));
  assert.equal(path.basename(artifactPath), 'Alpha Build.mp4');
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), 'alphabeta');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('client-workspace.test.js: ok');
