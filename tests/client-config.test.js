#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const {
  MIN_POLL_INTERVAL_MS,
  defaultClientConfig,
  normalizeSiteOrigin,
  sanitizeClientConfig
} = require('../lib/client-config');

const defaults = defaultClientConfig({
  defaultDownloadDirectory: path.join('/tmp', 'worldstage-downloads')
});

assert.equal(defaults.siteOrigin, 'https://5310s.com');
assert.equal(defaults.deviceToken, '');
assert.equal(defaults.accountToken, '');
assert.equal(defaults.downloadDirectory, path.join('/tmp', 'worldstage-downloads'));
assert.equal(defaults.launchOnLogin, false);

assert.equal(normalizeSiteOrigin('5310s.com', ''), 'https://5310s.com');
assert.equal(normalizeSiteOrigin('https://5310s.com/worldstage?foo=bar', ''), 'https://5310s.com');
assert.equal(normalizeSiteOrigin('ftp://example.com', 'https://fallback.example'), 'https://fallback.example');

const sanitized = sanitizeClientConfig({
  deviceName: '  Seed Box  ',
  siteOrigin: 'worldstage.example',
  deviceToken: '  wsct_token  ',
  accountToken: '  wsa_token  ',
  pollIntervalMs: '1000',
  backgroundOnClose: 0,
  launchOnLogin: 1,
  autoStartAgent: '',
  downloadDirectory: '  /srv/worldstage  '
}, {
  defaultDownloadDirectory: '/tmp/default-worldstage'
});

assert.equal(sanitized.deviceName, 'Seed Box');
assert.equal(sanitized.siteOrigin, 'https://worldstage.example');
assert.equal(sanitized.deviceToken, 'wsct_token');
assert.equal(sanitized.accountToken, 'wsa_token');
assert.equal(sanitized.pollIntervalMs, MIN_POLL_INTERVAL_MS);
assert.equal(sanitized.backgroundOnClose, false);
assert.equal(sanitized.launchOnLogin, true);
assert.equal(sanitized.autoStartAgent, false);
assert.equal(sanitized.downloadDirectory, '/srv/worldstage');

console.log('client-config.test.js: ok');
