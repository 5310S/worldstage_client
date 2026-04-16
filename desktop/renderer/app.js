'use strict';

const state = {
  snapshot: null,
  unsubscribe: null,
  advancedConfigTouched: false
};

function $(id) {
  return document.getElementById(id);
}

function safeText(value, fallback = 'Unavailable') {
  return value == null || value === '' ? fallback : String(value);
}

function formatTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Never';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return 'Never';
  return parsed.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function formatNumber(value, fallback = '0') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return new Intl.NumberFormat('en-US').format(numeric);
}

function formatBytes(value, fallback = '0 B') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  if (numeric < 1024) return `${formatNumber(numeric)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = numeric / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatPercent(value, fallback = '0%') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return `${numeric.toFixed(numeric >= 10 ? 0 : 1)}%`;
}

function pillClass(status) {
  if (status === 'running' || status === 'completed') return 'pill pill-ok';
  if (status === 'queued' || status === 'blocked' || status === 'paused') return 'pill pill-warn';
  return 'pill pill-neutral';
}

function seedStateTone(stateValue) {
  const value = String(stateValue || '').trim();
  if (value === 'seeding') return 'status-running';
  if (value === 'seed_announce_failed' || value === 'seed_source_missing') return 'status-failed';
  if (value === 'ready_to_seed' || value === 'local_only') return 'status-queued';
  return 'status-blocked';
}

function pairingStatusMessage(snapshot) {
  const config = snapshot.config || {};
  const runtime = snapshot.runtime || {};
  const pairing = runtime.pairing || {};

  if (config.deviceToken) {
    return 'This machine is connected to WorldStage. Advanced settings can stay closed unless you need to troubleshoot.';
  }
  if (pairing.lastError) {
    return `Connection link failed: ${pairing.lastError}`;
  }
  if (pairing.registered) {
    return 'Open a WorldStage connection link and this app should catch it automatically. You can also paste the link here.';
  }
  return 'Use a single connection link from the website when available. The raw token fields below are only a fallback.';
}

function shouldAutoOpenAdvancedConfig(snapshot) {
  const config = snapshot.config || {};
  const runtime = snapshot.runtime || {};
  const pairing = runtime.pairing || {};
  if (pairing.lastResult === 'pairing_link_failed') return true;
  return !config.deviceToken && !config.accountToken && Boolean(pairing.lastError);
}

function setupChecklistEntries(snapshot) {
  const config = snapshot.config || {};
  const summary = snapshot.summary || {};
  const runtime = snapshot.runtime || {};
  const launchOnLogin = runtime.launchOnLogin || {};
  const pairing = runtime.pairing || {};
  const updater = runtime.updater || {};
  const agent = snapshot.state && snapshot.state.agent ? snapshot.state.agent : {};
  return [
    {
      label: 'Connection link setup',
      ready: Boolean(config.deviceToken),
      detail: config.deviceToken
        ? 'Configured'
        : pairing.lastError
          ? `Link handling issue: ${pairing.lastError}`
          : pairing.registered
            ? 'The app can accept a WorldStage connection link directly from the website or OS.'
            : 'Paste a connection link below if your OS does not open the app automatically yet.'
    },
    {
      label: 'Keep running after window close',
      ready: Boolean(config.backgroundOnClose),
      detail: config.backgroundOnClose ? 'Enabled' : 'Turn on background close so the client stays alive in the tray.'
    },
    {
      label: 'Start with the computer',
      ready: Boolean(config.launchOnLogin) && !launchOnLogin.lastError && launchOnLogin.supported !== false,
      detail: launchOnLogin.lastError
        ? `Autostart failed: ${launchOnLogin.lastError}`
        : config.launchOnLogin
          ? 'Enabled'
          : 'Enable launch on login so seeding survives reboots without manual relaunch.'
    },
    {
      label: 'Start the agent automatically',
      ready: Boolean(config.autoStartAgent),
      detail: config.autoStartAgent ? 'Enabled' : 'Enable agent auto-start so background work begins on launch.'
    },
    {
      label: 'Website bridge connected',
      ready: Boolean(config.deviceToken),
      detail: config.deviceToken
        ? 'Configured'
        : 'The website still cannot hand this machine downloads until device pairing is set up.'
    },
    {
      label: 'WorldStage account linked',
      ready: Boolean(config.accountToken),
      detail: config.accountToken
        ? 'Configured'
        : 'Downloads and session bootstrap still require a WorldStage account token.'
    },
    {
      label: 'Background loop running',
      ready: summary.agentStatus === 'running',
      detail: summary.agentStatus === 'running'
        ? `Running (${agent.transportState || 'active'})`
        : 'Start the agent so the client can claim jobs immediately.'
    },
    {
      label: 'Release updates wired',
      ready: updater.enabled === true,
      detail: updater.enabled
        ? 'GitHub release checks are active for this packaged install.'
        : updater.disabledReason === 'packaged_build_required'
          ? 'Updater stays off in development runs. Packaged installs check GitHub releases automatically.'
          : updater.lastError || 'Updater is currently unavailable.'
    }
  ];
}

function updaterStatusMessage(updater) {
  if (!updater || typeof updater !== 'object') return 'Unavailable';
  if (updater.downloaded) {
    return `Update ${safeText(updater.latestVersion, 'ready')} downloaded. Restart to install.`;
  }
  if (updater.lastResult === 'downloading_update') {
    return `Downloading ${safeText(updater.latestVersion, 'update')} (${formatPercent(updater.progressPercent, '0%')}).`;
  }
  if (updater.lastResult === 'update_available') {
    return `Update ${safeText(updater.latestVersion, 'available')} is available and downloading in the background.`;
  }
  if (updater.lastResult === 'up_to_date') {
    return 'This install is on the latest published release.';
  }
  if (updater.lastResult === 'release_page_opened') {
    return 'Opened the latest GitHub release page.';
  }
  if (updater.lastResult === 'manual_check_unavailable') {
    return `Update checks are unavailable: ${safeText(updater.disabledReason, 'unknown reason')}.`;
  }
  if (updater.lastError) {
    return `Update error: ${updater.lastError}`;
  }
  if (updater.disabledReason === 'packaged_build_required') {
    return 'Dev builds do not self-update. Packaged installs check GitHub releases.';
  }
  return safeText(updater.lastResult, 'Idle');
}

function renderConfig(snapshot) {
  const config = snapshot.config || {};
  const advancedPanel = $('advanced-config-panel');
  $('device-name').value = config.deviceName || '';
  $('site-origin').value = config.siteOrigin || '';
  $('device-token').value = config.deviceToken || '';
  $('account-token').value = config.accountToken || '';
  $('poll-interval').value = String(config.pollIntervalMs || 15000);
  $('download-directory').value = config.downloadDirectory || '';
  $('background-on-close').checked = Boolean(config.backgroundOnClose);
  $('launch-on-login').checked = Boolean(config.launchOnLogin);
  $('auto-start-agent').checked = Boolean(config.autoStartAgent);
  $('pairing-status').textContent = pairingStatusMessage(snapshot);
  if (advancedPanel && !state.advancedConfigTouched) {
    advancedPanel.open = shouldAutoOpenAdvancedConfig(snapshot);
  }
}

function renderSummary(snapshot) {
  const summary = snapshot.summary || {};
  const agentState = snapshot.state && snapshot.state.agent ? snapshot.state.agent : {};
  const paths = snapshot.paths || {};
  const runtime = snapshot.runtime || {};
  const transportHost = runtime.transportHost || {};
  const launchOnLogin = runtime.launchOnLogin || {};
  const updater = runtime.updater || {};
  const worldstageSite = runtime.worldstageSite || {};
  const transportState = snapshot.state && snapshot.state.transport ? snapshot.state.transport : {};

  $('agent-pill').className = pillClass(summary.agentStatus);
  $('agent-pill').textContent = safeText(summary.agentStatus, 'idle');

  $('transport-pill').className = summary.transportAvailable ? 'pill pill-ok' : 'pill pill-warn';
  $('transport-pill').textContent = summary.transportAvailable ? 'Transport Ready' : 'Transport Pending';

  $('close-pill').className = summary.backgroundOnClose ? 'pill pill-ok' : 'pill pill-neutral';
  $('close-pill').textContent = summary.backgroundOnClose ? 'Background Close Enabled' : 'Quit On Close';

  $('site-origin-value').textContent = safeText(summary.siteOrigin, 'Unconfigured');
  $('last-cycle-value').textContent = formatTimestamp(agentState.lastCycleAtIso);
  $('last-sync-value').textContent = safeText(agentState.lastSyncResult, 'not_started');
  $('transport-state-value').textContent = safeText(agentState.transportState, 'not_connected');
  $('transport-host-value').textContent = transportHost.windowReady
    ? `Ready since ${formatTimestamp(transportHost.bootedAtIso)}`
    : 'Booting';
  $('transport-capability-value').textContent = safeText(transportHost.capability, 'workspace_preparation');
  $('worldstage-window-value').textContent = worldstageSite.open
    ? worldstageSite.visible
      ? 'Open'
      : 'Open in background'
    : 'Closed';
  $('worldstage-url-value').textContent = safeText(worldstageSite.url || worldstageSite.lastError, 'Unavailable');
  $('transport-host-result-value').textContent = safeText(transportState.lastHostResult, 'not_started');
  $('remote-status-value').textContent = safeText(transportState.lastRemoteStatusResult, 'not_started');
  $('remote-command-value').textContent = safeText(transportState.lastRemoteCommandResult, 'not_started');
  $('launch-on-login-value').textContent = launchOnLogin.lastError
    ? `Error: ${launchOnLogin.lastError}`
    : launchOnLogin.supported === false
      ? 'Unsupported'
      : launchOnLogin.enabled
        ? launchOnLogin.strategy === 'linux_autostart_desktop' && launchOnLogin.filePath
          ? `Enabled via ${launchOnLogin.filePath}`
          : 'Enabled'
        : 'Disabled';
  $('remote-report-value').textContent = safeText(transportState.lastRemoteReportResult, 'not_started');
  $('transport-note').textContent = safeText(summary.transportNote, '');

  $('queued-job-count').textContent = formatNumber(summary.queuedJobCount);
  $('running-job-count').textContent = formatNumber(summary.runningJobCount);
  $('blocked-job-count').textContent = formatNumber(summary.blockedJobCount);
  $('library-count').textContent = formatNumber(summary.libraryItemCount);
  $('device-id-value').textContent = safeText(summary.deviceId, 'Unavailable');

  $('config-path-value').textContent = safeText(paths.configPath, 'Unavailable');
  $('state-path-value').textContent = safeText(paths.statePath, 'Unavailable');
  $('workspace-root-value').textContent = safeText(paths.workspaceRootPath, 'Unavailable');
  $('update-current-version-value').textContent = safeText(updater.currentVersion, 'Unavailable');
  $('update-latest-version-value').textContent = safeText(updater.latestVersion, updater.currentVersion || 'Unknown');
  $('update-last-check-value').textContent = formatTimestamp(updater.lastCheckedAtIso);
  $('update-status-value').textContent = updaterStatusMessage(updater);
  $('update-note').textContent = updater.downloaded
    ? 'The update package is already on disk. Install it now or quit normally to let supported platforms apply it on exit.'
    : updater.lastResult === 'downloading_update'
      ? `Download progress: ${formatPercent(updater.progressPercent, '0%')} at ${formatBytes(updater.bytesPerSecond || 0, '0 B/s')}/s.`
      : updater.lastError
        ? `GitHub release checks failed: ${updater.lastError}`
        : updater.enabled
          ? 'Packaged desktop installs check the GitHub release channel and can apply supported updates without a manual reinstall.'
          : 'Dev builds stay on manual update flow. Packaged installs check GitHub releases automatically.';

  const running = summary.agentStatus === 'running';
  $('start-agent-button').disabled = running;
  $('stop-agent-button').disabled = !running;
  $('reload-worldstage-button').disabled = !worldstageSite.open;
  $('check-updates-button').disabled = updater.checking === true;
  $('install-update-button').disabled = updater.downloaded !== true;
}

function renderSetupChecklist(snapshot) {
  const container = $('setup-checklist');
  if (!container) return;
  container.replaceChildren();

  setupChecklistEntries(snapshot).forEach((entry) => {
    const row = document.createElement('article');
    row.className = 'setup-row';

    const status = document.createElement('span');
    status.className = entry.ready ? 'pill pill-ok' : 'pill pill-warn';
    status.textContent = entry.ready ? 'Ready' : 'Needs Setup';

    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = entry.label;
    const detail = document.createElement('p');
    detail.className = 'muted';
    detail.textContent = entry.detail;
    copy.append(title, detail);

    row.append(status, copy);
    container.appendChild(row);
  });
}

function renderJobs(snapshot) {
  const jobs = snapshot.state && Array.isArray(snapshot.state.jobs)
    ? snapshot.state.jobs
    : [];
  const container = $('job-list');
  container.replaceChildren();

  if (!jobs.length) {
    const empty = document.createElement('article');
    empty.className = 'empty-card';
    empty.textContent = 'No local download intents queued yet. Add one here now; website-issued intents land through the same queue later.';
    container.appendChild(empty);
    return;
  }

  jobs.forEach((job) => {
    const article = document.createElement('article');
    article.className = 'job-card';
    const isRunning = job.status === 'running';
    const canCancel = job.status === 'queued' || job.status === 'blocked' || job.status === 'running';
    const canRetry = job.status === 'blocked' || job.status === 'failed' || job.status === 'canceled';
    const canRemove = !isRunning && !(job.status === 'completed' && (job.localFilePath || job.seedAfterDownload !== false));

    const header = document.createElement('header');
    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = job.videoTitle || job.videoId || 'Untitled download intent';
    const subtitle = document.createElement('p');
    subtitle.className = 'muted mono';
    subtitle.textContent = job.videoId || 'video id pending';
    titleWrap.append(title, subtitle);

    const status = document.createElement('span');
    status.className = `chip status-${job.status}`;
    status.textContent = safeText(job.status, 'queued');
    header.append(titleWrap, status);

    const meta = document.createElement('div');
    meta.className = 'job-meta';
    [
      `Source: ${safeText(job.source, 'manual')}`,
      `Action: ${safeText(job.action, 'download_and_seed')}`,
      `Updated: ${formatTimestamp(job.updatedAtIso)}`,
      job.runnerState ? `Runner: ${job.runnerState}` : '',
      job.downloadId ? `Download: ${job.downloadId}` : '',
      job.sessionId ? `Session: ${job.sessionId}` : '',
      job.sessionStatus ? `Session status: ${job.sessionStatus}` : '',
      job.chunkCount ? `Chunks: ${formatNumber(job.verifiedChunkCount || 0)}/${formatNumber(job.chunkCount)}` : '',
      job.receivedBytes ? `Received: ${formatBytes(job.receivedBytes)}` : '',
      job.targetPeerId ? `Target peer: ${job.targetPeerId}` : '',
      job.channelId ? `Channel: ${job.channelId}` : '',
      job.remoteIntentId ? `Remote intent: ${job.remoteIntentId}` : '',
      job.workspacePath ? `Workspace: ${job.workspacePath}` : '',
      job.localFilePath ? `Local file: ${job.localFilePath}` : '',
      job.note ? `Note: ${job.note}` : ''
    ].filter(Boolean).forEach((label) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = label;
      meta.appendChild(chip);
    });

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const cancelButton = document.createElement('button');
    cancelButton.className = 'ghost action-button';
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = !canCancel;
    cancelButton.addEventListener('click', async () => {
      render(await window.worldstageClient.cancelJob({
        jobId: job.id
      }));
    });

    const retryButton = document.createElement('button');
    retryButton.className = 'secondary action-button';
    retryButton.type = 'button';
    retryButton.textContent = 'Retry';
    retryButton.disabled = !canRetry;
    retryButton.addEventListener('click', async () => {
      render(await window.worldstageClient.retryJob({
        jobId: job.id
      }));
    });

    const removeButton = document.createElement('button');
    removeButton.className = 'ghost action-button';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.disabled = !canRemove;
    removeButton.addEventListener('click', async () => {
      render(await window.worldstageClient.removeJob({
        jobId: job.id
      }));
    });

    actions.append(cancelButton, retryButton, removeButton);
    article.append(header, meta, actions);
    container.appendChild(article);
  });
}

function renderLibrary(snapshot) {
  const library = snapshot.state && Array.isArray(snapshot.state.library)
    ? snapshot.state.library
    : [];
  const container = $('library-list');
  container.replaceChildren();

  if (!library.length) {
    const empty = document.createElement('article');
    empty.className = 'empty-card';
    empty.textContent = 'Completed local copies appear here once the client assembles and registers them for background seeding.';
    container.appendChild(empty);
    return;
  }

  library.forEach((entry) => {
    const article = document.createElement('article');
    article.className = 'job-card';

    const header = document.createElement('header');
    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = entry.videoTitle || entry.fileName || entry.videoId || 'Untitled local copy';
    const subtitle = document.createElement('p');
    subtitle.className = 'muted mono';
    subtitle.textContent = entry.videoId || 'video id pending';
    titleWrap.append(title, subtitle);

    const status = document.createElement('span');
    status.className = `chip ${seedStateTone(entry.seedState)}`;
    status.textContent = safeText(entry.seedState, 'unknown');
    header.append(titleWrap, status);

    const meta = document.createElement('div');
    meta.className = 'job-meta';
    [
      entry.fileName ? `File: ${entry.fileName}` : '',
      entry.mimeType ? `Type: ${entry.mimeType}` : '',
      entry.sizeBytes ? `Size: ${formatBytes(entry.sizeBytes)}` : '',
      entry.chunkCount ? `Chunks: ${formatNumber(entry.chunkCount)} @ ${formatBytes(entry.chunkSize || 0)}` : '',
      entry.seedPeerId ? `Seed peer: ${entry.seedPeerId}` : '',
      entry.seedLastAnnouncedAtIso ? `Announced: ${formatTimestamp(entry.seedLastAnnouncedAtIso)}` : '',
      entry.localPath ? `Local file: ${entry.localPath}` : '',
      entry.manifestPath ? `Manifest: ${entry.manifestPath}` : '',
      entry.seedLastError ? `Seed note: ${entry.seedLastError}` : ''
    ].filter(Boolean).forEach((label) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = label;
      meta.appendChild(chip);
    });

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const openButton = document.createElement('button');
    openButton.className = 'ghost action-button';
    openButton.type = 'button';
    openButton.textContent = 'Open File';
    openButton.disabled = !entry.localPath;
    openButton.addEventListener('click', async () => {
      await window.worldstageClient.openPath({ path: entry.localPath });
    });

    const revealButton = document.createElement('button');
    revealButton.className = 'ghost action-button';
    revealButton.type = 'button';
    revealButton.textContent = 'Reveal';
    revealButton.disabled = !entry.localPath;
    revealButton.addEventListener('click', async () => {
      await window.worldstageClient.showItemInFolder({ path: entry.localPath });
    });

    const refreshButton = document.createElement('button');
    refreshButton.className = 'secondary action-button';
    refreshButton.type = 'button';
    refreshButton.textContent = 'Refresh Seed';
    refreshButton.addEventListener('click', async () => {
      render(await window.worldstageClient.refreshLibraryItem({
        videoId: entry.videoId,
        localPath: entry.localPath
      }));
    });

    const pauseResumeButton = document.createElement('button');
    pauseResumeButton.className = 'ghost action-button';
    pauseResumeButton.type = 'button';
    pauseResumeButton.textContent = entry.seedState === 'seed_paused' ? 'Resume' : 'Pause';
    pauseResumeButton.disabled = entry.seedState === 'local_only';
    pauseResumeButton.addEventListener('click', async () => {
      if (entry.seedState === 'seed_paused') {
        render(await window.worldstageClient.resumeLibraryItem({
          videoId: entry.videoId,
          localPath: entry.localPath
        }));
        return;
      }
      render(await window.worldstageClient.pauseLibraryItem({
        videoId: entry.videoId,
        localPath: entry.localPath
      }));
    });

    const removeButton = document.createElement('button');
    removeButton.className = 'ghost action-button';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', async () => {
      render(await window.worldstageClient.removeLibraryItem({
        videoId: entry.videoId,
        localPath: entry.localPath
      }));
    });

    actions.append(openButton, revealButton, refreshButton, pauseResumeButton, removeButton);
    article.append(header, meta, actions);
    container.appendChild(article);
  });
}

function render(snapshot) {
  state.snapshot = snapshot;
  renderConfig(snapshot);
  renderSummary(snapshot);
  renderSetupChecklist(snapshot);
  renderJobs(snapshot);
  renderLibrary(snapshot);
}

function configPayload() {
  return {
    deviceName: $('device-name').value,
    siteOrigin: $('site-origin').value,
    deviceToken: $('device-token').value,
    accountToken: $('account-token').value,
    pollIntervalMs: $('poll-interval').value,
    downloadDirectory: $('download-directory').value,
    backgroundOnClose: $('background-on-close').checked,
    launchOnLogin: $('launch-on-login').checked,
    autoStartAgent: $('auto-start-agent').checked
  };
}

function queuePayload() {
  return {
    videoId: $('job-video-id').value,
    videoTitle: $('job-video-title').value,
    channelId: $('job-channel-id').value,
    source: 'manual'
  };
}

async function bootstrap() {
  if (!window.worldstageClient) return;
  const snapshot = await window.worldstageClient.getState();
  render(snapshot);
  state.unsubscribe = window.worldstageClient.onStateChanged((nextSnapshot) => {
    render(nextSnapshot);
  });

  $('config-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = await window.worldstageClient.saveConfig(configPayload());
    render(next);
  });

  $('advanced-config-panel').addEventListener('toggle', () => {
    state.advancedConfigTouched = true;
  });

  $('job-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = await window.worldstageClient.enqueueDownloadJob(queuePayload());
    $('job-video-id').value = '';
    $('job-video-title').value = '';
    $('job-channel-id').value = '';
    render(next);
  });

  $('start-agent-button').addEventListener('click', async () => {
    render(await window.worldstageClient.startAgent());
  });

  $('open-worldstage-button').addEventListener('click', async () => {
    render(await window.worldstageClient.openWorldStage());
  });

  $('reload-worldstage-button').addEventListener('click', async () => {
    render(await window.worldstageClient.reloadWorldStage());
  });

  $('check-updates-button').addEventListener('click', async () => {
    render(await window.worldstageClient.checkForUpdates());
  });

  $('install-update-button').addEventListener('click', async () => {
    await window.worldstageClient.installUpdate();
  });

  $('open-release-page-button').addEventListener('click', async () => {
    render(await window.worldstageClient.openReleasePage());
  });

  $('stop-agent-button').addEventListener('click', async () => {
    render(await window.worldstageClient.stopAgent());
  });

  $('clear-finished-button').addEventListener('click', async () => {
    render(await window.worldstageClient.clearFinishedJobs());
  });

  $('open-downloads-button').addEventListener('click', async () => {
    await window.worldstageClient.openDownloadDirectory();
  });

  $('open-data-button').addEventListener('click', async () => {
    await window.worldstageClient.openUserDataDirectory();
  });

  $('apply-home-defaults-button').addEventListener('click', async () => {
    const saved = await window.worldstageClient.saveConfig({
      ...configPayload(),
      backgroundOnClose: true,
      launchOnLogin: true,
      autoStartAgent: true
    });
    const started = saved.summary && saved.summary.agentStatus === 'running'
      ? saved
      : await window.worldstageClient.startAgent();
    render(started);
  });

  $('apply-pairing-link-button').addEventListener('click', async () => {
    const link = $('pairing-link').value;
    const next = await window.worldstageClient.applyPairingLink({
      link
    });
    $('pairing-link').value = '';
    render(next);
  });

  $('paste-pairing-link-button').addEventListener('click', async () => {
    const clipboardText = await window.worldstageClient.readClipboardText();
    if (!clipboardText) return;
    $('pairing-link').value = clipboardText;
    $('pairing-link').focus();
    $('pairing-link').select();
  });
}

bootstrap().catch((error) => {
  console.error(error);
});
