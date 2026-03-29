const { app, ipcMain } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const REPO_OWNER = 'JJMcGil1';
const REPO_NAME = 'portal';
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const STARTUP_DELAY = 5 * 1000; // 5 seconds
const DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const API_TIMEOUT = 30 * 1000; // 30 seconds
const DOWNLOAD_DIR = path.join(require('os').tmpdir(), 'portal-update');

let mainWindow = null;
let pollTimer = null;
let latestRelease = null;
let downloadedPath = null;
let isDownloading = false;

function init(win) {
  mainWindow = win;
  setupIPC();

  if (!app.isPackaged) {
    console.log('[auto-updater] Skipping — running in dev mode');
    return;
  }

  setTimeout(() => {
    checkForUpdates();
    pollTimer = setInterval(checkForUpdates, POLL_INTERVAL);
  }, STARTUP_DELAY);
}

function setupIPC() {
  // Remove any existing handlers first (safe during live reload)
  const channels = ['updater-check', 'updater-download', 'updater-install', 'updater-dismiss', 'updater-get-version'];
  channels.forEach(ch => { try { ipcMain.removeHandler(ch); } catch {} });

  ipcMain.handle('updater-check', () => checkForUpdates());
  ipcMain.handle('updater-download', () => downloadUpdate());
  ipcMain.handle('updater-install', () => installUpdate());
  ipcMain.handle('updater-dismiss', () => {
    latestRelease = null;
  });
  ipcMain.handle('updater-get-version', () => app.getVersion());
}

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('API timeout')), API_TIMEOUT);

    const req = https.get(url, { headers: { 'User-Agent': 'Portal-Updater' } }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timeout);
        return fetchJSON(res.headers.location).then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        clearTimeout(timeout);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function checkForUpdates() {
  try {
    const currentVersion = app.getVersion();
    const releaseUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    const release = await fetchJSON(releaseUrl);

    const tagVersion = (release.tag_name || '').replace(/^v/, '');
    if (!tagVersion || compareVersions(tagVersion, currentVersion) <= 0) {
      send('updater-up-to-date');
      return { upToDate: true };
    }

    // Find latest.json asset
    const latestJsonAsset = (release.assets || []).find(a => a.name === 'latest.json');
    let latestJson = null;
    if (latestJsonAsset) {
      latestJson = await fetchJSON(latestJsonAsset.browser_download_url);
    }

    // Determine correct DMG for architecture
    const arch = process.arch; // arm64 or x64
    const dmgName = arch === 'arm64'
      ? (release.assets || []).find(a => a.name.includes('arm64') && a.name.endsWith('.dmg'))
      : (release.assets || []).find(a => !a.name.includes('arm64') && a.name.endsWith('.dmg'));

    if (!dmgName) {
      console.log('[auto-updater] No DMG found for arch:', arch);
      return { upToDate: true };
    }

    latestRelease = {
      version: tagVersion,
      downloadUrl: dmgName.browser_download_url,
      fileName: dmgName.name,
      latestJson,
      releaseNotes: release.body || 'Bug fixes and improvements.',
    };

    send('updater-update-available', {
      version: tagVersion,
      releaseNotes: latestRelease.releaseNotes,
    });

    return { upToDate: false, version: tagVersion };
  } catch (err) {
    console.error('[auto-updater] Check failed:', err.message);
    send('updater-error', { message: 'Failed to check for updates.' });
    return { error: err.message };
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Download timeout')), DOWNLOAD_TIMEOUT);

    const doRequest = (downloadUrl) => {
      https.get(downloadUrl, { headers: { 'User-Agent': 'Portal-Updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doRequest(res.headers.location);
        }

        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          return reject(new Error(`Download HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'], 10) || 0;
        let transferred = 0;

        const file = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          transferred += chunk.length;
          if (total > 0) {
            const percent = Math.round((transferred / total) * 100);
            send('updater-download-progress', { percent, transferred, total });
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          clearTimeout(timeout);
          file.close(() => resolve());
        });

        file.on('error', (err) => {
          clearTimeout(timeout);
          fs.unlink(dest, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    };

    doRequest(url);
  });
}

async function downloadUpdate() {
  if (!latestRelease || isDownloading) return;

  isDownloading = true;

  try {
    // Ensure download directory exists
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    const dest = path.join(DOWNLOAD_DIR, latestRelease.fileName);

    // Clean up any previous download
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }

    await downloadFile(latestRelease.downloadUrl, dest);

    // Verify SHA256 if latest.json is available
    if (latestRelease.latestJson) {
      const arch = process.arch;
      const platformKey = arch === 'arm64' ? 'mac-arm64' : 'mac';
      const expected = latestRelease.latestJson.platforms?.[platformKey]?.sha256;

      if (expected) {
        const fileData = fs.readFileSync(dest);
        const actual = crypto.createHash('sha256').update(fileData).digest('hex');

        if (actual !== expected) {
          fs.unlinkSync(dest);
          throw new Error('SHA256 hash mismatch — download may be corrupted');
        }
        console.log('[auto-updater] SHA256 verified');
      }
    }

    downloadedPath = dest;
    isDownloading = false;

    send('updater-downloaded');

    // Auto-install after download
    setTimeout(() => installUpdate(), 500);
  } catch (err) {
    isDownloading = false;
    console.error('[auto-updater] Download failed:', err.message);
    send('updater-error', { message: err.message });
  }
}

async function installUpdate() {
  if (!downloadedPath || !fs.existsSync(downloadedPath)) {
    send('updater-error', { message: 'No downloaded update found.' });
    return;
  }

  try {
    send('updater-installing');

    const mountPoint = path.join(DOWNLOAD_DIR, 'portal-mount');

    // Unmount if leftover from previous attempt
    try { execSync(`hdiutil detach "${mountPoint}" -quiet -force 2>/dev/null`); } catch {}

    // Mount the DMG
    if (!fs.existsSync(mountPoint)) {
      fs.mkdirSync(mountPoint, { recursive: true });
    }

    execSync(`hdiutil attach "${downloadedPath}" -mountpoint "${mountPoint}" -nobrowse -quiet`);

    // Find the .app inside
    const items = fs.readdirSync(mountPoint);
    const appName = items.find(i => i.endsWith('.app'));

    if (!appName) {
      execSync(`hdiutil detach "${mountPoint}" -quiet -force`);
      throw new Error('No .app found in DMG');
    }

    const sourcePath = path.join(mountPoint, appName);
    const appPath = app.getPath('exe').split('.app/')[0] + '.app';

    // Replace the current app
    execSync(`rm -rf "${appPath}"`);
    execSync(`cp -R "${sourcePath}" "${appPath}"`);

    // Strip quarantine attribute
    execSync(`xattr -cr "${appPath}"`);

    // Unmount
    execSync(`hdiutil detach "${mountPoint}" -quiet -force`);

    // Clean up download
    try {
      fs.unlinkSync(downloadedPath);
      fs.rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
    } catch {}

    // Relaunch
    app.relaunch();
    app.exit(0);
  } catch (err) {
    console.error('[auto-updater] Install failed:', err.message);
    send('updater-error', { message: 'Installation failed: ' + err.message });
  }
}

function destroy() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = { init, destroy };
