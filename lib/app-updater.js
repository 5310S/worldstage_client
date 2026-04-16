'use strict';

const { resolveWorldStageReleaseConfig } = require('./worldstage-release');

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeReleaseNotes(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry && entry.note))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

class WorldStageAppUpdater {
  constructor(options = {}) {
    this.autoUpdater = options.autoUpdater || null;
    this.app = options.app || null;
    this.shell = options.shell || null;
    this.env = options.env || process.env;
    this.platform = normalizeText(options.platform) || process.platform;
    this.currentVersion = normalizeText(options.currentVersion)
      || (this.app && typeof this.app.getVersion === 'function' ? normalizeText(this.app.getVersion()) : '');
    this.release = resolveWorldStageReleaseConfig(this.env);
    this.intervalMs = Math.max(60 * 1000, Number(options.intervalMs || DEFAULT_UPDATE_CHECK_INTERVAL_MS) || DEFAULT_UPDATE_CHECK_INTERVAL_MS);
    this.setInterval = typeof options.setInterval === 'function' ? options.setInterval : global.setInterval;
    this.clearInterval = typeof options.clearInterval === 'function' ? options.clearInterval : global.clearInterval;
    this.listeners = new Set();
    this.checkTimer = null;
    this.bound = false;
    this.state = this.buildInitialState(options);
  }

  buildInitialState(options = {}) {
    const isPackaged = options.isPackaged != null
      ? options.isPackaged === true
      : Boolean(this.app && this.app.isPackaged);
    const supportsAutoInstall = this.platform !== 'linux' || Boolean(normalizeText(this.env.APPIMAGE));
    let disabledReason = '';
    if (!this.autoUpdater) disabledReason = 'auto_updater_missing';
    else if (!isPackaged) disabledReason = 'packaged_build_required';
    return {
      enabled: disabledReason === '',
      disabledReason,
      supportsAutoInstall,
      currentVersion: this.currentVersion || '0.0.0',
      latestVersion: '',
      releaseName: '',
      releaseNotes: '',
      releaseDateIso: '',
      checking: false,
      available: false,
      downloaded: false,
      lastCheckedAtIso: '',
      lastDownloadedAtIso: '',
      lastResult: disabledReason === 'packaged_build_required'
        ? 'disabled_development_build'
        : disabledReason === 'auto_updater_missing'
          ? 'disabled_missing_updater'
          : 'idle',
      lastError: '',
      progressPercent: 0,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      releaseUrl: this.release.releasesUrl,
      repoUrl: this.release.repoUrl,
      releasesUrl: this.release.releasesUrl
    };
  }

  snapshot() {
    return {
      ...this.state,
      release: {
        ...this.release,
        downloads: {
          ...this.release.downloads
        }
      }
    };
  }

  onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitChange() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (_) {}
    }
    return snapshot;
  }

  setState(patch = {}) {
    this.state = {
      ...this.state,
      ...patch
    };
    return this.emitChange();
  }

  initialize() {
    if (!this.state.enabled || !this.autoUpdater) return this.snapshot();
    if (!this.bound) {
      this.bindAutoUpdaterEvents();
      this.bound = true;
    }
    this.autoUpdater.autoDownload = true;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.autoUpdater.allowPrerelease = false;
    this.autoUpdater.allowDowngrade = false;
    if (typeof this.autoUpdater.setFeedURL === 'function') {
      this.autoUpdater.setFeedURL({
        provider: 'github',
        owner: this.release.owner,
        repo: this.release.repo
      });
    }
    this.startSchedule();
    return this.setState({
      lastResult: 'ready',
      lastError: ''
    });
  }

  bindAutoUpdaterEvents() {
    if (!this.autoUpdater || typeof this.autoUpdater.on !== 'function') return;
    this.autoUpdater.on('checking-for-update', () => {
      this.setState({
        checking: true,
        lastError: '',
        lastResult: 'checking',
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        bytesPerSecond: 0
      });
    });
    this.autoUpdater.on('update-available', (info) => {
      this.setState({
        checking: false,
        available: true,
        downloaded: false,
        lastCheckedAtIso: nowIso(),
        latestVersion: normalizeText(info && info.version),
        releaseName: normalizeText(info && (info.releaseName || info.version)),
        releaseNotes: normalizeReleaseNotes(info && info.releaseNotes),
        releaseDateIso: normalizeText(info && (info.releaseDate || info.releaseDateIso || info.publishedAt)),
        releaseUrl: normalizeText(info && (info.releaseUrl || info.html_url || info.url)) || this.release.releasesUrl,
        lastResult: 'update_available',
        lastError: ''
      });
    });
    this.autoUpdater.on('update-not-available', (info) => {
      this.setState({
        checking: false,
        available: false,
        downloaded: false,
        lastCheckedAtIso: nowIso(),
        latestVersion: normalizeText(info && info.version) || this.state.currentVersion,
        releaseName: normalizeText(info && (info.releaseName || info.version)),
        releaseNotes: normalizeReleaseNotes(info && info.releaseNotes),
        releaseDateIso: normalizeText(info && (info.releaseDate || info.releaseDateIso || info.publishedAt)),
        progressPercent: 0,
        transferredBytes: 0,
        totalBytes: 0,
        bytesPerSecond: 0,
        lastResult: 'up_to_date',
        lastError: ''
      });
    });
    this.autoUpdater.on('download-progress', (progress) => {
      this.setState({
        checking: false,
        available: true,
        downloaded: false,
        progressPercent: Math.max(0, Math.min(100, Number(progress && progress.percent) || 0)),
        transferredBytes: Math.max(0, Number(progress && progress.transferred) || 0),
        totalBytes: Math.max(0, Number(progress && progress.total) || 0),
        bytesPerSecond: Math.max(0, Number(progress && progress.bytesPerSecond) || 0),
        lastResult: 'downloading_update',
        lastError: ''
      });
    });
    this.autoUpdater.on('update-downloaded', (info) => {
      this.setState({
        checking: false,
        available: true,
        downloaded: true,
        latestVersion: normalizeText(info && info.version) || this.state.latestVersion,
        releaseName: normalizeText(info && (info.releaseName || info.version)) || this.state.releaseName,
        releaseNotes: normalizeReleaseNotes(info && info.releaseNotes) || this.state.releaseNotes,
        releaseDateIso: normalizeText(info && (info.releaseDate || info.releaseDateIso || info.publishedAt)) || this.state.releaseDateIso,
        releaseUrl: normalizeText(info && (info.releaseUrl || info.html_url || info.url)) || this.state.releaseUrl || this.release.releasesUrl,
        lastDownloadedAtIso: nowIso(),
        progressPercent: 100,
        lastResult: 'update_downloaded',
        lastError: ''
      });
    });
    this.autoUpdater.on('error', (error) => {
      this.setState({
        checking: false,
        lastCheckedAtIso: nowIso(),
        lastResult: 'update_error',
        lastError: normalizeText(error && error.message ? error.message : error) || 'update_error'
      });
    });
  }

  startSchedule() {
    if (!this.state.enabled || typeof this.setInterval !== 'function' || this.checkTimer) return;
    this.checkTimer = this.setInterval(() => {
      this.checkForUpdates({
        manual: false
      }).catch(() => {});
    }, this.intervalMs);
  }

  stopSchedule() {
    if (!this.checkTimer || typeof this.clearInterval !== 'function') return;
    this.clearInterval(this.checkTimer);
    this.checkTimer = null;
  }

  async checkForUpdates(options = {}) {
    const manual = options && options.manual !== false;
    if (!this.state.enabled || !this.autoUpdater || typeof this.autoUpdater.checkForUpdates !== 'function') {
      return this.setState({
        lastResult: manual ? 'manual_check_unavailable' : this.state.lastResult,
        lastError: this.state.disabledReason || 'updates_unavailable'
      });
    }
    try {
      await this.autoUpdater.checkForUpdates();
      return this.snapshot();
    } catch (error) {
      return this.setState({
        checking: false,
        lastCheckedAtIso: nowIso(),
        lastResult: 'update_error',
        lastError: normalizeText(error && error.message ? error.message : error) || 'update_error'
      });
    }
  }

  quitAndInstall() {
    if (!this.autoUpdater || typeof this.autoUpdater.quitAndInstall !== 'function') {
      throw new Error('update_install_unavailable');
    }
    if (!this.state.downloaded) {
      throw new Error('update_not_downloaded');
    }
    this.autoUpdater.quitAndInstall();
    return this.setState({
      lastResult: 'installing_update',
      lastError: ''
    });
  }

  async openReleasePage() {
    if (!this.shell || typeof this.shell.openExternal !== 'function') {
      return this.setState({
        lastResult: 'release_page_unavailable',
        lastError: 'shell_unavailable'
      });
    }
    const targetUrl = this.state.releaseUrl || this.release.releasesUrl;
    await this.shell.openExternal(targetUrl);
    return this.setState({
      lastResult: 'release_page_opened',
      lastError: ''
    });
  }

  destroy() {
    this.stopSchedule();
    this.listeners.clear();
  }
}

module.exports = {
  DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  WorldStageAppUpdater
};
