#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveReleaseVersion,
  syncPackageVersionForRelease,
  tagToVersion
} = require('../scripts/worldstage-client-release-version');

async function main() {
  assert.equal(tagToVersion('v1.2.3'), '1.2.3');
  assert.equal(tagToVersion('refs/tags/v1.2.3'), '1.2.3');
  assert.equal(resolveReleaseVersion({
    WORLDSTAGE_CLIENT_RELEASE_VERSION: '2.3.4'
  }), '2.3.4');
  assert.equal(resolveReleaseVersion({
    WORLDSTAGE_CLIENT_RELEASE_TAG: 'v2.3.4'
  }), '2.3.4');
  assert.equal(resolveReleaseVersion({
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'v2.3.5'
  }), '2.3.5');
  assert.equal(resolveReleaseVersion({
    GITHUB_REF: 'refs/tags/v2.3.6'
  }), '2.3.6');
  assert.equal(resolveReleaseVersion({
    GITHUB_REF_TYPE: 'branch',
    GITHUB_REF_NAME: 'main'
  }), '');
  assert.throws(() => tagToVersion('release-candidate'), /Invalid release version tag/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldstage-release-version-'));
  fs.writeFileSync(path.join(tmpDir, 'package.json'), `${JSON.stringify({
    name: 'worldstage-client',
    version: '0.1.0'
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), `${JSON.stringify({
    name: 'worldstage-client',
    version: '0.1.0',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'worldstage-client',
        version: '0.1.0'
      }
    }
  }, null, 2)}\n`);

  const result = syncPackageVersionForRelease({
    cwd: tmpDir,
    env: {
      WORLDSTAGE_CLIENT_RELEASE_TAG: 'v3.4.5'
    }
  });

  assert.equal(result.version, '3.4.5');
  assert.equal(result.changed, true);

  const packageJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package-lock.json'), 'utf8'));
  assert.equal(packageJson.version, '3.4.5');
  assert.equal(packageLock.version, '3.4.5');
  assert.equal(packageLock.packages[''].version, '3.4.5');

  const noopResult = syncPackageVersionForRelease({
    cwd: tmpDir,
    env: {}
  });
  assert.equal(noopResult.version, '');
  assert.equal(noopResult.changed, false);

  console.log('worldstage-client-release-version.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
