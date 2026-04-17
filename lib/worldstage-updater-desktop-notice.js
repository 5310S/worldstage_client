'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function buildReadyBody(previousVersion, latestVersion) {
  if (previousVersion && latestVersion) {
    return `Windows client ${previousVersion} downloaded ${latestVersion}. Click to open WorldStage Client and install it.`;
  }
  if (latestVersion) {
    return `Windows client update ${latestVersion} is ready. Click to open WorldStage Client and install it.`;
  }
  return 'A Windows client update is ready. Click to open WorldStage Client and install it.';
}

function buildErrorBody(lastError) {
  const errorText = normalizeText(lastError);
  if (!errorText) {
    return 'WorldStage Client could not complete the GitHub release update flow. Click to open the client and retry.';
  }
  return `WorldStage Client could not complete the GitHub release update flow: ${errorText}. Click to open the client and retry.`;
}

function buildWorldStageUpdaterDesktopNotice(input = {}) {
  const platform = normalizeText(input.platform);
  const previous = input && typeof input.previous === 'object' && input.previous
    ? input.previous
    : {};
  const current = input && typeof input.current === 'object' && input.current
    ? input.current
    : {};
  const previousLastResult = normalizeText(previous.lastResult);
  const currentLastResult = normalizeText(current.lastResult);
  const previousLatestVersion = normalizeText(previous.latestVersion);
  const currentLatestVersion = normalizeText(current.latestVersion);
  const previousLastError = normalizeText(previous.lastError);
  const currentLastError = normalizeText(current.lastError);

  if (platform !== 'win32') {
    return {
      visible: false,
      reason: 'unsupported_platform'
    };
  }

  if (current.enabled !== true) {
    return {
      visible: false,
      reason: normalizeText(current.disabledReason) || 'updater_disabled'
    };
  }

  if (current.downloaded === true && (
    previous.downloaded !== true
    || previousLatestVersion !== currentLatestVersion
    || previousLastResult !== 'update_downloaded'
  )) {
    return {
      visible: true,
      key: `ready:${currentLatestVersion || 'unknown'}`,
      title: currentLatestVersion
        ? `WorldStage Update ${currentLatestVersion} Ready`
        : 'WorldStage Update Ready',
      body: buildReadyBody(normalizeText(current.currentVersion), currentLatestVersion),
      clickAction: 'show'
    };
  }

  if (currentLastResult === 'update_error' && currentLastError && (
    previousLastResult !== 'update_error'
    || previousLastError !== currentLastError
  )) {
    return {
      visible: true,
      key: `error:${currentLastError}`,
      title: 'WorldStage Update Failed',
      body: buildErrorBody(currentLastError),
      clickAction: 'show'
    };
  }

  return {
    visible: false,
    reason: 'idle'
  };
}

module.exports = {
  buildWorldStageUpdaterDesktopNotice
};
