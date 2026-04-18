#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
  WORLDSTAGE_AUTH_COOKIE,
  WORLDSTAGE_CSRF_COOKIE,
  WorldStageLocalServer
} = require('../lib/worldstage-local-server');

const MOCK_WORLDSTAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>5310S - WorldStage</title>
</head>
<body class="worldstage-auth-route">
  <main>
    <h1>World Stage</h1>
    <p>Live upstream WorldStage shell.</p>
  </main>
  <script type="module" src="/worldstage-space.js?v=20260415a"></script>
</body>
</html>`;

const MOCK_WORLDSTAGE_SPACE_JS = "import * as THREE from 'https://unpkg.com/three@0.179.1/build/three.module.js';\nexport { THREE };";

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function startMockWorldStageUpstream(port) {
  const state = {
    requests: [],
    removedVideoIds: [],
    tokens: new Map([
      ['ws-auth-login', { id: 'acct-login', name: 'viewer@example.com' }],
      ['ws-auth-register', { id: 'acct-register', name: 'builder@example.com' }],
      ['ws-auth-import', { id: 'acct-import', name: 'imported@example.com' }],
      ['ws-auth-recovery-import', { id: 'acct-recovery', name: 'recover@example.com' }]
    ])
  };

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const authorization = String(req.headers.authorization || '');
    state.requests.push({
      method: req.method,
      path: reqUrl.pathname,
      authorization
    });

    if (req.method === 'GET' && (reqUrl.pathname === '/worldstage' || reqUrl.pathname === '/worldstage-login')) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(MOCK_WORLDSTAGE_HTML);
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/worldstage-space.js') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      });
      res.end(MOCK_WORLDSTAGE_SPACE_JS);
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/worldstage/auth/register') {
      await readJsonBody(req);
      jsonResponse(res, 201, {
        ok: true,
        account: state.tokens.get('ws-auth-register'),
        authToken: 'ws-auth-register'
      });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/worldstage/auth/login') {
      await readJsonBody(req);
      jsonResponse(res, 200, {
        ok: true,
        account: state.tokens.get('ws-auth-login'),
        authToken: 'ws-auth-login'
      });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/worldstage/auth/import') {
      await readJsonBody(req);
      jsonResponse(res, 200, {
        ok: true,
        account: state.tokens.get('ws-auth-import'),
        authToken: 'ws-auth-import'
      });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/worldstage/auth/recovery/import') {
      await readJsonBody(req);
      jsonResponse(res, 200, {
        ok: true,
        account: state.tokens.get('ws-auth-recovery-import'),
        authToken: 'ws-auth-recovery-import'
      });
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/worldstage/me') {
      const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
      const account = state.tokens.get(token);
      if (!account) {
        jsonResponse(res, 401, { error: 'invalid_auth_token' });
        return;
      }
      jsonResponse(res, 200, { ok: true, account });
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/worldstage/downloads') {
      const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
      if (!state.tokens.has(token)) {
        jsonResponse(res, 401, { error: 'invalid_auth_token' });
        return;
      }
      jsonResponse(res, 200, {
        ok: true,
        downloads: [
          { videoId: 'vid-1', title: 'Orbit Log', status: 'completed' }
        ]
      });
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/worldstage/bootstrap') {
      const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
      if (!state.tokens.has(token)) {
        jsonResponse(res, 401, { error: 'invalid_auth_token' });
        return;
      }
      jsonResponse(res, 200, {
        ok: true,
        summary: { videoCount: 1 },
        videos: [{ videoId: 'vid-1', title: 'Orbit Log' }],
        channels: [{ channelId: 'channel-1', title: 'Orbit Channel' }]
      });
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/weave/mesh/config') {
      jsonResponse(res, 200, {
        ok: true,
        iceServers: [
          { urls: ['stun:stun.example.com:3478'] }
        ]
      });
      return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/api/worldstage/me/username') {
      const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
      const account = state.tokens.get(token);
      if (!account) {
        jsonResponse(res, 401, { error: 'invalid_auth_token' });
        return;
      }
      const payload = await readJsonBody(req);
      const username = String(payload && payload.username || '').trim() || account.name;
      const updated = { id: account.id, name: username };
      state.tokens.set(token, updated);
      jsonResponse(res, 200, { ok: true, account: updated });
      return;
    }

    if (req.method === 'DELETE' && reqUrl.pathname.startsWith('/api/worldstage/videos/')) {
      const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
      if (!state.tokens.has(token)) {
        jsonResponse(res, 401, { error: 'invalid_auth_token' });
        return;
      }
      const videoId = decodeURIComponent(reqUrl.pathname.slice('/api/worldstage/videos/'.length));
      state.removedVideoIds.push(videoId);
      jsonResponse(res, 200, { ok: true, removedVideoId: videoId });
      return;
    }

    jsonResponse(res, 404, { error: 'not_found' });
  });

  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve();
    });
    server.on('error', reject);
  });

  return {
    server,
    state,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

function responseCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const raw = response.headers.get('set-cookie');
  return raw ? [raw] : [];
}

function cookiePairFromResponse(response, cookieName = WORLDSTAGE_AUTH_COOKIE) {
  const match = responseCookies(response)
    .join('; ')
    .match(new RegExp(`${cookieName}=[^;]+`));
  return match ? match[0] : '';
}

function joinCookies(...cookiePairs) {
  return cookiePairs.filter(Boolean).join('; ');
}

function readSessionFile(sessionStatePath) {
  if (!fs.existsSync(sessionStatePath)) return { sessions: {} };
  return JSON.parse(fs.readFileSync(sessionStatePath, 'utf8'));
}

async function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body),
    redirect: 'manual'
  });
}

(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstage-local-server-'));
  const sessionStatePath = path.join(tmpRoot, 'worldstage-browser-sessions.json');
  const upstreamPort = await reservePort();
  const upstream = await startMockWorldStageUpstream(upstreamPort);
  const upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;
  const syncedTokens = [];
  const clearedTokens = [];
  let desktopAuthToken = '';
  let site = null;

  async function startSite() {
    site = new WorldStageLocalServer({
      host: '127.0.0.1',
      port: 0,
      sessionStatePath,
      siteOrigin: upstreamOrigin,
      getDesktopAuthToken: () => desktopAuthToken,
      onAuthToken: ({ authToken }) => {
        desktopAuthToken = String(authToken || '').trim();
        syncedTokens.push(desktopAuthToken);
      },
      onClearAuthToken: ({ authToken }) => {
        clearedTokens.push(String(authToken || '').trim());
        desktopAuthToken = '';
      }
    });
    return site.start();
  }

  try {
    let baseUrl = await startSite();

    let response = await fetch(`${baseUrl}/worldstage`, { redirect: 'manual' });
    assert.strictEqual(response.status, 302, 'Unauthenticated /worldstage should redirect.');
    assert.strictEqual(response.headers.get('location'), '/worldstage-login?next=%2Fworldstage');

    response = await fetch(`${baseUrl}/worldstage-login`, { redirect: 'manual' });
    assert.strictEqual(response.status, 200, 'WorldStage login shell should render publicly.');
    const loginHtml = await response.text();
    assert.ok(loginHtml.includes('Live upstream WorldStage shell.'), 'The local bridge should proxy the live WorldStage shell.');
    assert.ok(loginHtml.includes('/worldstage-space.js?v=20260415a'), 'The proxied WorldStage page should include the current starfield module path.');
    assert.ok(String(response.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'HTML responses should publish a restrictive CSP.');
    assert.strictEqual(response.headers.get('x-frame-options'), 'DENY', 'HTML responses should deny framing.');
    assert.strictEqual(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', 'HTML responses should set a referrer policy.');
    assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff', 'HTML responses should disable MIME sniffing.');

    response = await fetch(`${baseUrl}/worldstage-space.js?v=20260409f`, { redirect: 'manual' });
    assert.strictEqual(response.status, 200, 'The upstream starfield module should be proxied locally.');
    assert.ok((await response.text()).includes("import * as THREE"), 'The proxied starfield module should preserve the upstream Three.js entrypoint.');

    response = await postJson(`${baseUrl}/api/worldstage/auth/import`, {
      portableAccount: 'signed-bundle'
    });
    assert.strictEqual(response.status, 200, 'Import wrapper should preserve upstream success status.');
    let payload = await response.json();
    assert.ok(payload.account && payload.account.id === 'acct-import', 'Import wrapper should preserve imported account data.');
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'authToken'), 'Import wrapper must strip upstream authToken.');
    assert.ok(/^worldstage_auth_token=wss_[a-f0-9]+$/.test(cookiePairFromResponse(response)), 'Import wrapper should issue an opaque session cookie.');
    assert.ok(/^worldstage_csrf_token=wscs_[a-f0-9]+$/.test(cookiePairFromResponse(response, WORLDSTAGE_CSRF_COOKIE)), 'Import wrapper should issue a CSRF cookie.');

    response = await postJson(`${baseUrl}/api/worldstage/auth/register`, {
      email: 'builder@example.com',
      username: 'builder@example.com',
      password: 'password123'
    });
    assert.strictEqual(response.status, 201, 'Register wrapper should preserve upstream success status.');
    payload = await response.json();
    assert.ok(payload.ok, 'Register wrapper should return upstream payload.');
    assert.ok(payload.account && payload.account.id === 'acct-register', 'Register wrapper should preserve account data.');
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'authToken'), 'Register wrapper must strip upstream authToken.');
    const registerSetCookieHeader = responseCookies(response).join('; ');
    const registerCookie = cookiePairFromResponse(response);
    const registerCsrfCookie = cookiePairFromResponse(response, WORLDSTAGE_CSRF_COOKIE);
    assert.ok(/^worldstage_auth_token=wss_[a-f0-9]+$/.test(registerCookie), 'Register wrapper should issue opaque session cookie.');
    assert.ok(/^worldstage_csrf_token=wscs_[a-f0-9]+$/.test(registerCsrfCookie), 'Register wrapper should issue a CSRF cookie.');
    assert.ok(registerSetCookieHeader.includes('HttpOnly'), 'Register cookie should be HttpOnly.');
    assert.ok(registerSetCookieHeader.includes('SameSite=Strict'), 'Register cookie should be SameSite=Strict.');
    assert.ok(responseCookies(response).some((value) => value.startsWith(`${WORLDSTAGE_CSRF_COOKIE}=`) && !value.includes('HttpOnly')), 'Register CSRF cookie should remain readable to same-origin JavaScript.');

    response = await postJson(`${baseUrl}/api/worldstage/auth/login`, {
      email: 'viewer@example.com',
      username: 'viewer@example.com',
      password: 'password123'
    });
    assert.strictEqual(response.status, 200, 'Login wrapper should preserve upstream success status.');
    payload = await response.json();
    assert.ok(payload.account && payload.account.id === 'acct-login', 'Login wrapper should preserve account data.');
    assert.ok(!Object.prototype.hasOwnProperty.call(payload, 'authToken'), 'Login wrapper must not leak upstream authToken.');
    const loginSetCookieHeader = responseCookies(response).join('; ');
    assert.ok(loginSetCookieHeader.includes(`${WORLDSTAGE_AUTH_COOKIE}=wss_`), 'Login wrapper should issue opaque session id cookie.');
    assert.ok(loginSetCookieHeader.includes('HttpOnly'), 'Login cookie should be HttpOnly.');
    assert.ok(loginSetCookieHeader.includes('SameSite=Strict'), 'Login cookie should be SameSite=Strict.');
    assert.ok(loginSetCookieHeader.includes('Path=/'), 'Login cookie should be site scoped.');
    assert.ok(loginSetCookieHeader.includes('Max-Age='), 'Login cookie should carry Max-Age.');
    assert.ok(!loginSetCookieHeader.includes('ws-auth-login'), 'Login cookie must not contain the upstream bearer token.');
    const loginCookie = cookiePairFromResponse(response);
    const loginCsrfCookie = cookiePairFromResponse(response, WORLDSTAGE_CSRF_COOKIE);
    assert.ok(loginCookie, 'Login wrapper should return a session cookie.');
    assert.ok(/^worldstage_csrf_token=wscs_[a-f0-9]+$/.test(loginCsrfCookie), 'Login wrapper should return a CSRF cookie.');
    assert.ok(responseCookies(response).some((value) => value.startsWith(`${WORLDSTAGE_CSRF_COOKIE}=`) && !value.includes('HttpOnly')), 'Login CSRF cookie should remain script-readable.');
    const loginCookieHeader = joinCookies(loginCookie, loginCsrfCookie);
    assert.deepStrictEqual(syncedTokens, ['ws-auth-import', 'ws-auth-register', 'ws-auth-login'], 'Desktop auth sync should track each successful copied auth flow.');
    assert.strictEqual(desktopAuthToken, 'ws-auth-login', 'Desktop auth state should mirror the latest login token.');

    const upstreamCountBeforeBlockedDirectAuth = upstream.state.requests.length;
    response = await postJson(`${baseUrl}/api/worldstage/accounts/login`, {
      email: 'viewer@example.com',
      username: 'viewer@example.com',
      password: 'password123'
    });
    assert.strictEqual(response.status, 404, 'Direct legacy WorldStage auth proxy routes should be blocked.');
    payload = await response.json();
    assert.strictEqual(payload.error, 'not_found');
    assert.strictEqual(upstream.state.requests.length, upstreamCountBeforeBlockedDirectAuth, 'Blocked direct auth proxy routes should not hit the upstream.');

    let persisted = readSessionFile(sessionStatePath);
    const persistedIds = Object.keys(persisted.sessions || {});
    assert.ok(persistedIds.length >= 3, 'Session file should persist issued WorldStage sessions.');
    const persistedLogin = Object.entries(persisted.sessions).find(([, entry]) => entry && entry.token === 'ws-auth-login');
    assert.ok(persistedLogin, 'Session file should store the upstream token server-side.');
    assert.ok(persistedLogin[1] && /^wscs_[a-f0-9]+$/.test(String(persistedLogin[1].csrfToken || '')), 'Session file should persist the CSRF token alongside the upstream bearer token.');

    response = await fetch(`${baseUrl}/api/worldstage/me`, {
      headers: { Cookie: loginCookie },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'Session cookie should authenticate /api/worldstage/me.');
    assert.ok(/^worldstage_csrf_token=wscs_[a-f0-9]+$/.test(cookiePairFromResponse(response, WORLDSTAGE_CSRF_COOKIE)), 'Authenticated reads should restore the CSRF cookie when only the session cookie is present.');
    payload = await response.json();
    assert.strictEqual(payload.account.name, 'viewer@example.com');

    response = await fetch(`${baseUrl}/api/worldstage/downloads`, {
      headers: { Cookie: loginCookieHeader },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'Session cookie should authenticate personalized WorldStage reads.');
    payload = await response.json();
    assert.ok(Array.isArray(payload.downloads) && payload.downloads.length === 1, 'Downloads should pass through the copied edge.');

    response = await fetch(`${baseUrl}/api/worldstage/bootstrap`, {
      headers: { Cookie: loginCookieHeader },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'Generic WorldStage JSON reads should proxy through the local bridge.');
    payload = await response.json();
    assert.strictEqual(payload.summary.videoCount, 1, 'The local bridge should preserve generic WorldStage bootstrap payloads.');

    response = await fetch(`${baseUrl}/api/weave/mesh/config`, {
      headers: { Cookie: loginCookieHeader },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'The local bridge should proxy the ICE config endpoint used by the live shell.');
    payload = await response.json();
    assert.ok(Array.isArray(payload.iceServers) && payload.iceServers.length === 1, 'The ICE config payload should pass through unchanged.');

    response = await postJson(`${baseUrl}/api/worldstage/me/username`, { username: 'viewer' }, {
      Cookie: loginCookieHeader
    });
    assert.strictEqual(response.status, 403, 'Cookie-authenticated writes should reject requests missing the CSRF header.');
    payload = await response.json();
    assert.strictEqual(payload.error, 'invalid_csrf');

    response = await postJson(`${baseUrl}/api/worldstage/me/username`, { username: 'viewer' }, {
      Cookie: loginCookieHeader,
      'X-WorldStage-CSRF': 'wscs_wrong'
    });
    assert.strictEqual(response.status, 403, 'Cookie-authenticated writes should reject mismatched CSRF headers.');

    response = await postJson(`${baseUrl}/api/worldstage/me/username`, { username: 'viewer' }, {
      Cookie: loginCookieHeader,
      'X-WorldStage-CSRF': loginCsrfCookie.split('=')[1]
    });
    assert.strictEqual(response.status, 200, 'Session cookie should authenticate protected WorldStage writes.');

    const meCalls = upstream.state.requests.filter((entry) => entry.path === '/api/worldstage/me');
    assert.ok(meCalls.some((entry) => entry.authorization === 'Bearer ws-auth-login'), 'Protected reads should forward the server-side bearer token upstream.');
    const usernameCalls = upstream.state.requests.filter((entry) => entry.path === '/api/worldstage/me/username');
    assert.ok(usernameCalls.some((entry) => entry.authorization === 'Bearer ws-auth-login'), 'Protected writes should forward the server-side bearer token upstream.');
    assert.strictEqual(usernameCalls.length, 1, 'Rejected CSRF attempts should not reach the upstream WorldStage write endpoint.');
    const bootstrapCalls = upstream.state.requests.filter((entry) => entry.path === '/api/worldstage/bootstrap');
    assert.ok(bootstrapCalls.some((entry) => entry.authorization === 'Bearer ws-auth-login'), 'Generic WorldStage reads should forward the server-side bearer token upstream.');

    response = await fetch(`${baseUrl}/api/worldstage/videos/vid-1`, {
      method: 'DELETE',
      headers: {
        Cookie: loginCookieHeader,
        'X-WorldStage-CSRF': loginCsrfCookie.split('=')[1]
      }
    });
    assert.strictEqual(response.status, 200, 'Cookie-authenticated DELETE requests should proxy through the local WorldStage bridge.');
    payload = await response.json();
    assert.strictEqual(payload.removedVideoId, 'vid-1');
    assert.deepStrictEqual(upstream.state.removedVideoIds, ['vid-1'], 'Hosted-video deletes should be forwarded upstream with the current account session.');

    response = await fetch(`${baseUrl}/worldstage-login`, {
      headers: { Cookie: loginCookieHeader },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 302, 'Authenticated /worldstage-login should redirect to the app.');
    assert.strictEqual(response.headers.get('location'), '/worldstage');

    response = await fetch(`${baseUrl}/worldstage`, {
      headers: { Cookie: loginCookieHeader },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'Authenticated /worldstage should serve the copied page shell.');
    assert.ok(String(response.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'Protected HTML responses should keep the CSP hardening.');
    assert.match(await response.text(), /WorldStage/, 'Protected WorldStage page should still render normally.');

    response = await fetch(`${baseUrl}/api/worldstage/me`, {
      headers: { Cookie: `${WORLDSTAGE_AUTH_COOKIE}=wss_missing` },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 401, 'Unknown session ids should be rejected.');
    assert.ok(responseCookies(response).join('; ').includes(`${WORLDSTAGE_AUTH_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0; HttpOnly`), 'Unknown session ids should clear the auth cookie.');
    assert.ok(responseCookies(response).join('; ').includes(`${WORLDSTAGE_CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`), 'Unknown session ids should clear the CSRF cookie.');

    response = await fetch(`${baseUrl}/api/worldstage/me`, {
      headers: { Cookie: `${WORLDSTAGE_AUTH_COOKIE}=${encodeURIComponent('ws-auth-login')}` },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'Legacy token cookies should continue to authenticate during migration.');
    assert.ok(responseCookies(response).join('; ').includes(`${WORLDSTAGE_AUTH_COOKIE}=wss_`), 'Legacy token cookies should be upgraded to opaque session cookies.');
    assert.ok(responseCookies(response).join('; ').includes(`${WORLDSTAGE_CSRF_COOKIE}=wscs_`), 'Legacy token cookies should receive a CSRF companion cookie during migration.');

    await site.stop();
    baseUrl = await startSite();

    response = await fetch(`${baseUrl}/api/worldstage/me`, {
      headers: { Cookie: loginCookieHeader },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'Persisted WorldStage sessions should survive a local server restart.');
    payload = await response.json();
    assert.strictEqual(payload.account.name, 'viewer', 'Restarted local server should still authenticate the same account.');

    response = await fetch(`${baseUrl}/api/worldstage/auth/logout`, {
      method: 'POST',
      headers: { Cookie: loginCookieHeader },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 403, 'Logout should require the CSRF header for cookie-authenticated sessions.');

    response = await fetch(`${baseUrl}/api/worldstage/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: loginCookieHeader,
        'X-WorldStage-CSRF': loginCsrfCookie.split('=')[1]
      },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'Logout endpoint should respond successfully.');
    assert.ok(responseCookies(response).join('; ').includes(`${WORLDSTAGE_AUTH_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0; HttpOnly`), 'Logout should clear the auth cookie.');
    assert.ok(responseCookies(response).join('; ').includes(`${WORLDSTAGE_CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`), 'Logout should clear the CSRF cookie.');
    assert.deepStrictEqual(clearedTokens, ['ws-auth-login'], 'Desktop auth state should clear when the copied workflow logs out.');
    assert.strictEqual(desktopAuthToken, '', 'Desktop auth state should be empty after logout.');

    response = await fetch(`${baseUrl}/api/worldstage/me`, {
      headers: { Cookie: loginCookieHeader },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 401, 'Logged-out sessions should no longer authenticate.');

    persisted = readSessionFile(sessionStatePath);
    const stillHasLoginSession = Object.values(persisted.sessions || {}).some((entry) => entry && entry.token === 'ws-auth-login');
    assert.ok(!stillHasLoginSession, 'Logout should remove the persisted session entry.');

    desktopAuthToken = 'ws-auth-import';
    response = await fetch(`${baseUrl}/worldstage-login`, {
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 302, 'A desktop auth token should bootstrap the copied WorldStage session.');
    assert.strictEqual(response.headers.get('location'), '/worldstage');
    const bootstrappedCookie = cookiePairFromResponse(response);
    const bootstrappedCsrfCookie = cookiePairFromResponse(response, WORLDSTAGE_CSRF_COOKIE);
    assert.ok(/^worldstage_auth_token=wss_[a-f0-9]+$/.test(bootstrappedCookie), 'Desktop bootstrap should issue an opaque session cookie.');
    assert.ok(/^worldstage_csrf_token=wscs_[a-f0-9]+$/.test(bootstrappedCsrfCookie), 'Desktop bootstrap should issue a CSRF cookie.');

    response = await fetch(`${baseUrl}/api/worldstage/me`, {
      headers: {
        Cookie: joinCookies(bootstrappedCookie, bootstrappedCsrfCookie)
      },
      redirect: 'manual'
    });
    assert.strictEqual(response.status, 200, 'Bootstrapped browser sessions should authenticate through the copied edge.');
    payload = await response.json();
    assert.strictEqual(payload.account.id, 'acct-import');
  } finally {
    if (site) await site.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }

  console.log('worldstage-local-server.test.js: ok');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
