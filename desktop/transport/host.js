'use strict';

(function bootstrapTransportHost() {
  if (!window.worldstageTransportHost) return;

  const ICE_GATHER_TIMEOUT_MS = 1500;
  const SEED_SESSION_SYNC_INTERVAL_MS = 2000;
  const VIDEO_CHUNK_SIZE = 64 * 1024;
  const VIDEO_DATA_CHANNEL_BUFFERED_LIMIT = 512 * 1024;
  const bootedAtIso = new Date().toISOString();
  const statusNode = document.getElementById('transport-host-status');
  const runtime = {
    activeJobId: '',
    dispatchInFlight: false,
    seedSyncInFlight: false,
    latestSnapshot: null,
    offerContexts: new Map(),
    creatorContexts: new Map(),
    seedSyncTimer: 0
  };

  function renderStatus(message) {
    if (!statusNode) return;
    statusNode.textContent = message;
  }

  function hasWebRtcSupport() {
    return typeof window.RTCPeerConnection === 'function';
  }

  function sendDataChannelJson(channel, payload) {
    channel.send(JSON.stringify(payload));
  }

  function normalizeCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') return null;
    const candidateValue = String(candidate.candidate || '').trim();
    if (!candidateValue) return null;
    const sdpMid = candidate.sdpMid == null ? null : String(candidate.sdpMid).trim();
    const sdpMLineIndex = candidate.sdpMLineIndex == null ? null : Math.max(0, Math.trunc(Number(candidate.sdpMLineIndex) || 0));
    const usernameFragment = candidate.usernameFragment == null ? null : String(candidate.usernameFragment).trim();
    return {
      candidate: candidateValue,
      sdpMid,
      sdpMLineIndex,
      usernameFragment
    };
  }

  function candidateFingerprint(candidate) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) return '';
    return [
      normalized.candidate,
      normalized.sdpMid == null ? '' : normalized.sdpMid,
      normalized.sdpMLineIndex == null ? '' : String(normalized.sdpMLineIndex),
      normalized.usernameFragment == null ? '' : normalized.usernameFragment
    ].join('|');
  }

  function bytesToHex(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return Array.from(bytes, (entry) => entry.toString(16).padStart(2, '0')).join('');
  }

  function base64ToUint8Array(value) {
    const raw = String(value || '').trim();
    if (!raw) return new Uint8Array(0);
    const decoded = window.atob(raw);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  }

  async function digestArrayBuffer(arrayBuffer) {
    return window.crypto.subtle.digest('SHA-256', arrayBuffer);
  }

  function closeOfferContext(jobId) {
    const key = String(jobId || '').trim();
    if (!key || !runtime.offerContexts.has(key)) return;
    const context = runtime.offerContexts.get(key);
    runtime.offerContexts.delete(key);
    try {
      if (context && context.channel) context.channel.close();
    } catch (_) {}
    try {
      if (context && context.pc) context.pc.close();
    } catch (_) {}
  }

  function closeCreatorContext(sessionId) {
    const key = String(sessionId || '').trim();
    if (!key || !runtime.creatorContexts.has(key)) return;
    const context = runtime.creatorContexts.get(key);
    runtime.creatorContexts.delete(key);
    try {
      if (context && context.channel) context.channel.close();
    } catch (_) {}
    try {
      if (context && context.pc) context.pc.close();
    } catch (_) {}
  }

  function waitForIceGatheringComplete(peerConnection, timeoutMs) {
    if (!peerConnection) return Promise.resolve();
    if (peerConnection.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        peerConnection.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (peerConnection.iceGatheringState === 'complete') finish();
      };
      const timer = window.setTimeout(finish, timeoutMs);
      peerConnection.addEventListener('icegatheringstatechange', onStateChange);
    });
  }

  function waitForBufferedAmount(channel, threshold) {
    if (!channel || channel.readyState !== 'open') return Promise.resolve();
    if (channel.bufferedAmount <= threshold) return Promise.resolve();
    return new Promise((resolve) => {
      const poll = () => {
        if (!channel || channel.readyState !== 'open' || channel.bufferedAmount <= threshold) {
          resolve();
          return;
        }
        window.setTimeout(poll, 25);
      };
      poll();
    });
  }

  async function applyRemoteCandidates(context, candidates) {
    if (!context || !context.pc || !context.pc.remoteDescription) return 0;
    let appliedCount = 0;
    for (const entry of Array.isArray(candidates) ? candidates : []) {
      const normalized = normalizeCandidate(entry);
      if (!normalized) continue;
      const fingerprint = candidateFingerprint(normalized);
      if (!fingerprint || context.remoteCandidateKeys.has(fingerprint)) continue;
      await context.pc.addIceCandidate(normalized);
      context.remoteCandidateKeys.add(fingerprint);
      appliedCount += 1;
    }
    return appliedCount;
  }

  async function flushPendingLocalCandidates(context) {
    if (!context || context.candidateFlushInFlight || !context.canPublishCandidates || !context.sessionId) return 0;
    context.candidateFlushInFlight = true;
    let sentCount = 0;
    try {
      while (context.pendingLocalCandidates.length > 0) {
        const nextCandidate = context.pendingLocalCandidates[0];
        if (context.signalRole === 'creator') {
          await window.worldstageTransportHost.publishSeedCandidate({
            sessionId: context.sessionId,
            peerId: context.peerId,
            candidate: nextCandidate
          });
        } else {
          await window.worldstageTransportHost.publishCandidate({
            jobId: context.jobId,
            role: 'viewer',
            candidate: nextCandidate
          });
        }
        context.pendingLocalCandidates.shift();
        sentCount += 1;
      }
      return sentCount;
    } finally {
      context.candidateFlushInFlight = false;
    }
  }

  function queueLocalCandidate(context, candidate) {
    const normalized = normalizeCandidate(candidate);
    if (!context || !normalized) return;
    const fingerprint = candidateFingerprint(normalized);
    if (!fingerprint || context.localCandidateKeys.has(fingerprint)) return;
    context.localCandidateKeys.add(fingerprint);
    context.pendingLocalCandidates.push(normalized);
    flushPendingLocalCandidates(context).catch((error) => {
      renderStatus(`ICE relay failed: ${String(error && error.message ? error.message : error)}`);
    });
  }

  function nextMissingChunkIndex(context) {
    if (!context || !context.manifest) return -1;
    const chunkCount = Math.max(0, Math.trunc(Number(context.manifest.chunkCount || 0) || 0));
    for (let index = 0; index < chunkCount; index += 1) {
      if (!context.receivedChunkIndexes.has(index)) return index;
    }
    return -1;
  }

  async function requestVideoManifest(context) {
    if (!context || !context.channel || context.channel.readyState !== 'open') return false;
    if (context.manifestRequested && context.manifest) return false;
    context.manifestRequested = true;
    sendDataChannelJson(context.channel, { type: 'request-manifest' });
    await window.worldstageTransportHost.updateJob({
      jobId: context.jobId,
      status: 'running',
      runnerState: 'awaiting_manifest',
      progressPercent: 25,
      note: 'Transfer channel is ready. Requesting the video manifest from the seeding peer.',
      failureCode: '',
      eventType: 'manifest_requested'
    });
    return true;
  }

  async function requestNextVideoChunk(context) {
    if (!context || !context.manifest || !context.channel || context.channel.readyState !== 'open') return false;
    if (context.pendingChunkHeader) return false;

    const index = nextMissingChunkIndex(context);
    if (index < 0) {
      sendDataChannelJson(context.channel, { type: 'download-complete' });
      return false;
    }

    await window.worldstageTransportHost.markChunkRequested({
      jobId: context.jobId,
      chunkIndex: index
    });
    sendDataChannelJson(context.channel, { type: 'request-chunk', index });
    return true;
  }

  async function handleVideoDownloadDataMessage(context, event) {
    if (!context) return;

    if (typeof event.data === 'string') {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        throw new Error('invalid_swarm_control_message');
      }

      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'manifest') {
        context.manifest = {
          name: String(payload.name || `${context.videoId}.bin`),
          mimeType: String(payload.mimeType || 'application/octet-stream'),
          size: Math.max(0, Math.trunc(Number(payload.size || 0) || 0)),
          chunkSize: Math.max(0, Math.trunc(Number(payload.chunkSize || 0) || 0)),
          chunkCount: Math.max(0, Math.trunc(Number(payload.chunkCount || 0) || 0)),
          chunkHashes: Array.isArray(payload.chunkHashes) ? payload.chunkHashes.map((entry) => String(entry || '').trim().toLowerCase()) : [],
          fileHash: String(payload.fileHash || '').trim().toLowerCase()
        };
        await window.worldstageTransportHost.recordManifest({
          jobId: context.jobId,
          manifest: context.manifest
        });
        await requestNextVideoChunk(context);
        return;
      }

      if (payload.type === 'chunk-header') {
        context.pendingChunkHeader = {
          index: Math.max(0, Math.trunc(Number(payload.index || 0) || 0)),
          size: Math.max(0, Math.trunc(Number(payload.size || 0) || 0)),
          hash: String(payload.hash || '').trim().toLowerCase()
        };
        return;
      }

      if (payload.type === 'complete') return;

      if (payload.type === 'error') {
        throw new Error(String(payload.message || 'seeder_error'));
      }

      return;
    }

    const pending = context.pendingChunkHeader;
    if (!pending) return;
    const arrayBuffer = event.data instanceof ArrayBuffer ? event.data : await event.data.arrayBuffer();
    if (pending.size && arrayBuffer.byteLength !== pending.size) {
      context.pendingChunkHeader = null;
      await window.worldstageTransportHost.markChunkFailed({
        jobId: context.jobId,
        chunkIndex: pending.index,
        reason: 'chunk_size_mismatch'
      });
      throw new Error('chunk_size_mismatch');
    }

    const hash = bytesToHex(await digestArrayBuffer(arrayBuffer));
    if (pending.hash && hash !== pending.hash) {
      context.pendingChunkHeader = null;
      await window.worldstageTransportHost.markChunkFailed({
        jobId: context.jobId,
        chunkIndex: pending.index,
        reason: 'chunk_hash_mismatch'
      });
      throw new Error('chunk_hash_mismatch');
    }

    context.receivedChunkIndexes.add(pending.index);
    context.pendingChunkHeader = null;
    const snapshot = await window.worldstageTransportHost.recordVerifiedChunk({
      jobId: context.jobId,
      chunkIndex: pending.index,
      receivedHash: hash,
      bytes: new Uint8Array(arrayBuffer)
    });
    const jobs = snapshot && snapshot.state && Array.isArray(snapshot.state.jobs)
      ? snapshot.state.jobs
      : [];
    const job = jobs.find((entry) => entry.id === context.jobId);
    if (job && job.status === 'completed') {
      sendDataChannelJson(context.channel, { type: 'download-complete' });
      return;
    }
    await requestNextVideoChunk(context);
  }

  async function loadSeedSource(libraryEntry) {
    const manifest = await window.worldstageTransportHost.readSeedManifest({
      manifestPath: libraryEntry.manifestPath
    });
    return {
      videoId: String(libraryEntry.videoId || '').trim(),
      name: String(manifest.name || libraryEntry.fileName || `${libraryEntry.videoId}.bin`).trim(),
      mimeType: String(manifest.mimeType || libraryEntry.mimeType || 'application/octet-stream').trim(),
      size: Math.max(0, Math.trunc(Number(manifest.size || libraryEntry.sizeBytes || 0) || 0)),
      localPath: String(libraryEntry.localPath || '').trim(),
      manifest: {
        chunkSize: Math.max(0, Math.trunc(Number(manifest.chunkSize || libraryEntry.chunkSize || VIDEO_CHUNK_SIZE) || VIDEO_CHUNK_SIZE)),
        chunkCount: Math.max(0, Math.trunc(Number(manifest.chunkCount || libraryEntry.chunkCount || 0) || 0)),
        chunkHashes: Array.isArray(manifest.chunkHashes) ? manifest.chunkHashes.map((entry) => String(entry || '').trim().toLowerCase()) : [],
        fileHash: String(manifest.fileHash || libraryEntry.manifestDigest || '').trim().toLowerCase()
      }
    };
  }

  function sendVideoManifest(channel, source) {
    const manifest = source.manifest || {};
    sendDataChannelJson(channel, {
      type: 'manifest',
      name: source.name,
      mimeType: source.mimeType,
      size: Number(source.size || 0),
      chunkSize: Number(manifest.chunkSize || VIDEO_CHUNK_SIZE),
      chunkCount: Number(manifest.chunkCount || 0),
      chunkHashes: Array.isArray(manifest.chunkHashes) ? manifest.chunkHashes : [],
      fileHash: String(manifest.fileHash || '')
    });
  }

  async function sendRequestedSeedChunk(context, index) {
    const source = context && context.source ? context.source : null;
    const channel = context && context.channel ? context.channel : null;
    const manifest = source && source.manifest ? source.manifest : {};
    const chunkCount = Number(manifest.chunkCount || 0);
    const chunkSize = Number(manifest.chunkSize || VIDEO_CHUNK_SIZE);
    if (!source || !channel) throw new Error('seed_source_missing');
    if (!Number.isFinite(index) || index < 0 || index >= chunkCount) {
      throw new Error('invalid_chunk_request');
    }

    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, Number(source.size || 0));
    const chunkPayload = await window.worldstageTransportHost.readSeedChunk({
      localPath: source.localPath,
      start,
      end
    });
    const bytes = base64ToUint8Array(chunkPayload && chunkPayload.base64);
    sendDataChannelJson(channel, {
      type: 'chunk-header',
      index,
      size: bytes.byteLength,
      hash: Array.isArray(manifest.chunkHashes) ? String(manifest.chunkHashes[index] || '') : ''
    });
    if (channel.bufferedAmount > VIDEO_DATA_CHANNEL_BUFFERED_LIMIT) {
      await waitForBufferedAmount(channel, Math.trunc(VIDEO_DATA_CHANNEL_BUFFERED_LIMIT / 2));
    }
    channel.send(bytes);
  }

  function setupVideoSeederChannel(context, session, channel) {
    const source = context && context.source ? context.source : null;
    if (!source) {
      sendDataChannelJson(channel, {
        type: 'error',
        message: 'seed_source_missing'
      });
      return;
    }
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('open', () => {
      renderStatus(`Seeder channel ready for ${source.name}. Waiting for viewer chunk requests.`);
    });
    channel.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      Promise.resolve().then(async () => {
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'request-manifest') {
          renderStatus(`Viewer ${String(session.viewerPeerId || '').trim() || session.sessionId} requested the manifest for ${source.name}.`);
          sendVideoManifest(channel, source);
          return;
        }
        if (payload.type === 'request-chunk') {
          const index = Math.trunc(Number(payload.index));
          renderStatus(`Sending chunk ${index + 1} of ${Number(source.manifest && source.manifest.chunkCount || 0)} for ${source.name}.`);
          await sendRequestedSeedChunk(context, index);
          return;
        }
        if (payload.type === 'download-complete') {
          renderStatus(`Viewer ${String(session.viewerPeerId || '').trim() || session.sessionId} confirmed the video transfer is complete.`);
        }
      }).catch((error) => {
        try {
          sendDataChannelJson(channel, {
            type: 'error',
            message: String(error && error.message ? error.message : error)
          });
        } catch (_) {}
      });
    });
    channel.addEventListener('close', () => {
      renderStatus(`Seeder channel closed for ${source.name}.`);
    });
  }

  async function buildVideoDownloadOffer(job) {
    if (!hasWebRtcSupport()) throw new Error('webrtc_not_supported');
    const key = String(job && job.id || '').trim();
    if (!key) throw new Error('job_id_required');

    closeOfferContext(key);

    const peerConnection = new window.RTCPeerConnection({ iceServers: [] });
    const dataChannel = peerConnection.createDataChannel('worldstage-video-download', { ordered: true });
    dataChannel.binaryType = 'arraybuffer';

    const context = {
      jobId: key,
      videoId: String(job && job.videoId || '').trim(),
      signalRole: 'viewer',
      pc: peerConnection,
      channel: dataChannel,
      offer: null,
      sessionId: '',
      canPublishCandidates: false,
      candidateFlushInFlight: false,
      pendingLocalCandidates: [],
      localCandidateKeys: new Set(),
      remoteCandidateKeys: new Set(),
      answerApplied: false,
      manifestRequested: false,
      manifest: null,
      pendingChunkHeader: null,
      receivedChunkIndexes: new Set()
    };

    dataChannel.addEventListener('open', () => {
      requestVideoManifest(context).catch((error) => {
        renderStatus(`Manifest request failed: ${String(error && error.message ? error.message : error)}`);
      });
    });
    dataChannel.addEventListener('message', (event) => {
      handleVideoDownloadDataMessage(context, event).catch((error) => {
        renderStatus(`Transfer failed: ${String(error && error.message ? error.message : error)}`);
      });
    });
    dataChannel.addEventListener('close', () => {
      renderStatus(`Transfer channel closed for ${context.videoId || context.jobId}.`);
    });

    peerConnection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return;
      queueLocalCandidate(context, event.candidate);
    });

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGatheringComplete(peerConnection, ICE_GATHER_TIMEOUT_MS);

    context.offer = {
      type: peerConnection.localDescription ? peerConnection.localDescription.type : offer.type,
      sdp: peerConnection.localDescription && peerConnection.localDescription.sdp
        ? peerConnection.localDescription.sdp
        : offer.sdp
    };
    runtime.offerContexts.set(key, context);
    return context.offer;
  }

  async function buildVideoDownloadAnswer(session, libraryEntry) {
    if (!session || !session.offer || !session.videoId) throw new Error('video_session_offer_missing');
    if (!hasWebRtcSupport()) throw new Error('webrtc_not_supported');

    closeCreatorContext(session.sessionId);

    const source = await loadSeedSource(libraryEntry);
    const peerConnection = new window.RTCPeerConnection({ iceServers: [] });
    const context = {
      sessionId: String(session.sessionId || '').trim(),
      videoId: String(session.videoId || '').trim(),
      peerId: String(libraryEntry.seedPeerId || '').trim(),
      signalRole: 'creator',
      pc: peerConnection,
      channel: null,
      source,
      canPublishCandidates: false,
      candidateFlushInFlight: false,
      pendingLocalCandidates: [],
      localCandidateKeys: new Set(),
      remoteCandidateKeys: new Set()
    };
    runtime.creatorContexts.set(context.sessionId, context);

    peerConnection.addEventListener('datachannel', (event) => {
      context.channel = event.channel;
      setupVideoSeederChannel(context, session, event.channel);
    });
    peerConnection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) return;
      queueLocalCandidate(context, event.candidate);
    });

    try {
      await peerConnection.setRemoteDescription({
        type: String(session.offer.type || 'offer').trim() || 'offer',
        sdp: String(session.offer.sdp || '')
      });
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await waitForIceGatheringComplete(peerConnection, ICE_GATHER_TIMEOUT_MS);
      await applyRemoteCandidates(context, session.viewerCandidates);
      return {
        context,
        answer: {
          type: peerConnection.localDescription ? peerConnection.localDescription.type : answer.type,
          sdp: peerConnection.localDescription && peerConnection.localDescription.sdp
            ? peerConnection.localDescription.sdp
            : answer.sdp
        }
      };
    } catch (error) {
      closeCreatorContext(session.sessionId);
      throw error;
    }
  }

  async function syncActiveContext(job) {
    const key = String(job && job.id || '').trim();
    if (!key || !runtime.offerContexts.has(key)) return;
    const context = runtime.offerContexts.get(key);

    if (!context.sessionId && job.sessionId) {
      context.sessionId = String(job.sessionId || '').trim();
      context.canPublishCandidates = true;
      await flushPendingLocalCandidates(context);
    }

    if (job.sessionStatus === 'answered' && job.sessionAnswer && !context.answerApplied) {
      await context.pc.setRemoteDescription({
        type: String(job.sessionAnswer.type || 'answer').trim() || 'answer',
        sdp: String(job.sessionAnswer.sdp || '')
      });
      context.answerApplied = true;
      await window.worldstageTransportHost.updateJob({
        jobId: job.id,
        status: 'running',
        runnerState: 'awaiting_data_channel',
        progressPercent: Math.max(Number(job.progressPercent || 0) || 0, 22),
        note: 'Seeder answer applied. ICE candidate exchange is active and the data channel is negotiating.',
        failureCode: '',
        eventType: 'answer_applied'
      });
      await flushPendingLocalCandidates(context);
    }

    if (context.answerApplied) {
      await applyRemoteCandidates(context, job.creatorCandidates);
      if (context.channel.readyState === 'open' && !context.manifestRequested) {
        await requestVideoManifest(context);
      }
    }
  }

  async function syncCreatorContext(context, session) {
    if (!context || !session) return;
    if (String(session.status || '').trim() === 'closed') {
      closeCreatorContext(session.sessionId);
      return;
    }
    if (String(session.status || '').trim() === 'answered') {
      context.canPublishCandidates = true;
      await flushPendingLocalCandidates(context);
      await applyRemoteCandidates(context, session.viewerCandidates);
    }
  }

  function seedableLibraryEntries(snapshot) {
    const library = snapshot && snapshot.state && Array.isArray(snapshot.state.library)
      ? snapshot.state.library
      : [];
    return library.filter((entry) => {
      return String(entry && entry.seedState || '').trim() === 'seeding'
        && String(entry && entry.videoId || '').trim()
        && String(entry && entry.seedPeerId || '').trim()
        && String(entry && entry.localPath || '').trim()
        && String(entry && entry.manifestPath || '').trim();
    });
  }

  async function maybeAnswerSeedSession(session, libraryEntry) {
    const sessionId = String(session && session.sessionId || '').trim();
    if (!sessionId) return null;
    if (runtime.creatorContexts.has(sessionId)) return runtime.creatorContexts.get(sessionId);

    renderStatus(`Answering a queued download request for ${libraryEntry.videoTitle || libraryEntry.videoId}.`);
    const built = await buildVideoDownloadAnswer(session, libraryEntry);
    const answeredSession = await window.worldstageTransportHost.answerSeedSession({
      sessionId,
      creatorPeerId: String(libraryEntry.seedPeerId || '').trim(),
      answer: built.answer
    });
    built.context.canPublishCandidates = true;
    await flushPendingLocalCandidates(built.context);
    await applyRemoteCandidates(built.context, answeredSession && answeredSession.viewerCandidates);
    renderStatus(`Seeding ${libraryEntry.videoTitle || libraryEntry.videoId} to ${String(session.viewerPeerId || '').trim() || sessionId}.`);
    return built.context;
  }

  async function syncSeedSessions(snapshot) {
    if (runtime.seedSyncInFlight) return;
    runtime.seedSyncInFlight = true;
    try {
      if (!snapshot || !snapshot.config || !snapshot.config.accountToken || !hasWebRtcSupport()) {
        for (const sessionId of Array.from(runtime.creatorContexts.keys())) closeCreatorContext(sessionId);
        return;
      }

      const entries = seedableLibraryEntries(snapshot);
      const activeSessionIds = new Set();
      for (const libraryEntry of entries) {
        const sessions = await window.worldstageTransportHost.listSeedSessions({
          videoId: libraryEntry.videoId,
          seedPeerId: libraryEntry.seedPeerId
        });
        for (const session of Array.isArray(sessions) ? sessions : []) {
          const sessionId = String(session && session.sessionId || '').trim();
          if (!sessionId) continue;
          activeSessionIds.add(sessionId);
          const status = String(session && session.status || '').trim();
          if (status === 'awaiting_answer' && !runtime.creatorContexts.has(sessionId)) {
            try {
              await maybeAnswerSeedSession(session, libraryEntry);
            } catch (error) {
              closeCreatorContext(sessionId);
              renderStatus(`Seed answer failed: ${String(error && error.message ? error.message : error)}`);
            }
            continue;
          }

          const context = runtime.creatorContexts.get(sessionId);
          if (context) {
            try {
              await syncCreatorContext(context, session);
            } catch (error) {
              renderStatus(`Seed session sync failed: ${String(error && error.message ? error.message : error)}`);
            }
          }
        }
      }

      for (const sessionId of Array.from(runtime.creatorContexts.keys())) {
        if (!activeSessionIds.has(sessionId)) closeCreatorContext(sessionId);
      }
    } finally {
      runtime.seedSyncInFlight = false;
    }
  }

  function startSeedSyncTimer() {
    if (runtime.seedSyncTimer) return;
    runtime.seedSyncTimer = window.setInterval(() => {
      syncSeedSessions(runtime.latestSnapshot).catch((error) => {
        renderStatus(`Seed sync failed: ${String(error && error.message ? error.message : error)}`);
      });
    }, SEED_SESSION_SYNC_INTERVAL_MS);
  }

  window.worldstageTransportHost.signalReady({
    capability: 'webrtc_download_transport',
    bootedAtIso
  });

  renderStatus('Transport host is idle.');
  startSeedSyncTimer();

  async function maybeDispatchPreparedJob(snapshot) {
    const jobs = snapshot && snapshot.state && Array.isArray(snapshot.state.jobs)
      ? snapshot.state.jobs
      : [];

    if (runtime.dispatchInFlight) return;
    if (runtime.activeJobId) {
      const activeJob = jobs.find((job) => job.id === runtime.activeJobId);
      if (activeJob && activeJob.status === 'running') {
        renderStatus(`Transport host is tracking ${activeJob.videoTitle || activeJob.videoId || activeJob.id}.`);
        return;
      }
      runtime.activeJobId = '';
    }

    const preparedJob = jobs.find((job) => {
      return job.status === 'blocked'
        && [
          'awaiting_transport_worker',
          'awaiting_account_token',
          'awaiting_webrtc_offer'
        ].includes(String(job.runnerState || '').trim());
    });
    if (!preparedJob) {
      if (runtime.creatorContexts.size > 0) {
        renderStatus(`Transport host is seeding ${runtime.creatorContexts.size} active session${runtime.creatorContexts.size === 1 ? '' : 's'}.`);
      } else {
        renderStatus('Transport host is idle.');
      }
      return;
    }

    if (!snapshot || !snapshot.config || !snapshot.config.accountToken) {
      if (preparedJob.runnerState !== 'awaiting_account_token') {
        await window.worldstageTransportHost.updateJob({
          jobId: preparedJob.id,
          status: 'blocked',
          runnerState: 'awaiting_account_token',
          progressPercent: Number(preparedJob.progressPercent || 0) || 0,
          note: 'Add a WorldStage account token before the desktop client can announce a viewer peer or open a transfer session.',
          failureCode: 'account_token_unconfigured',
          eventType: 'control_plane_auth_required'
        });
      }
      renderStatus(`Waiting for an account token before bootstrapping ${preparedJob.videoTitle || preparedJob.videoId || preparedJob.id}.`);
      return;
    }

    if (!hasWebRtcSupport()) {
      await window.worldstageTransportHost.updateJob({
        jobId: preparedJob.id,
        status: 'blocked',
        runnerState: 'webrtc_unavailable',
        progressPercent: Number(preparedJob.progressPercent || 0) || 0,
        note: 'This desktop runtime does not expose RTCPeerConnection, so download offers cannot be created.',
        failureCode: 'webrtc_not_supported',
        eventType: 'webrtc_unavailable'
      });
      renderStatus('Transport host cannot create WebRTC offers in this runtime.');
      return;
    }

    runtime.dispatchInFlight = true;
    renderStatus(`Generating an offer for ${preparedJob.videoTitle || preparedJob.videoId || preparedJob.id}.`);
    try {
      const offer = await buildVideoDownloadOffer(preparedJob);
      await window.worldstageTransportHost.updateJob({
        jobId: preparedJob.id,
        status: 'running',
        runnerState: 'awaiting_control_plane_bootstrap',
        progressPercent: Math.max(Number(preparedJob.progressPercent || 0) || 0, 4),
        note: 'Transport host generated a local WebRTC offer and is bootstrapping the control-plane download session.',
        failureCode: '',
        eventType: 'transport_offer_created'
      });
      const updated = await window.worldstageTransportHost.bootstrapJob({
        jobId: preparedJob.id,
        offer
      });
      const updatedJobs = updated && updated.state && Array.isArray(updated.state.jobs)
        ? updated.state.jobs
        : [];
      const activeJob = updatedJobs.find((job) => job.id === preparedJob.id);
      runtime.activeJobId = activeJob && activeJob.status === 'running' ? activeJob.id : '';
      if (activeJob) await syncActiveContext(activeJob);
      renderStatus(activeJob
        ? `Transport host is tracking ${activeJob.videoTitle || activeJob.videoId || activeJob.id}.`
        : 'Transport host is idle.');
    } catch (error) {
      closeOfferContext(preparedJob.id);
      renderStatus(`Transport host claim failed: ${String(error && error.message ? error.message : error)}`);
    } finally {
      runtime.dispatchInFlight = false;
    }
  }

  window.worldstageTransportHost.onClientSnapshot((snapshot) => {
    runtime.latestSnapshot = snapshot;
    const jobs = snapshot && snapshot.state && Array.isArray(snapshot.state.jobs)
      ? snapshot.state.jobs
      : [];
    const activeJob = jobs.find((job) => job.status === 'running');
    if (activeJob) {
      runtime.activeJobId = activeJob.id;
      renderStatus(`Transport host is tracking ${activeJob.videoTitle || activeJob.videoId || activeJob.id}.`);
      syncActiveContext(activeJob).catch((error) => {
        renderStatus(`Transport sync failed: ${String(error && error.message ? error.message : error)}`);
      });
    }
    jobs
      .filter((job) => job.status === 'completed' || job.status === 'failed' || job.status === 'canceled')
      .forEach((job) => closeOfferContext(job.id));
    syncSeedSessions(snapshot).catch((error) => {
      renderStatus(`Seed sync failed: ${String(error && error.message ? error.message : error)}`);
    });
    maybeDispatchPreparedJob(snapshot).catch((error) => {
      renderStatus(`Transport host dispatch failed: ${String(error && error.message ? error.message : error)}`);
    });
  });
})();
