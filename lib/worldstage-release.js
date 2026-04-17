'use strict';

const DEFAULT_RELEASE_OWNER = '5310S';
const DEFAULT_RELEASE_REPO = 'worldstage_client';

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
      windows: download('WorldStageClient-windows-x64.exe'),
      macos: download('WorldStageClient-mac-universal.dmg'),
      linuxAppImage: download('WorldStageClient-linux-x64.AppImage'),
      linuxAppImageArm64: download('WorldStageClient-linux-arm64.AppImage'),
      linuxDeb: download('WorldStageClient-linux-x64.deb'),
      linuxDebArm64: download('WorldStageClient-linux-arm64.deb'),
      linuxRpm: download('WorldStageClient-linux-x64.rpm'),
      linuxRpmArm64: download('WorldStageClient-linux-arm64.rpm'),
      archLinux: download('WorldStageClient-linux-x64.pacman'),
      archLinuxArm64: download('WorldStageClient-linux-arm64.pacman')
    }
  };
}

module.exports = {
  DEFAULT_RELEASE_OWNER,
  DEFAULT_RELEASE_REPO,
  resolveWorldStageReleaseConfig
};
