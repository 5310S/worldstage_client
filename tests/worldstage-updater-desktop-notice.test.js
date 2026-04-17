#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { buildWorldStageUpdaterDesktopNotice } = require('../lib/worldstage-updater-desktop-notice');

assert.deepEqual(
  buildWorldStageUpdaterDesktopNotice({
    platform: 'linux',
    previous: {},
    current: {
      enabled: true,
      downloaded: true,
      latestVersion: '0.2.0'
    }
  }),
  {
    visible: false,
    reason: 'unsupported_platform'
  }
);

assert.deepEqual(
  buildWorldStageUpdaterDesktopNotice({
    platform: 'win32',
    previous: {},
    current: {
      enabled: false,
      disabledReason: 'packaged_build_required'
    }
  }),
  {
    visible: false,
    reason: 'packaged_build_required'
  }
);

{
  const notice = buildWorldStageUpdaterDesktopNotice({
    platform: 'win32',
    previous: {
      enabled: true,
      downloaded: false,
      lastResult: 'downloading_update',
      latestVersion: '0.1.3'
    },
    current: {
      enabled: true,
      currentVersion: '0.1.3',
      latestVersion: '0.1.4',
      downloaded: true,
      lastResult: 'update_downloaded'
    }
  });
  assert.equal(notice.visible, true);
  assert.equal(notice.clickAction, 'show');
  assert.equal(notice.key, 'ready:0.1.4');
  assert.match(notice.body, /0\.1\.3 downloaded 0\.1\.4/i);
}

assert.deepEqual(
  buildWorldStageUpdaterDesktopNotice({
    platform: 'win32',
    previous: {
      enabled: true,
      currentVersion: '0.1.3',
      latestVersion: '0.1.4',
      downloaded: true,
      lastResult: 'update_downloaded'
    },
    current: {
      enabled: true,
      currentVersion: '0.1.3',
      latestVersion: '0.1.4',
      downloaded: true,
      lastResult: 'update_downloaded'
    }
  }),
  {
    visible: false,
    reason: 'idle'
  }
);

{
  const notice = buildWorldStageUpdaterDesktopNotice({
    platform: 'win32',
    previous: {
      enabled: true,
      lastResult: 'checking',
      lastError: ''
    },
    current: {
      enabled: true,
      lastResult: 'update_error',
      lastError: 'github_rate_limited'
    }
  });
  assert.equal(notice.visible, true);
  assert.equal(notice.key, 'error:github_rate_limited');
  assert.match(notice.body, /github_rate_limited/);
}

console.log('worldstage-updater-desktop-notice.test.js: ok');
