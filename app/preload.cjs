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
  // Lock THIS window's content aspect ratio (output window); no-op elsewhere.
  setWindowAspectRatio: (ratio) => ipcRenderer.send('window-set-aspect-ratio', ratio),
  // TTS-server request relayed through the main process (such servers send no CORS headers).
  ttsHttp: (req) => ipcRenderer.invoke('ttsHttp', req),
  ttsHttpAbort: (id) => ipcRenderer.invoke('ttsHttpAbort', id),
  // Its optional SSH jump host: what is stored (never the secrets), store/clear a
  // password or key passphrase, pin / forget the bastion's host key.
  ttsSshInfo: (req) => ipcRenderer.invoke('ttsSshInfo', req),
  ttsSshSecret: (req) => ipcRenderer.invoke('ttsSshSecret', req),
  ttsSshTrust: (req) => ipcRenderer.invoke('ttsSshTrust', req),
  ttsSshForget: (req) => ipcRenderer.invoke('ttsSshForget', req),
  // Streamed binary writes (the video export): open a workspace file, write
  // chunks at positions, then commit (rename into place) or discard.
  streamFileOpen: (relPath) => ipcRenderer.invoke('streamFileOpen', relPath),
  streamFileWrite: (req) => ipcRenderer.invoke('streamFileWrite', req),
  streamFileClose: (req) => ipcRenderer.invoke('streamFileClose', req),
  // Recording a live presentation: the tab-capture source of the window the
  // audience sees (the output window if open, else this window).
  getSlideWindowSource: () => ipcRenderer.invoke('getSlideWindowSource'),
  // The "exact" video export: a hidden window running the narrated auto-play of a
  // deck (`#/show-export?job=…`), recorded as a tab by the page that opened it.
  openShowExport: (req) => ipcRenderer.invoke('openShowExport', req),
  showExportSource: (jobId) => ipcRenderer.invoke('showExportSource', jobId),
  closeShowExport: (jobId) => ipcRenderer.invoke('closeShowExport', jobId),
  saveBinaryDialog: (args) => ipcRenderer.invoke('saveBinaryDialog', args),
  getLinkConfig: (relPath) => ipcRenderer.invoke('getLinkConfig', relPath),
  setLinkConfig: (args) => ipcRenderer.invoke('setLinkConfig', args),
  getAppSettings: () => ipcRenderer.invoke('getAppSettings'),
  setAppSettings: (obj) => ipcRenderer.invoke('setAppSettings', obj),
  setMcpEnabled: (enabled) => ipcRenderer.invoke('setMcpEnabled', enabled),
  getMcpInfo: () => ipcRenderer.invoke('getMcpInfo'),
  mcpGetHostConfig: (host, overridePath) => ipcRenderer.invoke('mcpGetHostConfig', host, overridePath),
  mcpRegisterHost: (host, overridePath) => ipcRenderer.invoke('mcpRegisterHost', host, overridePath),
  mcpPickHostConfig: (host) => ipcRenderer.invoke('mcpPickHostConfig', host),
  onMcpRequest: (cb) => {
    const handler = (e, d) => cb(d);
    ipcRenderer.on('mcp-request', handler);
    return () => ipcRenderer.removeListener('mcp-request', handler);
  },
  mcpRespond: (payload) => ipcRenderer.send('mcp-response', payload),
  getSshBypassJump: () => ipcRenderer.invoke('getSshBypassJump'),
  setSshBypassJump: (value) => ipcRenderer.invoke('setSshBypassJump', value),
  getCacheInfo: () => ipcRenderer.invoke('getCacheInfo'),
  setCacheConfig: (cfg) => ipcRenderer.invoke('setCacheConfig', cfg),
  clearCache: () => ipcRenderer.invoke('clearCache'),
  prefetchDeck: (relPath) => ipcRenderer.invoke('prefetchDeck', relPath),
  pickFile: (options) => ipcRenderer.invoke('pickFile', options),
  writeBinaryToPath: (args) => ipcRenderer.invoke('writeBinaryToPath', args),
  getSnipets: (dirs) => ipcRenderer.invoke('getSnipets', dirs),
  getTemplates: (dirs) => ipcRenderer.invoke('getTemplates', dirs),
  getTemplateContent: (path) => ipcRenderer.invoke('getTemplateContent', path),
  getThemes: (dirs) => ipcRenderer.invoke('getThemes', dirs),
  getFonts: (dirs) => ipcRenderer.invoke('getFonts', dirs),
  getFontRequirements: (dirs) => ipcRenderer.invoke('getFontRequirements', dirs),
  getSkills: (dirs) => ipcRenderer.invoke('getSkills', dirs),
  installFont: (args) => ipcRenderer.invoke('installFont', args),
  inspectFont: (base64) => ipcRenderer.invoke('inspectFont', base64),
  statFiles: (paths) => ipcRenderer.invoke('statFiles', paths),
  getAppVersion: () => ipcRenderer.invoke('getAppVersion'),
  setModified: (modified) => ipcRenderer.send('set-modified', modified),
  onAppCloseRequest: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('app-close-request', handler);
    return () => ipcRenderer.removeListener('app-close-request', handler);
  },
  confirmAppClose: () => ipcRenderer.send('app-close-confirmed'),
  // Multi-monitor slideshow: list displays, park the window on one, undo it.
  getDisplays: () => ipcRenderer.invoke('getDisplays'),
  moveToDisplay: (displayId) => ipcRenderer.invoke('moveToDisplay', displayId),
  restoreWindowPlacement: () => ipcRenderer.invoke('restoreWindowPlacement'),
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