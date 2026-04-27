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
const worldstagePageSource = fs.readFileSync(path.join(root, 'desktop', 'worldstage', 'worldstage.html'), 'utf8');
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
assert.match(worldstageSitePreloadSource, /top:\s*0/, 'Exit button should sit flush against the top window edge.');
assert.match(worldstageSitePreloadSource, /right:\s*0/, 'Exit button should sit flush against the right window edge.');
assert.match(worldstageSitePreloadSource, /border-left:\s*1px solid/, 'Exit button should draw its visible left edge.');
assert.match(worldstageSitePreloadSource, /border-bottom:\s*1px solid/, 'Exit button should draw its visible bottom edge.');
assert.match(worldstageSitePreloadSource, /border-top:\s*0/, 'Exit button should use the top window edge instead of drawing a top border.');
assert.match(worldstageSitePreloadSource, /border-right:\s*0/, 'Exit button should use the right window edge instead of drawing a right border.');
assert.match(worldstageSitePreloadSource, /buildWorldStageDesktopDragModel/, 'Windows frameless shell should model draggable window support.');
assert.match(worldstageSitePreloadSource, /-webkit-app-region:\s*drag/, 'Windows frameless shell should make non-control page regions draggable.');
assert.match(worldstageSitePreloadSource, /-webkit-app-region:\s*no-drag/, 'Windows frameless shell should keep controls clickable inside draggable windows.');
assert.match(mainSource, /desktopClient:\s*true/, 'WorldStage site shell state should mark that it is running in the desktop client.');
assert.match(worldstageSitePreloadSource, /Download World\\nStage Local Client|download world stage local client/i, 'Desktop client should identify the public local-client download button.');
assert.match(worldstageSitePreloadSource, /CLIENT_DOWNLOAD_HIDDEN_ATTR/, 'Desktop client should hide the redundant local-client download button.');
assert.match(worldstageSitePreloadSource, /worldstage-desktop-client-nav-layout/, 'Desktop client should install a dedicated responsive nav layout.');
assert.match(worldstageSitePreloadSource, /worldstage-topbar-center[\s\S]*left:\s*50%/, 'Desktop nav search should stay centered in the window.');
assert.doesNotMatch(worldstageSitePreloadSource, /worldStageDesktopNavLeftButtonCount/, 'Desktop nav should not move buttons between containers with measurement-driven layout code.');
assert.match(worldstageSitePreloadSource, /#worldstage-hosted-videos[\s\S]*display:\s*none/, 'Desktop client should hide the redundant topbar Hosted Videos button from the hosted page.');
assert.doesNotMatch(worldstagePageSource, /id="worldstage-hosted-videos"/, 'Bundled WorldStage page should not render the redundant topbar Hosted Videos button.');
assert.match(worldstageSitePreloadSource, /@media\s*\(max-width:\s*900px\)/, 'Desktop nav should include tablet-specific layout rules.');
assert.match(worldstageSitePreloadSource, /@media\s*\(max-width:\s*700px\)/, 'Desktop nav should include mobile-specific layout rules.');

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
