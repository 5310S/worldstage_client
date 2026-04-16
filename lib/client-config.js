'use strict';

const os = require('os');
const path = require('path');

const MIN_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 10 * 60 * 1000;

function normalizeInteger(value, fallback, options = {}) {
  const parsed = Number.parseInt(String(value == null ? '' : value).trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  const min = Number.isFinite(options.min) ? options.min : Number.MIN_SAFE_INTEGER;
  const max = Number.isFinite(options.max) ? options.max : Number.MAX_SAFE_INTEGER;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function normalizeSiteOrigin(value, fallback = '') {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return fallback;
  try {
    const candidate = raw.includes('://') ? raw : `https://${raw}`;
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback;
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return fallback;
  }
}

function defaultClientConfig(options = {}) {
  const defaultDownloadDirectory = String(
    options.defaultDownloadDirectory || path.join(os.homedir(), 'Videos', 'WorldStage')
  ).trim();

  return {
    deviceName: `WorldStage Home on ${os.hostname()}`,
    siteOrigin: normalizeSiteOrigin(options.defaultSiteOrigin || 'https://5310s.com', 'https://5310s.com'),
    deviceToken: '',
    accountToken: '',
    pollIntervalMs: 15_000,
    backgroundOnClose: true,
    launchOnLogin: false,
    autoStartAgent: true,
    downloadDirectory: defaultDownloadDirectory
  };
}

function sanitizeClientConfig(input = {}, options = {}) {
  const defaults = defaultClientConfig(options);
  return {
    deviceName: String(input.deviceName || defaults.deviceName).trim() || defaults.deviceName,
    siteOrigin: normalizeSiteOrigin(input.siteOrigin, defaults.siteOrigin),
    deviceToken: String(input.deviceToken || '').trim(),
    accountToken: String(input.accountToken || '').trim(),
    pollIntervalMs: normalizeInteger(input.pollIntervalMs, defaults.pollIntervalMs, {
      min: MIN_POLL_INTERVAL_MS,
      max: MAX_POLL_INTERVAL_MS
    }),
    backgroundOnClose: Boolean(
      Object.prototype.hasOwnProperty.call(input, 'backgroundOnClose')
        ? input.backgroundOnClose
        : defaults.backgroundOnClose
    ),
    launchOnLogin: Boolean(
      Object.prototype.hasOwnProperty.call(input, 'launchOnLogin')
        ? input.launchOnLogin
        : defaults.launchOnLogin
    ),
    autoStartAgent: Boolean(
      Object.prototype.hasOwnProperty.call(input, 'autoStartAgent')
        ? input.autoStartAgent
        : defaults.autoStartAgent
    ),
    downloadDirectory: String(input.downloadDirectory || defaults.downloadDirectory).trim() || defaults.downloadDirectory
  };
}

module.exports = {
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  defaultClientConfig,
  normalizeSiteOrigin,
  sanitizeClientConfig
};
