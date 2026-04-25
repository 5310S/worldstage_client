#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseBoolean,
  resolveExpectedReleaseArtifacts,
  verifyReleaseArtifacts
} = require('../scripts/verify-release-artifacts');

function writeFile(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true
  });
  fs.writeFileSync(filePath, content);
}

async function main() {
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('1'), true);
  assert.equal(parseBoolean('false'), false);
  assert.deepEqual(
    resolveExpectedReleaseArtifacts('mac', 'universal').artifacts,
    ['WorldStageClient-mac-universal.dmg'],
    'Expected mac releases to require the universal DMG.'
  );
  assert.equal(
    resolveExpectedReleaseArtifacts('linux', 'arm64').metadata,
    '',
    'Expected Linux ARM64 builds to skip updater metadata until an ARM64 update feed exists.'
  );
  assert.throws(() => resolveExpectedReleaseArtifacts('mac', 'x64'), /Unsupported release artifact target/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstage-release-artifacts-'));
  const releaseDir = path.join(tmpDir, 'release');
  writeFile(path.join(tmpDir, 'package.json'), `${JSON.stringify({
    name: 'worldstage-client',
    version: '0.1.9'
  }, null, 2)}\n`);
  writeFile(path.join(releaseDir, 'WorldStageClient-mac-universal.dmg'));
  writeFile(path.join(releaseDir, 'latest-mac.yml'), [
    'version: 0.1.9',
    'files:',
    '  - url: WorldStageClient-mac-universal.dmg',
    'path: WorldStageClient-mac-universal.dmg',
    ''
  ].join('\n'));

  const result = verifyReleaseArtifacts({
    cwd: tmpDir,
    target: 'mac',
    arch: 'universal',
    releaseDir,
    requireMetadata: true
  });
  assert.deepEqual(result.artifacts, ['WorldStageClient-mac-universal.dmg']);
  assert.equal(result.metadata, 'latest-mac.yml');

  writeFile(path.join(releaseDir, 'WorldStageClient-mac-x64.dmg'));
  assert.throws(() => verifyReleaseArtifacts({
    cwd: tmpDir,
    target: 'mac',
    arch: 'universal',
    releaseDir,
    requireMetadata: true
  }), /Unexpected release artifact/);

  console.log('worldstage-client-release-artifacts.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
