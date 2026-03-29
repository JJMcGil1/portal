const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portal', {
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

  // DevTools
  toggleDevTools: (webContentsId) => ipcRenderer.send('toggle-devtools', webContentsId),
});
