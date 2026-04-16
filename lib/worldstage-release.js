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
  return {
    owner,
    repo,
    repoUrl,
    releasesUrl,
    downloads: {
      windows: `${releasesUrl}/download/WorldStageClient-windows-x64.exe`,
      macos: `${releasesUrl}/download/WorldStageClient-mac-x64.dmg`,
      linuxAppImage: `${releasesUrl}/download/WorldStageClient-linux-x64.AppImage`,
      linuxDeb: `${releasesUrl}/download/WorldStageClient-linux-x64.deb`
    }
  };
}

module.exports = {
  DEFAULT_RELEASE_OWNER,
  DEFAULT_RELEASE_REPO,
  resolveWorldStageReleaseConfig
};
