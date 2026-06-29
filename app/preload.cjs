const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (args) => ipcRenderer.invoke('saveFile', args),
  createFile: (args) => ipcRenderer.invoke('createFile', args),
  moveFile: (args) => ipcRenderer.invoke('moveFile', args),
  copyFiles: (args) => ipcRenderer.invoke('copyFiles', args),
  renameFile: (args) => ipcRenderer.invoke('renameFile', args),
  deleteFiles: (args) => ipcRenderer.invoke('deleteFiles', args),
  readFileText: (filePath) => ipcRenderer.invoke('readFileText', filePath),
  getFileTree: () => ipcRenderer.invoke('getFileTree'),
  getSubTree: (relPath) => ipcRenderer.invoke('getSubTree', relPath),
  getFileAsDataUrl: (filePath) => ipcRenderer.invoke('getFileAsDataUrl', filePath),
  openFolder: () => ipcRenderer.invoke('openFolder'),
  openInFileManager: (relPath) => ipcRenderer.invoke('openInFileManager', relPath),
  setBaseDir: (dirPath) => ipcRenderer.invoke('setBaseDir', dirPath),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  exportPdf: (filename) => ipcRenderer.send('export-pdf', filename),
  saveBinaryDialog: (args) => ipcRenderer.invoke('saveBinaryDialog', args),
  getLinkConfig: (relPath) => ipcRenderer.invoke('getLinkConfig', relPath),
  setLinkConfig: (args) => ipcRenderer.invoke('setLinkConfig', args),
  getAppSettings: () => ipcRenderer.invoke('getAppSettings'),
  setAppSettings: (obj) => ipcRenderer.invoke('setAppSettings', obj),
  getSshBypassJump: () => ipcRenderer.invoke('getSshBypassJump'),
  setSshBypassJump: (value) => ipcRenderer.invoke('setSshBypassJump', value),
  getCacheInfo: () => ipcRenderer.invoke('getCacheInfo'),
  setCacheConfig: (cfg) => ipcRenderer.invoke('setCacheConfig', cfg),
  clearCache: () => ipcRenderer.invoke('clearCache'),
  prefetchDeck: (relPath) => ipcRenderer.invoke('prefetchDeck', relPath),
  pickFile: (options) => ipcRenderer.invoke('pickFile', options),
  getSnipets: () => ipcRenderer.invoke('getSnipets'),
  getTemplates: () => ipcRenderer.invoke('getTemplates'),
  getTemplateContent: (path) => ipcRenderer.invoke('getTemplateContent', path),
  getThemes: (dirs) => ipcRenderer.invoke('getThemes', dirs),
  getAppVersion: () => ipcRenderer.invoke('getAppVersion'),
  setModified: (modified) => ipcRenderer.send('set-modified', modified),
  onAppCloseRequest: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('app-close-request', handler);
    return () => ipcRenderer.removeListener('app-close-request', handler);
  },
  confirmAppClose: () => ipcRenderer.send('app-close-confirmed'),
  startRemoteServer: () => ipcRenderer.invoke('startRemoteServer'),
  getRemoteInfo: () => ipcRenderer.invoke('getRemoteInfo'),
  stopRemoteServer: () => ipcRenderer.send('stopRemoteServer'),
  captureSlide: (data) => ipcRenderer.invoke('captureSlide', data),
  onCaptureRender: (cb) => {
    const handler = (e, d) => cb(d);
    ipcRenderer.on('capture-render', handler);
    return () => ipcRenderer.removeListener('capture-render', handler);
  },
  sendCaptureReady: (id) => ipcRenderer.send('capture-ready', id),
  getModules: () => ipcRenderer.invoke('getModules'),
  getModuleContent: (path) => ipcRenderer.invoke('getModuleContent', path),
  getEffects: () => ipcRenderer.invoke('getEffects'),
  getEffectContent: (path) => ipcRenderer.invoke('getEffectContent', path),
});