'use strict';

const VIDEO_PATH_PREFIX = '/api/worldstage/videos/';
const PEER_ANNOUNCE_PATH = '/api/worldstage/peers/announce';
const DOWNLOADS_PATH = '/api/worldstage/downloads';
const SESSIONS_PATH = '/api/worldstage/sessions';

function sanitizePeerSegment(value, fallback = 'peer') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function viewerPeerIdForJob(deviceId, jobId) {
  return [
    'wscp',
    sanitizePeerSegment(deviceId, 'device'),
    sanitizePeerSegment(jobId, 'job'),
    'viewer'
  ].join('-').slice(0, 120);
}

function seederPeerIdForVideo(deviceId, videoId) {
  return [
    'wscp',
    sanitizePeerSegment(deviceId, 'device'),
    sanitizePeerSegment(videoId, 'video'),
    'seeder'
  ].join('-').slice(0, 120);
}

function authHeaders(accountToken, headers = {}) {
  const token = String(accountToken || '').trim();
  if (!token) return { ...headers };
  return {
    ...headers,
    Authorization: `Bearer ${token}`
  };
}

async function requestJson(url, options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const { fetchImpl: _ignored, ...requestOptions } = options;
  const response = await fetchImpl(url, requestOptions);
  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(String(payload.error || `request_status_${response.status}`));
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function buildVideoUrl(siteOrigin, videoId) {
  return new URL(`${VIDEO_PATH_PREFIX}${encodeURIComponent(String(videoId || '').trim())}`, String(siteOrigin || '').trim()).toString();
}

function buildSessionListUrl(siteOrigin, filters = {}) {
  const url = new URL(SESSIONS_PATH, String(siteOrigin || '').trim());
  Object.entries(filters).forEach(([key, value]) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    url.searchParams.set(key, normalized);
  });
  return url.toString();
}

function buildSessionCandidateUrl(siteOrigin, sessionId) {
  return new URL(
    `${SESSIONS_PATH}/${encodeURIComponent(String(sessionId || '').trim())}/candidate`,
    String(siteOrigin || '').trim()
  ).toString();
}

function buildSessionAnswerUrl(siteOrigin, sessionId) {
  return new URL(
    `${SESSIONS_PATH}/${encodeURIComponent(String(sessionId || '').trim())}/answer`,
    String(siteOrigin || '').trim()
  ).toString();
}

function buildDownloadChunkUrl(siteOrigin, downloadId, chunkIndex) {
  return new URL(
    `${DOWNLOADS_PATH}/${encodeURIComponent(String(downloadId || '').trim())}/chunks/${Math.max(0, Math.trunc(Number(chunkIndex || 0)))}`,
    String(siteOrigin || '').trim()
  ).toString();
}

async function fetchVideoDetail(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const videoId = String(options.videoId || '').trim();
  const accountToken = String(options.accountToken || '').trim();

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!videoId) throw new Error('video_id_required');

  const payload = await requestJson(buildVideoUrl(siteOrigin, videoId), {
    method: 'GET',
    headers: authHeaders(accountToken, {
      Accept: 'application/json'
    }),
    fetchImpl: options.fetchImpl
  });

  if (!payload.video || !payload.video.id) throw new Error('video_not_found');
  return payload.video;
}

async function announceViewerPeer(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const peerId = String(options.peerId || '').trim();
  const channelId = String(options.channelId || '').trim();

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');
  if (!peerId) throw new Error('peer_id_required');
  if (!channelId) throw new Error('channel_id_required');

  const payload = await requestJson(new URL(PEER_ANNOUNCE_PATH, siteOrigin).toString(), {
    method: 'POST',
    headers: authHeaders(accountToken, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      peerId,
      role: 'viewer',
      channelId,
      viewerCapacity: 0,
      viewerCount: 0,
      transport: 'desktop-background-client'
    }),
    fetchImpl: options.fetchImpl
  });

  if (!payload.peer || !payload.peer.peerId) throw new Error('peer_announce_missing');
  return payload.peer;
}

async function announceSeederPeer(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const peerId = String(options.peerId || '').trim();
  const videoId = String(options.videoId || '').trim();
  const channelId = String(options.channelId || '').trim();
  const viewerCapacity = Math.max(0, Math.trunc(Number(options.viewerCapacity || 8) || 0));

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');
  if (!peerId) throw new Error('peer_id_required');
  if (!videoId) throw new Error('video_id_required');

  const payload = await requestJson(new URL(PEER_ANNOUNCE_PATH, siteOrigin).toString(), {
    method: 'POST',
    headers: authHeaders(accountToken, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      peerId,
      role: 'seeder',
      channelId: channelId || undefined,
      videoIds: [videoId],
      viewerCapacity,
      viewerCount: 0,
      transport: 'desktop-background-client'
    }),
    fetchImpl: options.fetchImpl
  });

  if (!payload.peer || !payload.peer.peerId) throw new Error('peer_announce_missing');
  return payload.peer;
}

async function createDownloadRecord(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const viewerPeerId = String(options.viewerPeerId || '').trim();
  const videoId = String(options.videoId || '').trim();
  const channelId = String(options.channelId || '').trim();

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');
  if (!viewerPeerId) throw new Error('viewer_peer_id_required');
  if (!videoId) throw new Error('video_id_required');
  if (!channelId) throw new Error('channel_id_required');

  const payload = await requestJson(new URL(DOWNLOADS_PATH, siteOrigin).toString(), {
    method: 'POST',
    headers: authHeaders(accountToken, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      viewerPeerId,
      videoId,
      channelId
    }),
    fetchImpl: options.fetchImpl
  });

  if (!payload.download || !payload.download.downloadId) throw new Error('download_record_missing');
  return payload.download;
}

async function createDownloadSession(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const viewerPeerId = String(options.viewerPeerId || '').trim();
  const videoId = String(options.videoId || '').trim();
  const channelId = String(options.channelId || '').trim();
  const downloadId = String(options.downloadId || '').trim();
  const targetPeerId = String(options.targetPeerId || '').trim();
  const offer = options.offer && typeof options.offer === 'object' ? options.offer : {};

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');
  if (!viewerPeerId) throw new Error('viewer_peer_id_required');
  if (!videoId) throw new Error('video_id_required');
  if (!channelId) throw new Error('channel_id_required');
  if (!downloadId) throw new Error('download_id_required');
  if (!String(offer.type || '').trim() || !String(offer.sdp || '').trim()) throw new Error('offer_required');

  const payload = await requestJson(new URL(SESSIONS_PATH, siteOrigin).toString(), {
    method: 'POST',
    headers: authHeaders(accountToken, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      viewerPeerId,
      videoId,
      channelId,
      downloadId,
      targetPeerId: targetPeerId || undefined,
      offer: {
        type: String(offer.type || '').trim(),
        sdp: String(offer.sdp || '')
      },
      transport: 'webrtc-data-download'
    }),
    fetchImpl: options.fetchImpl
  });

  if (!payload.session || !payload.session.sessionId) throw new Error('session_record_missing');
  return payload.session;
}

async function fetchSessionRecord(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const sessionId = String(options.sessionId || '').trim();

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');
  if (!sessionId) throw new Error('session_id_required');

  const payload = await requestJson(buildSessionListUrl(siteOrigin, {
    downloadId: options.downloadId,
    viewerPeerId: options.viewerPeerId,
    videoId: options.videoId
  }), {
    method: 'GET',
    headers: authHeaders(accountToken, {
      Accept: 'application/json'
    }),
    fetchImpl: options.fetchImpl
  });

  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  return sessions.find((entry) => String(entry && entry.sessionId || '').trim() === sessionId) || null;
}

async function fetchSessions(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');

  const payload = await requestJson(buildSessionListUrl(siteOrigin, {
    streamId: options.streamId,
    videoId: options.videoId,
    downloadId: options.downloadId,
    viewerPeerId: options.viewerPeerId,
    targetPeerId: options.targetPeerId,
    status: options.status
  }), {
    method: 'GET',
    headers: authHeaders(accountToken, {
      Accept: 'application/json'
    }),
    fetchImpl: options.fetchImpl
  });

  return Array.isArray(payload.sessions) ? payload.sessions : [];
}

async function answerSession(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const sessionId = String(options.sessionId || '').trim();
  const creatorPeerId = String(options.creatorPeerId || '').trim();
  const answer = options.answer && typeof options.answer === 'object' ? options.answer : null;

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');
  if (!sessionId) throw new Error('session_id_required');
  if (!creatorPeerId) throw new Error('peer_id_required');
  if (!answer || !String(answer.type || '').trim() || !String(answer.sdp || '').trim()) throw new Error('answer_required');

  const payload = await requestJson(buildSessionAnswerUrl(siteOrigin, sessionId), {
    method: 'POST',
    headers: authHeaders(accountToken, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      creatorPeerId,
      answer: {
        type: String(answer.type || '').trim(),
        sdp: String(answer.sdp || '')
      }
    }),
    fetchImpl: options.fetchImpl
  });

  if (!payload.session || !payload.session.sessionId) throw new Error('session_record_missing');
  return payload.session;
}

async function publishSessionCandidate(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const sessionId = String(options.sessionId || '').trim();
  const role = String(options.role || '').trim();
  const peerId = String(options.peerId || '').trim();
  const candidate = options.candidate && typeof options.candidate === 'object' ? options.candidate : null;

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');
  if (!sessionId) throw new Error('session_id_required');
  if (!role) throw new Error('session_role_required');
  if (!peerId) throw new Error('peer_id_required');
  if (!candidate || !String(candidate.candidate || '').trim()) throw new Error('candidate_required');

  const payload = await requestJson(buildSessionCandidateUrl(siteOrigin, sessionId), {
    method: 'POST',
    headers: authHeaders(accountToken, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify({
      role,
      peerId,
      candidate
    }),
    fetchImpl: options.fetchImpl
  });

  if (!payload.session || !payload.session.sessionId) throw new Error('session_record_missing');
  return payload.session;
}

async function updateDownloadChunk(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const downloadId = String(options.downloadId || '').trim();
  const chunkIndex = Math.max(0, Math.trunc(Number(options.chunkIndex || 0)));
  const payload = options.payload && typeof options.payload === 'object' ? options.payload : {};

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!accountToken) throw new Error('account_token_unconfigured');
  if (!downloadId) throw new Error('download_id_required');

  const response = await requestJson(buildDownloadChunkUrl(siteOrigin, downloadId, chunkIndex), {
    method: 'PATCH',
    headers: authHeaders(accountToken, {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(payload),
    fetchImpl: options.fetchImpl
  });

  if (!response.download || !response.download.downloadId) throw new Error('download_record_missing');
  return response.download;
}

async function bootstrapDownloadControlPlane(options = {}) {
  const siteOrigin = String(options.siteOrigin || '').trim();
  const accountToken = String(options.accountToken || '').trim();
  const deviceId = String(options.deviceId || '').trim();
  const job = options.job && typeof options.job === 'object' ? options.job : {};
  const video = await fetchVideoDetail({
    siteOrigin,
    videoId: job.videoId,
    accountToken,
    fetchImpl: options.fetchImpl
  });
  const peerId = String(job.controlPeerId || viewerPeerIdForJob(deviceId, job.id)).trim();
  const peer = await announceViewerPeer({
    siteOrigin,
    accountToken,
    peerId,
    channelId: String(video.channelId || job.channelId || '').trim(),
    fetchImpl: options.fetchImpl
  });
  const download = await createDownloadRecord({
    siteOrigin,
    accountToken,
    viewerPeerId: peer.peerId,
    videoId: video.id,
    channelId: String(video.channelId || '').trim(),
    fetchImpl: options.fetchImpl
  });
  const session = await createDownloadSession({
    siteOrigin,
    accountToken,
    viewerPeerId: peer.peerId,
    videoId: video.id,
    channelId: String(video.channelId || '').trim(),
    downloadId: download.downloadId,
    targetPeerId: String(job.targetPeerId || '').trim(),
    offer: options.offer,
    fetchImpl: options.fetchImpl
  });

  return {
    video,
    peer,
    download,
    session
  };
}

module.exports = {
  DOWNLOADS_PATH,
  PEER_ANNOUNCE_PATH,
  SESSIONS_PATH,
  VIDEO_PATH_PREFIX,
  answerSession,
  announceSeederPeer,
  announceViewerPeer,
  bootstrapDownloadControlPlane,
  buildDownloadChunkUrl,
  buildSessionAnswerUrl,
  buildSessionCandidateUrl,
  buildSessionListUrl,
  buildVideoUrl,
  createDownloadRecord,
  createDownloadSession,
  fetchSessions,
  fetchSessionRecord,
  fetchVideoDetail,
  publishSessionCandidate,
  seederPeerIdForVideo,
  updateDownloadChunk,
  viewerPeerIdForJob
};
