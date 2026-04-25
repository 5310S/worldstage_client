'use strict';

const DEFAULT_RELEASE_OWNER = '5310S';
const DEFAULT_RELEASE_REPO = 'worldstage_client';
const RELEASE_ASSET_NAMES = Object.freeze({
  windows: 'WorldStageClient-windows-x64.exe',
  macos: 'WorldStageClient-mac-universal.dmg',
  linuxAppImage: 'WorldStageClient-linux-x64.AppImage',
  linuxAppImageArm64: 'WorldStageClient-linux-arm64.AppImage',
  linuxDeb: 'WorldStageClient-linux-x64.deb',
  linuxDebArm64: 'WorldStageClient-linux-arm64.deb',
  linuxRpm: 'WorldStageClient-linux-x64.rpm',
  linuxRpmArm64: 'WorldStageClient-linux-arm64.rpm',
  archLinux: 'WorldStageClient-linux-x64.pacman',
  archLinuxArm64: 'WorldStageClient-linux-arm64.pacman'
});

function normalizeText(value) {
  return String(value || '').trim();
}

function resolveWorldStageReleaseConfig(source = process.env) {
  const owner = normalizeText(source.WORLDSTAGE_CLIENT_RELEASE_REPO_OWNER) || DEFAULT_RELEASE_OWNER;
  const repo = normalizeText(source.WORLDSTAGE_CLIENT_RELEASE_REPO_NAME) || DEFAULT_RELEASE_REPO;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const releasesUrl = `${repoUrl}/releases/latest`;
  const download = (fileName) => `${releasesUrl}/download/${fileName}`;
  return {
    owner,
    repo,
    repoUrl,
    releasesUrl,
    downloads: {
      windows: download(RELEASE_ASSET_NAMES.windows),
      macos: download(RELEASE_ASSET_NAMES.macos),
      linuxAppImage: download(RELEASE_ASSET_NAMES.linuxAppImage),
      linuxAppImageArm64: download(RELEASE_ASSET_NAMES.linuxAppImageArm64),
      linuxDeb: download(RELEASE_ASSET_NAMES.linuxDeb),
      linuxDebArm64: download(RELEASE_ASSET_NAMES.linuxDebArm64),
      linuxRpm: download(RELEASE_ASSET_NAMES.linuxRpm),
      linuxRpmArm64: download(RELEASE_ASSET_NAMES.linuxRpmArm64),
      archLinux: download(RELEASE_ASSET_NAMES.archLinux),
      archLinuxArm64: download(RELEASE_ASSET_NAMES.archLinuxArm64)
    }
  };
}

module.exports = {
  DEFAULT_RELEASE_OWNER,
  DEFAULT_RELEASE_REPO,
  RELEASE_ASSET_NAMES,
  resolveWorldStageReleaseConfig
};
