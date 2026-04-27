#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { WorldStageLocalServer } = require('../lib/worldstage-local-server');

const root = path.join(__dirname, '..');
const bundledWorldStageSource = fs.readFileSync(path.join(root, 'desktop', 'worldstage', 'worldstage.html'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'desktop', 'worldstage-site-preload.js'), 'utf8');
const localServerSource = fs.readFileSync(path.join(root, 'lib', 'worldstage-local-server.js'), 'utf8');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function extractFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `Expected ${functionName} to exist.`);
  let depth = 0;
  let seenBody = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
      seenBody = true;
    } else if (char === '}') {
      depth -= 1;
      if (seenBody && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Unable to extract ${functionName}.`);
}

async function startSearchUpstream() {
  const port = await reservePort();
  const state = {
    requests: []
  };
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    state.requests.push({
      method: req.method,
      pathname: reqUrl.pathname,
      search: reqUrl.search,
      authorization: String(req.headers.authorization || '')
    });
    if (req.method === 'GET' && reqUrl.pathname === '/api/worldstage/search') {
      const query = String(reqUrl.searchParams.get('q') || reqUrl.searchParams.get('query') || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        query,
        counts: {
          channels: query ? 1 : 0,
          streams: 0,
          videos: query ? 2 : 0,
          total: query ? 3 : 0
        },
        results: query
          ? [
              { type: 'channel', id: 'channel-alpha', title: `${query} channel` },
              { type: 'video', id: 'video-alpha', title: `${query} video` }
            ]
          : []
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function testLocalSearchProxy() {
  const upstream = await startSearchUpstream();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstage-search-test-'));
  const site = new WorldStageLocalServer({
    port: 0,
    siteOrigin: upstream.baseUrl,
    sessionStatePath: path.join(tmpDir, 'sessions.json')
  });
  try {
    const baseUrl = await site.start();
    const response = await fetch(`${baseUrl}/api/worldstage/search?q=nebula`, {
      headers: {
        Accept: 'application/json'
      }
    });
    assert.equal(response.status, 200, 'Local server should proxy GET /api/worldstage/search.');
    const payload = await response.json();
    assert.equal(payload.query, 'nebula', 'Search query should survive the local proxy.');
    assert.equal(payload.counts.total, 3, 'Search result counts should survive the local proxy.');
    assert.equal(payload.results.length, 2, 'Search results should survive the local proxy.');
    assert.equal(upstream.state.requests.length, 1, 'Search proxy should make one upstream request.');
    assert.equal(upstream.state.requests[0].method, 'GET', 'Search proxy should preserve GET method.');
    assert.equal(upstream.state.requests[0].pathname, '/api/worldstage/search', 'Search proxy should preserve endpoint path.');
    assert.equal(upstream.state.requests[0].search, '?q=nebula', 'Search proxy should preserve query string.');
  } finally {
    await site.stop().catch(() => {});
    await upstream.close().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testLiveHostedSearch() {
  if (process.env.WORLDSTAGE_LIVE_SEARCH_TEST !== '1') return;
  const pageResponse = await fetch('https://5310s.com/worldstage-login');
  assert.equal(pageResponse.status, 200, 'Live WorldStage page should be reachable.');
  const liveSource = await pageResponse.text();
  assert.match(liveSource, /WORLDSTAGE_SEARCH_ENDPOINT\s*=\s*'\/api\/worldstage\/search'/, 'Live page should define the search endpoint.');
  assert.match(liveSource, /function worldstageLoadSearchResults\(/, 'Live page should include real search loading code.');
  assert.match(liveSource, /worldstageLoadSearchResults\(query\)/, 'Live submit should load search results.');
  assert.match(liveSource, /function worldstageHandleSearchKeydown\(/, 'Live search box should handle keyboard input.');
  assert.match(liveSource, /key === 'Enter'[\s\S]*worldstageSubmitSearch\(\)/, 'Live search should submit on Enter.');
  assert.match(liveSource, /key === 'Backspace'[\s\S]*worldstageSetSearchDraft/, 'Live search should edit draft text with Backspace.');
  assert.match(liveSource, /worldstage-search-input/, 'Live page should render a searchbox.');

  const apiResponse = await fetch('https://5310s.com/api/worldstage/search?q=test');
  assert.equal(apiResponse.status, 200, 'Live search API should respond.');
  const apiPayload = await apiResponse.json();
  assert.equal(apiPayload.query, 'test', 'Live search API should echo the query.');
  assert.equal(typeof apiPayload.counts, 'object', 'Live search API should return counts.');
  assert.ok(Array.isArray(apiPayload.results), 'Live search API should return a results array.');
}

(async () => {
  const bundledSubmitSearch = extractFunction(bundledWorldStageSource, 'worldstageSubmitSearch');
  assert.match(bundledWorldStageSource, /id="worldstage-search-input"/, 'Bundled page should render a search input.');
  assert.match(bundledWorldStageSource, /id="worldstage-search-go"/, 'Bundled page should render a search submit button.');
  assert.match(bundledWorldStageSource, /id="worldstage-search-icon"/, 'Bundled page should render a search icon button.');
  assert.match(bundledSubmitSearch, /\.trim\(\)/, 'Bundled search should trim user input.');
  assert.match(bundledSubmitSearch, /if \(!query\) return;/, 'Bundled search should ignore blank searches.');
  assert.match(bundledSubmitSearch, /CustomEvent\('worldstage-search'/, 'Bundled search currently emits a search event.');
  assert.match(bundledSubmitSearch, /detail:\s*\{\s*query\s*\}/, 'Bundled search event should carry the query.');
  assert.doesNotMatch(bundledSubmitSearch, /fetch\(/, 'Bundled search submit does not fetch results.');
  assert.doesNotMatch(bundledSubmitSearch, /worldstageLoadSearchResults/, 'Bundled search submit does not render results.');
  assert.doesNotMatch(bundledWorldStageSource, /addEventListener\(\s*['"]worldstage-search/, 'Bundled page has no listener for its search event.');

  assert.match(preloadSource, /\[tabindex\]:not\(\[tabindex="-1"\]\)/, 'Preload drag CSS should keep focusable searchboxes clickable.');
  assert.doesNotMatch(preloadSource, /worldstage-search-input[\s\S]*display:\s*none/, 'Preload should not hide the search input.');
  assert.match(localServerSource, /reqPath\.startsWith\('\/api\/worldstage\/'\)/, 'Local server should proxy WorldStage API paths.');

  await testLocalSearchProxy();
  await testLiveHostedSearch();

  console.log('worldstage-search.test.js: ok');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
