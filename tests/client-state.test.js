#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CLIENT_STATE_VERSION,
  createQueuedJobRecord,
  readClientState,
  writeClientState
} = require('../lib/client-state');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstage-client-state-'));

try {
  const statePath = path.join(tmpDir, 'nested', 'client-state.json');
  const initial = readClientState(statePath);
  assert.equal(initial.version, CLIENT_STATE_VERSION);
  assert.ok(initial.device.id.startsWith('wscd_'));
  assert.deepEqual(initial.jobs, []);

  const job = createQueuedJobRecord({
    videoId: 'video-alpha',
    videoTitle: 'Alpha Build',
    source: 'remote'
  });
  assert.ok(job.id.startsWith('wscj_'));
  assert.equal(job.status, 'queued');
  assert.equal(job.videoId, 'video-alpha');

  const written = writeClientState(statePath, {
    ...initial,
    library: [{
      videoId: 'video-alpha',
      videoTitle: 'Alpha Build',
      localPath: path.join(tmpDir, 'downloads', 'Alpha Build.mp4'),
      manifestPath: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'staging', 'download-manifest.json'),
      fileName: 'Alpha Build.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1024,
      chunkSize: 512,
      chunkCount: 2,
      manifestDigest: 'manifest-alpha',
      seedPeerId: 'wscp-device-video-alpha-seeder',
      seedState: 'seeding',
      seedLastAnnouncedAtIso: job.createdAtIso,
      seedLastError: '',
      addedAtIso: job.createdAtIso
    }],
    jobs: [{
      ...job,
      status: 'blocked',
      runnerState: 'awaiting_transport_worker',
      workspaceId: 'wscj_alpha',
      workspacePath: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha'),
      manifestPath: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'manifest.json'),
      jobStatePath: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'job-state.json'),
      downloadManifestPath: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'staging', 'download-manifest.json'),
      partialDirectory: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'partials'),
      stagingDirectory: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'staging'),
      artifactDirectory: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'artifacts'),
      logsDirectory: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'logs'),
      eventLogPath: path.join(tmpDir, 'downloads', '.worldstage-client', 'jobs', 'wscj_alpha', 'logs', 'events.ndjson'),
      claimedAtIso: job.createdAtIso
    }],
    transport: {
      pendingRemoteIntentCount: 2,
      pendingRemoteCommandCount: 1,
      activeTransferCount: 0,
      lastIntentCursor: 'cursor-22',
      lastCommandCursor: 'cmd-cursor-22',
      lastRemoteSyncAtIso: job.createdAtIso,
      hostState: 'prepared',
      lastHostActivityAtIso: job.createdAtIso,
      lastHostResult: 'workspace_prepared',
      lastRemoteCommandAtIso: job.createdAtIso,
      lastRemoteCommandResult: 'remote_commands_received',
      lastRemoteStatusAtIso: job.createdAtIso,
      lastRemoteStatusResult: 'remote_status_reported',
      lastRemoteReportAtIso: job.createdAtIso,
      lastRemoteReportResult: 'not_applicable'
    },
    ui: {
      windowVisible: false,
      lastOpenedAtIso: job.createdAtIso
    }
  });

  assert.equal(written.jobs.length, 1);
  assert.equal(written.ui.windowVisible, false);
  assert.ok(fs.existsSync(statePath));

  const roundTrip = readClientState(statePath);
  assert.equal(roundTrip.jobs.length, 1);
  assert.equal(roundTrip.jobs[0].videoTitle, 'Alpha Build');
  assert.equal(roundTrip.jobs[0].runnerState, 'awaiting_transport_worker');
  assert.equal(roundTrip.jobs[0].workspaceId, 'wscj_alpha');
  assert.ok(roundTrip.jobs[0].workspacePath.endsWith(path.join('.worldstage-client', 'jobs', 'wscj_alpha')));
  assert.ok(roundTrip.jobs[0].downloadManifestPath.endsWith(path.join('staging', 'download-manifest.json')));
  assert.ok(roundTrip.jobs[0].eventLogPath.endsWith(path.join('logs', 'events.ndjson')));
  assert.equal(roundTrip.library.length, 1);
  assert.equal(roundTrip.library[0].manifestPath.endsWith(path.join('staging', 'download-manifest.json')), true);
  assert.equal(roundTrip.library[0].seedPeerId, 'wscp-device-video-alpha-seeder');
  assert.equal(roundTrip.library[0].seedState, 'seeding');
  assert.equal(roundTrip.library[0].chunkCount, 2);
  assert.equal(roundTrip.ui.windowVisible, false);
  assert.equal(roundTrip.transport.lastIntentCursor, 'cursor-22');
  assert.equal(roundTrip.transport.lastCommandCursor, 'cmd-cursor-22');
  assert.equal(roundTrip.transport.hostState, 'prepared');
  assert.equal(roundTrip.transport.pendingRemoteCommandCount, 1);
  assert.equal(roundTrip.transport.lastRemoteCommandResult, 'remote_commands_received');
  assert.equal(roundTrip.transport.lastRemoteStatusResult, 'remote_status_reported');
  assert.equal(roundTrip.transport.lastRemoteReportResult, 'not_applicable');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('client-state.test.js: ok');
