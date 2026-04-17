'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function clippedReleaseNotes(value) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= 180) return text;
  return `${text.slice(0, 177).trim()}...`;
}

function isDashboardPath(pathname) {
  const value = normalizeText(pathname);
  if (!value) return true;
  if (!value.startsWith('/worldstage')) return false;
  return !value.startsWith('/worldstage-login');
}

function buildWorldStageSiteUpdaterBannerModel(input = {}) {
  const platform = normalizeText(input.platform);
  const pathname = normalizeText(input.pathname);
  const updater = input && typeof input.updater === 'object' && input.updater
    ? input.updater
    : {};
  const latestVersion = normalizeText(updater.latestVersion);
  const currentVersion = normalizeText(updater.currentVersion);
  const releaseNotes = clippedReleaseNotes(updater.releaseNotes);
  const releaseUrl = normalizeText(updater.releaseUrl || updater.releasesUrl || updater.repoUrl);
  const progressPercent = Math.max(0, Math.min(100, Number(updater.progressPercent) || 0));

  if (platform !== 'win32') {
    return {
      visible: false,
      reason: 'unsupported_platform'
    };
  }

  if (!isDashboardPath(pathname)) {
    return {
      visible: false,
      reason: 'non_dashboard_route'
    };
  }

  if (updater.enabled !== true) {
    return {
      visible: false,
      reason: normalizeText(updater.disabledReason) || 'updater_disabled'
    };
  }

  if (updater.downloaded === true) {
    return {
      visible: true,
      tone: 'ready',
      title: latestVersion
        ? `Update ${latestVersion} Ready`
        : 'Update Ready',
      message: currentVersion && latestVersion
        ? `Windows client ${currentVersion} downloaded ${latestVersion} from GitHub and can install it now.`
        : 'The Windows client downloaded the latest GitHub release and can install it now.',
      details: releaseNotes,
      progressPercent: 100,
      primaryAction: {
        id: 'install',
        label: 'Install Update'
      },
      secondaryAction: releaseUrl
        ? {
            id: 'release',
            label: 'GitHub Release'
          }
        : null
    };
  }

  if (updater.lastResult === 'downloading_update' || updater.lastResult === 'update_available' || updater.available === true) {
    return {
      visible: true,
      tone: 'info',
      title: latestVersion
        ? `Downloading ${latestVersion}`
        : 'Downloading Update',
      message: progressPercent > 0
        ? `The Windows client is downloading the latest GitHub release in the background (${progressPercent}%).`
        : 'The Windows client found a newer GitHub release and is downloading it in the background.',
      details: releaseNotes,
      progressPercent,
      primaryAction: null,
      secondaryAction: releaseUrl
        ? {
            id: 'release',
            label: 'GitHub Release'
          }
        : null
    };
  }

  if (updater.lastResult === 'update_error' && normalizeText(updater.lastError)) {
    return {
      visible: true,
      tone: 'error',
      title: 'Update Check Failed',
      message: 'The Windows client could not complete the GitHub release update flow.',
      details: normalizeText(updater.lastError),
      progressPercent: 0,
      primaryAction: {
        id: 'retry',
        label: 'Retry'
      },
      secondaryAction: releaseUrl
        ? {
            id: 'release',
            label: 'GitHub Release'
          }
        : null
    };
  }

  return {
    visible: false,
    reason: 'idle'
  };
}

module.exports = {
  buildWorldStageSiteUpdaterBannerModel
};
