#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const RELEASE_ARTIFACT_RENAMES = Object.freeze({
  'WorldStageClient-linux-x86_64.AppImage': 'WorldStageClient-linux-x64.AppImage',
  'WorldStageClient-linux-x86_64.AppImage.blockmap': 'WorldStageClient-linux-x64.AppImage.blockmap',
  'WorldStageClient-linux-amd64.deb': 'WorldStageClient-linux-x64.deb',
  'WorldStageClient-linux-x86_64.rpm': 'WorldStageClient-linux-x64.rpm',
  'WorldStageClient-linux-aarch64.rpm': 'WorldStageClient-linux-arm64.rpm',
  'WorldStageClient-linux-aarch64.pacman': 'WorldStageClient-linux-arm64.pacman'
});

function normalizeReleaseArtifacts(options = {}) {
  const cwd = options.cwd || process.cwd();
  const releaseDir = options.releaseDir || path.join(cwd, 'release');
  const renamed = [];

  if (!fs.existsSync(releaseDir)) {
    return {
      releaseDir,
      renamed
    };
  }

  for (const [sourceName, targetName] of Object.entries(RELEASE_ARTIFACT_RENAMES)) {
    const sourcePath = path.join(releaseDir, sourceName);
    const targetPath = path.join(releaseDir, targetName);
    if (!fs.existsSync(sourcePath)) continue;
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { force: true });
    fs.renameSync(sourcePath, targetPath);
    renamed.push({
      from: sourceName,
      to: targetName
    });
  }

  const latestLinuxPath = path.join(releaseDir, 'latest-linux.yml');
  if (fs.existsSync(latestLinuxPath)) {
    let metadata = fs.readFileSync(latestLinuxPath, 'utf8');
    for (const [sourceName, targetName] of Object.entries(RELEASE_ARTIFACT_RENAMES)) {
      metadata = metadata.split(sourceName).join(targetName);
    }
    fs.writeFileSync(latestLinuxPath, metadata);
  }

  return {
    releaseDir,
    renamed
  };
}

if (require.main === module) {
  try {
    const result = normalizeReleaseArtifacts();
    if (result.renamed.length === 0) {
      console.log('No release artifacts needed normalization.');
    } else {
      for (const entry of result.renamed) {
        console.log(`Normalized ${entry.from} -> ${entry.to}`);
      }
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = {
  RELEASE_ARTIFACT_RENAMES,
  normalizeReleaseArtifacts
};
