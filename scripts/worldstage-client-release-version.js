#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function normalizeText(value) {
  return String(value || '').trim();
}

function tagToVersion(tag) {
  const normalized = normalizeText(tag).replace(/^refs\/tags\//, '');
  const version = normalized.startsWith('v') ? normalized.slice(1) : normalized;
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid release version tag: ${tag}`);
  }
  return version;
}

function resolveReleaseVersion(source = process.env) {
  const explicitVersion = normalizeText(source.WORLDSTAGE_CLIENT_RELEASE_VERSION);
  if (explicitVersion) return tagToVersion(explicitVersion);

  const explicitTag = normalizeText(source.WORLDSTAGE_CLIENT_RELEASE_TAG);
  if (explicitTag) return tagToVersion(explicitTag);

  const githubRefType = normalizeText(source.GITHUB_REF_TYPE);
  const githubRefName = normalizeText(source.GITHUB_REF_NAME);
  if (githubRefType === 'tag' && githubRefName) return tagToVersion(githubRefName);

  const githubRef = normalizeText(source.GITHUB_REF);
  if (githubRef.startsWith('refs/tags/')) return tagToVersion(githubRef);

  return '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function syncPackageVersionForRelease(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const version = resolveReleaseVersion(env);
  if (!version) {
    return {
      version: '',
      changed: false,
      files: []
    };
  }

  const changedFiles = [];
  const packageJsonPath = path.join(cwd, 'package.json');
  const packageLockPath = path.join(cwd, 'package-lock.json');

  const packageJson = readJson(packageJsonPath);
  if (packageJson.version !== version) {
    packageJson.version = version;
    writeJson(packageJsonPath, packageJson);
    changedFiles.push(packageJsonPath);
  }

  if (fs.existsSync(packageLockPath)) {
    const packageLock = readJson(packageLockPath);
    let lockChanged = false;
    if (packageLock.version !== version) {
      packageLock.version = version;
      lockChanged = true;
    }
    if (packageLock.packages && packageLock.packages[''] && packageLock.packages[''].version !== version) {
      packageLock.packages[''].version = version;
      lockChanged = true;
    }
    if (lockChanged) {
      writeJson(packageLockPath, packageLock);
      changedFiles.push(packageLockPath);
    }
  }

  return {
    version,
    changed: changedFiles.length > 0,
    files: changedFiles
  };
}

if (require.main === module) {
  try {
    const result = syncPackageVersionForRelease();
    if (result.version) {
      const action = result.changed ? 'Synced' : 'Verified';
      console.log(`${action} WorldStage Client package version ${result.version}`);
    } else {
      console.log('No release tag provided; package version left unchanged.');
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = {
  resolveReleaseVersion,
  syncPackageVersionForRelease,
  tagToVersion
};
