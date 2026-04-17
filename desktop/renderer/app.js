'use strict';

const state = {
  snapshot: null,
  unsubscribe: null,
  supportPanelTouched: false,
  advancedConfigTouched: false,
  authMode: 'login',
  authBusy: false
};

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function setDisabled(id, disabled) {
  const node = $(id);
  if (node) node.disabled = Boolean(disabled);
}

function setHidden(id, hidden) {
  const node = $(id);
  if (node) node.hidden = Boolean(hidden);
}

function listen(id, eventName, handler) {
  const node = $(id);
  if (!node) return;
  node.addEventListener(eventName, handler);
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

function pairingStatusMessage(snapshot) {
  const config = snapshot.config || {};
  const runtime = snapshot.runtime || {};
  const pairing = runtime.pairing || {};

  if (config.deviceToken && config.accountToken) {
    return 'This Mac is already linked. You only need manual recovery if the website hand-off stops working.';
  }
  if (pairing.lastError) {
    return `Connection hand-off failed: ${pairing.lastError}`;
  }
  if (pairing.registered) {
    return 'The app can accept a WorldStage connection link automatically from the website or from your operating system.';
  }
  return 'Most people should never need this. If the website gives you a connection link, paste it here.';
}

function authGateVisible(snapshot) {
  const config = snapshot.config || {};
  return !String(config.accountToken || '').trim();
}

function setAuthMode(mode) {
  state.authMode = String(mode || '').trim() === 'register' ? 'register' : 'login';
  const registering = state.authMode === 'register';
  const loginButton = $('auth-mode-login');
  const registerButton = $('auth-mode-register');
  if (loginButton) loginButton.classList.toggle('auth-mode-active', !registering);
  if (registerButton) registerButton.classList.toggle('auth-mode-active', registering);
  setText('auth-title', registering ? 'Create your WorldStage account' : 'Sign in to WorldStage');
  setText('auth-copy', registering
    ? 'Create a WorldStage account so this computer can keep your downloads and seeding alive in the background.'
    : 'Sign in with your WorldStage account to connect this computer for background downloads and seeding.');
  setText('auth-identifier-label', registering ? 'Email' : 'Email or username');
  setHidden('auth-password-confirm-field', !registering);
  setText('auth-submit-button', registering ? 'Register' : 'Login');
  const passwordInput = $('auth-password');
  if (passwordInput) {
    passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
  }
}

function setAuthStatus(message, tone = '') {
  const node = $('auth-status');
  if (!node) return;
  node.textContent = String(message || '');
  node.classList.remove('auth-status-error', 'auth-status-ok');
  if (tone === 'error') node.classList.add('auth-status-error');
  if (tone === 'ok') node.classList.add('auth-status-ok');
}

function setAuthBusy(busy) {
  state.authBusy = Boolean(busy);
  setDisabled('auth-mode-login', busy);
  setDisabled('auth-mode-register', busy);
  setDisabled('auth-identifier', busy);
  setDisabled('auth-password', busy);
  setDisabled('auth-password-confirm', busy);
  setDisabled('auth-submit-button', busy);
}

function authPayload() {
  return {
    mode: state.authMode,
    identifier: $('auth-identifier').value,
    password: $('auth-password').value,
    passwordConfirm: $('auth-password-confirm').value
  };
}

function shouldAutoOpenAdvancedConfig(snapshot) {
  const config = snapshot.config || {};
  const runtime = snapshot.runtime || {};
  const pairing = runtime.pairing || {};
  if (pairing.lastResult === 'pairing_link_failed') return true;
  return !config.deviceToken && !config.accountToken && Boolean(pairing.lastError);
}

function shouldAutoOpenSupportPanel(snapshot) {
  const runtime = snapshot.runtime || {};
  const pairing = runtime.pairing || {};
  return Boolean(pairing.lastError);
}

function connectionOverview(snapshot) {
  const config = snapshot.config || {};
  const runtime = snapshot.runtime || {};
  const pairing = runtime.pairing || {};

  if (config.deviceToken && config.accountToken) {
    return {
      accountPill: 'Connected',
      accountPillClass: 'pill pill-ok',
      accountStatus: 'Signed in and linked',
      devicePill: 'Device Linked',
      devicePillClass: 'pill pill-ok',
      deviceStatus: 'Ready for website hand-off',
      note: 'This Mac is connected to WorldStage and can keep downloads and seeding alive in the background.'
    };
  }

  if (config.accountToken) {
    return {
      accountPill: 'Signed In',
      accountPillClass: 'pill pill-ok',
      accountStatus: 'Account connected',
      devicePill: 'Finishing Setup',
      devicePillClass: 'pill pill-warn',
      deviceStatus: 'Open WorldStage to finish linking this Mac',
      note: 'Your WorldStage account is connected. Open WorldStage once to complete the device hand-off if downloads are not appearing here yet.'
    };
  }

  if (pairing.lastError) {
    return {
      accountPill: 'Needs Attention',
      accountPillClass: 'pill pill-warn',
      accountStatus: 'Connection problem',
      devicePill: 'Retry Needed',
      devicePillClass: 'pill pill-warn',
      deviceStatus: 'Manual recovery available below',
      note: `We hit a sign-in or hand-off issue: ${pairing.lastError}. Open WorldStage and try again, or use the troubleshooting section below.`
    };
  }

  return {
    accountPill: 'Needs Sign In',
    accountPillClass: 'pill pill-warn',
    accountStatus: 'Not connected',
    devicePill: pairing.registered ? 'Ready To Link' : 'Waiting For Connection',
    devicePillClass: pairing.registered ? 'pill pill-neutral' : 'pill pill-neutral',
    deviceStatus: pairing.registered
      ? 'This app is ready for WorldStage to hand off background work'
      : 'Protocol hand-off is not confirmed yet',
    note: pairing.registered
      ? 'Open WorldStage to sign in or create an account. The website can pair with this app automatically.'
      : 'Open WorldStage to sign in or create an account. If the website does not hand off automatically, the troubleshooting section has a manual recovery path.'
  };
}

function backgroundOverview(snapshot) {
  const config = snapshot.config || {};
  const runtime = snapshot.runtime || {};
  const launchOnLogin = runtime.launchOnLogin || {};

  if (launchOnLogin.lastError) {
    return {
      pill: 'Needs Attention',
      pillClass: 'pill pill-warn',
      status: 'Autostart needs attention',
      note: `Launch on login could not be configured: ${launchOnLogin.lastError}`
    };
  }

  if (config.backgroundOnClose && config.autoStartAgent && (config.launchOnLogin || launchOnLogin.enabled)) {
    return {
      pill: 'Background Ready',
      pillClass: 'pill pill-ok',
      status: 'Automatic',
      note: 'The app stays alive after the window closes, starts background sync automatically, and relaunches with the computer.'
    };
  }

  if (config.backgroundOnClose && config.autoStartAgent) {
    return {
      pill: 'Mostly Ready',
      pillClass: 'pill pill-neutral',
      status: 'Runs in background after launch',
      note: 'Background work is on, but launch-on-login is disabled. You can turn it on in troubleshooting if you want hands-free restarts after reboot.'
    };
  }

  return {
    pill: 'Needs Setup',
    pillClass: 'pill pill-warn',
    status: 'Manual',
    note: 'Background behavior is partially disabled. Troubleshooting has the manual controls if you want to change it.'
  };
}

function readySeedCount(snapshot) {
  const library = snapshot.state && Array.isArray(snapshot.state.library)
    ? snapshot.state.library
    : [];
  return library.filter((entry) => {
    const seedState = String(entry && entry.seedState || '').trim();
    return seedState === 'ready_to_seed' || seedState === 'seeding' || seedState === 'seed_paused';
  }).length;
}

function activeDownloadCount(snapshot) {
  const jobs = snapshot.state && Array.isArray(snapshot.state.jobs)
    ? snapshot.state.jobs
    : [];
  return jobs.filter((job) => {
    const status = String(job && job.status || '').trim();
    return status === 'queued' || status === 'running' || status === 'blocked' || status === 'paused';
  }).length;
}

function activityNote(snapshot) {
  const activeDownloads = activeDownloadCount(snapshot);
  const savedFiles = snapshot.summary ? Number(snapshot.summary.libraryItemCount || 0) : 0;
  const seeds = readySeedCount(snapshot);
  if (activeDownloads > 0) {
    return `${formatNumber(activeDownloads)} background ${activeDownloads === 1 ? 'job is' : 'jobs are'} active right now.`;
  }
  if (savedFiles > 0 && seeds > 0) {
    return `${formatNumber(savedFiles)} saved ${savedFiles === 1 ? 'file is' : 'files are'} available locally, and ${formatNumber(seeds)} ${seeds === 1 ? 'copy is' : 'copies are'} ready to help seed.`;
  }
  if (savedFiles > 0) {
    return `${formatNumber(savedFiles)} saved ${savedFiles === 1 ? 'file is' : 'files are'} available locally.`;
  }
  return 'Downloads you start from WorldStage show up here automatically. Completed files stay available for background seeding.';
}

function renderConfig(snapshot) {
  const config = snapshot.config || {};
  const supportPanel = $('support-panel');
  const advancedPanel = $('advanced-config-panel');

  if ($('device-name')) $('device-name').value = config.deviceName || '';
  if ($('site-origin')) $('site-origin').value = config.siteOrigin || '';
  if ($('device-token')) $('device-token').value = config.deviceToken || '';
  if ($('account-token')) $('account-token').value = config.accountToken || '';
  if ($('poll-interval')) $('poll-interval').value = String(config.pollIntervalMs || 15000);
  if ($('download-directory')) $('download-directory').value = config.downloadDirectory || '';
  if ($('background-on-close')) $('background-on-close').checked = Boolean(config.backgroundOnClose);
  if ($('launch-on-login')) $('launch-on-login').checked = Boolean(config.launchOnLogin);
  if ($('auto-start-agent')) $('auto-start-agent').checked = Boolean(config.autoStartAgent);
  setText('pairing-status', pairingStatusMessage(snapshot));

  if (supportPanel && !state.supportPanelTouched) {
    supportPanel.open = shouldAutoOpenSupportPanel(snapshot);
  }
  if (advancedPanel && !state.advancedConfigTouched) {
    advancedPanel.open = shouldAutoOpenAdvancedConfig(snapshot);
  }
}

function renderAuthGate(snapshot) {
  const locked = authGateVisible(snapshot);
  setHidden('auth-shell', !locked);
  setHidden('app-shell', locked);
  if (!locked) {
    setAuthStatus('', '');
    return;
  }
  setAuthMode(state.authMode);
}

function renderSummary(snapshot) {
  const summary = snapshot.summary || {};
  const agentState = snapshot.state && snapshot.state.agent ? snapshot.state.agent : {};
  const runtime = snapshot.runtime || {};
  const transportState = snapshot.state && snapshot.state.transport ? snapshot.state.transport : {};
  const worldstageSite = runtime.worldstageSite || {};
  const launchOnLogin = runtime.launchOnLogin || {};
  const updater = runtime.updater || {};
  const paths = snapshot.paths || {};

  const connection = connectionOverview(snapshot);
  const background = backgroundOverview(snapshot);

  if ($('account-pill')) {
    $('account-pill').className = connection.accountPillClass;
    $('account-pill').textContent = connection.accountPill;
  }
  if ($('device-pill')) {
    $('device-pill').className = connection.devicePillClass;
    $('device-pill').textContent = connection.devicePill;
  }
  if ($('background-pill')) {
    $('background-pill').className = background.pillClass;
    $('background-pill').textContent = background.pill;
  }

  setText('account-status-value', connection.accountStatus);
  setText('device-status-value', connection.deviceStatus);
  setText('background-mode-value', background.status);
  setText('last-sync-value', safeText(agentState.lastSyncResult, 'not_started'));
  setText('account-note', connection.note);

  setText('active-downloads-value', formatNumber(activeDownloadCount(snapshot)));
  setText('ready-seed-count-value', formatNumber(readySeedCount(snapshot)));
  setText('saved-files-value', formatNumber(summary.libraryItemCount || 0));
  setText('download-folder-value', safeText(summary.downloadDirectory, 'Unavailable'));
  setText('activity-note', activityNote(snapshot));

  setText('site-origin-value', safeText(summary.siteOrigin, 'Unconfigured'));
  setText('worldstage-window-value', worldstageSite.open
    ? worldstageSite.visible
      ? 'Open'
      : 'Open in background'
    : 'Closed');
  setText('worldstage-url-value', safeText(worldstageSite.url || worldstageSite.lastError, 'Unavailable'));
  setText('transport-state-value', safeText(agentState.transportState, 'not_connected'));
  setText('remote-status-value', safeText(transportState.lastRemoteStatusResult, 'not_started'));
  setText('remote-command-value', safeText(transportState.lastRemoteCommandResult, 'not_started'));
  setText('remote-report-value', safeText(transportState.lastRemoteReportResult, 'not_started'));
  setText('launch-on-login-value', launchOnLogin.lastError
    ? `Error: ${launchOnLogin.lastError}`
    : launchOnLogin.supported === false
      ? 'Unsupported'
      : launchOnLogin.enabled
        ? launchOnLogin.strategy === 'linux_autostart_desktop' && launchOnLogin.filePath
          ? `Enabled via ${launchOnLogin.filePath}`
          : 'Enabled'
        : 'Disabled');
  setText('config-path-value', safeText(paths.configPath, 'Unavailable'));
  setText('state-path-value', safeText(paths.statePath, 'Unavailable'));
  setText('workspace-root-value', safeText(paths.workspaceRootPath, 'Unavailable'));

  setText('update-current-version-value', safeText(updater.currentVersion, 'Unavailable'));
  setText('update-latest-version-value', safeText(updater.latestVersion, updater.currentVersion || 'Unknown'));
  setText('update-last-check-value', formatTimestamp(updater.lastCheckedAtIso));
  setText('update-status-value', updaterStatusMessage(updater));
  setText('update-note', updater.downloaded
    ? 'The update package is already on disk. Install it now or quit normally to let supported platforms apply it on exit.'
    : updater.lastResult === 'downloading_update'
      ? `Download progress: ${formatPercent(updater.progressPercent, '0%')} at ${formatBytes(updater.bytesPerSecond || 0, '0 B/s')}/s.`
      : updater.lastError
        ? `GitHub release checks failed: ${updater.lastError}`
        : updater.enabled
          ? 'Packaged installs check the GitHub release channel in the background.'
          : 'Dev builds stay on a manual update flow. Packaged installs check GitHub releases automatically.');

  const running = summary.agentStatus === 'running';
  setDisabled('start-agent-button', running);
  setDisabled('stop-agent-button', !running);
  setDisabled('reload-worldstage-button', !worldstageSite.open);
  setDisabled('check-updates-button', updater.checking === true);
  setDisabled('install-update-button', updater.downloaded !== true);
}

function renderJobs(snapshot) {
  const jobs = snapshot.state && Array.isArray(snapshot.state.jobs)
    ? snapshot.state.jobs
    : [];
  const container = $('job-list');
  if (!container) return;
  container.replaceChildren();

  if (!jobs.length) {
    const empty = document.createElement('article');
    empty.className = 'empty-card';
    empty.textContent = 'No downloads yet. Start something from WorldStage and it will appear here automatically.';
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
    title.textContent = job.videoTitle || job.videoId || 'Untitled download';
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
      `Source: ${safeText(job.source, 'worldstage')}`,
      `Updated: ${formatTimestamp(job.updatedAtIso)}`,
      job.runnerState ? `Stage: ${job.runnerState}` : '',
      job.downloadId ? `Download: ${job.downloadId}` : '',
      job.sessionStatus ? `Session: ${job.sessionStatus}` : '',
      job.chunkCount ? `Chunks: ${formatNumber(job.verifiedChunkCount || 0)}/${formatNumber(job.chunkCount)}` : '',
      job.receivedBytes ? `Received: ${formatBytes(job.receivedBytes)}` : '',
      job.localFilePath ? `Saved: ${job.localFilePath}` : '',
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
  if (!container) return;
  container.replaceChildren();

  if (!library.length) {
    const empty = document.createElement('article');
    empty.className = 'empty-card';
    empty.textContent = 'Completed files will appear here once WorldStage finishes saving them on this Mac.';
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
      entry.sizeBytes ? `Size: ${formatBytes(entry.sizeBytes)}` : '',
      entry.chunkCount ? `Chunks: ${formatNumber(entry.chunkCount)}` : '',
      entry.seedPeerId ? `Seed peer: ${entry.seedPeerId}` : '',
      entry.seedLastAnnouncedAtIso ? `Announced: ${formatTimestamp(entry.seedLastAnnouncedAtIso)}` : '',
      entry.localPath ? `Saved: ${entry.localPath}` : '',
      entry.seedLastError ? `Note: ${entry.seedLastError}` : ''
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
  renderAuthGate(snapshot);
  renderConfig(snapshot);
  renderSummary(snapshot);
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

async function bootstrap() {
  if (!window.worldstageClient) return;
  const snapshot = await window.worldstageClient.getState();
  setAuthMode('login');
  render(snapshot);
  state.unsubscribe = window.worldstageClient.onStateChanged((nextSnapshot) => {
    render(nextSnapshot);
  });

  listen('auth-mode-login', 'click', () => {
    setAuthMode('login');
    setAuthStatus('', '');
  });

  listen('auth-mode-register', 'click', () => {
    setAuthMode('register');
    setAuthStatus('', '');
  });

  listen('auth-form', 'submit', async (event) => {
    event.preventDefault();
    setAuthBusy(true);
    setAuthStatus('', '');
    try {
      const result = await window.worldstageClient.authenticateAccount(authPayload());
      if ($('auth-password')) $('auth-password').value = '';
      if ($('auth-password-confirm')) $('auth-password-confirm').value = '';
      setAuthStatus(state.authMode === 'register' ? 'Account created.' : 'Signed in.', 'ok');
      render(result.snapshot);
    } catch (error) {
      const message = String(error && error.message ? error.message : 'request_failed');
      setAuthStatus(message, 'error');
    } finally {
      setAuthBusy(false);
    }
  });

  listen('config-form', 'submit', async (event) => {
    event.preventDefault();
    const next = await window.worldstageClient.saveConfig(configPayload());
    render(next);
  });

  listen('support-panel', 'toggle', () => {
    state.supportPanelTouched = true;
  });

  listen('advanced-config-panel', 'toggle', () => {
    state.advancedConfigTouched = true;
  });

  listen('open-worldstage-button', 'click', async () => {
    render(await window.worldstageClient.openWorldStage({
      path: '/worldstage'
    }));
  });

  listen('reload-worldstage-button', 'click', async () => {
    render(await window.worldstageClient.reloadWorldStage());
  });

  listen('open-downloads-button', 'click', async () => {
    await window.worldstageClient.openDownloadDirectory();
  });

  listen('open-data-button', 'click', async () => {
    await window.worldstageClient.openUserDataDirectory();
  });

  listen('start-agent-button', 'click', async () => {
    render(await window.worldstageClient.startAgent());
  });

  listen('stop-agent-button', 'click', async () => {
    render(await window.worldstageClient.stopAgent());
  });

  listen('check-updates-button', 'click', async () => {
    render(await window.worldstageClient.checkForUpdates());
  });

  listen('install-update-button', 'click', async () => {
    await window.worldstageClient.installUpdate();
  });

  listen('open-release-page-button', 'click', async () => {
    render(await window.worldstageClient.openReleasePage());
  });

  listen('clear-finished-button', 'click', async () => {
    render(await window.worldstageClient.clearFinishedJobs());
  });

  listen('apply-pairing-link-button', 'click', async () => {
    const link = $('pairing-link').value;
    const next = await window.worldstageClient.applyPairingLink({
      link
    });
    $('pairing-link').value = '';
    render(next);
  });

  listen('paste-pairing-link-button', 'click', async () => {
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
