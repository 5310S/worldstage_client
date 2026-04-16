'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_LINUX_AUTOSTART_FILE_NAME = 'worldstage-client.desktop';

function normalizeLaunchPath(value) {
  return String(value || '').trim();
}

function normalizeLaunchArgs(args) {
  return Array.isArray(args)
    ? args.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
}

function resolveLaunchCommand(options = {}) {
  const execPath = normalizeLaunchPath(options.execPath || process.execPath);
  if (!execPath) throw new Error('launch_command_required');

  const argv = Array.isArray(options.argv) ? options.argv : process.argv;
  const args = [];
  if (options.defaultApp === true) {
    const appPath = normalizeLaunchPath(options.appPath || argv[1]);
    if (appPath) args.push(appPath);
  }
  args.push(...normalizeLaunchArgs(options.args));

  return {
    command: execPath,
    args
  };
}

function escapeDesktopExecArg(value) {
  const raw = String(value || '');
  return `"${raw.replace(/(["\\`$])/g, '\\$1')}"`;
}

function buildLinuxAutostartDesktopEntry(options = {}) {
  const launch = resolveLaunchCommand(options);
  const name = String(options.appName || 'WorldStage Client').trim() || 'WorldStage Client';
  const comment = String(
    options.comment
    || 'Start the WorldStage home client in the background when this desktop session begins.'
  ).trim();
  const execLine = [launch.command, ...launch.args]
    .map((entry) => escapeDesktopExecArg(entry))
    .join(' ');

  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${name}`,
    `Comment=${comment}`,
    `Exec=${execLine}`,
    'Terminal=false',
    'StartupNotify=false',
    'X-GNOME-Autostart-enabled=true'
  ].join('\n');
}

function linuxAutostartFilePath(options = {}) {
  const autostartDirectory = normalizeLaunchPath(
    options.autostartDirectory || path.join(os.homedir(), '.config', 'autostart')
  );
  return path.join(
    autostartDirectory,
    String(options.desktopFileName || DEFAULT_LINUX_AUTOSTART_FILE_NAME).trim() || DEFAULT_LINUX_AUTOSTART_FILE_NAME
  );
}

function syncLinuxAutostart(options = {}) {
  const filePath = linuxAutostartFilePath(options);

  if (options.enabled === false) {
    fs.rmSync(filePath, { force: true });
    return {
      supported: true,
      enabled: false,
      strategy: 'linux_autostart_desktop',
      filePath
    };
  }

  const desktopEntry = buildLinuxAutostartDesktopEntry(options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${desktopEntry}\n`);
  return {
    supported: true,
    enabled: true,
    strategy: 'linux_autostart_desktop',
    filePath
  };
}

function syncLaunchOnLogin(options = {}) {
  const platform = String(options.platform || process.platform).trim() || process.platform;

  if (platform === 'linux') {
    return syncLinuxAutostart(options);
  }

  if (platform === 'darwin' || platform === 'win32') {
    if (typeof options.setLoginItemSettings !== 'function') {
      throw new Error('set_login_item_settings_required');
    }
    const enabled = options.enabled !== false;
    const payload = {
      openAtLogin: enabled,
      openAsHidden: enabled
    };
    if (options.defaultApp === true) {
      const launch = resolveLaunchCommand(options);
      payload.path = launch.command;
      payload.args = launch.args;
    }
    options.setLoginItemSettings(payload);
    return {
      supported: true,
      enabled,
      strategy: 'electron_login_item',
      filePath: ''
    };
  }

  return {
    supported: false,
    enabled: false,
    strategy: 'unsupported',
    filePath: ''
  };
}

module.exports = {
  DEFAULT_LINUX_AUTOSTART_FILE_NAME,
  buildLinuxAutostartDesktopEntry,
  escapeDesktopExecArg,
  linuxAutostartFilePath,
  resolveLaunchCommand,
  syncLaunchOnLogin,
  syncLinuxAutostart
};
