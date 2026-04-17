'use strict';

const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  net,
  nativeImage,
  session,
  shell
} = require('electron');
const { autoUpdater } = require('electron-updater');
const { WorldStageClientAgent } = require('../lib/client-agent');
const { WorldStageAppUpdater } = require('../lib/app-updater');
const { syncLaunchOnLogin } = require('../lib/launch-on-login');
const {
  extractPairingLinkFromArgv,
  PAIRING_PROTOCOL
} = require('../lib/pairing-link');
const {
  buildWorldStageSiteUrl,
  isWorldStageSiteUrlAllowed,
  snapshotWorldStageSiteState
} = require('../lib/worldstage-site-window');

const CONFIG_FILE_NAME = 'worldstage-client-config.json';
const STATE_FILE_NAME = 'worldstage-client-state.json';
const WORLDSTAGE_SITE_PARTITION = 'persist:worldstage-site';
const WORLDSTAGE_SHELL_ROOT = path.join(__dirname, 'worldstage-shell');
const WORLDSTAGE_SHELL_FILES = Object.freeze({
  html: path.join(WORLDSTAGE_SHELL_ROOT, 'worldstage.html'),
  space: path.join(WORLDSTAGE_SHELL_ROOT, 'worldstage-space.js'),
  three: path.join(WORLDSTAGE_SHELL_ROOT, 'three.module.js')
});

let mainWindow = null;
let transportWindow = null;
let worldstageSiteWindow = null;
let tray = null;
let agent = null;
let updater = null;
let isQuitting = false;
let worldstageShellProtocolRegistered = false;
const pendingPairingLinks = [];
const transportHostState = {
  windowReady: false,
  capability: 'webrtc_download_transport',
  bootedAtIso: '',
  lastSnapshotAtIso: ''
};
const pairingState = {
  protocolScheme: String(PAIRING_PROTOCOL || 'worldstage:').replace(/:$/, ''),
  supported: true,
  registered: false,
  lastResult: 'idle',
  lastLink: '',
  lastLinkSource: '',
  lastAppliedAtIso: '',
  lastError: ''
};
const launchOnLoginState = {
  supported: true,
  enabled: false,
  strategy: 'not_synced',
  filePath: '',
  syncedAtIso: '',
  lastError: ''
};
const worldstageSiteState = snapshotWorldStageSiteState();
const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

function nowIso() {
  return new Date().toISOString();
}

function safeAppPath(name, fallback) {
  try {
    return app.getPath(name);
  } catch (_) {
    return fallback;
  }
}

function userDataPaths() {
  const userDataPath = app.getPath('userData');
  const videosPath = safeAppPath('videos', path.join(userDataPath, 'videos'));
  const downloadDirectory = path.join(videosPath, 'WorldStage');
  return {
    userDataPath,
    configPath: path.join(userDataPath, CONFIG_FILE_NAME),
    statePath: path.join(userDataPath, STATE_FILE_NAME),
    downloadDirectory
  };
}

function ensureDirectories() {
  const paths = userDataPaths();
  fs.mkdirSync(paths.userDataPath, { recursive: true });
  fs.mkdirSync(paths.downloadDirectory, { recursive: true });
  return paths;
}

function localWorldStageShellFileForPath(pathname = '') {
  const route = String(pathname || '').trim();
  if (!route) return '';
  if (route === '/worldstage-space.js') return WORLDSTAGE_SHELL_FILES.space;
  if (route === '/three.module.js') return WORLDSTAGE_SHELL_FILES.three;
  if (route === '/worldstage-login' || route === '/worldstage/login' || route === '/worldstage.html') {
    return WORLDSTAGE_SHELL_FILES.html;
  }
  if (route === '/worldstage' || route.startsWith('/worldstage/')) {
    return WORLDSTAGE_SHELL_FILES.html;
  }
  return '';
}

function worldStageShellContentType(filePath) {
  const extension = path.extname(String(filePath || '').trim()).toLowerCase();
  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

function shouldServeLocalWorldStageShell(requestUrl) {
  const raw = String(requestUrl || '').trim();
  if (!raw) return false;
  try {
    const target = new URL(raw);
    const site = new URL(currentWorldStageSiteOrigin());
    if (target.origin !== site.origin) return false;
    return Boolean(localWorldStageShellFileForPath(target.pathname));
  } catch (_) {
    return false;
  }
}

function worldStageShellResponse(filePath) {
  const body = fs.readFileSync(filePath);
  return new Response(body, {
    status: 200,
    headers: {
      'cache-control': 'no-store',
      'content-type': worldStageShellContentType(filePath)
    }
  });
}

function registerWorldStageShellProtocol() {
  if (worldstageShellProtocolRegistered) return;
  const partitionSession = session.fromPartition(WORLDSTAGE_SITE_PARTITION);
  partitionSession.protocol.handle('https', async (request) => {
    try {
      if (!shouldServeLocalWorldStageShell(request.url)) {
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      }
      const filePath = localWorldStageShellFileForPath(new URL(request.url).pathname);
      if (!filePath) return net.fetch(request, { bypassCustomProtocolHandlers: true });
      return worldStageShellResponse(filePath);
    } catch (_) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }
  });
  worldstageShellProtocolRegistered = true;
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#172033"/>
          <stop offset="100%" stop-color="#0a0f18"/>
        </linearGradient>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#7ae5c1"/>
          <stop offset="100%" stop-color="#ffd27a"/>
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#bg)"/>
      <circle cx="32" cy="32" r="16" fill="none" stroke="url(#ring)" stroke-width="5"/>
      <path d="M24 36 L32 20 L40 36" fill="none" stroke="#f5f7fb" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M20 44 H44" fill="none" stroke="#f5f7fb" stroke-width="5" stroke-linecap="round"/>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function buildRuntimeState() {
  return {
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron || '',
    transportHost: {
      windowReady: transportHostState.windowReady,
      capability: transportHostState.capability,
      bootedAtIso: transportHostState.bootedAtIso,
      lastSnapshotAtIso: transportHostState.lastSnapshotAtIso
    },
    launchOnLogin: {
      supported: launchOnLoginState.supported,
      enabled: launchOnLoginState.enabled,
      strategy: launchOnLoginState.strategy,
      filePath: launchOnLoginState.filePath,
      syncedAtIso: launchOnLoginState.syncedAtIso,
      lastError: launchOnLoginState.lastError
    },
    pairing: {
      protocolScheme: pairingState.protocolScheme,
      supported: pairingState.supported,
      registered: pairingState.registered,
      lastResult: pairingState.lastResult,
      lastLinkSource: pairingState.lastLinkSource,
      lastAppliedAtIso: pairingState.lastAppliedAtIso,
      lastError: pairingState.lastError
    },
    updater: updater ? updater.snapshot() : null,
    worldstageSite: snapshotWorldStageSiteState(worldstageSiteState)
  };
}

function decorateSnapshot(snapshot) {
  return {
    ...snapshot,
    runtime: buildRuntimeState()
  };
}

function pushSnapshot(snapshot) {
  if (transportWindow && !transportWindow.isDestroyed() && transportHostState.windowReady) {
    transportHostState.lastSnapshotAtIso = nowIso();
  }
  const payload = decorateSnapshot(snapshot || agent.snapshot());
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('client:state-changed', payload);
  }
  if (transportWindow && !transportWindow.isDestroyed() && transportHostState.windowReady) {
    transportWindow.webContents.send('transport:client-snapshot', payload);
  }
}

function syncWorldStageSiteState(patch = {}) {
  Object.assign(worldstageSiteState, patch);
  worldstageSiteState.open = Boolean(worldstageSiteWindow && !worldstageSiteWindow.isDestroyed());
  worldstageSiteState.visible = Boolean(worldstageSiteState.open && worldstageSiteWindow.isVisible());
}

function currentWorldStageSiteOrigin() {
  return agent && agent.config && agent.config.siteOrigin
    ? agent.config.siteOrigin
    : 'https://5310s.com';
}

function currentWorldStageSiteUrl(pathname = '/worldstage') {
  return buildWorldStageSiteUrl(currentWorldStageSiteOrigin(), pathname);
}

function allowWorldStageNavigation(targetUrl) {
  return isWorldStageSiteUrlAllowed(currentWorldStageSiteOrigin(), targetUrl);
}

async function applyWorldStageAuthMode(window, authMode) {
  const mode = String(authMode || '').trim();
  if (!window || window.isDestroyed() || (mode !== 'login' && mode !== 'register')) return;
  const classAction = mode === 'register' ? 'add' : 'remove';
  const focusTarget = mode === 'register'
    ? 'passwordConfirmInput || emailInput || passwordInput'
    : 'emailInput || passwordInput || passwordConfirmInput';
  try {
    await window.webContents.executeJavaScript(`
      (() => {
        const authFields = document.querySelector('.worldstage-auth-fields');
        const emailInput = document.getElementById('worldstage-auth-email');
        const passwordInput = document.getElementById('worldstage-auth-password');
        const passwordConfirmInput = document.getElementById('worldstage-auth-password-confirm');
        if (authFields) authFields.classList.${classAction}('register-mode');
        const target = ${focusTarget};
        if (target && typeof target.focus === 'function') target.focus();
        return true;
      })();
    `, true);
  } catch (_) {}
}

function updateWorldStageLocation(urlValue) {
  syncWorldStageSiteState({
    url: String(urlValue || '').trim(),
    lastNavigationAtIso: nowIso(),
    lastError: ''
  });
  pushSnapshot();
}

function attachWorldStageWindowHandlers(window) {
  window.on('show', () => {
    syncWorldStageSiteState({
      open: true,
      visible: true
    });
    pushSnapshot();
  });

  window.on('hide', () => {
    syncWorldStageSiteState({
      open: true,
      visible: false
    });
    pushSnapshot();
  });

  window.on('closed', () => {
    worldstageSiteWindow = null;
    syncWorldStageSiteState({
      open: false,
      visible: false
    });
    pushSnapshot();
  });

  window.webContents.on('page-title-updated', (_event, title) => {
    syncWorldStageSiteState({
      title: String(title || '').trim()
    });
    pushSnapshot();
  });

  window.webContents.on('did-navigate', (_event, urlValue) => {
    updateWorldStageLocation(urlValue);
  });

  window.webContents.on('did-navigate-in-page', (_event, urlValue) => {
    updateWorldStageLocation(urlValue);
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame === false) return;
    syncWorldStageSiteState({
      lastError: `${String(errorDescription || 'load_failed').trim()} (${Number(errorCode || 0)})`,
      url: String(validatedURL || worldstageSiteState.url || '').trim()
    });
    pushSnapshot();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowWorldStageNavigation(url)) {
      openWorldStageWindow({
        targetUrl: url,
        forceReload: true
      }).catch(() => {});
      return { action: 'deny' };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, urlValue) => {
    if (allowWorldStageNavigation(urlValue)) return;
    event.preventDefault();
    shell.openExternal(urlValue).catch(() => {});
  });
}

async function openWorldStageWindow(options = {}) {
  const defaultUrl = currentWorldStageSiteUrl(String(options.path || '/worldstage').trim() || '/worldstage');
  const targetUrl = String(options.targetUrl || defaultUrl).trim() || defaultUrl;
  const authMode = String(options.authMode || '').trim();
  const openedAtIso = nowIso();

  if (worldstageSiteWindow && !worldstageSiteWindow.isDestroyed()) {
    syncWorldStageSiteState({
      open: true,
      visible: true,
      lastOpenedAtIso: openedAtIso,
      lastError: ''
    });
    if (options.forceReload || worldstageSiteState.url !== targetUrl) {
      await worldstageSiteWindow.loadURL(targetUrl);
    }
    worldstageSiteWindow.show();
    worldstageSiteWindow.focus();
    await applyWorldStageAuthMode(worldstageSiteWindow, authMode);
    pushSnapshot();
    return decorateSnapshot(agent.snapshot());
  }

  worldstageSiteWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#050811',
    title: 'WorldStage',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: WORLDSTAGE_SITE_PARTITION
    }
  });

  attachWorldStageWindowHandlers(worldstageSiteWindow);
  syncWorldStageSiteState({
    open: true,
    visible: true,
    url: targetUrl,
    title: 'WorldStage',
    lastOpenedAtIso: openedAtIso,
    lastError: ''
  });
  await worldstageSiteWindow.loadURL(targetUrl);
  worldstageSiteWindow.show();
  await applyWorldStageAuthMode(worldstageSiteWindow, authMode);
  pushSnapshot();
  return decorateSnapshot(agent.snapshot());
}

async function reloadWorldStageWindow() {
  if (!worldstageSiteWindow || worldstageSiteWindow.isDestroyed()) {
    return openWorldStageWindow({
      forceReload: true
    });
  }
  await worldstageSiteWindow.loadURL(currentWorldStageSiteUrl());
  worldstageSiteWindow.show();
  worldstageSiteWindow.focus();
  syncWorldStageSiteState({
    open: true,
    visible: true,
    lastOpenedAtIso: nowIso(),
    lastError: ''
  });
  pushSnapshot();
  return decorateSnapshot(agent.snapshot());
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 1080,
    minHeight: 760,
    backgroundColor: '#06070b',
    title: '5310S - WorldStage',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: WORLDSTAGE_SITE_PARTITION
    }
  });

  worldstageSiteWindow = mainWindow;
  attachWorldStageWindowHandlers(mainWindow);
  mainWindow.loadURL(currentWorldStageSiteUrl('/worldstage-login'));

  mainWindow.on('show', () => {
    if (agent) agent.setWindowVisible(true);
  });

  mainWindow.on('close', (event) => {
    if (!agent || isQuitting) return;
    if (!agent.config.backgroundOnClose) return;
    event.preventDefault();
    mainWindow.hide();
    agent.setWindowVisible(false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTransportWindow() {
  transportWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    frame: false,
    skipTaskbar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'transport', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  transportWindow.loadFile(path.join(__dirname, 'transport', 'index.html'));

  transportWindow.on('closed', () => {
    transportHostState.windowReady = false;
    transportWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
}

function refreshTrayMenu() {
  if (!tray || !agent) return;
  const running = agent.state.agent.status === 'running';
  const updaterState = updater ? updater.snapshot() : null;
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open WorldStage Client',
      click: () => showMainWindow()
    },
    {
      label: 'Open WorldStage',
      click: () => {
        openWorldStageWindow().catch(() => {});
      }
    },
    {
      label: running ? 'Pause Background Agent' : 'Start Background Agent',
      click: () => {
        const action = running ? agent.stop() : agent.start();
        Promise.resolve(action).then((snapshot) => pushSnapshot(snapshot)).catch(() => {});
      }
    },
    {
      label: 'Open Download Directory',
      click: () => shell.openPath(userDataPaths().downloadDirectory)
    },
    {
      label: updaterState && updaterState.downloaded
        ? 'Install Downloaded Update'
        : 'Check For Updates',
      click: () => {
        if (!updater) return;
        const action = updaterState && updaterState.downloaded
          ? Promise.resolve().then(() => updater.quitAndInstall())
          : updater.checkForUpdates({
              manual: true
            });
        Promise.resolve(action).then(() => pushSnapshot()).catch(() => {});
      }
    },
    {
      label: 'Open Latest Release',
      click: () => {
        if (!updater) return;
        Promise.resolve(updater.openReleasePage()).then(() => pushSnapshot()).catch(() => {});
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('WorldStage Client');
  tray.setContextMenu(menu);
}

function registerPairingProtocol() {
  const scheme = pairingState.protocolScheme || 'worldstage';
  try {
    let registered = false;
    if (process.defaultApp) {
      const appPath = String(process.argv[1] || '').trim();
      registered = app.setAsDefaultProtocolClient(scheme, process.execPath, appPath ? [path.resolve(appPath)] : []);
    } else {
      registered = app.setAsDefaultProtocolClient(scheme);
    }
    if (typeof app.isDefaultProtocolClient === 'function') {
      try {
        registered = app.isDefaultProtocolClient(scheme) || registered;
      } catch (_) {}
    }
    pairingState.supported = true;
    pairingState.registered = Boolean(registered);
    pairingState.lastError = '';
    return pairingState.registered;
  } catch (error) {
    pairingState.supported = process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux';
    pairingState.registered = false;
    pairingState.lastError = String(error && error.message ? error.message : error);
    return false;
  }
}

function applyLaunchOnLoginPreference() {
  if (!agent) return;
  try {
    const result = syncLaunchOnLogin({
      platform: process.platform,
      enabled: agent.config.launchOnLogin,
      execPath: process.execPath,
      argv: process.argv,
      defaultApp: Boolean(process.defaultApp),
      setLoginItemSettings: typeof app.setLoginItemSettings === 'function'
        ? app.setLoginItemSettings.bind(app)
        : null
    });
    launchOnLoginState.supported = result.supported !== false;
    launchOnLoginState.enabled = result.enabled === true;
    launchOnLoginState.strategy = String(result.strategy || 'unknown').trim() || 'unknown';
    launchOnLoginState.filePath = String(result.filePath || '').trim();
    launchOnLoginState.syncedAtIso = nowIso();
    launchOnLoginState.lastError = '';
  } catch (error) {
    launchOnLoginState.supported = process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux';
    launchOnLoginState.enabled = false;
    launchOnLoginState.strategy = 'sync_failed';
    launchOnLoginState.filePath = '';
    launchOnLoginState.syncedAtIso = nowIso();
    launchOnLoginState.lastError = String(error && error.message ? error.message : error);
  }
}

async function applyPairingLink(link, options = {}) {
  const rawLink = String(link || '').trim();
  if (!rawLink) throw new Error('pairing_link_required');
  const source = String(options.source || 'unknown').trim() || 'unknown';
  const appliedAtIso = nowIso();

  if (!agent) {
    pendingPairingLinks.push({
      link: rawLink,
      source
    });
    pairingState.lastLink = rawLink;
    pairingState.lastLinkSource = source;
    pairingState.lastAppliedAtIso = appliedAtIso;
    pairingState.lastResult = 'pairing_link_queued';
    pairingState.lastError = '';
    return null;
  }

  try {
    const applied = await agent.applyPairingLink(rawLink);
    applyLaunchOnLoginPreference();
    let snapshot = applied.snapshot;
    if (agent.state.agent.status === 'running') {
      snapshot = await agent.runCycle();
    } else if (agent.config.autoStartAgent) {
      snapshot = await agent.start();
    }
    pairingState.lastLink = rawLink;
    pairingState.lastLinkSource = source;
    pairingState.lastAppliedAtIso = appliedAtIso;
    pairingState.lastResult = 'pairing_link_applied';
    pairingState.lastError = '';
    if (options.showWindow !== false) showMainWindow();
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  } catch (error) {
    pairingState.lastLink = rawLink;
    pairingState.lastLinkSource = source;
    pairingState.lastAppliedAtIso = appliedAtIso;
    pairingState.lastResult = 'pairing_link_failed';
    pairingState.lastError = String(error && error.message ? error.message : error);
    if (options.showWindow !== false) showMainWindow();
    pushSnapshot();
    throw error;
  }
}

function queueInitialPairingLink(link, source) {
  const rawLink = String(link || '').trim();
  if (!rawLink) return;
  pendingPairingLinks.push({
    link: rawLink,
    source: String(source || 'argv').trim() || 'argv'
  });
  pairingState.lastLink = rawLink;
  pairingState.lastLinkSource = String(source || 'argv').trim() || 'argv';
  pairingState.lastAppliedAtIso = nowIso();
  pairingState.lastResult = 'pairing_link_queued';
  pairingState.lastError = '';
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.on('click', () => {
    if (!mainWindow || !mainWindow.isVisible()) {
      showMainWindow();
      return;
    }
    hideMainWindow();
    if (agent) agent.setWindowVisible(false);
  });
  refreshTrayMenu();
}

function registerIpc() {
  ipcMain.handle('client:get-state', async () => decorateSnapshot(agent.snapshot()));
  ipcMain.handle('client:save-config', async (_event, config) => {
    const snapshot = agent.saveConfig(config);
    applyLaunchOnLoginPreference();
    refreshTrayMenu();
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:authenticate-account', async (_event, payload) => {
    const authenticated = await agent.authenticateAccount(payload && payload.mode, payload || {});
    let snapshot = authenticated.snapshot;
    if (agent.state.agent.status === 'running') {
      snapshot = await agent.runCycle();
    } else if (agent.config.autoStartAgent) {
      snapshot = await agent.start();
    }
    applyLaunchOnLoginPreference();
    refreshTrayMenu();
    pushSnapshot(snapshot);
    return {
      ...authenticated,
      snapshot: decorateSnapshot(snapshot)
    };
  });
  ipcMain.handle('client:apply-pairing-link', async (_event, payload) => {
    return applyPairingLink(payload && payload.link, {
      source: 'renderer',
      showWindow: false
    });
  });
  ipcMain.handle('client:start-agent', async () => {
    const snapshot = await agent.start();
    refreshTrayMenu();
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:stop-agent', async () => {
    const snapshot = await agent.stop();
    refreshTrayMenu();
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:enqueue-download-job', async (_event, payload) => {
    const snapshot = agent.enqueueDownloadJob(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:clear-finished-jobs', async () => {
    const snapshot = agent.clearFinishedJobs();
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:cancel-job', async (_event, payload) => {
    const snapshot = await agent.cancelJob(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:retry-job', async (_event, payload) => {
    const snapshot = await agent.retryJob(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:remove-job', async (_event, payload) => {
    const snapshot = agent.removeJob(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:refresh-library-item', async (_event, payload) => {
    const snapshot = await agent.refreshLibraryItem(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:pause-library-item', async (_event, payload) => {
    const snapshot = agent.pauseLibraryItem(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:resume-library-item', async (_event, payload) => {
    const snapshot = await agent.resumeLibraryItem(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:remove-library-item', async (_event, payload) => {
    const snapshot = agent.removeLibraryItem(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('client:open-download-directory', async () => {
    await shell.openPath(userDataPaths().downloadDirectory);
    return decorateSnapshot(agent.snapshot());
  });
  ipcMain.handle('client:open-path', async (_event, payload) => {
    const targetPath = path.resolve(String(payload && payload.path || '').trim());
    if (!targetPath) throw new Error('path_required');
    await shell.openPath(targetPath);
    return decorateSnapshot(agent.snapshot());
  });
  ipcMain.handle('client:show-item-in-folder', async (_event, payload) => {
    const targetPath = path.resolve(String(payload && payload.path || '').trim());
    if (!targetPath) throw new Error('path_required');
    shell.showItemInFolder(targetPath);
    return decorateSnapshot(agent.snapshot());
  });
  ipcMain.handle('client:open-user-data-directory', async () => {
    await shell.openPath(userDataPaths().userDataPath);
    return decorateSnapshot(agent.snapshot());
  });
  ipcMain.handle('client:show-window', async () => {
    showMainWindow();
    return decorateSnapshot(agent.snapshot());
  });
  ipcMain.handle('client:check-for-updates', async () => {
    if (!updater) return decorateSnapshot(agent.snapshot());
    await updater.checkForUpdates({
      manual: true
    });
    return decorateSnapshot(agent.snapshot());
  });
  ipcMain.handle('client:install-update', async () => {
    if (!updater) throw new Error('updater_unavailable');
    updater.quitAndInstall();
    return decorateSnapshot(agent.snapshot());
  });
  ipcMain.handle('client:open-release-page', async () => {
    if (!updater) throw new Error('updater_unavailable');
    await updater.openReleasePage();
    return decorateSnapshot(agent.snapshot());
  });
  ipcMain.handle('client:open-worldstage', async (_event, payload) => {
    return openWorldStageWindow({
      path: payload && payload.path,
      authMode: payload && payload.authMode,
      forceReload: payload && payload.forceReload
    });
  });
  ipcMain.handle('client:reload-worldstage', async () => reloadWorldStageWindow());
  ipcMain.handle('transport:job-update', async (_event, payload) => {
    const snapshot = await agent.applyTransportUpdate(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('transport:bootstrap-job', async (_event, payload) => {
    const snapshot = await agent.bootstrapControlPlaneJob(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('transport:publish-candidate', async (_event, payload) => {
    const snapshot = await agent.publishViewerCandidate(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('transport:list-seed-sessions', async (_event, payload) => {
    return agent.listSeedSessions(payload);
  });
  ipcMain.handle('transport:answer-seed-session', async (_event, payload) => {
    return agent.answerSeedSession(payload);
  });
  ipcMain.handle('transport:publish-seed-candidate', async (_event, payload) => {
    return agent.publishCreatorCandidate(payload);
  });
  ipcMain.handle('transport:record-manifest', async (_event, payload) => {
    const snapshot = await agent.recordTransportManifest(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('transport:mark-chunk-requested', async (_event, payload) => {
    const snapshot = await agent.markRequestedChunk(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('transport:mark-chunk-failed', async (_event, payload) => {
    const snapshot = await agent.markFailedChunk(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('transport:record-verified-chunk', async (_event, payload) => {
    const snapshot = await agent.recordVerifiedChunk(payload);
    pushSnapshot(snapshot);
    return decorateSnapshot(snapshot);
  });
  ipcMain.handle('transport:read-seed-manifest', async (_event, payload) => {
    const manifestPath = path.resolve(String(payload && payload.manifestPath || '').trim());
    if (!manifestPath) throw new Error('manifest_path_required');
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  });
  ipcMain.handle('transport:read-seed-chunk', async (_event, payload) => {
    const localPath = path.resolve(String(payload && payload.localPath || '').trim());
    if (!localPath) throw new Error('local_path_required');
    const start = Math.max(0, Math.trunc(Number(payload && payload.start || 0) || 0));
    const end = Math.max(start, Math.trunc(Number(payload && payload.end || start) || start));
    const length = Math.max(0, end - start);
    const fd = fs.openSync(localPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, start);
      return {
        byteLength: bytesRead,
        base64: buffer.subarray(0, bytesRead).toString('base64')
      };
    } finally {
      fs.closeSync(fd);
    }
  });
  ipcMain.on('transport:host-ready', (_event, payload) => {
    transportHostState.windowReady = true;
    transportHostState.capability = String(payload && payload.capability || transportHostState.capability).trim() || transportHostState.capability;
    transportHostState.bootedAtIso = String(payload && payload.bootedAtIso || nowIso()).trim() || nowIso();
    pushSnapshot();
  });
}

app.whenReady().then(async () => {
  registerWorldStageShellProtocol();
  const paths = ensureDirectories();
  agent = new WorldStageClientAgent({
    configPath: paths.configPath,
    statePath: paths.statePath,
    defaultDownloadDirectory: paths.downloadDirectory,
    defaultSiteOrigin: 'https://5310s.com'
  });
  registerPairingProtocol();
  applyLaunchOnLoginPreference();
  updater = new WorldStageAppUpdater({
    app,
    autoUpdater,
    shell
  });
  updater.onChange(() => {
    refreshTrayMenu();
    pushSnapshot();
  });
  updater.initialize();
  agent.on('changed', (snapshot) => {
    refreshTrayMenu();
    pushSnapshot(snapshot);
  });

  createMainWindow();
  createTransportWindow();
  createTray();
  registerIpc();

  while (pendingPairingLinks.length > 0) {
    const next = pendingPairingLinks.shift();
    if (!next) continue;
    try {
      await applyPairingLink(next.link, {
        source: next.source,
        showWindow: false
      });
    } catch (_) {}
  }

  if (agent.config.autoStartAgent) await agent.start();
  else await agent.runCycle();

  updater.checkForUpdates({
    manual: false
  }).catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    showMainWindow();
  });
});

if (singleInstanceLock) {
  const initialPairingLink = extractPairingLinkFromArgv(process.argv);
  if (initialPairingLink) queueInitialPairingLink(initialPairingLink, 'argv');

  app.on('second-instance', (_event, argv) => {
    const pairingLink = extractPairingLinkFromArgv(argv);
    if (pairingLink) {
      applyPairingLink(pairingLink, {
        source: 'second-instance'
      }).catch(() => {});
      return;
    }
    showMainWindow();
  });

  app.on('open-url', (event, urlValue) => {
    event.preventDefault();
    applyPairingLink(urlValue, {
      source: 'open-url'
    }).catch(() => {});
  });
}

app.on('before-quit', async (event) => {
  if (isQuitting || !agent) return;
  isQuitting = true;
  event.preventDefault();
  if (updater) updater.destroy();
  await agent.destroy();
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (agent && agent.config.backgroundOnClose && !isQuitting) return;
    app.quit();
  }
});
