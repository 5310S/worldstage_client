'use strict';

const { normalizeSiteOrigin } = require('./client-config');

function buildWorldStageSiteUrl(siteOrigin, pathname = '/worldstage') {
  const origin = normalizeSiteOrigin(siteOrigin, 'https://5310s.com');
  const base = new URL(origin);
  const nextPath = String(pathname || '/worldstage').trim() || '/worldstage';
  return new URL(nextPath.startsWith('/') ? nextPath : `/${nextPath}`, base).toString();
}

function isWorldStageSiteUrlAllowed(siteOrigin, candidateUrl) {
  const origin = normalizeSiteOrigin(siteOrigin, 'https://5310s.com');
  const raw = String(candidateUrl || '').trim();
  if (!raw) return false;
  try {
    const base = new URL(origin);
    const candidate = new URL(raw, base);
    return candidate.origin === base.origin;
  } catch (_) {
    return false;
  }
}

function snapshotWorldStageSiteState(input = {}) {
  return {
    open: Boolean(input.open),
    visible: Boolean(input.visible),
    url: String(input.url || '').trim(),
    title: String(input.title || '').trim(),
    lastOpenedAtIso: String(input.lastOpenedAtIso || '').trim(),
    lastNavigationAtIso: String(input.lastNavigationAtIso || '').trim(),
    lastError: String(input.lastError || '').trim()
  };
}

module.exports = {
  buildWorldStageSiteUrl,
  isWorldStageSiteUrlAllowed,
  snapshotWorldStageSiteState
};
