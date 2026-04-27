'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Keep the banner model local to this preload. Sandboxed preloads cannot
// reliably require arbitrary project modules after packaging.
function normalizeText(value) {
  return String(value || '').trim();
}

function clippedReleaseNotes(value) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= 180) return text;
  return `${text.slice(0, 177).trim()}...`;
}

function isDashboardPath(pathname) {
  const value = normalizeText(pathname);
  if (!value) return true;
  if (!value.startsWith('/worldstage')) return false;
  return !value.startsWith('/worldstage-login');
}

function buildWorldStageSiteUpdaterBannerModel(input = {}) {
  const platform = normalizeText(input.platform);
  const pathname = normalizeText(input.pathname);
  const updater = input && typeof input.updater === 'object' && input.updater
    ? input.updater
    : {};
  const latestVersion = normalizeText(updater.latestVersion);
  const currentVersion = normalizeText(updater.currentVersion);
  const releaseNotes = clippedReleaseNotes(updater.releaseNotes);
  const releaseUrl = normalizeText(updater.releaseUrl || updater.releasesUrl || updater.repoUrl);
  const progressPercent = Math.max(0, Math.min(100, Number(updater.progressPercent) || 0));

  if (platform !== 'win32') {
    return {
      visible: false,
      reason: 'unsupported_platform'
    };
  }

  if (!isDashboardPath(pathname)) {
    return {
      visible: false,
      reason: 'non_dashboard_route'
    };
  }

  if (updater.enabled !== true) {
    return {
      visible: false,
      reason: normalizeText(updater.disabledReason) || 'updater_disabled'
    };
  }

  if (updater.downloaded === true) {
    return {
      visible: true,
      tone: 'ready',
      title: latestVersion
        ? `Update ${latestVersion} Ready`
        : 'Update Ready',
      message: currentVersion && latestVersion
        ? `Windows client ${currentVersion} downloaded ${latestVersion} from GitHub and can install it now.`
        : 'The Windows client downloaded the latest GitHub release and can install it now.',
      details: releaseNotes,
      progressPercent: 100,
      primaryAction: {
        id: 'install',
        label: 'Install Update'
      },
      secondaryAction: releaseUrl
        ? {
            id: 'release',
            label: 'GitHub Release'
          }
        : null
    };
  }

  if (updater.lastResult === 'downloading_update' || updater.lastResult === 'update_available' || updater.available === true) {
    return {
      visible: true,
      tone: 'info',
      title: latestVersion
        ? `Downloading ${latestVersion}`
        : 'Downloading Update',
      message: progressPercent > 0
        ? `The Windows client is downloading the latest GitHub release in the background (${progressPercent}%).`
        : 'The Windows client found a newer GitHub release and is downloading it in the background.',
      details: releaseNotes,
      progressPercent,
      primaryAction: null,
      secondaryAction: releaseUrl
        ? {
            id: 'release',
            label: 'GitHub Release'
          }
        : null
    };
  }

  if (updater.lastResult === 'update_error' && normalizeText(updater.lastError)) {
    return {
      visible: true,
      tone: 'error',
      title: 'Update Check Failed',
      message: 'The Windows client could not complete the GitHub release update flow.',
      details: normalizeText(updater.lastError),
      progressPercent: 0,
      primaryAction: {
        id: 'retry',
        label: 'Retry'
      },
      secondaryAction: releaseUrl
        ? {
            id: 'release',
            label: 'GitHub Release'
          }
        : null
    };
  }

  return {
    visible: false,
    reason: 'idle'
  };
}

function buildWorldStageDesktopExitButtonModel(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const platform = normalizeText(source.platform);
  const visible = source.exitButtonVisible === true || source.frameless === true;
  if (platform !== 'win32') {
    return {
      visible: false,
      reason: 'unsupported_platform'
    };
  }
  if (!visible) {
    return {
      visible: false,
      reason: 'native_chrome_available'
    };
  }
  return {
    visible: true,
    actionId: 'exit',
    label: 'X',
    position: 'top-right'
  };
}

function buildWorldStageDesktopDragModel(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const platform = normalizeText(source.platform);
  const enabled = source.frameless === true || source.exitButtonVisible === true;
  if (platform !== 'win32') {
    return {
      enabled: false,
      reason: 'unsupported_platform'
    };
  }
  if (!enabled) {
    return {
      enabled: false,
      reason: 'native_chrome_available'
    };
  }
  return {
    enabled: true
  };
}

function buildWorldStageDesktopClientDownloadControlModel(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const hidden = source.desktopClient === true
    || source.frameless === true
    || source.exitButtonVisible === true;
  if (!hidden) {
    return {
      hidden: false,
      reason: 'browser_context'
    };
  }
  return {
    hidden: true
  };
}

function buildWorldStageDesktopNavLayoutModel(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const enabled = source.desktopClient === true
    || source.frameless === true
    || source.exitButtonVisible === true;
  if (!enabled) {
    return {
      enabled: false,
      reason: 'browser_context'
    };
  }
  return {
    enabled: true
  };
}

const STATE_CHANNEL = 'worldstage-site:updater-state-changed';
const ROOT_ID = 'worldstage-desktop-update-banner-root';
const SHELL_ROOT_ID = 'worldstage-desktop-shell-root';
const DRAG_STYLE_ID = 'worldstage-desktop-drag-style';
const NAV_LAYOUT_STYLE_ID = 'worldstage-desktop-nav-layout-style';
const NAV_LAYOUT_CLASS = 'worldstage-desktop-client-nav-layout';
const CLIENT_DOWNLOAD_HIDDEN_ATTR = 'data-worldstage-client-download-hidden';
const HOSTED_VIDEOS_HIDDEN_ATTR = 'data-worldstage-hosted-videos-hidden';

let updaterState = null;
let shellState = null;
let bannerHost = null;
let bannerShadow = null;
let shellHost = null;
let shellShadow = null;
let clientDownloadObserver = null;
let clientDownloadRenderQueued = false;
let renderQueued = false;
let initialized = false;

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  Promise.resolve().then(() => {
    renderQueued = false;
    renderBanner();
    renderShellControls();
  });
}

function safePathname() {
  try {
    return String(window.location.pathname || '').trim();
  } catch (_) {
    return '';
  }
}

function ensureBannerShadow() {
  const parent = document.body || document.documentElement;
  if (!parent) return null;
  if (!bannerHost || !bannerHost.isConnected) {
    bannerHost = document.getElementById(ROOT_ID) || document.createElement('div');
    bannerHost.id = ROOT_ID;
    if (!bannerHost.isConnected) parent.appendChild(bannerHost);
    bannerShadow = bannerHost.shadowRoot || bannerHost.attachShadow({ mode: 'open' });
  }
  return bannerShadow;
}

function ensureShellShadow() {
  const parent = document.body || document.documentElement;
  if (!parent) return null;
  if (!shellHost || !shellHost.isConnected) {
    shellHost = document.createElement('div');
    shellHost.id = SHELL_ROOT_ID;
    shellHost.style.webkitAppRegion = 'no-drag';
    parent.appendChild(shellHost);
    shellShadow = shellHost.attachShadow({ mode: 'closed' });
  }
  return shellShadow;
}

function syncWindowDragRegion() {
  const model = buildWorldStageDesktopDragModel(shellState);
  const existing = document.getElementById(DRAG_STYLE_ID);
  if (!model.enabled) {
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (shellHost) shellHost.style.webkitAppRegion = '';
    return;
  }

  const parent = document.head || document.documentElement;
  if (!parent) return;
  const style = existing || document.createElement('style');
  style.id = DRAG_STYLE_ID;
  style.textContent = `
    html,
    body {
      -webkit-app-region: drag;
    }

    input,
    textarea,
    select,
    button,
    a,
    label,
    summary,
    audio,
    video,
    iframe,
    [role="button"],
    [role="link"],
    [contenteditable="true"],
    [tabindex]:not([tabindex="-1"]),
    #${ROOT_ID},
    #${SHELL_ROOT_ID} {
      -webkit-app-region: no-drag;
    }
  `;
  if (!style.isConnected) parent.appendChild(style);
  if (shellHost) shellHost.style.webkitAppRegion = 'no-drag';
}

function isWorldStageClientDownloadControl(element) {
  if (!element) return false;
  const text = normalizeText(element.textContent).replace(/\s+/g, ' ').toLowerCase();
  const href = typeof element.getAttribute === 'function'
    ? normalizeText(element.getAttribute('href')).toLowerCase()
    : '';
  return text.includes('download world stage local client')
    || href.includes('/downloads/worldstage-client');
}

function isWorldStageHostedVideosNavControl(element) {
  if (!element) return false;
  const getAttr = typeof element.getAttribute === 'function'
    ? (name) => normalizeText(element.getAttribute(name))
    : () => '';
  const id = normalizeText(element.id || getAttr('id')).toLowerCase();
  const className = normalizeText(element.className || getAttr('class')).toLowerCase();
  const text = normalizeText(element.textContent).replace(/\s+/g, ' ').toLowerCase();
  return id === 'worldstage-hosted-videos'
    || (className.includes('worldstage-topbar-btn') && text === 'hosted videos');
}

function queueClientDownloadControlSync() {
  if (clientDownloadRenderQueued) return;
  clientDownloadRenderQueued = true;
  Promise.resolve().then(() => {
    clientDownloadRenderQueued = false;
    syncWorldStageClientDownloadControl();
  });
}

function installClientDownloadControlObserver() {
  if (clientDownloadObserver || typeof MutationObserver !== 'function') return;
  const target = document.body || document.documentElement;
  if (!target) return;
  clientDownloadObserver = new MutationObserver(queueClientDownloadControlSync);
  clientDownloadObserver.observe(target, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function syncWorldStageClientDownloadControl() {
  const model = buildWorldStageDesktopClientDownloadControlModel(shellState);
  if (!model.hidden) {
    if (typeof document.querySelectorAll !== 'function') return;
    document.querySelectorAll(`[${CLIENT_DOWNLOAD_HIDDEN_ATTR}], [${HOSTED_VIDEOS_HIDDEN_ATTR}]`).forEach((element) => {
      element.removeAttribute(CLIENT_DOWNLOAD_HIDDEN_ATTR);
      element.removeAttribute(HOSTED_VIDEOS_HIDDEN_ATTR);
      element.style.removeProperty('display');
    });
    return;
  }

  installClientDownloadControlObserver();
  if (typeof document.querySelectorAll !== 'function') return;
  document.querySelectorAll('a, button, [role="button"], [onclick]').forEach((element) => {
    if (!isWorldStageClientDownloadControl(element)) return;
    element.setAttribute(CLIENT_DOWNLOAD_HIDDEN_ATTR, 'true');
    element.style.setProperty('display', 'none', 'important');
  });
  document.querySelectorAll('#worldstage-hosted-videos, button.worldstage-topbar-btn').forEach((element) => {
    if (!isWorldStageHostedVideosNavControl(element)) return;
    element.setAttribute(HOSTED_VIDEOS_HIDDEN_ATTR, 'true');
    element.style.setProperty('display', 'none', 'important');
  });
}

function worldStageNavLayoutCss() {
  return `
    body.${NAV_LAYOUT_CLASS} .worldstage-topbar {
      --worldstage-client-nav-search-width: clamp(320px, 32vw, 500px);
      --worldstage-client-nav-gap: clamp(16px, 1.5vw, 24px);
      --worldstage-client-nav-edge: clamp(18px, 2vw, 30px);
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      height: clamp(88px, 9vh, 112px) !important;
      min-height: 88px !important;
      max-height: none !important;
      display: block !important;
      padding: 0 !important;
      overflow: hidden !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-center {
      position: absolute !important;
      left: 50% !important;
      top: 50% !important;
      width: var(--worldstage-client-nav-search-width) !important;
      max-width: calc(100vw - 168px) !important;
      transform: translate(-50%, -50%) !important;
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      z-index: 2 !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-left,
    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-right {
      position: absolute !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      display: flex !important;
      align-items: center !important;
      gap: clamp(8px, 0.85vw, 12px) !important;
      min-width: 0 !important;
      max-height: calc(100% - 14px) !important;
      overflow: hidden !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-left {
      left: var(--worldstage-client-nav-edge) !important;
      right: calc(50% + (var(--worldstage-client-nav-search-width) / 2) + var(--worldstage-client-nav-gap)) !important;
      justify-content: flex-start !important;
      flex-wrap: nowrap !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-right {
      left: calc(50% + (var(--worldstage-client-nav-search-width) / 2) + var(--worldstage-client-nav-gap)) !important;
      right: 56px !important;
      justify-content: flex-end !important;
      flex-wrap: nowrap !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-brand,
    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-username {
      flex: 0 1 auto !important;
      min-width: 0 !important;
      max-width: none !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-brand {
      max-width: min(170px, 22vw) !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-username {
      max-width: min(138px, 16vw) !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-search-wrap {
      flex: 1 1 auto !important;
      min-width: 0 !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-topbar-btn {
      height: 38px !important;
      min-width: 0 !important;
      padding-left: clamp(7px, 0.7vw, 11px) !important;
      padding-right: clamp(7px, 0.7vw, 11px) !important;
      font-size: clamp(9px, 0.7vw, 12px) !important;
      letter-spacing: 0.04em !important;
    }

    body.${NAV_LAYOUT_CLASS} #worldstage-hosted-videos {
      display: none !important;
    }

    body.${NAV_LAYOUT_CLASS} .worldstage-account-view {
      padding-top: clamp(96px, 14vh, 150px) !important;
    }

    @media (max-width: 1180px) {
      body.${NAV_LAYOUT_CLASS} .worldstage-topbar {
        --worldstage-client-nav-search-width: clamp(280px, 28vw, 340px);
        height: 92px !important;
        min-height: 92px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-brand {
        max-width: 132px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-username {
        max-width: 92px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-left,
      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-right {
        gap: 7px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-right {
        right: 54px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-btn {
        height: 34px !important;
        padding-left: 7px !important;
        padding-right: 7px !important;
        font-size: 10px !important;
        letter-spacing: 0.025em !important;
      }
    }

    @media (max-width: 900px) {
      body.${NAV_LAYOUT_CLASS} .worldstage-topbar {
        --worldstage-client-nav-search-width: min(560px, calc(100vw - 112px));
        height: 136px !important;
        min-height: 136px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-center {
        top: 40px !important;
        width: var(--worldstage-client-nav-search-width) !important;
        max-width: calc(100vw - 112px) !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-left,
      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-right {
        top: 100px !important;
        max-height: 42px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-left {
        left: 18px !important;
        right: calc(50% + 14px) !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-right {
        left: calc(50% + 14px) !important;
        right: 54px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-btn {
        height: 34px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-account-view {
        padding-top: 148px !important;
      }
    }

    @media (max-width: 700px) {
      body.${NAV_LAYOUT_CLASS} .worldstage-topbar {
        --worldstage-client-nav-search-width: calc(100vw - 28px);
        height: 176px !important;
        min-height: 176px !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-left {
        top: 16px !important;
        left: 14px !important;
        right: 58px !important;
        transform: none !important;
        justify-content: flex-start !important;
        flex-wrap: nowrap !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-center {
        top: 72px !important;
        width: var(--worldstage-client-nav-search-width) !important;
        max-width: calc(100vw - 28px) !important;
        transform: translateX(-50%) !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-right {
        top: 122px !important;
        left: 14px !important;
        right: 14px !important;
        transform: none !important;
        justify-content: flex-start !important;
        flex-wrap: nowrap !important;
        overflow-x: auto !important;
        overflow-y: hidden !important;
        max-height: 46px !important;
        padding-bottom: 4px !important;
        scrollbar-width: none !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-right::-webkit-scrollbar {
        display: none !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-brand {
        max-width: 52vw !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-topbar-username {
        max-width: 30vw !important;
      }

      body.${NAV_LAYOUT_CLASS} .worldstage-account-view {
        padding-top: 190px !important;
      }
    }
  `;
}

function ensureWorldStageNavLayoutStyle() {
  const parent = document.head || document.documentElement;
  if (!parent) return null;
  const style = document.getElementById(NAV_LAYOUT_STYLE_ID) || document.createElement('style');
  style.id = NAV_LAYOUT_STYLE_ID;
  style.textContent = worldStageNavLayoutCss();
  if (!style.isConnected) parent.appendChild(style);
  return style;
}

function syncWorldStageNavLayout() {
  const model = buildWorldStageDesktopNavLayoutModel(shellState);
  const body = document.body;
  const existing = document.getElementById(NAV_LAYOUT_STYLE_ID);
  if (!model.enabled) {
    if (body && body.classList) body.classList.remove(NAV_LAYOUT_CLASS);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    return;
  }

  ensureWorldStageNavLayoutStyle();
  if (body && body.classList) body.classList.add(NAV_LAYOUT_CLASS);
}

function buttonMarkup(action, tone) {
  if (!action || !action.id || !action.label) return '';
  const variant = action.id === 'install'
    ? 'primary'
    : tone === 'error'
      ? 'secondary danger'
      : 'secondary';
  return `<button type="button" class="action ${variant}" data-action="${String(action.id)}">${String(action.label)}</button>`;
}

function bannerMarkup(model) {
  const progressMarkup = model.progressPercent > 0
    ? `
      <div class="progress" aria-hidden="true">
        <div class="progress-fill" style="width:${Math.max(0, Math.min(100, Number(model.progressPercent) || 0))}%"></div>
      </div>
    `
    : '';
  const detailsMarkup = model.details
    ? `<p class="details">${String(model.details)}</p>`
    : '';
  return `
    <style>
      :host {
        all: initial;
      }
      .wrap {
        position: fixed;
        top: 84px;
        right: 18px;
        z-index: 2147483647;
        pointer-events: none;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      }
      .card {
        width: min(360px, calc(100vw - 28px));
        background: rgba(8, 12, 20, 0.96);
        color: #f6f0e1;
        border: 1px solid rgba(255, 214, 122, 0.38);
        border-left: 4px solid ${model.tone === 'error' ? '#ff7f7f' : model.tone === 'ready' ? '#7ae5c1' : '#ffd27a'};
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.42);
        backdrop-filter: blur(14px);
        padding: 14px 14px 12px;
        pointer-events: auto;
      }
      .eyebrow {
        margin: 0 0 6px;
        font-size: 11px;
        line-height: 1.4;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #ffd27a;
      }
      .title {
        margin: 0;
        font-size: 17px;
        line-height: 1.25;
        font-weight: 700;
      }
      .message,
      .details {
        margin: 8px 0 0;
        font-size: 13px;
        line-height: 1.55;
        color: rgba(246, 240, 225, 0.88);
      }
      .details {
        color: rgba(246, 240, 225, 0.68);
      }
      .progress {
        margin-top: 10px;
        width: 100%;
        height: 6px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.1);
      }
      .progress-fill {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #ffd27a 0%, #7ae5c1 100%);
        transition: width 200ms ease;
      }
      .actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
      }
      .action {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.03em;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, background-color 120ms ease;
      }
      .action:hover {
        transform: translateY(-1px);
      }
      .action.primary {
        background: #ffd27a;
        color: #131822;
      }
      .action.secondary {
        background: rgba(255, 255, 255, 0.1);
        color: #f6f0e1;
      }
      .action.secondary.danger {
        background: rgba(255, 127, 127, 0.14);
        color: #ffd7d7;
      }
    </style>
    <div class="wrap">
      <section class="card" role="status" aria-live="polite">
        <p class="eyebrow">WorldStage Client Update</p>
        <h2 class="title">${String(model.title || 'Update Available')}</h2>
        <p class="message">${String(model.message || '')}</p>
        ${detailsMarkup}
        ${progressMarkup}
        <div class="actions">
          ${buttonMarkup(model.primaryAction, model.tone)}
          ${buttonMarkup(model.secondaryAction, model.tone)}
        </div>
      </section>
    </div>
  `;
}

function shellControlsMarkup(model = {}) {
  const label = normalizeText(model.label) || 'X';
  const positionClass = model.position === 'top-right' ? 'top-right' : 'bottom-right';
  return `
    <style>
      :host {
        all: initial;
      }
      .wrap {
        position: fixed;
        right: 18px;
        z-index: 2147483647;
        pointer-events: none;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      }
      .wrap.top-right {
        top: 0;
        right: 0;
      }
      .wrap.bottom-right {
        bottom: 18px;
      }
      .exit {
        -webkit-app-region: no-drag;
        appearance: none;
        pointer-events: auto;
        width: 44px;
        height: 40px;
        border: 0;
        border-left: 1px solid rgba(255, 255, 255, 0.24);
        border-bottom: 1px solid rgba(255, 255, 255, 0.24);
        border-top: 0;
        border-right: 0;
        border-radius: 0 0 0 12px;
        background: rgba(8, 12, 20, 0.82);
        color: #f6f0e1;
        box-shadow: -14px 16px 36px rgba(0, 0, 0, 0.34);
        backdrop-filter: blur(12px);
        cursor: pointer;
        font: 800 12px/1 "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .exit:hover {
        border-color: rgba(255, 210, 122, 0.62);
        background: rgba(18, 22, 30, 0.94);
      }
      .exit:focus-visible {
        outline: 2px solid #ffd27a;
        outline-offset: 3px;
      }
    </style>
    <div class="wrap ${positionClass}">
      <button type="button" class="exit" data-shell-action="exit" aria-label="Exit WorldStage" title="Exit WorldStage">${label}</button>
    </div>
  `;
}

async function performBannerAction(actionId) {
  if (!actionId) return;
  if (actionId === 'install') {
    updaterState = await ipcRenderer.invoke('worldstage-site:install-update');
    queueRender();
    return;
  }
  if (actionId === 'retry') {
    updaterState = await ipcRenderer.invoke('worldstage-site:check-for-updates');
    queueRender();
    return;
  }
  if (actionId === 'release') {
    updaterState = await ipcRenderer.invoke('worldstage-site:open-release-page');
    queueRender();
  }
}

function bindBannerActions(shadowRoot) {
  if (!shadowRoot) return;
  shadowRoot.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      performBannerAction(button.getAttribute('data-action')).catch(() => {});
    });
  });
}

async function performShellAction(actionId) {
  if (actionId === 'exit') {
    await ipcRenderer.invoke('worldstage-site:exit-app');
  }
}

function bindShellActions(shadowRoot) {
  if (!shadowRoot) return;
  shadowRoot.querySelectorAll('[data-shell-action]').forEach((button) => {
    button.addEventListener('click', () => {
      performShellAction(button.getAttribute('data-shell-action')).catch(() => {});
    });
  });
}

function renderBanner() {
  const shadowRoot = ensureBannerShadow();
  if (!bannerHost || !shadowRoot) return;
  const model = buildWorldStageSiteUpdaterBannerModel({
    platform: updaterState && updaterState.platform,
    pathname: safePathname(),
    updater: updaterState
  });

  if (!model.visible) {
    bannerHost.style.display = 'none';
    shadowRoot.innerHTML = '';
    return;
  }

  bannerHost.style.display = 'block';
  shadowRoot.innerHTML = bannerMarkup(model);
  bindBannerActions(shadowRoot);
}

function renderShellControls() {
  syncWindowDragRegion();
  syncWorldStageClientDownloadControl();
  syncWorldStageNavLayout();
  const shadowRoot = ensureShellShadow();
  if (!shellHost || !shadowRoot) return;
  const model = buildWorldStageDesktopExitButtonModel({
    ...shellState,
    pathname: safePathname()
  });

  if (!model.visible) {
    shellHost.style.display = 'none';
    shadowRoot.innerHTML = '';
    return;
  }

  shellHost.style.display = 'block';
  shadowRoot.innerHTML = shellControlsMarkup(model);
  bindShellActions(shadowRoot);
}

function installRouteHooks() {
  if (window.__worldstageDesktopUpdaterRouteHooksInstalled) return;
  window.__worldstageDesktopUpdaterRouteHooksInstalled = true;

  const pushState = window.history && typeof window.history.pushState === 'function'
    ? window.history.pushState.bind(window.history)
    : null;
  const replaceState = window.history && typeof window.history.replaceState === 'function'
    ? window.history.replaceState.bind(window.history)
    : null;

  if (pushState) {
    window.history.pushState = function patchedPushState(...args) {
      const result = pushState(...args);
      queueRender();
      return result;
    };
  }

  if (replaceState) {
    window.history.replaceState = function patchedReplaceState(...args) {
      const result = replaceState(...args);
      queueRender();
      return result;
    };
  }

  window.addEventListener('popstate', queueRender);
  window.addEventListener('hashchange', queueRender);
}

function requestUpdaterState(attempt = 0) {
  ipcRenderer.invoke('worldstage-site:get-updater-state').then((state) => {
    updaterState = state;
    queueRender();
  }).catch(() => {
    if (attempt >= 10) return;
    window.setTimeout(() => requestUpdaterState(attempt + 1), 250);
  });
}

function requestShellState(attempt = 0) {
  ipcRenderer.invoke('worldstage-site:get-shell-state').then((state) => {
    shellState = state;
    queueRender();
  }).catch(() => {
    if (attempt >= 10) return;
    window.setTimeout(() => requestShellState(attempt + 1), 250);
  });
}

function initializeBanner() {
  if (initialized) return;
  initialized = true;
  installRouteHooks();
  requestUpdaterState();
  requestShellState();
  ipcRenderer.on(STATE_CHANNEL, (_event, state) => {
    updaterState = state;
    queueRender();
  });
  queueRender();
}

contextBridge.exposeInMainWorld('worldstageDesktopUpdater', {
  getState: () => ipcRenderer.invoke('worldstage-site:get-updater-state'),
  checkForUpdates: () => ipcRenderer.invoke('worldstage-site:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('worldstage-site:install-update'),
  openReleasePage: () => ipcRenderer.invoke('worldstage-site:open-release-page'),
  onStateChanged: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, state) => handler(state);
    ipcRenderer.on(STATE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(STATE_CHANNEL, listener);
  }
});

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initializeBanner, { once: true });
} else {
  initializeBanner();
}
