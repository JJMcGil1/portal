// Suppress Electron security warnings before anything else
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const { app, BrowserWindow, WebContentsView, ipcMain, session, nativeTheme, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database.js');
const autoUpdater = require('./auto-updater.js');

// Crash diagnostics — catch silent deaths
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled rejection:', reason);
});

// Force dark mode at the Chromium level
app.commandLine.appendSwitch('force-dark-mode');

// Disable Chromium features that leak Electron identity
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication,Autofill');
// Allow third-party cookies (Google auth flow uses cross-origin cookies extensively)
app.commandLine.appendSwitch('disable-site-isolation-trials');


// --- Structured logging ---
const log = {
  tab: (tabId, msg, ...args) => console.log(`[tab:${tabId}] ${msg}`, ...args),
  session: (msg, ...args) => console.log(`[session] ${msg}`, ...args),
  app: (msg, ...args) => console.log(`[app] ${msg}`, ...args),
  warn: (ctx, msg, ...args) => console.warn(`[${ctx}] ⚠ ${msg}`, ...args),
};

// Strip "Electron" from the default user agent globally
const defaultUA = app.userAgentFallback;
app.userAgentFallback = defaultUA
  .replace(/\s*Electron\/[\d.]+/, '')
  .replace(/\s*portal\/[\d.]+/, '');

let mainWindow;

// --- Tab View Management ---
const tabViews = new Map(); // tabId -> WebContentsView
const pinnedTabs = new Map(); // tabId -> pinnedUrl (used to intercept cross-origin nav)
const pinnedTabRestoring = new Set(); // tabIds currently being restored to their pinned URL
let activeTabViewId = null;
let contentBounds = { x: 0, y: 0, width: 800, height: 600 };

// --- Live Reload ---
const isDev = !app.isPackaged;

function setupLiveReload(win) {
  if (!isDev) return;

  const srcDir = __dirname;
  const debounce = {};

  fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (!filename || filename.startsWith('.')) return;
    // Ignore build output directory — esbuild writes to src/dist/
    if (filename.startsWith('dist/') || filename.startsWith('dist\\')) return;

    if (debounce[filename]) return;
    debounce[filename] = true;
    setTimeout(() => { delete debounce[filename]; }, 300);

    const ext = path.extname(filename).toLowerCase();

    if (filename === 'main.js' || filename === 'preload.js' || filename.endsWith('preload.js')) {
      log.app(`Main process file changed: ${filename} — restart the app`);
      return;
    }

    if (['.html', '.css', '.js'].includes(ext)) {
      log.app(`${filename} changed — reloading renderer`);
      if (ext === '.css') {
        win.webContents.executeJavaScript(`
          document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
            const href = link.href.split('?')[0];
            link.href = href + '?reload=' + Date.now();
          });
        `).catch(() => {});
      } else {
        win.webContents.reloadIgnoringCache();
      }
    }
  });

  log.app('Live reload watching src/ for changes');
}

async function generateAppIcon() {
  const iconWindow = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });

  await iconWindow.loadFile(path.join(__dirname, 'icons', 'app-icon.html'));
  await new Promise(resolve => setTimeout(resolve, 150));
  const image = await iconWindow.webContents.capturePage();
  iconWindow.destroy();
  return image;
}

// --- Chrome version info (used for UA spoofing and header rewriting) ---
const chromeVersion = process.versions.chrome;
const chromeMajor = chromeVersion.split('.')[0];

// --- Dark mode injection for tab views ---
const darkModeCSS = `
  @media (prefers-color-scheme: light) {
    :root { color-scheme: dark !important; }
  }
`;

function injectDarkMode(webContents) {
  webContents.insertCSS(darkModeCSS).catch(() => {});
  webContents.executeJavaScript(`
    if (!document.querySelector('meta[name="color-scheme"][data-portal]')) {
      const meta = document.createElement('meta');
      meta.name = 'color-scheme';
      meta.content = 'dark';
      meta.dataset.portal = '1';
      document.head.appendChild(meta);
    }
  `).catch(() => {});
}


// --- URL sanitization ---
// Google auth rejection URLs get persisted in the DB. On restore, redirect to the
// original destination (the `continue` param) instead of loading the rejection page.
function sanitizeUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname === 'accounts.google.com' && u.pathname.includes('/signin/rejected')) {
      const continueUrl = u.searchParams.get('continue') || u.searchParams.get('followup');
      if (continueUrl) {
        log.app(`Sanitized rejected Google URL → ${continueUrl}`);
        return continueUrl;
      }
    }
  } catch (e) {}
  return url;
}

// --- Tab View lifecycle ---

function createTabView(tabId, url) {
  if (!mainWindow) return;

  url = sanitizeUrl(url);
  log.tab(tabId, `Creating WebContentsView${url ? ` → ${url}` : ' (blank)'}`);

  // Destroy existing view for this tabId (e.g. after renderer reload)
  if (tabViews.has(tabId)) {
    log.tab(tabId, 'Destroying previous view (renderer reload cleanup)');
    const oldView = tabViews.get(tabId);
    mainWindow.contentView.removeChildView(oldView);
    tabViews.delete(tabId);
  }

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'webview-preload.js'),
      partition: 'persist:portal',
      contextIsolation: false,   // Must be false so preload can set window.chrome, navigator.userAgentData etc.
      nodeIntegration: false,
      sandbox: false,
    }
  });

  const wc = view.webContents;

  // Guard: wrap event handler to skip if webContents has been destroyed
  const safeOn = (event, handler) => {
    wc.on(event, (...args) => {
      if (wc.isDestroyed()) return;
      try {
        handler(...args);
      } catch (e) {
        if (e?.message?.includes('destroyed')) return;
        throw e;
      }
    });
  };

  const chromeUA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

  // Register view in map AND add to window IMMEDIATELY so showTabView can
  // find it and setBounds works (view starts off-screen until activated).
  // This MUST happen synchronously so showTabView (called right after) can find it.
  tabViews.set(tabId, view);
  view.setBounds({ x: -9999, y: -9999, width: 1, height: 1 });
  try { view.setBorderRadius(11); } catch (e) {}
  mainWindow.contentView.addChildView(view);

  // Set UA at the webContents level (synchronous, takes effect before any navigation).
  // navigator.userAgentData is disabled via Chromium flag (--disable-features=UserAgentClientHint).
  // Google falls back to parsing the User-Agent string, which this controls.
  wc.setUserAgent(chromeUA);

  // Crash detection — log when a tab's renderer process dies
  safeOn('render-process-gone', (event, details) => {
    log.warn('tab:' + tabId, `Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`);
  });

  wc.on('destroyed', () => {
    log.tab(tabId, 'Destroyed');
  });

  // Dark mode injection
  safeOn('did-finish-load', () => injectDarkMode(wc));
  safeOn('did-navigate', (event, navUrl) => {
    injectDarkMode(wc);

    // Google sign-in detection: if Google rejects sign-in, open in system browser.
    // Google blocks ALL Electron-based browsers (even Arc-style WebContentsView).
    // The only reliable approach is system browser for auth.
    if (navUrl && navUrl.includes('accounts.google.com') && navUrl.includes('/signin/rejected')) {
      const u = new URL(navUrl);
      const continueUrl = u.searchParams.get('continue') || u.searchParams.get('followup') || 'https://accounts.google.com';
      log.app(`Google blocked sign-in — opening in system browser: ${continueUrl}`);
      shell.openExternal(continueUrl);
      // Navigate the tab to the destination (user will be signed out but can browse)
      wc.loadURL(continueUrl);
    }
  });

  // Forward events to the renderer UI
  safeOn('did-start-loading', () => {
    mainWindow?.webContents.send('tab-did-start-loading', tabId);
  });

  safeOn('did-stop-loading', () => {
    mainWindow?.webContents.send('tab-did-stop-loading', tabId);
  });

  safeOn('page-title-updated', (event, title) => {
    mainWindow?.webContents.send('tab-page-title-updated', tabId, title);
  });

  safeOn('page-favicon-updated', (event, favicons) => {
    mainWindow?.webContents.send('tab-page-favicon-updated', tabId, favicons);
  });

  safeOn('did-navigate', (event, navUrl) => {
    mainWindow?.webContents.send('tab-did-navigate', tabId, navUrl);
  });

  safeOn('did-navigate-in-page', (event, navUrl, isMainFrame) => {
    mainWindow?.webContents.send('tab-did-navigate-in-page', tabId, navUrl, isMainFrame);
  });

  // Pinned tab protection: block ALL navigations away from the pinned URL
  safeOn('will-navigate', (event, navUrl) => {
    const pinnedUrl = pinnedTabs.get(tabId);
    if (!pinnedUrl) return;
    // Allow navigating to the exact pinned URL (e.g. reload)
    if (navUrl === pinnedUrl) return;
    event.preventDefault();
    log.tab(tabId, `Pinned tab: blocked nav to ${navUrl}, opening in new tab`);
    mainWindow?.webContents.send('tab-new-window', navUrl);
  });

  // Pinned tab safety net: catch navigations that slipped past will-navigate
  // (e.g. JS-initiated navigations, redirects)
  safeOn('did-navigate', (event, navUrl) => {
    const pinnedUrl = pinnedTabs.get(tabId);
    if (!pinnedUrl) return;
    // If we're restoring the pinned tab back to its URL, just clear the flag
    if (pinnedTabRestoring.has(tabId)) {
      pinnedTabRestoring.delete(tabId);
      return;
    }
    if (navUrl === pinnedUrl) return;
    log.tab(tabId, `Pinned tab escaped to ${navUrl}, opening in new tab and restoring`);
    mainWindow?.webContents.send('tab-new-window', navUrl);
    pinnedTabRestoring.add(tabId);
    wc.loadURL(pinnedUrl);
  });

  // Pinned tab: catch SPA navigations (pushState/replaceState) that bypass will-navigate
  safeOn('did-navigate-in-page', (event, navUrl, isMainFrame) => {
    if (!isMainFrame) return;
    const pinnedUrl = pinnedTabs.get(tabId);
    if (!pinnedUrl) return;
    // Allow hash-only changes on the same page (e.g. scrolling to anchors)
    try {
      const pinned = new URL(pinnedUrl);
      const nav = new URL(navUrl);
      pinned.hash = '';
      nav.hash = '';
      if (pinned.href === nav.href) return; // same page, different hash — allow
    } catch (e) {}
    if (navUrl === pinnedUrl) return;
    log.tab(tabId, `Pinned tab SPA nav to ${navUrl}, opening in new tab and going back`);
    mainWindow?.webContents.send('tab-new-window', navUrl);
    wc.goBack();
  });

  // Popup / target=_blank handling
  wc.setWindowOpenHandler(({ url: openUrl, disposition }) => {
    try {
      // OAuth popups (Google, Apple, etc.) need a real popup window with
      // window.opener intact so postMessage / storagerelay:// flow works.
      // Using action:'allow' lets Electron create the child window with the
      // correct opener reference. We configure it via overrideBrowserWindowOptions.
      if (openUrl.includes('accounts.google.com/o/oauth2') ||
          openUrl.includes('accounts.google.com/signin/oauth') ||
          openUrl.includes('appleid.apple.com/auth')) {
        log.tab(tabId, `Opening OAuth popup: ${openUrl.substring(0, 80)}…`);
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 500,
            height: 700,
            resizable: true,
            parent: mainWindow,
            webPreferences: {
              partition: 'persist:portal',
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      mainWindow?.webContents.send('tab-new-window', openUrl);
    } catch (e) {
      if (!e?.message?.includes('destroyed')) throw e;
    }
    return { action: 'deny' };
  });

  // Handle OAuth popup lifecycle after Electron creates it
  wc.on('did-create-window', (childWindow) => {
    log.tab(tabId, `OAuth popup window created`);
    // Auto-close when OAuth redirects to storagerelay:// (token delivered via postMessage)
    childWindow.webContents.on('will-navigate', (e, navUrl) => {
      if (navUrl.startsWith('storagerelay://')) {
        log.tab(tabId, `OAuth complete, closing popup`);
        childWindow.close();
      }
    });
  });

  // Navigate
  if (url) {
    log.tab(tabId, `Navigating to ${url}`);
    wc.loadURL(url);
  }

  log.tab(tabId, `Ready (pid: ${wc.getOSProcessId()}, partition: persist:portal)`);
}

function showTabView(tabId) {
  // Hide the previously active view
  if (activeTabViewId !== null && activeTabViewId !== tabId) {
    const oldView = tabViews.get(activeTabViewId);
    if (oldView) {
      oldView.setBounds({ x: -9999, y: -9999, width: 1, height: 1 });
    }
  }

  // Show the requested view
  const view = tabViews.get(tabId);
  if (view) {
    log.tab(tabId, `Showing at bounds: ${JSON.stringify(contentBounds)}`);
    view.setBounds(contentBounds);
    try { view.setBorderRadius(11); } catch (e) {}
    activeTabViewId = tabId;
  } else {
    log.warn('tab', `showTabView(${tabId}) — view not found in map`);
  }
}

function hideAllTabViews() {
  for (const [, view] of tabViews) {
    view.setBounds({ x: -9999, y: -9999, width: 1, height: 1 });
  }
  activeTabViewId = null;
}

function destroyTabView(tabId) {
  const view = tabViews.get(tabId);
  if (view) {
    mainWindow.contentView.removeChildView(view);
    tabViews.delete(tabId);
    if (activeTabViewId === tabId) {
      activeTabViewId = null;
    }
    log.tab(tabId, 'Destroyed');
  }
}

function updateContentBounds(bounds) {
  const changed = contentBounds.x !== bounds.x || contentBounds.y !== bounds.y ||
                  contentBounds.width !== bounds.width || contentBounds.height !== bounds.height;
  contentBounds = bounds;
  if (changed) {
    log.app(`Content bounds updated: ${JSON.stringify(bounds)}`);
  }
  // Reposition the active tab view
  if (activeTabViewId !== null) {
    const view = tabViews.get(activeTabViewId);
    if (view) {
      view.setBounds(contentBounds);
      try { view.setBorderRadius(11); } catch (e) {}
    }
  }
}

// --- Window creation ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 10 },
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.warn('app', `Main renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`);
  });
  mainWindow.on('unresponsive', () => {
    log.warn('app', 'Window became unresponsive');
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log.warn('app', `Main renderer failed to load: ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  // Set app icon — only needed in dev mode; packaged app uses bundled .icns
  if (!app.isPackaged) {
    generateAppIcon().then(icon => {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(icon);
      }
      mainWindow.setIcon(icon);
    }).catch(err => console.error('[icon]', err));
  }

  setupLiveReload(mainWindow);

  // Initialize auto-updater
  autoUpdater.init(mainWindow);
}

app.whenReady().then(async () => {
  log.app('Portal starting');
  log.app(`Architecture: WebContentsView (embedded Chromium ${chromeVersion})`);
  log.app(`Platform: ${process.platform} ${process.arch}`);
  log.app(`Electron: ${process.versions.electron}`);

  nativeTheme.themeSource = 'dark';

  // Configure the persist:portal partition (shared by all tab views)
  const portalSession = session.fromPartition('persist:portal');

  // One-time session clear to purge Google's flagged cookies from previous
  // spoofing attempts. Uses a flag file so it only happens once.
  const flagFile = path.join(app.getPath('userData'), '.session-cleared-v3');
  if (!fs.existsSync(flagFile)) {
    await portalSession.clearStorageData();
    fs.writeFileSync(flagFile, new Date().toISOString());
    log.session('One-time session clear (purging stale Google flags)');
  }

  const cleanUA = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not-A.Brand";v="99"`;
  const cleanUAFull = `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="99.0.0.0"`;

  // Rewrite headers to remove ALL Electron fingerprints.
  // Rewrite Sec-CH-UA headers and strip Electron from User-Agent on all requests.
  portalSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = {};

    // Rebuild headers, stripping any sec-ch-ua variants (case-insensitive)
    // and Electron traces from User-Agent
    for (const [key, value] of Object.entries(details.requestHeaders)) {
      const lower = key.toLowerCase();

      // Skip all sec-ch-ua headers — we'll set correct ones below
      if (lower === 'sec-ch-ua' || lower === 'sec-ch-ua-full-version-list' ||
          lower === 'sec-ch-ua-mobile' || lower === 'sec-ch-ua-platform') {
        continue;
      }

      // Clean User-Agent
      if (lower === 'user-agent') {
        headers[key] = value
          .replace(/\s*Electron\/[\d.]+/, '')
          .replace(/\s*portal\/[\d.]+/, '');
        continue;
      }

      headers[key] = value;
    }

    // Force-set all client hint headers with correct values
    headers['Sec-CH-UA'] = cleanUA;
    headers['Sec-CH-UA-Full-Version-List'] = cleanUAFull;
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"macOS"';

    callback({ requestHeaders: headers });
  });

  // Strip restrictive CSP headers
  portalSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    callback({ responseHeaders: headers });
  });

  // Allow all permissions
  portalSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  portalSession.cookies.flushStore().catch(() => {});

  // Set standard user agent on the session
  const sessionUA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  portalSession.setUserAgent(sessionUA);

  log.session('Session configured: UA spoofing, header rewriting, CSP stripping, permission grants');
  log.session(`UA: Chrome/${chromeVersion} on macOS`);

  app.on('child-process-gone', (event, details) => {
    log.warn('app', `Child process gone: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}, name=${details.name || 'unknown'}`);
  });

  createWindow();
  log.app('Window created — ready');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  session.fromPartition('persist:portal').cookies.flushStore().catch(() => {});
  autoUpdater.destroy();
  database.close();
});

// --- IPC: Tab View Management ---

ipcMain.handle('tab-view-create', (_, tabId, url) => {
  createTabView(tabId, url);
});

ipcMain.handle('tab-view-destroy', (_, tabId) => {
  destroyTabView(tabId);
});

ipcMain.handle('tab-view-show', (_, tabId) => {
  showTabView(tabId);
});

ipcMain.handle('tab-view-hide-all', () => {
  hideAllTabViews();
});

ipcMain.handle('tab-view-navigate', (_, tabId, url) => {
  url = sanitizeUrl(url);
  // Don't navigate pinned tabs — renderer should handle this, but safety net
  if (pinnedTabs.has(tabId)) {
    log.tab(tabId, `Blocked navigate on pinned tab → ${url}, opening in new tab`);
    mainWindow?.webContents.send('tab-new-window', url);
    return;
  }
  const view = tabViews.get(tabId);
  if (view && !view.webContents.isDestroyed()) {
    log.tab(tabId, `Navigating → ${url}`);
    view.webContents.loadURL(url);
  }
});

ipcMain.handle('tab-view-go-back', (_, tabId) => {
  if (pinnedTabs.has(tabId)) return; // pinned tabs don't navigate
  const view = tabViews.get(tabId);
  if (view && !view.webContents.isDestroyed() && view.webContents.canGoBack()) {
    view.webContents.goBack();
  }
});

ipcMain.handle('tab-view-go-forward', (_, tabId) => {
  if (pinnedTabs.has(tabId)) return; // pinned tabs don't navigate
  const view = tabViews.get(tabId);
  if (view && !view.webContents.isDestroyed() && view.webContents.canGoForward()) {
    view.webContents.goForward();
  }
});

ipcMain.handle('tab-view-reload', (_, tabId) => {
  const view = tabViews.get(tabId);
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.reload();
  }
});

ipcMain.handle('tab-view-devtools', (_, tabId) => {
  const view = tabViews.get(tabId);
  if (view) {
    if (view.webContents.isDevToolsOpened()) {
      view.webContents.closeDevTools();
    } else {
      view.webContents.openDevTools({ mode: 'right' });
    }
  }
});

ipcMain.handle('tab-view-set-bounds', (_, bounds) => {
  updateContentBounds(bounds);
});

// --- IPC: General ---

// Open URL in system browser
ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url);
});

// --- IPC: SQLite persistence ---
ipcMain.handle('db-get-all-tabs', () => database.getAllTabs());
ipcMain.handle('db-get-active-tab-id', () => database.getActiveTabId());
ipcMain.handle('db-create-tab', (_, tab) => database.createTab(tab));
ipcMain.handle('db-update-tab', (_, id, fields) => database.updateTab(id, fields));
ipcMain.handle('db-delete-tab', (_, id) => database.deleteTab(id));
ipcMain.handle('db-get-next-tab-id', () => database.getNextTabId());
ipcMain.handle('db-get-all-saved', () => database.getAllSaved());
ipcMain.handle('db-create-saved', (_, site) => database.createSaved(site));
ipcMain.handle('db-delete-saved', (_, id) => database.deleteSaved(id));
ipcMain.handle('db-get-profile', () => database.getProfile());
ipcMain.handle('db-update-profile', (_, fields) => database.updateProfile(fields));
ipcMain.handle('db-reorder-pinned-tabs', (_, orderedIds) => database.reorderPinnedTabs(orderedIds));

// Pinned tab state sync (renderer tells main which tabs are pinned)
ipcMain.handle('tab-set-pinned', (_, tabId, url) => { pinnedTabs.set(tabId, url); });
ipcMain.handle('tab-unset-pinned', (_, tabId) => { pinnedTabs.delete(tabId); });

// Legacy
ipcMain.handle('load-data', () => ({ sites: database.getAllSaved() }));
ipcMain.handle('save-data', () => {});

// Handle DevTools toggle for webview (legacy, kept for compatibility)
ipcMain.on('toggle-devtools', (event, webContentsId) => {
  const allWebContents = require('electron').webContents.getAllWebContents();
  const target = allWebContents.find((wc) => wc.id === webContentsId);
  if (target) {
    if (target.isDevToolsOpened()) {
      target.closeDevTools();
    } else {
      target.openDevTools({ mode: 'right' });
    }
  }
});
