#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WorldStageClientAgent } = require('../lib/client-agent');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstage-client-agent-'));

async function main() {
  const remoteEventCalls = [];
  const remoteStatusCalls = [];
  const remoteCommandResultCalls = [];
  const chunkStates = new Map();
  const peerAnnounceCalls = [];
  const remoteCommandBatches = [
    {
      cursor: 'cmd-cursor-0',
      commands: []
    },
    {
      cursor: 'cmd-cursor-1',
      commands: []
    },
    {
      cursor: 'cmd-cursor-2',
      commands: [
        {
          id: 'cmd-pause-1',
          command: 'pause_seed',
          videoId: 'video-remote-1',
          note: 'Pause the remote seed.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-3',
      commands: [
        {
          id: 'cmd-resume-1',
          command: 'resume_seed',
          videoId: 'video-remote-1',
          note: 'Resume the remote seed.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-4',
      commands: [
        {
          id: 'cmd-refresh-1',
          command: 'refresh_seed',
          videoId: 'video-remote-1',
          note: 'Refresh the remote seed.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-5',
      commands: [
        {
          id: 'cmd-remove-1',
          command: 'remove_seed',
          videoId: 'video-remote-1',
          note: 'Remove the remote seed.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-6',
      commands: [
        {
          id: 'cmd-pause-missing-1',
          command: 'pause_seed',
          videoId: 'video-remote-1',
          note: 'Pause a seed that no longer exists.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-7',
      commands: [
        {
          id: 'cmd-cancel-job-1',
          command: 'cancel_job',
          videoId: 'video-seed-001',
          note: 'Cancel the queued local job.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-8',
      commands: [
        {
          id: 'cmd-retry-job-1',
          command: 'retry_job',
          videoId: 'video-seed-001',
          note: 'Retry the queued local job.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-9',
      commands: [
        {
          id: 'cmd-remove-job-1',
          command: 'remove_job',
          videoId: 'video-seed-001',
          note: 'Remove the queued local job.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-10',
      commands: [
        {
          id: 'cmd-remove-missing-job-1',
          command: 'remove_job',
          videoId: 'video-seed-001',
          note: 'Remove a missing job.'
        }
      ]
    },
    {
      cursor: 'cmd-cursor-11',
      commands: []
    }
  ];
  let remoteCommandBatchIndex = 0;
  const agent = new WorldStageClientAgent({
    configPath: path.join(tmpDir, 'config.json'),
    statePath: path.join(tmpDir, 'state.json'),
    defaultDownloadDirectory: path.join(tmpDir, 'downloads'),
    defaultSiteOrigin: 'https://5310s.com',
    fetchImpl: async (requestUrl, options = {}) => {
      const method = options.method || 'GET';
      if (method === 'POST' && requestUrl === 'https://5310s.com/api/worldstage/client/pair/claim') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ok: true,
              siteOrigin: 'https://5310s.com',
              deviceId: 'wscd-remote-1',
              deviceToken: 'wsct_secret',
              accountToken: 'wsa_secret',
              device: {
                id: 'wscd-remote-1',
                name: 'Desk Seeder'
              }
            };
          }
        };
      }

      if (method === 'GET' && requestUrl.includes('/api/worldstage/client/intents')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              cursor: 'cursor-remote-1',
              intents: [
                {
                  id: 'intent-remote-1',
                  videoId: 'video-remote-1',
                  videoTitle: 'Remote Seed'
                }
              ]
            };
          }
        };
      }

      if (method === 'GET' && requestUrl.includes('/api/worldstage/client/commands')) {
        const batch = remoteCommandBatches[Math.min(remoteCommandBatchIndex, remoteCommandBatches.length - 1)];
        remoteCommandBatchIndex += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return batch;
          }
        };
      }

      if (method === 'GET' && requestUrl === 'https://5310s.com/api/worldstage/videos/video-remote-1') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              video: {
                id: 'video-remote-1',
                channelId: 'channel-remote-1',
                title: 'Remote Seed'
              }
            };
          }
        };
      }

      if (method === 'GET' && requestUrl.includes('/api/worldstage/sessions?')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              sessions: [
                {
                  sessionId: 'session-1',
                  status: 'answered',
                  targetPeerId: 'peer-seed-1',
                  answer: {
                    type: 'answer',
                    sdp: 'v=0\r\ns=WorldStage Desktop Answer\r\n'
                  },
                  creatorCandidates: [
                    {
                      candidate: 'candidate:1 1 udp 2122260223 10.0.0.8 6024 typ host',
                      sdpMid: '0',
                      sdpMLineIndex: 0
                    }
                  ]
                }
              ]
            };
          }
        };
      }

      if (method === 'POST' && requestUrl === 'https://5310s.com/api/worldstage/peers/announce') {
        const body = JSON.parse(options.body);
        peerAnnounceCalls.push(body);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              peer: {
                peerId: body.peerId
              }
            };
          }
        };
      }

      if (method === 'POST' && requestUrl === 'https://5310s.com/api/worldstage/downloads') {
        return {
          ok: true,
          status: 201,
          async json() {
            return {
              download: {
                downloadId: 'download-1'
              }
            };
          }
        };
      }

      if (method === 'POST' && requestUrl === 'https://5310s.com/api/worldstage/sessions') {
        return {
          ok: true,
          status: 201,
          async json() {
            return {
              session: {
                sessionId: 'session-1',
                status: 'awaiting_answer',
                targetPeerId: 'peer-seed-1',
                transport: 'webrtc-data-download'
              }
            };
          }
        };
      }

      if (method === 'POST' && requestUrl.includes('/api/worldstage/client/commands/') && requestUrl.endsWith('/results')) {
        remoteCommandResultCalls.push({
          requestUrl,
          options,
          body: JSON.parse(options.body)
        });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              accepted: true,
              resultId: `cmd-result-${remoteCommandResultCalls.length}`,
              commandStatus: 'reported'
            };
          }
        };
      }

      if (method === 'POST' && requestUrl.startsWith('https://5310s.com/api/worldstage/client/status')) {
        remoteStatusCalls.push({
          requestUrl,
          options,
          body: JSON.parse(options.body)
        });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              accepted: true,
              statusId: 'status-transport-1',
              device: {
                id: 'wscd_remote',
                registeredAtIso: '2026-04-16T13:30:00.000Z',
                claimedByHandle: 'seedbox'
              }
            };
          }
        };
      }

      if (method === 'PATCH' && requestUrl.includes('/api/worldstage/downloads/download-1/chunks/')) {
        const body = JSON.parse(options.body);
        const chunkIndex = Number(requestUrl.split('/').pop());
        chunkStates.set(chunkIndex, {
          index: chunkIndex,
          status: body.status,
          receivedBytes: Number(body.receivedBytes || 0) || 0
        });
        const chunks = Array.from(chunkStates.values()).sort((left, right) => left.index - right.index);
        const allVerified = chunks.length > 0 && chunks.every((chunk) => chunk.status === 'verified');
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              download: {
                downloadId: 'download-1',
                status: allVerified ? 'completed' : 'active',
                chunks
              }
            };
          }
        };
      }

      remoteEventCalls.push({
        requestUrl,
        options,
        body: JSON.parse(options.body)
      });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            accepted: true,
            eventId: 'evt-transport-1',
            intentStatus: 'running'
          };
        }
      };
    }
  });

  try {
    const initial = agent.snapshot();
    assert.equal(initial.summary.transportAvailable, false);
    assert.equal(initial.summary.queuedJobCount, 0);

    const queued = agent.enqueueDownloadJob({
      videoId: 'video-seed-001',
      videoTitle: 'Queued Seed',
      channelId: 'channel-seed'
    });
    assert.equal(queued.summary.queuedJobCount, 1);

    const paired = await agent.applyPairingLink(
      'worldstage://pair?siteOrigin=https%3A%2F%2F5310s.com&pairingCode=wscp_secret&deviceName=Desk%20Seeder'
    );
    assert.equal(paired.pairing.pairingCode, 'wscp_secret');
    assert.equal(paired.pairing.deviceToken, 'wsct_secret');
    assert.equal(paired.snapshot.config.deviceToken, 'wsct_secret');
    assert.equal(paired.snapshot.config.accountToken, 'wsa_secret');
    assert.equal(paired.snapshot.config.deviceName, 'Desk Seeder');
    assert.equal(paired.snapshot.config.backgroundOnClose, true);
    assert.equal(paired.snapshot.config.launchOnLogin, true);
    assert.equal(paired.snapshot.config.autoStartAgent, true);
    assert.ok(paired.snapshot.paths.workspaceRootPath.endsWith(path.join('downloads', '.worldstage-client')));

    const started = await agent.start();
    assert.equal(started.summary.agentStatus, 'running');
    assert.equal(started.state.jobs[0].status, 'blocked');
    assert.equal(started.state.jobs[0].runnerState, 'awaiting_transport_worker');
    assert.equal(started.state.agent.lastSyncResult, 'remote_intents_received');
    assert.equal(started.state.jobs[0].remoteIntentId, 'intent-remote-1');
    assert.equal(started.state.transport.lastIntentCursor, 'cursor-remote-1');
    assert.equal(started.state.transport.lastRemoteStatusResult, 'remote_status_reported');
    assert.equal(started.state.transport.lastRemoteCommandResult, 'remote_commands_idle');
    assert.equal(started.state.device.claimedByHandle, 'seedbox');
    assert.equal(remoteStatusCalls.length, 1);
    assert.equal(remoteCommandResultCalls.length, 0);
    assert.equal(remoteStatusCalls[0].body.status.device.id, started.state.device.id);
    assert.equal(remoteStatusCalls[0].body.status.counts.library, 0);
    assert.ok(fs.existsSync(started.state.jobs[0].workspacePath));
    assert.ok(fs.existsSync(started.state.jobs[0].manifestPath));
    assert.ok(fs.existsSync(started.state.jobs[0].eventLogPath));
    assert.equal(started.summary.blockedJobCount, 1);
    assert.equal(started.summary.queuedJobCount, 1);

    const running = await agent.bootstrapControlPlaneJob({
      jobId: started.state.jobs[0].id,
      offer: {
        type: 'offer',
        sdp: 'v=0\r\ns=WorldStage Desktop Offer\r\n'
      }
    });
    assert.equal(running.state.jobs[0].status, 'running');
    assert.equal(running.state.jobs[0].runnerState, 'awaiting_session_answer');
    assert.equal(running.state.jobs[0].progressPercent, 12);
    assert.equal(running.state.jobs[0].controlPeerId.includes('viewer'), true);
    assert.equal(running.state.jobs[0].downloadId, 'download-1');
    assert.equal(running.state.jobs[0].sessionId, 'session-1');
    assert.equal(running.state.jobs[0].sessionStatus, 'awaiting_answer');
    assert.equal(running.state.transport.hostState, 'active');
    assert.equal(running.state.transport.lastHostResult, 'control_plane_bootstrapped');
    assert.equal(running.state.transport.lastRemoteReportResult, 'remote_event_reported');
    assert.equal(remoteEventCalls.length, 1);
    assert.equal(remoteEventCalls[0].body.event.eventType, 'control_plane_bootstrapped');
    assert.equal(remoteEventCalls[0].body.event.jobId, started.state.jobs[0].id);
    const remoteEventLog = fs.readFileSync(running.state.jobs[0].eventLogPath, 'utf8');
    assert.match(remoteEventLog, /control_plane_bootstrapped/);
    assert.match(remoteEventLog, /remote_event_reported/);

    const secondCycle = await agent.runCycle();
    const remoteJob = secondCycle.state.jobs.find((job) => job.videoId === 'video-remote-1');
    const localJob = secondCycle.state.jobs.find((job) => job.videoId === 'video-seed-001');
    assert.ok(remoteJob);
    assert.equal(remoteJob.runnerState, 'awaiting_candidate_exchange');
    assert.equal(remoteJob.sessionStatus, 'answered');
    assert.equal(remoteJob.progressPercent, 18);
    assert.equal(remoteJob.sessionAnswer.type, 'answer');
    assert.equal(remoteJob.creatorCandidates.length, 1);
    const remoteJobWorkspacePath = remoteJob.workspacePath;
    assert.ok(localJob);
    assert.equal(localJob.status, 'blocked');
    assert.equal(localJob.runnerState, 'awaiting_transport_worker');
    assert.ok(fs.existsSync(localJob.workspacePath));
    const localJobWorkspacePath = localJob.workspacePath;
    assert.equal(secondCycle.summary.blockedJobCount, 1);
    assert.equal(secondCycle.summary.runningJobCount, 1);
    assert.equal(secondCycle.summary.queuedJobCount, 0);
    assert.equal(secondCycle.state.transport.lastCommandCursor, 'cmd-cursor-1');
    assert.equal(secondCycle.state.transport.lastRemoteCommandResult, 'remote_commands_idle');
    assert.ok(remoteEventCalls.some((entry) => entry.body.event.eventType === 'control_plane_answered'));
    assert.ok(remoteStatusCalls.length >= 2);
    assert.equal(remoteStatusCalls[1].body.status.counts.running, 1);

    const manifestSnapshot = await agent.recordTransportManifest({
      jobId: remoteJob.id,
      manifest: {
        name: 'Remote Seed.mp4',
        mimeType: 'video/mp4',
        size: 5,
        chunkSize: 5,
        chunkCount: 1,
        chunkHashes: [crypto.createHash('sha256').update('alpha').digest('hex')],
        fileHash: 'manifest-file-hash'
      }
    });
    const manifestJob = manifestSnapshot.state.jobs.find((job) => job.id === remoteJob.id);
    assert.equal(manifestJob.runnerState, 'receiving_chunks');
    assert.equal(manifestJob.fileName, 'Remote Seed.mp4');
    assert.equal(manifestJob.chunkCount, 1);
    assert.ok(fs.existsSync(manifestJob.downloadManifestPath));

    const requestedSnapshot = await agent.markRequestedChunk({
      jobId: remoteJob.id,
      chunkIndex: 0
    });
    const requestedJob = requestedSnapshot.state.jobs.find((job) => job.id === remoteJob.id);
    assert.equal(requestedJob.runnerState, 'receiving_chunks');
    assert.match(requestedJob.note, /Requesting chunk 1 of 1/);

    const verifiedSnapshot = await agent.recordVerifiedChunk({
      jobId: remoteJob.id,
      chunkIndex: 0,
      receivedHash: crypto.createHash('sha256').update('alpha').digest('hex'),
      bytes: Buffer.from('alpha')
    });
    const completedJob = verifiedSnapshot.state.jobs.find((job) => job.id === remoteJob.id);
    assert.equal(completedJob.status, 'completed');
    assert.equal(completedJob.runnerState, 'local_copy_ready');
    assert.equal(completedJob.progressPercent, 100);
    assert.ok(completedJob.localFilePath.endsWith('Remote Seed.mp4'));
    assert.equal(fs.readFileSync(completedJob.localFilePath, 'utf8'), 'alpha');
    const completedLocalFilePath = completedJob.localFilePath;
    assert.equal(verifiedSnapshot.state.library.length, 1);
    assert.equal(verifiedSnapshot.state.library[0].videoId, 'video-remote-1');
    assert.equal(verifiedSnapshot.state.library[0].localPath, completedJob.localFilePath);
    assert.ok(verifiedSnapshot.state.library[0].manifestPath.endsWith(path.join('staging', 'download-manifest.json')));
    assert.equal(verifiedSnapshot.state.library[0].manifestDigest, 'manifest-file-hash');
    assert.equal(verifiedSnapshot.state.library[0].seedState, 'seeding');
    assert.match(verifiedSnapshot.state.library[0].seedPeerId, /seeder$/);
    assert.ok(peerAnnounceCalls.some((entry) => entry.role === 'seeder' && Array.isArray(entry.videoIds) && entry.videoIds.includes('video-remote-1')));
    assert.ok(remoteEventCalls.some((entry) => entry.body.event.eventType === 'download_completed'));

    const refreshedLibrary = await agent.refreshLibraryItem({
      videoId: 'video-remote-1'
    });
    const refreshedEntry = refreshedLibrary.state.library.find((entry) => entry.videoId === 'video-remote-1');
    assert.equal(refreshedEntry.seedState, 'seeding');
    assert.ok(peerAnnounceCalls.filter((entry) => entry.role === 'seeder' && Array.isArray(entry.videoIds) && entry.videoIds.includes('video-remote-1')).length >= 2);

    const seederAnnounceCountBeforePause = peerAnnounceCalls.filter((entry) => {
      return entry.role === 'seeder'
        && Array.isArray(entry.videoIds)
        && entry.videoIds.includes('video-remote-1');
    }).length;

    const pausedByRemote = await agent.runCycle();
    const pausedEntry = pausedByRemote.state.library.find((entry) => entry.videoId === 'video-remote-1');
    assert.ok(pausedEntry);
    assert.equal(pausedEntry.seedState, 'seed_paused');
    assert.equal(pausedByRemote.state.transport.lastCommandCursor, 'cmd-cursor-2');
    assert.equal(pausedByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(pausedByRemote.state.transport.lastRemoteCommandResult, 'remote_command_reported');
    assert.equal(remoteCommandResultCalls.length, 1);
    assert.equal(remoteCommandResultCalls[0].body.result.commandId, 'cmd-pause-1');
    assert.equal(remoteCommandResultCalls[0].body.result.result, 'applied');
    assert.equal(remoteCommandResultCalls[0].body.result.note, 'Seed paused.');
    assert.equal(peerAnnounceCalls.filter((entry) => {
      return entry.role === 'seeder'
        && Array.isArray(entry.videoIds)
        && entry.videoIds.includes('video-remote-1');
    }).length, seederAnnounceCountBeforePause);

    const resumedByRemote = await agent.runCycle();
    const resumedEntry = resumedByRemote.state.library.find((entry) => entry.videoId === 'video-remote-1');
    assert.ok(resumedEntry);
    assert.equal(resumedEntry.seedState, 'seeding');
    assert.equal(resumedByRemote.state.transport.lastCommandCursor, 'cmd-cursor-3');
    assert.equal(resumedByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(remoteCommandResultCalls.length, 2);
    assert.equal(remoteCommandResultCalls[1].body.result.commandId, 'cmd-resume-1');
    assert.equal(remoteCommandResultCalls[1].body.result.result, 'applied');

    const seederAnnounceCountBeforeRefresh = peerAnnounceCalls.filter((entry) => {
      return entry.role === 'seeder'
        && Array.isArray(entry.videoIds)
        && entry.videoIds.includes('video-remote-1');
    }).length;

    const refreshedByRemote = await agent.runCycle();
    const refreshedByRemoteEntry = refreshedByRemote.state.library.find((entry) => entry.videoId === 'video-remote-1');
    assert.ok(refreshedByRemoteEntry);
    assert.equal(refreshedByRemoteEntry.seedState, 'seeding');
    assert.equal(refreshedByRemote.state.transport.lastCommandCursor, 'cmd-cursor-4');
    assert.equal(refreshedByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(remoteCommandResultCalls.length, 3);
    assert.equal(remoteCommandResultCalls[2].body.result.commandId, 'cmd-refresh-1');
    assert.equal(remoteCommandResultCalls[2].body.result.result, 'applied');
    assert.ok(peerAnnounceCalls.filter((entry) => {
      return entry.role === 'seeder'
        && Array.isArray(entry.videoIds)
        && entry.videoIds.includes('video-remote-1');
    }).length > seederAnnounceCountBeforeRefresh);

    const removedByRemote = await agent.runCycle();
    assert.equal(removedByRemote.state.library.length, 0);
    assert.equal(removedByRemote.state.jobs.some((job) => job.videoId === 'video-remote-1'), false);
    assert.equal(fs.existsSync(completedLocalFilePath), false);
    assert.equal(fs.existsSync(remoteJobWorkspacePath), false);
    assert.equal(removedByRemote.state.transport.lastCommandCursor, 'cmd-cursor-5');
    assert.equal(removedByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(remoteCommandResultCalls.length, 4);
    assert.equal(remoteCommandResultCalls[3].body.result.commandId, 'cmd-remove-1');
    assert.equal(remoteCommandResultCalls[3].body.result.result, 'applied');

    const ignoredByRemote = await agent.runCycle();
    assert.equal(ignoredByRemote.state.library.length, 0);
    assert.equal(ignoredByRemote.state.transport.lastCommandCursor, 'cmd-cursor-6');
    assert.equal(ignoredByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(ignoredByRemote.state.transport.lastRemoteCommandResult, 'remote_command_reported');
    assert.equal(remoteCommandResultCalls.length, 5);
    assert.equal(remoteCommandResultCalls[4].body.result.commandId, 'cmd-pause-missing-1');
    assert.equal(remoteCommandResultCalls[4].body.result.result, 'ignored');
    assert.equal(remoteCommandResultCalls[4].body.result.errorCode, 'library_entry_not_found');
    assert.equal(remoteStatusCalls[remoteStatusCalls.length - 1].body.status.counts.library, 0);

    const canceledJobByRemote = await agent.runCycle();
    const canceledLocalJob = canceledJobByRemote.state.jobs.find((job) => job.videoId === 'video-seed-001');
    assert.ok(canceledLocalJob);
    assert.equal(canceledLocalJob.status, 'canceled');
    assert.equal(canceledLocalJob.runnerState, 'canceled_by_remote_command');
    assert.equal(canceledJobByRemote.state.transport.lastCommandCursor, 'cmd-cursor-7');
    assert.equal(canceledJobByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(remoteCommandResultCalls.length, 6);
    assert.equal(remoteCommandResultCalls[5].body.result.commandId, 'cmd-cancel-job-1');
    assert.equal(remoteCommandResultCalls[5].body.result.result, 'applied');
    assert.equal(remoteCommandResultCalls[5].body.result.note, 'Job canceled.');

    const retriedJobByRemote = await agent.runCycle();
    const retriedLocalJob = retriedJobByRemote.state.jobs.find((job) => job.videoId === 'video-seed-001');
    assert.ok(retriedLocalJob);
    assert.equal(retriedLocalJob.status, 'blocked');
    assert.equal(retriedLocalJob.runnerState, 'awaiting_transport_worker');
    assert.equal(retriedLocalJob.progressPercent, 1);
    assert.equal(retriedLocalJob.failureCode, '');
    assert.equal(retriedJobByRemote.state.transport.lastCommandCursor, 'cmd-cursor-8');
    assert.equal(retriedJobByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(remoteCommandResultCalls.length, 7);
    assert.equal(remoteCommandResultCalls[6].body.result.commandId, 'cmd-retry-job-1');
    assert.equal(remoteCommandResultCalls[6].body.result.result, 'applied');
    assert.ok(fs.existsSync(localJobWorkspacePath));

    const removedJobByRemote = await agent.runCycle();
    assert.equal(removedJobByRemote.state.jobs.some((job) => job.videoId === 'video-seed-001'), false);
    assert.equal(removedJobByRemote.state.transport.lastCommandCursor, 'cmd-cursor-9');
    assert.equal(removedJobByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(remoteCommandResultCalls.length, 8);
    assert.equal(remoteCommandResultCalls[7].body.result.commandId, 'cmd-remove-job-1');
    assert.equal(remoteCommandResultCalls[7].body.result.result, 'applied');
    assert.equal(fs.existsSync(localJobWorkspacePath), false);

    const ignoredMissingJobByRemote = await agent.runCycle();
    assert.equal(ignoredMissingJobByRemote.state.jobs.some((job) => job.videoId === 'video-seed-001'), false);
    assert.equal(ignoredMissingJobByRemote.state.transport.lastCommandCursor, 'cmd-cursor-10');
    assert.equal(ignoredMissingJobByRemote.state.transport.pendingRemoteCommandCount, 0);
    assert.equal(ignoredMissingJobByRemote.state.transport.lastRemoteCommandResult, 'remote_command_reported');
    assert.equal(remoteCommandResultCalls.length, 9);
    assert.equal(remoteCommandResultCalls[8].body.result.commandId, 'cmd-remove-missing-job-1');
    assert.equal(remoteCommandResultCalls[8].body.result.result, 'ignored');
    assert.equal(remoteCommandResultCalls[8].body.result.errorCode, 'job_not_found');

    const saved = agent.saveConfig({
      pollIntervalMs: 20_000,
      deviceName: 'Desk Seeder'
    });
    assert.equal(saved.config.deviceName, 'Desk Seeder');
    assert.equal(saved.config.pollIntervalMs, 20_000);

    agent.state.jobs[0].status = 'completed';
    const cleared = agent.clearFinishedJobs();
    assert.equal(cleared.state.jobs.length, 0);

    await agent.stop();
    await agent.destroy();

    const restartedAgent = new WorldStageClientAgent({
      configPath: path.join(tmpDir, 'config.json'),
      statePath: path.join(tmpDir, 'state.json'),
      defaultDownloadDirectory: path.join(tmpDir, 'downloads'),
      defaultSiteOrigin: 'https://5310s.com',
      fetchImpl: agent.fetchImpl
    });
    try {
      const restartedSnapshot = await restartedAgent.runCycle();
      assert.equal(restartedSnapshot.state.library.length, 0);
      assert.equal(restartedSnapshot.state.transport.lastCommandCursor, 'cmd-cursor-11');
      assert.ok(remoteStatusCalls.length >= 11);
      assert.throws(() => restartedAgent.removeLibraryItem({
        videoId: 'video-remote-1'
      }), /library_entry_not_found/);
      const stoppedRestarted = await restartedAgent.stop();
      assert.equal(stoppedRestarted.summary.agentStatus, 'paused');
    } finally {
      await restartedAgent.destroy();
    }
  } finally {
    await agent.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('client-agent.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
