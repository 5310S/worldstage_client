#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const packageSource = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'desktop', 'main.js'), 'utf8');
const worldstageSitePreloadSource = fs.readFileSync(path.join(root, 'desktop', 'worldstage-site-preload.js'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const releaseHandoff = fs.readFileSync(path.join(root, 'RELEASE_HANDOFF_WINDOWS_MAC.txt'), 'utf8');

const nsis = packageJson.build && packageJson.build.nsis;

assert.ok(nsis && typeof nsis === 'object', 'Expected a Windows NSIS installer config block.');
assert.deepEqual(packageJson.build.win.target, ['nsis'], 'Windows builds must continue to produce an NSIS installer.');
assert.equal(packageJson.build.win.artifactName, 'WorldStageClient-windows-x64.${ext}', 'Windows installer release asset name must remain stable.');

assert.equal(nsis.oneClick, false, 'Installer must use assisted mode so users see setup/finish pages.');
assert.notEqual(nsis.oneClick, true, 'Installer must not regress to one-click silent flow.');
assert.match(packageSource, /"oneClick"\s*:\s*false/, 'package.json should explicitly disable one-click NSIS mode.');
assert.doesNotMatch(packageSource, /"oneClick"\s*:\s*true/, 'package.json must not enable one-click NSIS mode anywhere.');

assert.equal(nsis.runAfterFinish, true, 'Installer finish page should expose the launch checkbox after success.');
assert.match(packageSource, /"runAfterFinish"\s*:\s*true/, 'package.json should explicitly keep the finish-page launch option enabled.');
assert.doesNotMatch(packageSource, /"runAfterFinish"\s*:\s*false/, 'package.json must not disable the finish-page launch option.');

assert.equal(nsis.createDesktopShortcut, 'always', 'Installer should still create a desktop shortcut.');
assert.equal(nsis.createStartMenuShortcut, true, 'Installer should still create a Start Menu shortcut.');
assert.equal(nsis.perMachine, false, 'Installer should remain a per-user install by default.');
assert.equal(nsis.allowElevation, true, 'Installer should still be able to elevate when needed.');

assert.match(mainSource, /frame:\s*process\.platform\s*!==\s*'win32'/, 'Windows main window should be frameless so the native title row is not shown.');
assert.match(mainSource, /ipcMain\.handle\('worldstage-site:exit-app'/, 'Windows frameless shell should expose an exit IPC handler.');
assert.match(worldstageSitePreloadSource, /data-shell-action="exit"/, 'Windows frameless shell should render an in-page Exit button.');
assert.match(worldstageSitePreloadSource, /position:\s*'top-right'/, 'Exit button should be anchored at the top-right on login and authenticated pages.');
assert.match(worldstageSitePreloadSource, /top:\s*8px/, 'Exit button should sit near the top-right window corner.');
assert.match(worldstageSitePreloadSource, /border-radius:\s*50%/, 'Exit button should render as a circle.');

assert.match(readme, /Windows NSIS is configured for an assisted install/, 'README should document the assisted Windows installer flow.');
assert.match(readme, /finish-page launch checkbox/, 'README should mention the finish-page launch checkbox.');
assert.match(readme, /instead of silently auto-launching after setup/, 'README should explain that install success no longer silently auto-launches.');
assert.doesNotMatch(readme, /one-click install with desktop\/start-menu shortcuts and auto-launch after setup/, 'README must not describe the old one-click auto-launch behavior.');

assert.match(releaseHandoff, /NSIS assisted install reaches a successful finish page/, 'Windows handoff should require verifying the successful finish page.');
assert.match(releaseHandoff, /finish page offers the launch checkbox/, 'Windows handoff should require verifying the launch checkbox.');
assert.match(releaseHandoff, /app launches from the finish page only when the launch checkbox is selected/, 'Windows handoff should require verifying opt-in launch behavior.');
assert.doesNotMatch(releaseHandoff, /NSIS one-click install works/, 'Windows handoff must not keep the old one-click install acceptance criterion.');
assert.doesNotMatch(releaseHandoff, /app auto-launches after install/, 'Windows handoff must not keep the old auto-launch acceptance criterion.');

console.log('windows-installer-ux.test.js: ok');
