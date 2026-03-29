// Suppress Electron security warnings before anything else
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const { app, BrowserWindow, ipcMain, session, nativeTheme, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database.js');

// Force dark mode at the Chromium level
app.commandLine.appendSwitch('force-dark-mode');

// Strip "Electron" from the default user agent globally
const defaultUA = app.userAgentFallback;
app.userAgentFallback = defaultUA
  .replace(/\s*Electron\/[\d.]+/, '')
  .replace(/\s*portal\/[\d.]+/, '');

let mainWindow;

// --- Live Reload ---
const isDev = !app.isPackaged;

function setupLiveReload(win) {
  if (!isDev) return;

  const srcDir = __dirname;
  const debounce = {};

  fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (!filename || filename.startsWith('.')) return;

    if (debounce[filename]) return;
    debounce[filename] = true;
    setTimeout(() => { delete debounce[filename]; }, 300);

    const ext = path.extname(filename).toLowerCase();

    if (filename === 'main.js' || filename === 'preload.js' || filename.endsWith('preload.js')) {
      console.log(`[live-reload] Main process file changed: ${filename} — restart the app`);
      return;
    }

    if (['.html', '.css', '.js'].includes(ext)) {
      console.log(`[live-reload] ${filename} changed — reloading renderer`);
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

  console.log('[live-reload] Watching src/ for changes...');
}

async function generateAppIcon() {
  const iconWindow = new BrowserWindow({
    width: 512,
    height: 512,
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

// --- Chrome spoofing ---
const chromeVersion = process.versions.chrome;
const chromeMajor = chromeVersion.split('.')[0];

const CHROME_SPOOF_SCRIPT = `
  if (navigator.userAgentData) {
    const brands = [
      { brand: "Chromium", version: "${chromeMajor}" },
      { brand: "Google Chrome", version: "${chromeMajor}" },
      { brand: "Not-A.Brand", version: "99" }
    ];
    Object.defineProperty(navigator, 'userAgentData', {
      value: Object.create(NavigatorUAData.prototype, {
        brands: { get: () => brands, enumerable: true },
        mobile: { get: () => false, enumerable: true },
        platform: { get: () => "macOS", enumerable: true },
        toJSON: { value: function() { return { brands, mobile: false, platform: "macOS" }; } },
        getHighEntropyValues: {
          value: function(hints) {
            return Promise.resolve({
              brands,
              mobile: false,
              platform: "macOS",
              platformVersion: "15.0.0",
              architecture: "arm",
              model: "",
              uaFullVersion: "${chromeVersion}",
              fullVersionList: [
                { brand: "Chromium", version: "${chromeVersion}" },
                { brand: "Google Chrome", version: "${chromeVersion}" },
                { brand: "Not-A.Brand", version: "99.0.0.0" }
              ]
            });
          }
        }
      }),
      configurable: false
    });
  }
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() { return { onMessage: { addListener: function(){} }, postMessage: function(){} }; },
      sendMessage: function() {},
      onMessage: { addListener: function(){}, removeListener: function(){} },
      onConnect: { addListener: function(){}, removeListener: function(){} },
      id: undefined
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return { commitLoadTime: Date.now()/1000, connectionInfo: "h2", finishDocumentLoadTime: Date.now()/1000,
        finishLoadTime: Date.now()/1000, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now()/1000,
        navigationType: "Other", npnNegotiatedProtocol: "h2", requestTime: Date.now()/1000,
        startLoadTime: Date.now()/1000, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true, wasNpnNegotiated: true };
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() { return { startE: Date.now(), onloadT: Date.now(), pageT: Date.now(), tran: 15 }; };
  }
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: "PDF Viewer", filename: "internal-pdf-viewer", description: "Portable Document Format" },
      { name: "Chrome PDF Viewer", filename: "internal-pdf-viewer", description: "" },
      { name: "Chromium PDF Viewer", filename: "internal-pdf-viewer", description: "" },
      { name: "Microsoft Edge PDF Viewer", filename: "internal-pdf-viewer", description: "" },
      { name: "WebKit built-in PDF", filename: "internal-pdf-viewer", description: "" }
    ]
  });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
    try { delete window.process; } catch(e) {}
  }
`;

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
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Set app icon
  generateAppIcon().then(icon => {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(icon);
    }
    mainWindow.setIcon(icon);
  }).catch(err => console.error('[icon]', err));

  setupLiveReload(mainWindow);

  // Inject Chrome spoofing into every webview
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    // Set user agent
    webContents.setUserAgent(
      `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
    );

    // Inject spoofing before page scripts run
    webContents.on('did-start-navigation', (e, navUrl, isInPlace, isMainFrame) => {
      if (isMainFrame) {
        webContents.executeJavaScript(CHROME_SPOOF_SCRIPT).catch(() => {});
      }
    });

    // Dark mode injection
    const darkModeCSS = `
      @media (prefers-color-scheme: light) {
        :root { color-scheme: dark !important; }
      }
    `;
    function injectDarkMode() {
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
    webContents.on('did-finish-load', injectDarkMode);
    webContents.on('did-navigate', injectDarkMode);
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';

  // Configure the persist:portal partition
  const webviewSession = session.fromPartition('persist:portal');

  const cleanUA = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not-A.Brand";v="99"`;
  const cleanUAFull = `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="99.0.0.0"`;

  // Rewrite headers to remove Electron fingerprint
  webviewSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (headers['Sec-CH-UA'] || headers['sec-ch-ua']) {
      headers['Sec-CH-UA'] = cleanUA;
      delete headers['sec-ch-ua'];
    }
    if (headers['Sec-CH-UA-Full-Version-List'] || headers['sec-ch-ua-full-version-list']) {
      headers['Sec-CH-UA-Full-Version-List'] = cleanUAFull;
      delete headers['sec-ch-ua-full-version-list'];
    }
    if (headers['User-Agent']) {
      headers['User-Agent'] = headers['User-Agent']
        .replace(/\s*Electron\/[\d.]+/, '')
        .replace(/\s*portal\/[\d.]+/, '');
    }
    callback({ requestHeaders: headers });
  });

  // Strip restrictive CSP headers
  webviewSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    delete headers['x-frame-options'];
    delete headers['X-Frame-Options'];
    callback({ responseHeaders: headers });
  });

  // Allow all permissions
  webviewSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  webviewSession.cookies.flushStore().catch(() => {});

  // Set standard user agent
  webviewSession.setUserAgent(
    `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  session.fromPartition('persist:portal').cookies.flushStore().catch(() => {});
  database.close();
});

// --- IPC ---

// Open URL in system browser (for Google auth fallback)
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
// Legacy
ipcMain.handle('load-data', () => ({ sites: database.getAllSaved() }));
ipcMain.handle('save-data', () => {});

// Handle DevTools toggle for webview
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
