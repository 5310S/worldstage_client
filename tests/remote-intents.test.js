#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  REMOTE_COMMAND_RESULTS_SUFFIX,
  buildRemoteCommandResultUrl,
  REMOTE_COMMANDS_PATH,
  buildRemoteCommandUrl,
  REMOTE_INTENT_EVENTS_SUFFIX,
  buildRemoteIntentEventUrl,
  REMOTE_INTENTS_PATH,
  REMOTE_STATUS_PATH,
  buildRemoteIntentUrl,
  buildRemoteStatusUrl,
  fetchRemoteCommands,
  fetchRemoteIntents,
  mergeRemoteIntentsIntoJobs,
  publishRemoteClientStatus,
  publishRemoteCommandResult,
  publishRemoteIntentEvent
} = require('../lib/remote-intents');

async function main() {
  const url = buildRemoteIntentUrl('https://5310s.com', {
    deviceId: 'wscd_test',
    cursor: 'cursor-1'
  });
  assert.equal(
    url,
    `https://5310s.com${REMOTE_INTENTS_PATH}?deviceId=wscd_test&cursor=cursor-1`,
    'Expected remote intent URLs to encode device id and cursor.'
  );

  const fetched = await fetchRemoteIntents({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: 'wsct_secret',
    cursor: 'cursor-1',
    fetchImpl: async (requestUrl, options) => {
      assert.equal(requestUrl, url, 'Expected fetchRemoteIntents to hit the generated intent URL.');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer wsct_secret');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            cursor: 'cursor-2',
            intents: [
              {
                id: 'intent-1',
                videoId: 'video-alpha',
                videoTitle: 'Alpha',
                channelId: 'channel-alpha'
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(fetched.cursor, 'cursor-2');
  assert.equal(fetched.intents.length, 1);
  assert.equal(fetched.intents[0].id, 'intent-1');

  const commandUrl = buildRemoteCommandUrl('https://5310s.com', {
    deviceId: 'wscd_test',
    cursor: 'cmd-cursor-1'
  });
  assert.equal(
    commandUrl,
    `https://5310s.com${REMOTE_COMMANDS_PATH}?deviceId=wscd_test&cursor=cmd-cursor-1`,
    'Expected remote command URLs to encode device id and cursor.'
  );

  const fetchedCommands = await fetchRemoteCommands({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: 'wsct_secret',
    cursor: 'cmd-cursor-1',
    fetchImpl: async (requestUrl, options) => {
      assert.equal(requestUrl, commandUrl, 'Expected fetchRemoteCommands to hit the generated command URL.');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer wsct_secret');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            cursor: 'cmd-cursor-2',
            commands: [
              {
                id: 'cmd-1',
                command: 'pause_seed',
                videoId: 'video-alpha',
                note: 'Pause the seed.'
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(fetchedCommands.cursor, 'cmd-cursor-2');
  assert.equal(fetchedCommands.commands.length, 1);
  assert.equal(fetchedCommands.commands[0].command, 'pause_seed');

  const statusUrl = buildRemoteStatusUrl('https://5310s.com', {
    deviceId: 'wscd_test'
  });
  assert.equal(
    statusUrl,
    `https://5310s.com${REMOTE_STATUS_PATH}?deviceId=wscd_test`,
    'Expected remote status URLs to encode the device id.'
  );

  const eventUrl = buildRemoteIntentEventUrl('https://5310s.com', 'intent-1');
  assert.equal(
    eventUrl,
    `https://5310s.com${REMOTE_INTENTS_PATH}/intent-1${REMOTE_INTENT_EVENTS_SUFFIX}`,
    'Expected remote intent event URLs to include the encoded intent id.'
  );

  const published = await publishRemoteIntentEvent({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: 'wsct_secret',
    intentId: 'intent-1',
    event: {
      eventType: 'transport_claimed',
      jobId: 'job-1',
      status: 'running',
      runnerState: 'awaiting_control_plane_session',
      progressPercent: 5,
      note: 'Claimed.'
    },
    fetchImpl: async (requestUrl, options) => {
      assert.equal(requestUrl, eventUrl, 'Expected publishRemoteIntentEvent to hit the generated event URL.');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer wsct_secret');
      const body = JSON.parse(options.body);
      assert.equal(body.deviceId, 'wscd_test');
      assert.equal(body.event.eventType, 'transport_claimed');
      assert.equal(body.event.jobId, 'job-1');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            accepted: true,
            eventId: 'evt-1',
            intentStatus: 'running'
          };
        }
      };
    }
  });

  assert.equal(published.accepted, true);
  assert.equal(published.eventId, 'evt-1');
  assert.equal(published.intentStatus, 'running');

  const commandResultUrl = buildRemoteCommandResultUrl('https://5310s.com', 'cmd-1');
  assert.equal(
    commandResultUrl,
    `https://5310s.com${REMOTE_COMMANDS_PATH}/cmd-1${REMOTE_COMMAND_RESULTS_SUFFIX}`,
    'Expected remote command result URLs to include the encoded command id.'
  );

  const publishedCommandResult = await publishRemoteCommandResult({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: 'wsct_secret',
    commandId: 'cmd-1',
    result: {
      result: 'applied',
      note: 'Seed paused.',
      occurredAtIso: '2026-04-16T13:31:00.000Z'
    },
    fetchImpl: async (requestUrl, options) => {
      assert.equal(requestUrl, commandResultUrl, 'Expected publishRemoteCommandResult to hit the generated result URL.');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer wsct_secret');
      const body = JSON.parse(options.body);
      assert.equal(body.deviceId, 'wscd_test');
      assert.equal(body.result.commandId, 'cmd-1');
      assert.equal(body.result.result, 'applied');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            accepted: true,
            resultId: 'cmd-result-1',
            commandStatus: 'applied'
          };
        }
      };
    }
  });

  assert.equal(publishedCommandResult.accepted, true);
  assert.equal(publishedCommandResult.resultId, 'cmd-result-1');
  assert.equal(publishedCommandResult.commandStatus, 'applied');

  const publishedStatus = await publishRemoteClientStatus({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: 'wsct_secret',
    status: {
      reportedAtIso: '2026-04-16T13:30:00.000Z',
      device: {
        id: 'wscd_test',
        name: 'Desk Seeder'
      },
      agent: {
        status: 'running',
        transportState: 'transport_host_active',
        pollIntervalMs: 15000
      },
      counts: {
        queued: 1,
        running: 2,
        blocked: 0,
        completed: 3,
        failed: 0,
        library: 4
      },
      jobs: [
        {
          id: 'job-1',
          videoId: 'video-alpha',
          status: 'running',
          progressPercent: 42
        }
      ],
      library: [
        {
          videoId: 'video-alpha',
          seedState: 'seeding',
          seedPeerId: 'peer-alpha'
        }
      ]
    },
    fetchImpl: async (requestUrl, options) => {
      assert.equal(requestUrl, statusUrl, 'Expected publishRemoteClientStatus to hit the generated status URL.');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer wsct_secret');
      const body = JSON.parse(options.body);
      assert.equal(body.deviceId, 'wscd_test');
      assert.equal(body.status.device.id, 'wscd_test');
      assert.equal(body.status.counts.library, 4);
      assert.equal(body.status.jobs[0].id, 'job-1');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            accepted: true,
            statusId: 'status-1',
            device: {
              id: 'wscd_test',
              claimedByHandle: 'seedbox'
            }
          };
        }
      };
    }
  });

  assert.equal(publishedStatus.accepted, true);
  assert.equal(publishedStatus.statusId, 'status-1');
  assert.equal(publishedStatus.device.claimedByHandle, 'seedbox');

  const merged = mergeRemoteIntentsIntoJobs({
    jobs: [
      {
        id: 'job-local',
        remoteIntentId: '',
        source: 'manual',
        status: 'queued'
      },
      {
        id: 'job-remote-existing',
        remoteIntentId: 'intent-1',
        source: 'remote',
        status: 'queued'
      }
    ]
  }, [
    {
      id: 'intent-1',
      videoId: 'video-alpha',
      videoTitle: 'Alpha'
    },
    {
      id: 'intent-2',
      videoId: 'video-beta',
      videoTitle: 'Beta',
      channelId: 'channel-beta'
    }
  ]);

  assert.equal(merged.createdJobs.length, 1, 'Expected duplicate remote intents to be skipped.');
  assert.equal(merged.jobs[0].remoteIntentId, 'intent-2', 'Expected new remote intents to be prepended as queued jobs.');
  assert.equal(merged.jobs[0].source, 'remote');

  await assert.rejects(() => fetchRemoteIntents({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: ''
  }), /device_token_unconfigured/, 'Expected remote intent fetches to require a device token.');

  await assert.rejects(() => publishRemoteIntentEvent({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: 'wsct_secret',
    intentId: 'intent-1',
    event: {
      eventType: 'transport_claimed'
    }
  }), /job_id_required/, 'Expected remote intent event publishing to require a job id.');

  await assert.rejects(() => publishRemoteClientStatus({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: 'wsct_secret',
    status: {
      device: {
        id: ''
      }
    }
  }), /status_device_id_required/, 'Expected remote client status publishing to require a device id inside the status payload.');

  await assert.rejects(() => publishRemoteCommandResult({
    siteOrigin: 'https://5310s.com',
    deviceId: 'wscd_test',
    deviceToken: 'wsct_secret',
    commandId: '',
    result: {
      result: 'ignored'
    }
  }), /command_id_required/, 'Expected remote command result publishing to require a command id.');

  console.log('remote-intents.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
