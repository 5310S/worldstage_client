'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { normalizeSiteOrigin } = require('./client-config');

const WORLDSTAGE_AUTH_COOKIE = 'worldstage_auth_token';
const WORLDSTAGE_CSRF_COOKIE = 'worldstage_csrf_token';
const WORLDSTAGE_LOGIN_PATH = '/worldstage-login';
const WORLDSTAGE_APP_PATH = '/worldstage';
const WORLDSTAGE_AUTH_RATE_LIMIT_MAX = 30;
const WORLDSTAGE_SESSION_TTL_SECS = 600;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function cacheControlFor(filePath) {
  return path.extname(filePath).toLowerCase() === '.html'
    ? 'no-store, must-revalidate'
    : 'public, max-age=300';
}

function siteHtmlContentSecurityPolicy() {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' blob: https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' http: https: ws: wss:",
    "media-src 'self' data: blob: https:",
    "worker-src 'self' blob:"
  ].join('; ');
}

function send(res, status, headers, body) {
  const outHeaders = Object.assign({
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  }, headers || {});
  const contentType = String(outHeaders['Content-Type'] || outHeaders['content-type'] || '').toLowerCase();
  if (contentType.startsWith('text/html') && !outHeaders['Content-Security-Policy'] && !outHeaders['content-security-policy']) {
    outHeaders['Content-Security-Policy'] = siteHtmlContentSecurityPolicy();
  }
  res.writeHead(status, outHeaders);
  res.end(body);
}

function redirect(res, status, location) {
  send(res, status, {
    Location: location,
    'Cache-Control': 'no-store'
  }, '');
}

function sendJson(res, status, obj) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(obj));
}

function parseCookies(req) {
  const raw = req.headers.cookie;
  if (!raw || typeof raw !== 'string') return {};
  const out = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function decodedCookieValue(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch (_) {
    return raw.trim();
  }
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let exceeded = false;
    req.on('data', (chunk) => {
      if (exceeded) return;
      total += chunk.length;
      if (total > maxBytes) {
        exceeded = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (exceeded) {
        reject(new Error('payload too large'));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return req.socket && req.socket.remoteAddress
    ? req.socket.remoteAddress
    : 'unknown';
}

function allowRateWithState(state, ip, maxPerMinute) {
  const now = Date.now();
  const record = state.get(ip);
  if (!record || now >= record.resetAt) {
    state.set(ip, { resetAt: now + RATE_LIMIT_WINDOW_MS, count: 1 });
    return true;
  }
  if (record.count >= maxPerMinute) return false;
  record.count += 1;
  return true;
}

function requestIsSecure(req) {
  return Boolean(req.socket && req.socket.encrypted);
}

function appendResponseCookie(res, cookieValue) {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookieValue);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', current.concat(cookieValue));
    return;
  }
  res.setHeader('Set-Cookie', [current, cookieValue]);
}

function worldStageCookieAttributes(req, maxAgeSecs) {
  const attrs = [
    'Path=/',
    'SameSite=Strict'
  ];
  if (Number.isFinite(maxAgeSecs) && maxAgeSecs >= 0) {
    attrs.push(`Max-Age=${Math.floor(maxAgeSecs)}`);
  }
  if (requestIsSecure(req)) attrs.push('Secure');
  return attrs;
}

function worldStageSessionNormalizeEntry(sessionId, entry, nowMs) {
  const id = String(sessionId || '').trim();
  if (!id || !id.startsWith('wss_') || !entry || typeof entry !== 'object') return null;
  const token = String(entry.token || '').trim();
  const rawCsrfToken = String(entry.csrfToken || '').trim();
  const csrfToken = /^wscs_[a-f0-9]+$/i.test(rawCsrfToken) ? rawCsrfToken.toLowerCase() : '';
  const createdAt = Number(entry.createdAt) || 0;
  const expiresAt = Number(entry.expiresAt) || 0;
  const lastSeenAt = Number(entry.lastSeenAt) || createdAt || 0;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!token || !createdAt || !expiresAt || expiresAt <= now) return null;
  return {
    id,
    token,
    csrfToken,
    createdAt,
    expiresAt,
    lastSeenAt
  };
}

class WorldStageLocalServer {
  constructor(options = {}) {
    this.fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : globalThis.fetch;
    this.host = String(options.host || '127.0.0.1').trim() || '127.0.0.1';
    this.port = Math.max(0, Math.trunc(Number(options.port || 0) || 0));
    this.assetsDirectory = path.resolve(options.assetsDirectory || path.join(__dirname, '..', 'desktop', 'worldstage'));
    this.sessionStatePath = path.resolve(options.sessionStatePath || path.join(process.cwd(), 'worldstage-browser-sessions.json'));
    this.sessionTtlSecs = Math.max(60, Math.trunc(Number(options.sessionTtlSecs || WORLDSTAGE_SESSION_TTL_SECS) || WORLDSTAGE_SESSION_TTL_SECS));
    this.authRateLimitMax = Math.max(1, Math.trunc(Number(options.authRateLimitMax || WORLDSTAGE_AUTH_RATE_LIMIT_MAX) || WORLDSTAGE_AUTH_RATE_LIMIT_MAX));
    this.getSiteOrigin = typeof options.getSiteOrigin === 'function'
      ? options.getSiteOrigin
      : () => options.siteOrigin;
    this.getDesktopAuthToken = typeof options.getDesktopAuthToken === 'function'
      ? options.getDesktopAuthToken
      : () => options.desktopAuthToken;
    this.onAuthToken = typeof options.onAuthToken === 'function' ? options.onAuthToken : null;
    this.onClearAuthToken = typeof options.onClearAuthToken === 'function' ? options.onClearAuthToken : null;
    this.server = null;
    this.authRateState = new Map();
    this.sessions = this.loadSessionState();
    this.handleRequest = this.handleRequest.bind(this);
  }

  currentSiteOrigin() {
    return normalizeSiteOrigin(this.getSiteOrigin(), 'https://5310s.com');
  }

  getBaseUrl() {
    return this.server && this.port > 0 ? `http://${this.host}:${this.port}` : '';
  }

  loadSessionState() {
    const sessions = new Map();
    try {
      if (!fs.existsSync(this.sessionStatePath)) return sessions;
      const parsed = JSON.parse(fs.readFileSync(this.sessionStatePath, 'utf8'));
      const entries = parsed && parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {};
      const now = Date.now();
      for (const [sessionId, entry] of Object.entries(entries)) {
        const normalized = worldStageSessionNormalizeEntry(sessionId, entry, now);
        if (!normalized) continue;
        sessions.set(normalized.id, {
          token: normalized.token,
          csrfToken: normalized.csrfToken,
          createdAt: normalized.createdAt,
          expiresAt: normalized.expiresAt,
          lastSeenAt: normalized.lastSeenAt
        });
      }
    } catch (_) {
      return new Map();
    }
    return sessions;
  }

  persistSessions() {
    const serialized = {};
    const now = Date.now();
    for (const [sessionId, entry] of this.sessions.entries()) {
      const normalized = worldStageSessionNormalizeEntry(sessionId, entry, now);
      if (!normalized) continue;
      serialized[normalized.id] = {
        token: normalized.token,
        csrfToken: normalized.csrfToken,
        createdAt: normalized.createdAt,
        expiresAt: normalized.expiresAt,
        lastSeenAt: normalized.lastSeenAt
      };
    }
    fs.mkdirSync(path.dirname(this.sessionStatePath), { recursive: true });
    fs.writeFileSync(this.sessionStatePath, JSON.stringify({
      updatedAt: new Date(now).toISOString(),
      sessions: serialized
    }, null, 2));
  }

  pruneExpiredSessions(nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    let changed = false;
    for (const [sessionId, entry] of this.sessions.entries()) {
      if (!entry || !entry.token || Number(entry.expiresAt || 0) <= now) {
        this.sessions.delete(sessionId);
        changed = true;
      }
    }
    if (changed) this.persistSessions();
  }

  createCsrfToken() {
    return `wscs_${crypto.randomBytes(24).toString('hex')}`;
  }

  createSession(token, nowMs, options = {}) {
    const value = String(token || '').trim();
    if (!value) return '';
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    if (options.reuseExisting) {
      const existing = this.findSessionIdByToken(value, now);
      if (existing) return existing;
    }
    if (options.revokeExisting) {
      this.deleteSessionsByToken(value);
    }
    const sessionId = `wss_${crypto.randomBytes(24).toString('hex')}`;
    this.sessions.set(sessionId, {
      token: value,
      csrfToken: this.createCsrfToken(),
      createdAt: now,
      expiresAt: now + (this.sessionTtlSecs * 1000),
      lastSeenAt: now
    });
    this.persistSessions();
    return sessionId;
  }

  findSessionIdByToken(token, nowMs) {
    const value = String(token || '').trim();
    if (!value) return '';
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    let changed = false;
    for (const [sessionId, entry] of this.sessions.entries()) {
      if (!entry || !entry.token || Number(entry.expiresAt || 0) <= now) {
        this.sessions.delete(sessionId);
        changed = true;
        continue;
      }
      if (entry.token === value) {
        if (changed) this.persistSessions();
        return sessionId;
      }
    }
    if (changed) this.persistSessions();
    return '';
  }

  deleteSessionsByToken(token, keepSessionId = '') {
    const value = String(token || '').trim();
    const keep = String(keepSessionId || '').trim();
    if (!value) return 0;
    let removed = 0;
    for (const [sessionId, entry] of this.sessions.entries()) {
      if (sessionId === keep) continue;
      if (!entry || entry.token !== value) continue;
      this.sessions.delete(sessionId);
      removed += 1;
    }
    if (removed > 0) this.persistSessions();
    return removed;
  }

  sessionRecord(sessionId, nowMs) {
    const id = String(sessionId || '').trim();
    if (!id) return null;
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const entry = this.sessions.get(id);
    if (!entry || !entry.token || Number(entry.expiresAt || 0) <= now) {
      if (this.sessions.delete(id)) this.persistSessions();
      return null;
    }
    entry.lastSeenAt = now;
    return entry;
  }

  deleteSession(sessionId) {
    const id = String(sessionId || '').trim();
    if (!id) return;
    if (!this.sessions.delete(id)) return;
    this.persistSessions();
  }

  async readDesktopAuthToken() {
    return String(await Promise.resolve(this.getDesktopAuthToken()) || '').trim();
  }

  async syncDesktopAuthToken(token, payload) {
    if (!this.onAuthToken) return;
    await Promise.resolve(this.onAuthToken({
      authToken: String(token || '').trim(),
      payload: payload && typeof payload === 'object' ? payload : {},
      siteOrigin: this.currentSiteOrigin()
    }));
  }

  async clearDesktopAuthTokenIfMatches(token) {
    if (!this.onClearAuthToken) return false;
    const current = await this.readDesktopAuthToken();
    if (!current || current !== String(token || '').trim()) return false;
    await Promise.resolve(this.onClearAuthToken({
      authToken: current,
      siteOrigin: this.currentSiteOrigin()
    }));
    return true;
  }

  setSessionCookie(req, res, sessionId) {
    const attrs = worldStageCookieAttributes(req, this.sessionTtlSecs);
    attrs.push('HttpOnly');
    appendResponseCookie(res, `${WORLDSTAGE_AUTH_COOKIE}=${encodeURIComponent(sessionId)}; ${attrs.join('; ')}`);
  }

  clearSessionCookie(req, res) {
    const attrs = worldStageCookieAttributes(req, 0);
    attrs.push('HttpOnly');
    appendResponseCookie(res, `${WORLDSTAGE_AUTH_COOKIE}=; ${attrs.join('; ')}`);
  }

  setCsrfCookie(req, res, csrfToken) {
    const attrs = worldStageCookieAttributes(req, this.sessionTtlSecs);
    appendResponseCookie(res, `${WORLDSTAGE_CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; ${attrs.join('; ')}`);
  }

  clearCsrfCookie(req, res) {
    const attrs = worldStageCookieAttributes(req, 0);
    appendResponseCookie(res, `${WORLDSTAGE_CSRF_COOKIE}=; ${attrs.join('; ')}`);
  }

  ensureSessionCsrfToken(sessionId, sessionEntry) {
    const id = String(sessionId || '').trim();
    if (!id || !sessionEntry || typeof sessionEntry !== 'object') return '';
    const existing = String(sessionEntry.csrfToken || '').trim();
    if (/^wscs_[a-f0-9]+$/i.test(existing)) return existing.toLowerCase();
    sessionEntry.csrfToken = this.createCsrfToken();
    this.persistSessions();
    return sessionEntry.csrfToken;
  }

  setAuthCookies(req, res, sessionId) {
    const sessionEntry = this.sessions.get(String(sessionId || '').trim());
    if (!sessionEntry) return '';
    const csrfToken = this.ensureSessionCsrfToken(sessionId, sessionEntry);
    this.setSessionCookie(req, res, sessionId);
    if (csrfToken) this.setCsrfCookie(req, res, csrfToken);
    return csrfToken;
  }

  ensureCsrfCookie(req, res, auth) {
    if (!auth || auth.source !== 'session' || !auth.sessionId) return '';
    const sessionEntry = this.sessions.get(auth.sessionId);
    if (!sessionEntry) return '';
    const csrfToken = this.ensureSessionCsrfToken(auth.sessionId, sessionEntry);
    if (!csrfToken) return '';
    if (auth.csrfCookie !== csrfToken) {
      this.setCsrfCookie(req, res, csrfToken);
    }
    return csrfToken;
  }

  authFromRequest(req) {
    const cookies = parseCookies(req);
    const csrfCookie = decodedCookieValue(cookies[WORLDSTAGE_CSRF_COOKIE]);
    const cookieValue = decodedCookieValue(cookies[WORLDSTAGE_AUTH_COOKIE]);
    if (!cookieValue) {
      return { token: '', source: 'none', sessionId: '', csrfCookie };
    }
    if (cookieValue.startsWith('wss_')) {
      const session = this.sessionRecord(cookieValue, Date.now());
      if (!session) {
        return { token: '', source: 'invalid_session', sessionId: cookieValue, csrfCookie };
      }
      return { token: session.token, source: 'session', sessionId: cookieValue, csrfCookie };
    }
    return { token: cookieValue, source: 'legacy_cookie', sessionId: '', csrfCookie };
  }

  migrateLegacyAuth(req, res, auth) {
    if (!auth || auth.source !== 'legacy_cookie' || !auth.token) return '';
    const sessionId = this.createSession(auth.token, Date.now(), { reuseExisting: true });
    if (!sessionId) return '';
    this.setAuthCookies(req, res, sessionId);
    return sessionId;
  }

  invalidateAuth(req, res, auth) {
    if (auth && auth.sessionId) this.deleteSession(auth.sessionId);
    this.clearSessionCookie(req, res);
    this.clearCsrfCookie(req, res);
  }

  validateCsrf(req, res, auth) {
    if (!auth || auth.source !== 'session' || !auth.sessionId) return true;
    const sessionEntry = this.sessions.get(auth.sessionId);
    if (!sessionEntry) {
      this.invalidateAuth(req, res, auth);
      sendJson(res, 401, { error: 'invalid_session' });
      return false;
    }
    const cookieToken = String(auth.csrfCookie || '').trim();
    const headerToken = String(req.headers['x-worldstage-csrf'] || req.headers['x-csrf-token'] || '').trim();
    const expected = this.ensureSessionCsrfToken(auth.sessionId, sessionEntry);
    if (cookieToken && headerToken && cookieToken === expected && headerToken === expected) {
      return true;
    }
    if (expected) this.setCsrfCookie(req, res, expected);
    sendJson(res, 403, { error: 'invalid_csrf' });
    return false;
  }

  async requestUpstreamJson(upstreamPath, options = {}) {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch_unavailable');
    }
    const siteOrigin = this.currentSiteOrigin();
    const targetUrl = new URL(upstreamPath, siteOrigin).toString();
    const method = String(options.method || 'GET').toUpperCase();
    const headers = Object.assign({}, options.headers || {});
    const token = String(options.token || '').trim();
    if (!headers.Accept) headers.Accept = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.fetchImpl(targetUrl, {
      method,
      headers,
      body: options.body
    });
    const body = await response.text();
    let json = {};
    if (body) {
      try {
        json = JSON.parse(body);
      } catch (error) {
        error.statusCode = response.status || 500;
        error.responseBody = body;
        throw error;
      }
    }
    if (!response.ok) {
      const error = new Error(`upstream status ${response.status || 500}`);
      error.statusCode = response.status || 500;
      error.responseBody = body;
      error.responseJson = json;
      throw error;
    }
    return {
      statusCode: response.status || 200,
      json,
      body
    };
  }

  async fetchUpstreamJson(upstreamPath, token) {
    const response = await this.requestUpstreamJson(upstreamPath, {
      method: 'GET',
      token
    });
    return response.json;
  }

  async hasValidAuth(req, res) {
    const auth = this.authFromRequest(req);
    if (auth.token) {
      try {
        await this.fetchUpstreamJson('/api/worldstage/me', auth.token);
        this.migrateLegacyAuth(req, res, auth);
        this.ensureCsrfCookie(req, res, auth);
        return true;
      } catch (error) {
        if ((error.statusCode === 401 || error.statusCode === 403) && auth.source !== 'bearer') {
          this.invalidateAuth(req, res, auth);
          await this.clearDesktopAuthTokenIfMatches(auth.token).catch(() => {});
        }
        return false;
      }
    }

    if (auth.source === 'invalid_session') {
      this.invalidateAuth(req, res, auth);
    }

    const desktopToken = await this.readDesktopAuthToken();
    if (!desktopToken) return false;

    try {
      await this.fetchUpstreamJson('/api/worldstage/me', desktopToken);
      const sessionId = this.createSession(desktopToken, Date.now(), { reuseExisting: true });
      if (!sessionId) return false;
      this.setAuthCookies(req, res, sessionId);
      return true;
    } catch (error) {
      if (error.statusCode === 401 || error.statusCode === 403) {
        await this.clearDesktopAuthTokenIfMatches(desktopToken).catch(() => {});
      }
      return false;
    }
  }

  isProtectedWorldStagePath(reqBase) {
    return reqBase === WORLDSTAGE_APP_PATH || reqBase.startsWith(`${WORLDSTAGE_APP_PATH}/`);
  }

  async maybeHandleWorldStagePageAuth(req, res, reqPath) {
    const reqBase = String(reqPath || '').split('?')[0];
    if (reqBase === WORLDSTAGE_LOGIN_PATH) {
      if (await this.hasValidAuth(req, res)) {
        redirect(res, 302, WORLDSTAGE_APP_PATH);
        return true;
      }
      return false;
    }
    if (!this.isProtectedWorldStagePath(reqBase)) return false;
    if (await this.hasValidAuth(req, res)) return false;
    redirect(res, 302, `${WORLDSTAGE_LOGIN_PATH}?next=${encodeURIComponent(reqPath || reqBase)}`);
    return true;
  }

  async handleReadJson(req, res, upstreamPath) {
    const auth = this.authFromRequest(req);
    if (!auth.token && auth.source === 'invalid_session') {
      this.invalidateAuth(req, res, auth);
      sendJson(res, 401, { error: 'invalid_session' });
      return;
    }
    try {
      const payload = await this.fetchUpstreamJson(upstreamPath, auth.token);
      this.migrateLegacyAuth(req, res, auth);
      this.ensureCsrfCookie(req, res, auth);
      sendJson(res, 200, payload);
    } catch (error) {
      if ((error.statusCode === 401 || error.statusCode === 403) && auth.source !== 'bearer') {
        this.invalidateAuth(req, res, auth);
        await this.clearDesktopAuthTokenIfMatches(auth.token).catch(() => {});
        sendJson(res, error.statusCode, error.responseJson || { error: 'unauthorized' });
        return;
      }
      sendJson(res, 502, {
        error: 'worldstage_upstream_error',
        detail: String(error && error.message ? error.message : error)
      });
    }
  }

  async handleWrite(req, res, upstreamPath) {
    const body = await readBody(req, 256 * 1024);
    const auth = this.authFromRequest(req);
    if (!auth.token && auth.source === 'invalid_session') {
      this.invalidateAuth(req, res, auth);
      sendJson(res, 401, { error: 'invalid_session' });
      return;
    }
    if (!this.validateCsrf(req, res, auth)) return;
    try {
      const response = await this.requestUpstreamJson(upstreamPath, {
        method: req.method,
        token: auth.token,
        body,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json'
        }
      });
      sendJson(res, response.statusCode, response.json);
    } catch (error) {
      if ((error.statusCode === 401 || error.statusCode === 403) && auth.source !== 'bearer') {
        this.invalidateAuth(req, res, auth);
        await this.clearDesktopAuthTokenIfMatches(auth.token).catch(() => {});
        sendJson(res, error.statusCode, error.responseJson || { error: 'unauthorized' });
        return;
      }
      const status = Number(error && error.statusCode) || 502;
      if (status >= 400 && status < 500 && error && error.responseJson && typeof error.responseJson === 'object') {
        sendJson(res, status, error.responseJson);
        return;
      }
      sendJson(res, 502, {
        error: 'worldstage_upstream_error',
        detail: String(error && error.message ? error.message : error)
      });
    }
  }

  async handleSessionAuth(req, res, upstreamPath) {
    const ip = clientIp(req);
    if (!allowRateWithState(this.authRateState, ip, this.authRateLimitMax)) {
      sendJson(res, 429, { error: 'rate_limited' });
      return;
    }
    const body = await readBody(req, 256 * 1024);
    try {
      const response = await this.requestUpstreamJson(upstreamPath, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json'
        }
      });
      const payload = response && response.json && typeof response.json === 'object' ? response.json : {};
      const authToken = String(payload && payload.authToken || '').trim();
      if (!authToken) {
        sendJson(res, 502, { error: 'worldstage_upstream_error', detail: 'missing_auth_token' });
        return;
      }
      const sessionId = this.createSession(authToken, Date.now(), { revokeExisting: true });
      this.setAuthCookies(req, res, sessionId);
      await this.syncDesktopAuthToken(authToken, payload).catch(() => {});
      const sanitized = Object.assign({}, payload);
      delete sanitized.authToken;
      sendJson(res, response.statusCode || 200, sanitized);
    } catch (error) {
      const status = Number(error && error.statusCode) || 502;
      if (status >= 400 && status < 500 && error && error.responseJson && typeof error.responseJson === 'object') {
        sendJson(res, status, error.responseJson);
        return;
      }
      sendJson(res, 502, {
        error: 'worldstage_upstream_error',
        detail: String(error && error.message ? error.message : error)
      });
    }
  }

  async handleSessionLogout(req, res) {
    const auth = this.authFromRequest(req);
    if (auth.source === 'invalid_session' || !auth.token) {
      this.invalidateAuth(req, res, auth);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (!this.validateCsrf(req, res, auth)) return;
    this.invalidateAuth(req, res, auth);
    await this.clearDesktopAuthTokenIfMatches(auth.token).catch(() => {});
    sendJson(res, 200, { ok: true });
  }

  assetPath(fileName) {
    return path.join(this.assetsDirectory, fileName);
  }

  serveAsset(res, fileName) {
    const fullPath = this.assetPath(fileName);
    fs.readFile(fullPath, (error, data) => {
      if (error) {
        send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'read error');
        return;
      }
      send(res, 200, {
        'Content-Type': contentTypeFor(fullPath),
        'Cache-Control': cacheControlFor(fullPath)
      }, data);
    });
  }

  async handleRequest(req, res) {
    try {
      if (!req.url) {
        send(res, 400, { 'Content-Type': 'text/plain; charset=utf-8' }, 'bad request');
        return;
      }

      this.pruneExpiredSessions();
      const requestUrl = new URL(req.url, this.getBaseUrl() || `http://${this.host}:${this.port || 80}`);
      const reqPath = requestUrl.pathname;

      if (req.method === 'GET' && reqPath === '/health') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (req.method === 'POST' && reqPath === '/api/worldstage/auth/register') {
        await this.handleSessionAuth(req, res, '/api/worldstage/accounts');
        return;
      }

      if (req.method === 'POST' && reqPath === '/api/worldstage/auth/login') {
        await this.handleSessionAuth(req, res, '/api/worldstage/accounts/login');
        return;
      }

      if (req.method === 'POST' && reqPath === '/api/worldstage/auth/import') {
        await this.handleSessionAuth(req, res, '/api/worldstage/accounts/import');
        return;
      }

      if (req.method === 'POST' && reqPath === '/api/worldstage/auth/recovery/import') {
        await this.handleSessionAuth(req, res, '/api/worldstage/accounts/recovery/import');
        return;
      }

      if (req.method === 'POST' && reqPath === '/api/worldstage/auth/logout') {
        await this.handleSessionLogout(req, res);
        return;
      }

      if (
        req.method === 'POST'
        && (
          reqPath === '/api/worldstage/accounts'
          || reqPath === '/api/worldstage/accounts/login'
          || reqPath === '/api/worldstage/accounts/import'
          || reqPath === '/api/worldstage/accounts/recovery/import'
        )
      ) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }

      if (req.method === 'GET' && reqPath.startsWith('/api/worldstage/')) {
        await this.handleReadJson(req, res, `${reqPath}${requestUrl.search}`);
        return;
      }

      if (
        req.method === 'POST'
        && reqPath === '/api/worldstage/me/username'
      ) {
        await this.handleWrite(req, res, reqPath);
        return;
      }

      if (await this.maybeHandleWorldStagePageAuth(req, res, req.url)) {
        return;
      }

      if (req.method === 'GET' && reqPath === '/worldstage.html') {
        redirect(res, 302, WORLDSTAGE_LOGIN_PATH);
        return;
      }

      if (req.method === 'GET' && reqPath === '/worldstage-space.js') {
        this.serveAsset(res, 'worldstage-space.js');
        return;
      }

      if (req.method === 'GET' && (reqPath === WORLDSTAGE_LOGIN_PATH || this.isProtectedWorldStagePath(reqPath))) {
        this.serveAsset(res, 'worldstage.html');
        return;
      }

      send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'not found');
    } catch (error) {
      if (error && error.message === 'payload too large') {
        sendJson(res, 413, { error: 'payload_too_large' });
        return;
      }
      sendJson(res, 500, {
        error: 'server_error',
        detail: String(error && error.message ? error.message : error)
      });
    }
  }

  async start() {
    if (this.server) return this.getBaseUrl();
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        sendJson(res, 500, {
          error: 'server_error',
          detail: String(error && error.message ? error.message : error)
        });
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        const address = this.server.address();
        this.port = address && typeof address === 'object' ? address.port : this.port;
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    return this.getBaseUrl();
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
}

module.exports = {
  WORLDSTAGE_APP_PATH,
  WORLDSTAGE_AUTH_COOKIE,
  WORLDSTAGE_CSRF_COOKIE,
  WORLDSTAGE_LOGIN_PATH,
  WorldStageLocalServer
};
