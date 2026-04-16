'use strict';

const { normalizeSiteOrigin } = require('./client-config');

const PAIRING_PROTOCOL = 'worldstage:';
const HTTPS_PAIRING_PATHS = new Set([
  '/worldstage/client/connect',
  '/worldstage/connect'
]);
const CUSTOM_PAIRING_TARGETS = new Set([
  'pair',
  'connect'
]);

function normalizeLinkValue(value) {
  const raw = String(value || '').trim();
  return raw.replace(/^['"]|['"]$/g, '').trim();
}

function queryValue(searchParams, ...keys) {
  for (const key of keys) {
    const value = String(searchParams.get(key) || '').trim();
    if (value) return value;
  }
  return '';
}

function queryBoolean(searchParams, ...keys) {
  for (const key of keys) {
    if (!searchParams.has(key)) continue;
    const raw = String(searchParams.get(key) || '').trim().toLowerCase();
    if (!raw) return true;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  }
  return undefined;
}

function isCustomPairingUrl(url) {
  if (!url || url.protocol !== PAIRING_PROTOCOL) return false;
  const host = String(url.hostname || '').trim().toLowerCase();
  const pathSegments = String(url.pathname || '')
    .split('/')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (host && CUSTOM_PAIRING_TARGETS.has(host)) return true;
  return pathSegments.some((segment) => CUSTOM_PAIRING_TARGETS.has(segment));
}

function isHttpsPairingUrl(url) {
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return false;
  return HTTPS_PAIRING_PATHS.has(String(url.pathname || '').trim().toLowerCase());
}

function isPairingLink(value) {
  const raw = normalizeLinkValue(value);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return isCustomPairingUrl(url) || isHttpsPairingUrl(url);
  } catch (_) {
    return false;
  }
}

function extractPairingLinkFromArgv(argv = []) {
  for (const entry of Array.isArray(argv) ? argv : []) {
    const raw = normalizeLinkValue(entry);
    if (!raw) continue;
    if (isPairingLink(raw)) return raw;
  }
  return '';
}

function parsePairingLink(value, options = {}) {
  const raw = normalizeLinkValue(value);
  if (!raw) throw new Error('pairing_link_required');

  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw new Error('invalid_pairing_link');
  }

  if (!isCustomPairingUrl(url) && !isHttpsPairingUrl(url)) {
    throw new Error('unsupported_pairing_link');
  }

  const searchParams = url.searchParams;
  const fallbackOrigin = normalizeSiteOrigin(options.defaultSiteOrigin || '', '');
  const siteOrigin = normalizeSiteOrigin(
    queryValue(searchParams, 'siteOrigin', 'site_origin')
      || (isHttpsPairingUrl(url) ? url.origin : fallbackOrigin),
    fallbackOrigin
  );
  const deviceToken = queryValue(searchParams, 'deviceToken', 'device_token', 'token');
  const accountToken = queryValue(searchParams, 'accountToken', 'account_token', 'bearer');
  const pairingCode = queryValue(searchParams, 'pairingCode', 'pairing_code', 'code');
  const deviceName = queryValue(searchParams, 'deviceName', 'device_name');
  const downloadDirectory = queryValue(searchParams, 'downloadDirectory', 'download_directory');
  const backgroundOnClose = queryBoolean(searchParams, 'backgroundOnClose', 'background_on_close');
  const launchOnLogin = queryBoolean(searchParams, 'launchOnLogin', 'launch_on_login');
  const autoStartAgent = queryBoolean(searchParams, 'autoStartAgent', 'auto_start_agent');

  if (!siteOrigin && !pairingCode && !deviceToken && !accountToken && !deviceName && !downloadDirectory) {
    throw new Error('pairing_link_payload_missing');
  }

  return {
    raw,
    sourceProtocol: String(url.protocol || '').trim(),
    siteOrigin,
    pairingCode,
    deviceToken,
    accountToken,
    deviceName,
    downloadDirectory,
    backgroundOnClose,
    launchOnLogin,
    autoStartAgent
  };
}

function pairingConfigUpdate(parsed = {}) {
  const next = {};
  if (parsed.siteOrigin) next.siteOrigin = parsed.siteOrigin;
  if (parsed.deviceToken) next.deviceToken = parsed.deviceToken;
  if (parsed.accountToken) next.accountToken = parsed.accountToken;
  if (parsed.deviceName) next.deviceName = parsed.deviceName;
  if (parsed.downloadDirectory) next.downloadDirectory = parsed.downloadDirectory;
  if (typeof parsed.backgroundOnClose === 'boolean') next.backgroundOnClose = parsed.backgroundOnClose;
  if (typeof parsed.launchOnLogin === 'boolean') next.launchOnLogin = parsed.launchOnLogin;
  if (typeof parsed.autoStartAgent === 'boolean') next.autoStartAgent = parsed.autoStartAgent;
  return next;
}

function buildPairingClaimUrl(siteOrigin) {
  return new URL('/api/worldstage/client/pair/claim', String(siteOrigin || '').trim()).toString();
}

async function claimPairingLink(parsed = {}, options = {}) {
  const pairingCode = queryValue(new URLSearchParams({
    pairingCode: String(parsed.pairingCode || '').trim()
  }), 'pairingCode');
  const siteOrigin = normalizeSiteOrigin(parsed.siteOrigin || options.defaultSiteOrigin || '', '');
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  const deviceName = String(options.deviceName || parsed.deviceName || '').trim();

  if (!pairingCode) throw new Error('pairing_code_required');
  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const response = await fetchImpl(buildPairingClaimUrl(siteOrigin), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      pairingCode,
      deviceName
    })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(String(payload.error || `pairing_claim_status_${response.status}`));
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    siteOrigin: normalizeSiteOrigin(payload.siteOrigin || siteOrigin, siteOrigin),
    deviceId: String(payload.deviceId || payload.device && payload.device.id || '').trim(),
    deviceToken: String(payload.deviceToken || '').trim(),
    accountToken: String(payload.accountToken || '').trim(),
    deviceName: String(payload.device && payload.device.name || deviceName || parsed.deviceName || '').trim()
  };
}

module.exports = {
  CUSTOM_PAIRING_TARGETS,
  HTTPS_PAIRING_PATHS,
  PAIRING_PROTOCOL,
  buildPairingClaimUrl,
  claimPairingLink,
  extractPairingLinkFromArgv,
  isPairingLink,
  pairingConfigUpdate,
  parsePairingLink
};
