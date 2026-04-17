#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const mainProcessJs = fs.readFileSync(path.join(repoRoot, 'desktop', 'main.js'), 'utf8');
const localShellHtml = fs.readFileSync(path.join(repoRoot, 'desktop', 'worldstage-shell', 'worldstage.html'), 'utf8');
const localShellSpaceJs = fs.readFileSync(path.join(repoRoot, 'desktop', 'worldstage-shell', 'worldstage-space.js'), 'utf8');
const localThreePath = path.join(repoRoot, 'desktop', 'worldstage-shell', 'three.module.js');

assert.match(
  mainProcessJs,
  /mainWindow\.loadURL\(currentWorldStageSiteUrl\('\/worldstage-login'\)\)/,
  'Expected the main window to boot into the hosted WorldStage login shell.'
);
assert.match(
  mainProcessJs,
  /WORLDSTAGE_SITE_PARTITION/,
  'Expected the hosted WorldStage shell to use the persistent site partition.'
);
assert.match(
  mainProcessJs,
  /title:\s*'5310S - WorldStage'/,
  'Expected the desktop shell to match the hosted WorldStage title.'
);
assert.match(
  mainProcessJs,
  /protocol\.handle\('https'/,
  'Expected Electron to serve the WorldStage shell locally through the site partition protocol handler.'
);
assert.match(
  mainProcessJs,
  /worldstage-shell/,
  'Expected the desktop shell to read local WorldStage shell assets from this repo.'
);
assert.match(localShellHtml, /id="worldstage-auth-login"/, 'Expected the local shell to include the WorldStage login button.');
assert.match(localShellHtml, /id="worldstage-auth-register"/, 'Expected the local shell to include the WorldStage register button.');
assert.match(localShellHtml, /id="worldstage-onboarding"/, 'Expected the local shell to include the onboarding frame.');
assert.match(localShellHtml, /worldstage-space\.js\?v=20260415a/, 'Expected the local shell to load the copied WorldStage starfield module.');
assert.match(localShellSpaceJs, /import \* as THREE from '\.\/three\.module\.js';/, 'Expected the local starfield module to use the local Three.js bundle.');
assert.equal(fs.existsSync(localThreePath), true, 'Expected the local Three.js bundle to be present.');

console.log('worldstage-client-ui.test.js: ok');
