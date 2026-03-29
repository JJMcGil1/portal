const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portal', {
  // Open URL in system browser (for Google auth fallback)
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // DevTools (legacy)
  toggleDevTools: (webContentsId) => ipcRenderer.send('toggle-devtools', webContentsId),

  // --- Tab View Management (WebContentsView in main process) ---
  createTabView: (tabId, url) => ipcRenderer.invoke('tab-view-create', tabId, url),
  destroyTabView: (tabId) => ipcRenderer.invoke('tab-view-destroy', tabId),
  showTabView: (tabId) => ipcRenderer.invoke('tab-view-show', tabId),
  hideAllTabViews: () => ipcRenderer.invoke('tab-view-hide-all'),
  navigateTabView: (tabId, url) => ipcRenderer.invoke('tab-view-navigate', tabId, url),
  tabGoBack: (tabId) => ipcRenderer.invoke('tab-view-go-back', tabId),
  tabGoForward: (tabId) => ipcRenderer.invoke('tab-view-go-forward', tabId),
  tabReload: (tabId) => ipcRenderer.invoke('tab-view-reload', tabId),
  tabToggleDevTools: (tabId) => ipcRenderer.invoke('tab-view-devtools', tabId),
  setTabViewBounds: (bounds) => ipcRenderer.invoke('tab-view-set-bounds', bounds),

  // Tab view events (main -> renderer)
  onTabDidStartLoading: (cb) => ipcRenderer.on('tab-did-start-loading', (_, tabId) => cb(tabId)),
  onTabDidStopLoading: (cb) => ipcRenderer.on('tab-did-stop-loading', (_, tabId) => cb(tabId)),
  onTabPageTitleUpdated: (cb) => ipcRenderer.on('tab-page-title-updated', (_, tabId, title) => cb(tabId, title)),
  onTabPageFaviconUpdated: (cb) => ipcRenderer.on('tab-page-favicon-updated', (_, tabId, favicons) => cb(tabId, favicons)),
  onTabDidNavigate: (cb) => ipcRenderer.on('tab-did-navigate', (_, tabId, url) => cb(tabId, url)),
  onTabDidNavigateInPage: (cb) => ipcRenderer.on('tab-did-navigate-in-page', (_, tabId, url, isMainFrame) => cb(tabId, url, isMainFrame)),
  onTabNewWindow: (cb) => ipcRenderer.on('tab-new-window', (_, url) => cb(url)),

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
