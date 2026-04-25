#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const EXPECTED_RELEASE_ARTIFACTS = Object.freeze({
  mac: {
    universal: {
      artifacts: ['WorldStageClient-mac-universal.dmg'],
      metadata: 'latest-mac.yml',
      updatePath: 'WorldStageClient-mac-universal.dmg',
      rejectPatterns: [/^WorldStageClient-mac-(?!universal\.dmg$).+\.dmg$/]
    }
  },
  windows: {
    x64: {
      artifacts: ['WorldStageClient-windows-x64.exe'],
      metadata: 'latest.yml',
      updatePath: 'WorldStageClient-windows-x64.exe',
      rejectPatterns: []
    }
  },
  linux: {
    x64: {
      artifacts: [
        'WorldStageClient-linux-x64.AppImage',
        'WorldStageClient-linux-x64.deb',
        'WorldStageClient-linux-x64.rpm',
        'WorldStageClient-linux-x64.pacman'
      ],
      metadata: 'latest-linux.yml',
      updatePath: 'WorldStageClient-linux-x64.AppImage',
      rejectPatterns: []
    },
    arm64: {
      artifacts: [
        'WorldStageClient-linux-arm64.AppImage',
        'WorldStageClient-linux-arm64.deb',
        'WorldStageClient-linux-arm64.rpm',
        'WorldStageClient-linux-arm64.pacman'
      ],
      metadata: '',
      updatePath: '',
      rejectPatterns: []
    }
  }
});

function normalizeText(value) {
  return String(value || '').trim();
}

function parseBoolean(value) {
  return /^(1|true|yes)$/i.test(normalizeText(value));
}

function resolveExpectedReleaseArtifacts(target, arch) {
  const normalizedTarget = normalizeText(target);
  const normalizedArch = normalizeText(arch);
  const byTarget = EXPECTED_RELEASE_ARTIFACTS[normalizedTarget];
  const expected = byTarget && byTarget[normalizedArch];
  if (!expected) {
    throw new Error(`Unsupported release artifact target: ${normalizedTarget || '(missing)'} ${normalizedArch || '(missing)'}`);
  }
  return expected;
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function readPackageVersion(cwd) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  return normalizeText(packageJson.version);
}

function verifyReleaseArtifacts(options = {}) {
  const cwd = options.cwd || process.cwd();
  const target = options.target;
  const arch = options.arch;
  const releaseDir = options.releaseDir || path.join(cwd, 'release');
  const requireMetadata = options.requireMetadata === true;
  const expected = resolveExpectedReleaseArtifacts(target, arch);
  const entries = fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : [];

  for (const artifactName of expected.artifacts) {
    assertFileExists(path.join(releaseDir, artifactName), 'release artifact');
  }

  for (const pattern of expected.rejectPatterns) {
    const unexpected = entries.filter((entry) => pattern.test(entry));
    if (unexpected.length > 0) {
      throw new Error(`Unexpected release artifact for ${target} ${arch}: ${unexpected.join(', ')}`);
    }
  }

  if (requireMetadata) {
    if (!expected.metadata) {
      throw new Error(`No updater metadata is expected for ${target} ${arch}`);
    }
    const metadataPath = path.join(releaseDir, expected.metadata);
    assertFileExists(metadataPath, 'updater metadata');

    const metadata = fs.readFileSync(metadataPath, 'utf8');
    const packageVersion = readPackageVersion(cwd);
    if (!metadata.includes(`version: ${packageVersion}`)) {
      throw new Error(`${expected.metadata} does not match package version ${packageVersion}`);
    }
    if (!metadata.includes(`url: ${expected.updatePath}`) || !metadata.includes(`path: ${expected.updatePath}`)) {
      throw new Error(`${expected.metadata} does not point at ${expected.updatePath}`);
    }
  }

  return {
    target,
    arch,
    releaseDir,
    artifacts: expected.artifacts.slice(),
    metadata: requireMetadata ? expected.metadata : ''
  };
}

if (require.main === module) {
  try {
    const [target, arch, requireMetadataValue] = process.argv.slice(2);
    const result = verifyReleaseArtifacts({
      target,
      arch,
      requireMetadata: parseBoolean(requireMetadataValue)
    });
    const metadata = result.metadata ? ` and ${result.metadata}` : '';
    console.log(`Verified ${result.target} ${result.arch} release artifacts${metadata}.`);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_RELEASE_ARTIFACTS,
  parseBoolean,
  resolveExpectedReleaseArtifacts,
  verifyReleaseArtifacts
};
