#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { buildWorldStageSiteUpdaterBannerModel } = require('../lib/worldstage-site-updater-banner');

const baseUpdater = {
  enabled: true,
  currentVersion: '0.1.0',
  latestVersion: '0.2.0',
  releaseUrl: 'https://github.com/5310S/worldstage_client/releases/latest'
};

assert.deepEqual(
  buildWorldStageSiteUpdaterBannerModel({
    platform: 'linux',
    pathname: '/worldstage',
    updater: {
      ...baseUpdater,
      downloaded: true
    }
  }),
  {
    visible: false,
    reason: 'unsupported_platform'
  }
);

assert.deepEqual(
  buildWorldStageSiteUpdaterBannerModel({
    platform: 'win32',
    pathname: '/worldstage-login',
    updater: {
      ...baseUpdater,
      downloaded: true
    }
  }),
  {
    visible: false,
    reason: 'non_dashboard_route'
  }
);

{
  const model = buildWorldStageSiteUpdaterBannerModel({
    platform: 'win32',
    pathname: '/worldstage',
    updater: {
      ...baseUpdater,
      downloaded: true,
      releaseNotes: 'Windows update fixes local release alerts.'
    }
  });
  assert.equal(model.visible, true);
  assert.equal(model.tone, 'ready');
  assert.equal(model.primaryAction.id, 'install');
  assert.equal(model.secondaryAction.id, 'release');
  assert.match(model.message, /downloaded 0\.2\.0/i);
}

{
  const model = buildWorldStageSiteUpdaterBannerModel({
    platform: 'win32',
    pathname: '/worldstage',
    updater: {
      ...baseUpdater,
      lastResult: 'downloading_update',
      available: true,
      progressPercent: 42
    }
  });
  assert.equal(model.visible, true);
  assert.equal(model.tone, 'info');
  assert.equal(model.progressPercent, 42);
  assert.equal(model.secondaryAction.id, 'release');
}

{
  const model = buildWorldStageSiteUpdaterBannerModel({
    platform: 'win32',
    pathname: '/worldstage/account',
    updater: {
      ...baseUpdater,
      lastResult: 'update_error',
      lastError: 'github_rate_limited'
    }
  });
  assert.equal(model.visible, true);
  assert.equal(model.tone, 'error');
  assert.equal(model.primaryAction.id, 'retry');
  assert.match(model.details, /github_rate_limited/);
}

console.log('worldstage-site-updater-banner.test.js: ok');
