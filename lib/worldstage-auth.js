'use strict';

function requestJson(url, options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const { fetchImpl: _ignored, ...requestOptions } = options;
  return fetchImpl(url, requestOptions).then(async (response) => {
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
  });
}

function normalizeAuthIdentifier(value) {
  return String(value || '').trim();
}

function buildAuthEndpointCandidates(siteOrigin, mode) {
  const origin = String(siteOrigin || '').trim();
  const normalizedMode = String(mode || '').trim();
  if (normalizedMode === 'register') {
    return [
      new URL('/api/worldstage/auth/register', origin).toString(),
      new URL('/api/worldstage/accounts', origin).toString()
    ];
  }
  return [
    new URL('/api/worldstage/auth/login', origin).toString(),
    new URL('/api/worldstage/accounts/login', origin).toString()
  ];
}

async function requestAuthAgainstCandidates(mode, siteOrigin, payload, fetchImpl) {
  const candidates = buildAuthEndpointCandidates(siteOrigin, mode);
  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const url = candidates[index];
    try {
      return await requestJson(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        fetchImpl
      });
    } catch (error) {
      lastError = error;
      const statusCode = Number(error && error.statusCode || 0);
      if (statusCode !== 404) throw error;
    }
  }
  throw lastError || new Error('auth_request_failed');
}

async function authenticateWorldStageAccount(options = {}) {
  const mode = String(options.mode || 'login').trim() === 'register' ? 'register' : 'login';
  const siteOrigin = String(options.siteOrigin || '').trim();
  const identifier = normalizeAuthIdentifier(options.identifier || options.email || options.username);
  const password = String(options.password || '');
  const passwordConfirm = String(options.passwordConfirm || '');
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;

  if (!siteOrigin) throw new Error('site_origin_unconfigured');
  if (!identifier || !password) throw new Error('auth_credentials_required');
  if (mode === 'register') {
    if (password.length < 8) throw new Error('password_too_short');
    if (password !== passwordConfirm) throw new Error('password_confirmation_mismatch');
  }

  const payload = await requestAuthAgainstCandidates(mode, siteOrigin, {
    email: identifier,
    username: identifier,
    password
  }, fetchImpl);

  const authToken = String(payload && payload.authToken || '').trim();
  if (!authToken) throw new Error('auth_token_missing');

  return {
    mode,
    account: payload && payload.account ? payload.account : null,
    authToken,
    channel: payload && payload.channel ? payload.channel : null
  };
}

module.exports = {
  authenticateWorldStageAccount,
  buildAuthEndpointCandidates,
  normalizeAuthIdentifier
};
