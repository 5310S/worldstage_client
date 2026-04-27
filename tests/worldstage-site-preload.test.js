#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildWorldStageSiteUpdaterBannerModel } = require('../lib/worldstage-site-updater-banner');

const preloadPath = path.join(__dirname, '..', 'desktop', 'worldstage-site-preload.js');
const preloadSource = fs.readFileSync(preloadPath, 'utf8');

const sandbox = {
  Promise,
  Math,
  Number,
  String,
  window: {
    location: {
      pathname: '/worldstage'
    },
    history: {
      pushState() {},
      replaceState() {}
    },
    addEventListener() {},
    setTimeout() {},
    clearTimeout() {}
  },
  document: {
    readyState: 'loading',
    body: {},
    documentElement: {}
  },
  require(moduleName) {
    assert.equal(moduleName, 'electron', 'Sandboxed preload should only require the Electron bridge.');
    return {
      contextBridge: {
        exposeInMainWorld() {}
      },
      ipcRenderer: {
        invoke() {
          return Promise.resolve({});
        },
        on() {},
        removeListener() {}
      }
    };
  }
};

vm.createContext(sandbox);
vm.runInContext(preloadSource, sandbox, {
  filename: preloadPath
});

assert.equal(typeof sandbox.buildWorldStageSiteUpdaterBannerModel, 'function', 'Expected preload to keep the banner model locally.');
assert.equal(typeof sandbox.buildWorldStageDesktopExitButtonModel, 'function', 'Expected preload to keep the desktop exit control model locally.');
assert.equal(typeof sandbox.buildWorldStageDesktopDragModel, 'function', 'Expected preload to keep the desktop drag model locally.');
assert.equal(typeof sandbox.buildWorldStageDesktopClientDownloadControlModel, 'function', 'Expected preload to keep the client download control model locally.');
assert.equal(typeof sandbox.isWorldStageClientDownloadControl, 'function', 'Expected preload to keep the client download control matcher locally.');
assert.equal(typeof sandbox.isWorldStageHostedVideosNavControl, 'function', 'Expected preload to keep the hosted videos nav matcher locally.');
assert.equal(typeof sandbox.buildWorldStageDesktopNavLayoutModel, 'function', 'Expected preload to keep the desktop nav layout model locally.');

assert.deepEqual(
  sandbox.buildWorldStageDesktopExitButtonModel({
    platform: 'linux',
    frameless: false,
    exitButtonVisible: false
  }),
  {
    visible: false,
    reason: 'unsupported_platform'
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopExitButtonModel({
    platform: 'win32',
    frameless: false,
    exitButtonVisible: false
  }),
  {
    visible: false,
    reason: 'native_chrome_available'
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopExitButtonModel({
    platform: 'win32',
    frameless: true,
    exitButtonVisible: true,
    pathname: '/worldstage-login'
  }),
  {
    visible: true,
    actionId: 'exit',
    label: 'X',
    position: 'top-right'
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopExitButtonModel({
    platform: 'win32',
    frameless: true,
    exitButtonVisible: true,
    pathname: '/worldstage'
  }),
  {
    visible: true,
    actionId: 'exit',
    label: 'X',
    position: 'top-right'
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopDragModel({
    platform: 'linux',
    frameless: false,
    exitButtonVisible: false
  }),
  {
    enabled: false,
    reason: 'unsupported_platform'
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopDragModel({
    platform: 'win32',
    frameless: false,
    exitButtonVisible: false
  }),
  {
    enabled: false,
    reason: 'native_chrome_available'
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopDragModel({
    platform: 'win32',
    frameless: true,
    exitButtonVisible: false
  }),
  {
    enabled: true
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopDragModel({
    platform: 'win32',
    frameless: false,
    exitButtonVisible: true
  }),
  {
    enabled: true
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopClientDownloadControlModel({
    desktopClient: true,
    frameless: false,
    exitButtonVisible: false
  }),
  {
    hidden: true
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopClientDownloadControlModel({
    desktopClient: false,
    frameless: true,
    exitButtonVisible: false
  }),
  {
    hidden: true
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopClientDownloadControlModel({
    desktopClient: false,
    frameless: false,
    exitButtonVisible: false
  }),
  {
    hidden: false,
    reason: 'browser_context'
  }
);

assert.equal(
  sandbox.isWorldStageClientDownloadControl({
    textContent: 'Download World\nStage Local Client',
    getAttribute() {
      return '';
    }
  }),
  true
);

assert.equal(
  sandbox.isWorldStageClientDownloadControl({
    textContent: 'Get the client',
    getAttribute(name) {
      return name === 'href' ? '/downloads/worldstage-client/windows' : '';
    }
  }),
  true
);

assert.equal(
  sandbox.isWorldStageClientDownloadControl({
    textContent: 'My Account',
    getAttribute() {
      return '/worldstage/account';
    }
  }),
  false
);

assert.equal(
  sandbox.isWorldStageHostedVideosNavControl({
    id: 'worldstage-hosted-videos',
    textContent: 'Hosted Videos',
    className: 'worldstage-topbar-btn worldstage-topbar-btn-neutral',
    getAttribute() {
      return '';
    }
  }),
  true
);

assert.equal(
  sandbox.isWorldStageHostedVideosNavControl({
    textContent: 'Hosted Videos',
    className: 'worldstage-topbar-btn worldstage-topbar-btn-neutral',
    getAttribute() {
      return '';
    }
  }),
  true
);

assert.equal(
  sandbox.isWorldStageHostedVideosNavControl({
    textContent: 'Hosted Videos',
    className: 'worldstage-account-menu-trigger',
    getAttribute() {
      return '';
    }
  }),
  false,
  'Only the redundant topbar Hosted Videos control should be hidden.'
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopNavLayoutModel({
    desktopClient: true,
    frameless: false,
    exitButtonVisible: false
  }),
  {
    enabled: true
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopNavLayoutModel({
    desktopClient: false,
    frameless: true,
    exitButtonVisible: false
  }),
  {
    enabled: true
  }
);

assert.deepEqual(
  sandbox.buildWorldStageDesktopNavLayoutModel({
    desktopClient: false,
    frameless: false,
    exitButtonVisible: false
  }),
  {
    enabled: false,
    reason: 'browser_context'
  }
);

const cases = [
  {
    platform: 'linux',
    pathname: '/worldstage',
    updater: {
      enabled: true,
      downloaded: true
    }
  },
  {
    platform: 'win32',
    pathname: '/worldstage',
    updater: {
      enabled: true,
      currentVersion: '0.1.1',
      latestVersion: '0.1.2',
      downloaded: true,
      releaseUrl: 'https://github.com/5310S/worldstage_client/releases/latest'
    }
  },
  {
    platform: 'win32',
    pathname: '/worldstage/account',
    updater: {
      enabled: true,
      currentVersion: '0.1.1',
      latestVersion: '0.1.2',
      lastResult: 'downloading_update',
      available: true,
      progressPercent: 42,
      releaseUrl: 'https://github.com/5310S/worldstage_client/releases/latest'
    }
  },
  {
    platform: 'win32',
    pathname: '/worldstage',
    updater: {
      enabled: true,
      lastResult: 'update_error',
      lastError: 'github_rate_limited'
    }
  }
];

for (const input of cases) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.buildWorldStageSiteUpdaterBannerModel(input))),
    buildWorldStageSiteUpdaterBannerModel(input)
  );
}

console.log('worldstage-site-preload.test.js: ok');
