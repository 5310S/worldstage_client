#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_LINUX_AUTOSTART_FILE_NAME,
  buildLinuxAutostartDesktopEntry,
  linuxAutostartFilePath,
  resolveLaunchCommand,
  syncLaunchOnLogin,
  syncLinuxAutostart
} = require('../lib/launch-on-login');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstage-launch-on-login-'));

try {
  const resolvedDev = resolveLaunchCommand({
    execPath: '/opt/electron',
    argv: ['/opt/electron', '/srv/worldstage_client'],
    defaultApp: true
  });
  assert.deepEqual(resolvedDev, {
    command: '/opt/electron',
    args: ['/srv/worldstage_client']
  });

  const resolvedPackaged = resolveLaunchCommand({
    execPath: '/opt/WorldStage/worldstage-client',
    defaultApp: false
  });
  assert.deepEqual(resolvedPackaged, {
    command: '/opt/WorldStage/worldstage-client',
    args: []
  });

  const desktopEntry = buildLinuxAutostartDesktopEntry({
    execPath: '/opt/WorldStage/worldstage-client',
    appName: 'WorldStage Client'
  });
  assert.match(desktopEntry, /\[Desktop Entry\]/);
  assert.match(desktopEntry, /Name=WorldStage Client/);
  assert.match(desktopEntry, /Exec="\/opt\/WorldStage\/worldstage-client"/);

  const autostartPath = linuxAutostartFilePath({
    autostartDirectory: tmpDir
  });
  assert.equal(autostartPath, path.join(tmpDir, DEFAULT_LINUX_AUTOSTART_FILE_NAME));

  const syncedLinux = syncLinuxAutostart({
    enabled: true,
    execPath: '/opt/WorldStage/worldstage-client',
    autostartDirectory: tmpDir
  });
  assert.equal(syncedLinux.supported, true);
  assert.equal(syncedLinux.enabled, true);
  assert.equal(fs.existsSync(syncedLinux.filePath), true);
  assert.match(fs.readFileSync(syncedLinux.filePath, 'utf8'), /worldstage-client/);

  const unsyncedLinux = syncLinuxAutostart({
    enabled: false,
    execPath: '/opt/WorldStage/worldstage-client',
    autostartDirectory: tmpDir
  });
  assert.equal(unsyncedLinux.enabled, false);
  assert.equal(fs.existsSync(unsyncedLinux.filePath), false);

  const loginItemCalls = [];
  const syncedWindows = syncLaunchOnLogin({
    platform: 'win32',
    enabled: true,
    execPath: 'C:\\Program Files\\WorldStage\\WorldStage Client.exe',
    defaultApp: false,
    setLoginItemSettings: (payload) => {
      loginItemCalls.push(payload);
    }
  });
  assert.equal(syncedWindows.supported, true);
  assert.equal(syncedWindows.enabled, true);
  assert.equal(syncedWindows.strategy, 'electron_login_item');
  assert.deepEqual(loginItemCalls[0], {
    openAtLogin: true,
    openAsHidden: true
  });

  const syncedDevMac = syncLaunchOnLogin({
    platform: 'darwin',
    enabled: false,
    execPath: '/Applications/Electron.app/Contents/MacOS/Electron',
    argv: ['/Applications/Electron.app/Contents/MacOS/Electron', '/srv/worldstage_client'],
    defaultApp: true,
    setLoginItemSettings: (payload) => {
      loginItemCalls.push(payload);
    }
  });
  assert.equal(syncedDevMac.enabled, false);
  assert.deepEqual(loginItemCalls[1], {
    openAtLogin: false,
    openAsHidden: false,
    path: '/Applications/Electron.app/Contents/MacOS/Electron',
    args: ['/srv/worldstage_client']
  });

  const unsupported = syncLaunchOnLogin({
    platform: 'freebsd',
    enabled: true
  });
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.strategy, 'unsupported');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('launch-on-login.test.js: ok');
