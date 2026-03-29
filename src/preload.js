const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portal', {
  // Open URL in system browser (for Google auth fallback)
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // DevTools
  toggleDevTools: (webContentsId) => ipcRenderer.send('toggle-devtools', webContentsId),

  // Tab persistence
  getAllTabs: () => ipcRenderer.invoke('db-get-all-tabs'),
  getActiveTabId: () => ipcRenderer.invoke('db-get-active-tab-id'),
  createTabInDb: (tab) => ipcRenderer.invoke('db-create-tab', tab),
  updateTab: (id, fields) => ipcRenderer.invoke('db-update-tab', id, fields),
  deleteTab: (id) => ipcRenderer.invoke('db-delete-tab', id),
  getNextTabId: () => ipcRenderer.invoke('db-get-next-tab-id'),

  // Saved sites persistence
  getAllSaved: () => ipcRenderer.invoke('db-get-all-saved'),
  createSaved: (site) => ipcRenderer.invoke('db-create-saved', site),
  deleteSaved: (id) => ipcRenderer.invoke('db-delete-saved', id),

  // User profile
  getProfile: () => ipcRenderer.invoke('db-get-profile'),
  updateProfile: (fields) => ipcRenderer.invoke('db-update-profile', fields),

  // Pinned tab reorder
  reorderPinnedTabs: (orderedIds) => ipcRenderer.invoke('db-reorder-pinned-tabs', orderedIds),

  // Legacy
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),

  // Auto-updater
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater-check'),
    downloadUpdate: () => ipcRenderer.invoke('updater-download'),
    installUpdate: () => ipcRenderer.invoke('updater-install'),
    dismissUpdate: () => ipcRenderer.invoke('updater-dismiss'),
    getVersion: () => ipcRenderer.invoke('updater-get-version'),
    onUpdateAvailable: (cb) => ipcRenderer.on('updater-update-available', (_, data) => cb(data)),
    onUpToDate: (cb) => ipcRenderer.on('updater-up-to-date', () => cb()),
    onDownloadProgress: (cb) => ipcRenderer.on('updater-download-progress', (_, data) => cb(data)),
    onUpdateDownloaded: (cb) => ipcRenderer.on('updater-downloaded', () => cb()),
    onInstalling: (cb) => ipcRenderer.on('updater-installing', () => cb()),
    onUpdateError: (cb) => ipcRenderer.on('updater-error', (_, data) => cb(data)),
  },
});
