#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { WorldStageAppUpdater } = require('../lib/app-updater');

class FakeAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.feedConfig = null;
    this.checkCalls = 0;
    this.quitAndInstallCalls = 0;
    this.autoDownload = false;
    this.autoInstallOnAppQuit = false;
    this.allowPrerelease = true;
    this.allowDowngrade = true;
  }

  setFeedURL(config) {
    this.feedConfig = config;
  }

  async checkForUpdates() {
    this.checkCalls += 1;
    this.emit('checking-for-update');
    return {
      cancellationToken: null
    };
  }

  quitAndInstall() {
    this.quitAndInstallCalls += 1;
  }
}

async function main() {
  const disabledUpdater = new WorldStageAppUpdater({
    app: {
      isPackaged: false,
      getVersion() {
        return '0.1.0';
      }
    },
    autoUpdater: new FakeAutoUpdater()
  });

  assert.equal(disabledUpdater.snapshot().enabled, false, 'Expected updater to stay disabled for development runs.');
  assert.equal(disabledUpdater.snapshot().disabledReason, 'packaged_build_required');

  const linuxArm64Updater = new WorldStageAppUpdater({
    app: {
      isPackaged: true,
      getVersion() {
        return '0.1.0';
      }
    },
    platform: 'linux',
    arch: 'arm64',
    autoUpdater: new FakeAutoUpdater()
  });

  assert.equal(linuxArm64Updater.snapshot().enabled, false, 'Expected Linux ARM64 updater to stay disabled until a dedicated update feed exists.');
  assert.equal(linuxArm64Updater.snapshot().disabledReason, 'linux_arm64_update_feed_unavailable');

  const fakeAutoUpdater = new FakeAutoUpdater();
  const openedExternal = [];
  const timers = [];
  const updater = new WorldStageAppUpdater({
    app: {
      isPackaged: true,
      getVersion() {
        return '0.1.0';
      }
    },
    autoUpdater: fakeAutoUpdater,
    shell: {
      async openExternal(url) {
        openedExternal.push(String(url));
      }
    },
    setInterval(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearInterval() {}
  });

  updater.initialize();
  assert.equal(updater.snapshot().platform, process.platform);
  assert.equal(updater.snapshot().arch, process.arch);
  assert.equal(fakeAutoUpdater.autoDownload, true, 'Expected packaged updater to auto-download release updates.');
  assert.equal(fakeAutoUpdater.autoInstallOnAppQuit, true, 'Expected packaged updater to auto-install on quit when supported.');
  assert.deepEqual(fakeAutoUpdater.feedConfig, {
    provider: 'github',
    owner: '5310S',
    repo: 'worldstage_client'
  }, 'Expected updater feed to point at the GitHub release repo.');
  assert.equal(timers.length, 1, 'Expected updater to schedule periodic background checks.');

  await updater.checkForUpdates();
  assert.equal(fakeAutoUpdater.checkCalls, 1, 'Expected manual update checks to reach the auto-updater.');
  assert.equal(updater.snapshot().lastResult, 'checking');

  fakeAutoUpdater.emit('update-available', {
    version: '0.2.0',
    releaseName: 'WorldStage Client 0.2.0',
    releaseNotes: 'Improved release flow.'
  });
  assert.equal(updater.snapshot().available, true);
  assert.equal(updater.snapshot().latestVersion, '0.2.0');
  assert.equal(updater.snapshot().lastResult, 'update_available');

  fakeAutoUpdater.emit('download-progress', {
    percent: 64.2,
    transferred: 642,
    total: 1000,
    bytesPerSecond: 128
  });
  assert.equal(updater.snapshot().lastResult, 'downloading_update');
  assert.equal(Math.round(updater.snapshot().progressPercent), 64);

  fakeAutoUpdater.emit('update-downloaded', {
    version: '0.2.0'
  });
  assert.equal(updater.snapshot().downloaded, true, 'Expected updater to mark the release as downloaded.');
  assert.equal(updater.snapshot().lastResult, 'update_downloaded');

  updater.quitAndInstall();
  assert.equal(fakeAutoUpdater.quitAndInstallCalls, 1, 'Expected install action to delegate to the auto-updater.');
  assert.equal(updater.snapshot().lastResult, 'installing_update');

  await updater.openReleasePage();
  assert.deepEqual(openedExternal, ['https://github.com/5310S/worldstage_client/releases/latest']);
  assert.equal(updater.snapshot().lastResult, 'release_page_opened');

  fakeAutoUpdater.emit('error', new Error('github_rate_limited'));
  assert.equal(updater.snapshot().lastResult, 'update_error');
  assert.equal(updater.snapshot().lastError, 'github_rate_limited');

  console.log('app-updater.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
