const { app, BrowserWindow, ipcMain, session, nativeTheme, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database.js');

// Force dark mode at the Chromium level so webviews report prefers-color-scheme: dark
app.commandLine.appendSwitch('force-dark-mode');

let mainWindow;

// --- Live Reload: watch src/ and reload renderer on file changes ---
const isDev = !app.isPackaged;

function setupLiveReload(win) {
  if (!isDev) return;

  const srcDir = __dirname;
  const debounce = {};

  fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (!filename || filename.startsWith('.')) return;

    // Debounce — ignore rapid duplicate events (fs.watch fires multiples)
    if (debounce[filename]) return;
    debounce[filename] = true;
    setTimeout(() => { delete debounce[filename]; }, 300);

    const ext = path.extname(filename).toLowerCase();

    // Main process file changed — need full restart
    if (filename === 'main.js' || filename === 'preload.js' || filename.endsWith('preload.js')) {
      console.log(`[live-reload] Main process file changed: ${filename} — restart the app`);
      return;
    }

    // Renderer files — hot reload
    if (['.html', '.css', '.js'].includes(ext)) {
      console.log(`[live-reload] ${filename} changed — reloading renderer`);
      if (ext === '.css') {
        // CSS-only: inject without full page reload (preserves state)
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

  // Small delay to ensure SVG gradients are fully rendered
  await new Promise(resolve => setTimeout(resolve, 150));

  const image = await iconWindow.webContents.capturePage();
  iconWindow.destroy();
  return image;
}

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
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Set app icon (dock on macOS, taskbar on Windows/Linux)
  generateAppIcon().then(icon => {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(icon);
    }
    mainWindow.setIcon(icon);
  }).catch(err => console.error('[icon]', err));

  setupLiveReload(mainWindow);

  // Configure webview guest processes
  mainWindow.webContents.on('did-attach-webview', (event, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => {
      return { action: 'allow' };
    });

    // Force dark color scheme via CDP. Webview guests are separate Chromium
    // processes — nativeTheme and force-dark-mode flags don't reach them.
    // Attach debugger once per webview, send on every navigation.
    function emitDarkScheme() {
      try {
        if (!webContents.debugger.isAttached()) {
          webContents.debugger.attach('1.3');
        }
        webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: 'dark' }],
        }).catch(() => {});
      } catch {}
    }

    webContents.on('did-finish-load', emitDarkScheme);
    webContents.on('did-navigate', emitDarkScheme);
    webContents.on('did-navigate-in-page', emitDarkScheme);

    webContents.on('destroyed', () => {
      try { if (webContents.debugger.isAttached()) webContents.debugger.detach(); } catch {}
    });
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  // Set a permissive session for webviews
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [''],
      },
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  database.close();
});

// IPC handlers — SQLite persistence
ipcMain.handle('db-get-all-tabs', () => database.getAllTabs());
ipcMain.handle('db-get-active-tab-id', () => database.getActiveTabId());
ipcMain.handle('db-create-tab', (_, tab) => database.createTab(tab));
ipcMain.handle('db-update-tab', (_, id, fields) => database.updateTab(id, fields));
ipcMain.handle('db-delete-tab', (_, id) => database.deleteTab(id));
ipcMain.handle('db-get-next-tab-id', () => database.getNextTabId());
ipcMain.handle('db-get-all-saved', () => database.getAllSaved());
ipcMain.handle('db-create-saved', (_, site) => database.createSaved(site));
ipcMain.handle('db-delete-saved', (_, id) => database.deleteSaved(id));

// Legacy — keep for backward compat during transition
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
