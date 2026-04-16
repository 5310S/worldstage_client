#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  DOWNLOADS_PATH,
  PEER_ANNOUNCE_PATH,
  SESSIONS_PATH,
  VIDEO_PATH_PREFIX,
  answerSession,
  announceSeederPeer,
  bootstrapDownloadControlPlane,
  buildDownloadChunkUrl,
  buildSessionAnswerUrl,
  buildSessionCandidateUrl,
  buildSessionListUrl,
  buildVideoUrl,
  fetchSessions,
  fetchSessionRecord,
  publishSessionCandidate,
  seederPeerIdForVideo,
  updateDownloadChunk,
  viewerPeerIdForJob
} = require('../lib/control-plane');

async function main() {
  assert.equal(
    buildVideoUrl('https://5310s.com', 'video-alpha'),
    `https://5310s.com${VIDEO_PATH_PREFIX}video-alpha`,
    'Expected video detail URLs to encode the target video id.'
  );
  assert.equal(
    buildSessionListUrl('https://5310s.com', {
      downloadId: 'download-1',
      viewerPeerId: 'peer-1',
      videoId: 'video-alpha'
    }),
    `https://5310s.com${SESSIONS_PATH}?downloadId=download-1&viewerPeerId=peer-1&videoId=video-alpha`,
    'Expected session list URLs to carry download and peer filters.'
  );
  assert.equal(
    buildSessionCandidateUrl('https://5310s.com', 'session-1'),
    'https://5310s.com/api/worldstage/sessions/session-1/candidate',
    'Expected session candidate URLs to target the session candidate relay endpoint.'
  );
  assert.equal(
    buildDownloadChunkUrl('https://5310s.com', 'download-1', 3),
    'https://5310s.com/api/worldstage/downloads/download-1/chunks/3',
    'Expected chunk URLs to point at the indexed chunk update endpoint.'
  );
  assert.equal(
    buildSessionAnswerUrl('https://5310s.com', 'session-1'),
    'https://5310s.com/api/worldstage/sessions/session-1/answer',
    'Expected session answer URLs to target the answer endpoint.'
  );

  const viewerPeerId = viewerPeerIdForJob('wscd_1234', 'wscj_5678');
  assert.match(viewerPeerId, /^wscp-wscd-1234-wscj-5678-viewer/, 'Expected viewer peer ids to be derived from the device and job ids.');
  const seederPeerId = seederPeerIdForVideo('wscd_1234', 'video-alpha');
  assert.match(seederPeerId, /^wscp-wscd-1234-video-alpha-seeder/, 'Expected seeder peer ids to be derived from the device and video ids.');

  const requests = [];
  const bootstrapped = await bootstrapDownloadControlPlane({
    siteOrigin: 'https://5310s.com',
    accountToken: 'worldstage_token',
    deviceId: 'wscd_1234',
    job: {
      id: 'wscj_5678',
      videoId: 'video-alpha',
      channelId: 'channel-alpha'
    },
    offer: {
      type: 'offer',
      sdp: 'v=0\r\ns=WorldStage Desktop Offer\r\n'
    },
    fetchImpl: async (requestUrl, options = {}) => {
      requests.push({
        requestUrl,
        method: options.method || 'GET',
        body: options.body ? JSON.parse(options.body) : null
      });

      if ((options.method || 'GET') === 'GET' && requestUrl === 'https://5310s.com/api/worldstage/videos/video-alpha') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              video: {
                id: 'video-alpha',
                channelId: 'channel-alpha',
                title: 'Alpha'
              }
            };
          }
        };
      }

      if (requestUrl === `https://5310s.com${PEER_ANNOUNCE_PATH}`) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              peer: {
                peerId: viewerPeerId
              }
            };
          }
        };
      }

      if (requestUrl === `https://5310s.com${DOWNLOADS_PATH}`) {
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

      if (requestUrl === `https://5310s.com${SESSIONS_PATH}`) {
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

      throw new Error(`unexpected request ${requestUrl}`);
    }
  });

  assert.equal(bootstrapped.video.id, 'video-alpha');
  assert.equal(bootstrapped.peer.peerId, viewerPeerId);
  assert.equal(bootstrapped.download.downloadId, 'download-1');
  assert.equal(bootstrapped.session.sessionId, 'session-1');
  assert.equal(requests.length, 4);
  assert.equal(requests[1].body.peerId, viewerPeerId);
  assert.equal(requests[2].body.viewerPeerId, viewerPeerId);
  assert.equal(requests[3].body.downloadId, 'download-1');
  assert.equal(requests[3].body.offer.type, 'offer');

  const session = await fetchSessionRecord({
    siteOrigin: 'https://5310s.com',
    accountToken: 'worldstage_token',
    sessionId: 'session-1',
    downloadId: 'download-1',
    viewerPeerId,
    videoId: 'video-alpha',
    fetchImpl: async (requestUrl, options = {}) => {
      assert.equal(options.method, 'GET');
      assert.equal(
        requestUrl,
        buildSessionListUrl('https://5310s.com', {
          downloadId: 'download-1',
          viewerPeerId,
          videoId: 'video-alpha'
        }),
        'Expected fetchSessionRecord to query the filtered session list.'
      );
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            sessions: [
              {
                sessionId: 'session-1',
                status: 'answered'
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(session.status, 'answered');

  const sessions = await fetchSessions({
    siteOrigin: 'https://5310s.com',
    accountToken: 'worldstage_token',
    videoId: 'video-alpha',
    fetchImpl: async (requestUrl, options = {}) => {
      assert.equal(options.method, 'GET');
      assert.equal(
        requestUrl,
        buildSessionListUrl('https://5310s.com', {
          videoId: 'video-alpha'
        }),
        'Expected fetchSessions to query the session list endpoint with the provided filters.'
      );
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            sessions: [
              {
                sessionId: 'session-2',
                status: 'awaiting_answer'
              }
            ]
          };
        }
      };
    }
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, 'session-2');

  const publishedSession = await publishSessionCandidate({
    siteOrigin: 'https://5310s.com',
    accountToken: 'worldstage_token',
    sessionId: 'session-1',
    role: 'viewer',
    peerId: viewerPeerId,
    candidate: {
      candidate: 'candidate:1 1 udp 2122260223 10.0.0.2 6000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0
    },
    fetchImpl: async (requestUrl, options = {}) => {
      assert.equal(options.method, 'POST');
      assert.equal(
        requestUrl,
        buildSessionCandidateUrl('https://5310s.com', 'session-1'),
        'Expected publishSessionCandidate to hit the session candidate endpoint.'
      );
      const body = JSON.parse(options.body);
      assert.equal(body.role, 'viewer');
      assert.equal(body.peerId, viewerPeerId);
      assert.equal(body.candidate.candidate.includes('candidate:'), true);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            session: {
              sessionId: 'session-1',
              status: 'answered'
            }
          };
        }
      };
    }
  });
  assert.equal(publishedSession.sessionId, 'session-1');

  const answeredSession = await answerSession({
    siteOrigin: 'https://5310s.com',
    accountToken: 'worldstage_token',
    sessionId: 'session-1',
    creatorPeerId: seederPeerId,
    answer: {
      type: 'answer',
      sdp: 'v=0\r\ns=WorldStage Desktop Answer\r\n'
    },
    fetchImpl: async (requestUrl, options = {}) => {
      assert.equal(options.method, 'POST');
      assert.equal(
        requestUrl,
        buildSessionAnswerUrl('https://5310s.com', 'session-1'),
        'Expected answerSession to post to the session answer endpoint.'
      );
      const body = JSON.parse(options.body);
      assert.equal(body.creatorPeerId, seederPeerId);
      assert.equal(body.answer.type, 'answer');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            session: {
              sessionId: 'session-1',
              status: 'answered',
              creatorPeerId: seederPeerId
            }
          };
        }
      };
    }
  });
  assert.equal(answeredSession.creatorPeerId, seederPeerId);

  const announcedSeeder = await announceSeederPeer({
    siteOrigin: 'https://5310s.com',
    accountToken: 'worldstage_token',
    peerId: seederPeerId,
    videoId: 'video-alpha',
    fetchImpl: async (requestUrl, options = {}) => {
      assert.equal(options.method, 'POST');
      assert.equal(requestUrl, `https://5310s.com${PEER_ANNOUNCE_PATH}`);
      const body = JSON.parse(options.body);
      assert.equal(body.role, 'seeder');
      assert.deepEqual(body.videoIds, ['video-alpha']);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            peer: {
              peerId: seederPeerId,
              role: 'seeder'
            }
          };
        }
      };
    }
  });
  assert.equal(announcedSeeder.peerId, seederPeerId);

  const updatedDownload = await updateDownloadChunk({
    siteOrigin: 'https://5310s.com',
    accountToken: 'worldstage_token',
    downloadId: 'download-1',
    chunkIndex: 2,
    payload: {
      status: 'verified',
      receivedBytes: 1024,
      receivedHash: 'abc123'
    },
    fetchImpl: async (requestUrl, options = {}) => {
      assert.equal(options.method, 'PATCH');
      assert.equal(
        requestUrl,
        buildDownloadChunkUrl('https://5310s.com', 'download-1', 2),
        'Expected updateDownloadChunk to target the indexed chunk update endpoint.'
      );
      const body = JSON.parse(options.body);
      assert.equal(body.status, 'verified');
      assert.equal(body.receivedBytes, 1024);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            download: {
              downloadId: 'download-1',
              status: 'active',
              chunks: [
                {
                  index: 2,
                  status: 'verified',
                  receivedBytes: 1024
                }
              ]
            }
          };
        }
      };
    }
  });
  assert.equal(updatedDownload.downloadId, 'download-1');
  assert.equal(updatedDownload.chunks[0].status, 'verified');

  console.log('control-plane.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
