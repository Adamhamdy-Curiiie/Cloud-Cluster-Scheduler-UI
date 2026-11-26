const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('schedulerApi', {
  run: input => ipcRenderer.invoke('scheduler:run', input),
  listModels: () => ipcRenderer.invoke('scheduler:models')
});
