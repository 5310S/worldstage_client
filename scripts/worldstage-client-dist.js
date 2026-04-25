#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

const OPTIONAL_ENV_KEYS = [
  'GH_TOKEN',
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID'
];

function buildDesktopDistEnv(source = process.env) {
  const env = { ...source };
  for (const key of OPTIONAL_ENV_KEYS) {
    if (!String(source[key] || '').trim()) delete env[key];
  }

  const autoDiscovery = String(source.CSC_IDENTITY_AUTO_DISCOVERY || '').trim();
  if (autoDiscovery) env.CSC_IDENTITY_AUTO_DISCOVERY = autoDiscovery;
  else delete env.CSC_IDENTITY_AUTO_DISCOVERY;

  return env;
}

function resolveDesktopDistCommand(options = {}) {
  const publishMode = String(
    options.publishMode
      || (options.env && options.env.WORLDSTAGE_CLIENT_PUBLISH)
      || process.env.WORLDSTAGE_CLIENT_PUBLISH
      || 'never'
  ).trim() || 'never';
  return {
    command: process.execPath,
    args: [require.resolve('electron-builder/out/cli/cli.js'), '--publish', publishMode]
  };
}

function runDesktopDist(argv = process.argv.slice(2), options = {}) {
  const env = buildDesktopDistEnv(options.env || process.env);
  const commandSpec = resolveDesktopDistCommand({
    env
  });
  const result = spawnSync(commandSpec.command, [...commandSpec.args, ...argv], {
    cwd: options.cwd || process.cwd(),
    env,
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  if (typeof result.status === 'number') {
    process.exitCode = result.status;
    return result.status;
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  process.exitCode = 1;
  return 1;
}

if (require.main === module) {
  try {
    runDesktopDist();
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

module.exports = {
  OPTIONAL_ENV_KEYS,
  buildDesktopDistEnv,
  resolveDesktopDistCommand,
  runDesktopDist
};
