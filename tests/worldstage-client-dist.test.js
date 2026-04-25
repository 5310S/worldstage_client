#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const {
  OPTIONAL_ENV_KEYS,
  buildDesktopDistEnv,
  resolveDesktopDistCommand
} = require('../scripts/worldstage-client-dist');
const {
  RELEASE_ASSET_NAMES,
  resolveWorldStageReleaseConfig
} = require('../lib/worldstage-release');

async function main() {
  const repoRoot = path.join(__dirname, '..');
  const packageJson = require(path.join(repoRoot, 'package.json'));

  assert.equal(
    packageJson.scripts['desktop:dist'],
    'node scripts/worldstage-client-dist.js',
    'Expected client packaging to flow through the env-sanitizing wrapper.'
  );
  assert.deepEqual(
    OPTIONAL_ENV_KEYS,
    [
      'GH_TOKEN',
      'CSC_LINK',
      'CSC_KEY_PASSWORD',
      'APPLE_API_KEY',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID'
    ],
    'Expected desktop packaging to sanitize all optional signing and release env vars.'
  );

  const commandSpec = resolveDesktopDistCommand();
  assert.equal(commandSpec.command, process.execPath, 'Expected desktop packaging to invoke electron-builder through the active Node runtime.');
  assert.equal(commandSpec.args[0], require.resolve('electron-builder/out/cli/cli.js'));
  assert.deepEqual(commandSpec.args.slice(1), ['--publish', 'never']);
  const publishCommandSpec = resolveDesktopDistCommand({
    env: {
      WORLDSTAGE_CLIENT_PUBLISH: 'always'
    }
  });
  assert.deepEqual(publishCommandSpec.args.slice(1), ['--publish', 'always']);

  assert.equal(packageJson.build.productName, 'WorldStage Client', 'Expected a dedicated desktop product name.');
  assert.deepEqual(packageJson.build.publish, [{
    provider: 'github',
    owner: '5310S',
    repo: 'worldstage_client',
    releaseType: 'release'
  }], 'Expected packaged clients to publish through the WorldStage GitHub release repo.');
  assert.deepEqual(packageJson.build.protocols, [{
    name: 'WorldStage Connection Link',
    schemes: ['worldstage']
  }], 'Expected packaged clients to register the WorldStage pairing protocol.');
  assert.deepEqual(packageJson.build.mac.target, ['dmg'], 'Expected mac packaging target.');
  assert.equal(packageJson.build.mac.artifactName, 'WorldStageClient-mac-${arch}.${ext}', 'Expected mac packaging to produce architecture-specific asset names.');
  assert.equal(packageJson.build.mac.hardenedRuntime, true, 'Expected mac release builds to use the hardened runtime required for notarization.');
  assert.equal(packageJson.build.mac.gatekeeperAssess, false, 'Expected mac release builds to leave Gatekeeper assessment to notarization/stapling.');
  assert.equal(packageJson.build.mac.notarize, true, 'Expected mac release builds to enable notarization when Apple credentials are present.');
  assert.deepEqual(packageJson.build.win.target, ['nsis'], 'Expected Windows packaging target.');
  assert.equal(packageJson.build.win.artifactName, 'WorldStageClient-windows-${arch}.${ext}', 'Expected Windows packaging to keep stable per-arch asset names.');
  assert.deepEqual(packageJson.build.linux.target, ['AppImage', 'deb', 'rpm', 'pacman'], 'Expected Linux packaging targets to cover AppImage, Debian, RPM, and Arch packages.');
  assert.equal(packageJson.build.linux.artifactName, 'WorldStageClient-linux-${arch}.${ext}', 'Expected Linux packaging to produce architecture-specific asset names.');

  const env = buildDesktopDistEnv({
    PATH: '/usr/bin',
    GH_TOKEN: '',
    CSC_LINK: '   ',
    CSC_KEY_PASSWORD: '',
    APPLE_API_KEY: '',
    APPLE_API_KEY_ID: '',
    APPLE_API_ISSUER: '',
    APPLE_ID: '',
    APPLE_APP_SPECIFIC_PASSWORD: '',
    APPLE_TEAM_ID: '',
    CSC_IDENTITY_AUTO_DISCOVERY: '',
    WORLDSTAGE_CLIENT_ENV: 'test'
  });

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.WORLDSTAGE_CLIENT_ENV, 'test');
  assert.equal('GH_TOKEN' in env, false);
  assert.equal('CSC_LINK' in env, false);
  assert.equal('CSC_KEY_PASSWORD' in env, false);
  assert.equal('APPLE_API_KEY' in env, false);
  assert.equal('APPLE_API_KEY_ID' in env, false);
  assert.equal('APPLE_API_ISSUER' in env, false);
  assert.equal('APPLE_ID' in env, false);
  assert.equal('APPLE_APP_SPECIFIC_PASSWORD' in env, false);
  assert.equal('APPLE_TEAM_ID' in env, false);
  assert.equal('CSC_IDENTITY_AUTO_DISCOVERY' in env, false);

  const release = resolveWorldStageReleaseConfig();
  assert.equal(RELEASE_ASSET_NAMES.macos, 'WorldStageClient-mac-universal.dmg', 'Expected the public mac download asset to stay universal.');
  assert.equal(
    release.downloads.macos,
    'https://github.com/5310S/worldstage_client/releases/latest/download/WorldStageClient-mac-universal.dmg',
    'Expected public mac downloads to point at the universal DMG.'
  );

  console.log('worldstage-client-dist.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
