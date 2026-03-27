const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portal', {
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  toggleDevTools: (webContentsId) => ipcRenderer.send('toggle-devtools', webContentsId),
});
