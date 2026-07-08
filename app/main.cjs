const { app, BrowserWindow, ipcMain, Menu, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const isMac = process.platform === 'darwin';
const { pathToFileURL } = require('url');
const mdplink = require('./mdplink.cjs');
// Resolve a workspace-relative path through any `.mdplink` it crosses.
const vresolve = (rel) => mdplink.resolve(currentBaseDir, rel || '');
// Resolve to the FILE itself when the path is a `.mdplink` (so delete/rename act on
// the link file, not its target); otherwise resolve normally through the link.
const vresolveSelf = (rel) =>
  /\.mdplink$/i.test(rel || '') ? mdplink.resolveLinkFile(currentBaseDir, rel) : vresolve(rel);

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';

let isModified = false;
let forceClose = false;

if (process.platform === 'win32') {
  app.setAppUserModelId('jp.ac.kagawa-u.eng.kj.mdp');
}
if (isMac && !app.isPackaged) {
  app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mdp-file',
    privileges: { secure: true, standard: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true }
  },
  {
    scheme: 'app-asset',
    privileges: {
      secure: true, standard: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true, allowServiceWorkers: true
    }
  }
]);

let currentBaseDir = null;

let mainWindow;

function createWindow() {
mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: isMac ? true : false,
    titleBarStyle: 'hidden',
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.on('close', (e) => {
    if (isModified && !forceClose) {
      e.preventDefault();
      mainWindow.webContents.send('app-close-request');
    }
  });

  // When the main window is gone, quit the whole app. Otherwise the hidden
  // offscreen capture window (used for remote rasterization) keeps the process
  // alive headless — the app "disappears" but must be killed via Task Manager.
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (captureWin && !captureWin.isDestroyed()) { try { captureWin.destroy(); } catch (e) { /* ignore */ } }
    if (process.platform !== 'darwin') app.quit();
  });

  // If the renderer crashes/hangs, don't leave a zombie hidden process behind.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer gone:', details && details.reason);
    if (details && details.reason !== 'clean-exit' && process.platform !== 'darwin') {
      if (captureWin && !captureWin.isDestroyed()) { try { captureWin.destroy(); } catch (e) { /* ignore */ } }
      app.quit();
    }
  });

  mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(async () => {
  const { session } = require('electron');
  await session.defaultSession.clearCache();

  // Machine-local SSH state (jump-host bypass toggle, cache config) + offline cache
  // dir — kept out of the workspace.
  mdplink.initLocalState(path.join(app.getPath('userData'), 'mdp-local.json'), path.join(app.getPath('userData'), 'mdp-cache'));

  protocol.handle('mdp-file', async (request) => {
    try {
      const urlStr = request.url.replace(/^mdp-file:\/\//, '');
      const cleanPath = decodeURIComponent(urlStr.split('?')[0]);

      // Route through the VFS so files behind a `.mdplink` (local or remote) serve too.
      const data = await mdplink.vfsReadBuffer(vresolve(cleanPath));

      let mimeType = 'application/octet-stream';
      const ext = path.extname(cleanPath).toLowerCase();

      if (ext === '.svg' || cleanPath.endsWith('.drawio.svg')) mimeType = 'image/svg+xml';
      else if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.css') mimeType = 'text/css';
      else if (ext === '.js') mimeType = 'text/javascript';
      else if (ext === '.json') mimeType = 'application/json';
      else if (ext === '.md' || ext === '.txt') mimeType = 'text/plain';

      return new Response(data, {
        headers: {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
        }
      });
    } catch (e) {
      return new Response('File not found', { status: 404 });
    }
  });

  protocol.handle('app-asset', async (request) => {
    try {
      const urlStr = request.url.replace(/^app-asset:\/\//, '');
      const cleanPath = decodeURIComponent(urlStr.split('?')[0]);
      const baseDir = path.join(app.getAppPath(), 'dist');
      const absolutePath = path.join(baseDir, cleanPath);

      const data = await fs.readFile(absolutePath);

      let mimeType = 'application/octet-stream';
      const ext = path.extname(absolutePath).toLowerCase();
      if (ext === '.html') mimeType = 'text/html';
      else if (ext === '.js') mimeType = 'text/javascript';
      else if (ext === '.css') mimeType = 'text/css';
      else if (ext === '.svg') mimeType = 'image/svg+xml';
      else if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.woff') mimeType = 'font/woff';
      else if (ext === '.woff2') mimeType = 'font/woff2';
      else if (ext === '.json') mimeType = 'application/json';
      return new Response(data, {
        headers: {
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*'
        }
      });
    } catch (e) {
      return new Response('File not found', { status: 404 });
    }
  });

  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.on('app-close-confirmed', () => {
  forceClose = true;
  isModified = false;
  mainWindow?.close();
});

const remoteServer = require('./remoteServer.cjs');

ipcMain.handle('startRemoteServer', async () => {
  try {
    return await remoteServer.startRemoteServer({ distPath: path.join(app.getAppPath(), 'dist') });
  } catch (e) {
    console.error('Failed to start remote server:', e);
    return null;
  }
});

ipcMain.handle('getRemoteInfo', () => remoteServer.getRemoteInfo());

ipcMain.handle('getAppVersion', () => app.getVersion());

ipcMain.on('stopRemoteServer', () => remoteServer.stopRemoteServer());

let captureWin = null;
async function ensureCaptureWin() {
  if (captureWin && !captureWin.isDestroyed()) return captureWin;
  captureWin = new BrowserWindow({
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  await captureWin.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { hash: '/capture' });
  return captureWin;
}

ipcMain.handle('captureSlide', async (event, data) => {
  const win = await ensureCaptureWin();
  win.setContentSize(Math.round(data.width), Math.round(data.height));
  win.webContents.send('capture-render', data);
  // Bounded wait: if the offscreen renderer errors/reloads and never reports
  // ready, resolve anyway — an un-timed listener would leak (one per capture)
  // and hang the invoking IPC forever.
  await new Promise((resolve) => {
    const timer = setTimeout(() => { ipcMain.removeListener('capture-ready', handler); resolve(); }, 20000);
    const handler = (e, id) => {
      if (id === data.id) { clearTimeout(timer); ipcMain.removeListener('capture-ready', handler); resolve(); }
    };
    ipcMain.on('capture-ready', handler);
  });
  const img = await win.webContents.capturePage();
  return img.toDataURL();
});

app.on('before-quit', () => {
  remoteServer.stopRemoteServer();
  mdplink.closeAll();
  try { require('./mcp-bridge.cjs').stop(); } catch { /* ignore */ }
  if (captureWin && !captureWin.isDestroyed()) captureWin.destroy();
});

ipcMain.handle('setBaseDir', async (event, dirPath) => {
  if (dirPath && fsSync.existsSync(dirPath)) {
    currentBaseDir = dirPath;
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    currentBaseDir = result.filePaths[0];
    return { path: currentBaseDir, tree: await buildFileTree(currentBaseDir) };
  }
  return null;
});

// Reveal a workspace folder in the OS file manager (Explorer / Finder / …).
// `relPath` is relative to the workspace root (empty string = the root itself).
ipcMain.handle('openInFileManager', async (event, relPath) => {
  if (!currentBaseDir) return { success: false };
  // Resolve through the VFS so a `.mdplink` local link (or a folder inside one)
  // reveals its real local target. A remote (SSH) target has no local path → refuse.
  const target = vresolve(relPath || '');
  if (target.kind !== 'local') return { success: false, remote: true };
  const err = await shell.openPath(target.abs); // '' on success, else an error message
  return { success: !err, error: err || undefined };
});

ipcMain.handle('saveFile', async (event, { filename, content, isBase64 }) => {
  if (!currentBaseDir) return { success: false };
  await mdplink.vfsWrite(vresolve(filename), Buffer.from(content, isBase64 ? 'base64' : 'utf-8'));
  return { success: true };
});

ipcMain.handle('createFile', async (event, { path: itemPath, type }) => {
  if (!currentBaseDir) return { success: false };
  if (type === 'directory') await mdplink.vfsMkdirp(vresolve(itemPath));
  else await mdplink.vfsWrite(vresolve(itemPath), Buffer.from('', 'utf-8'));
  return { success: true };
});

ipcMain.handle('readFileText', async (event, filePath) => {
  if (!currentBaseDir) return "";
  return await mdplink.vfsReadText(vresolve(filePath));
});

// Read/write a `.mdplink` file's RAW JSON (bypasses link traversal so the config
// itself is read, not the directory it points to).
ipcMain.handle('getLinkConfig', async (event, relPath) => {
  if (!currentBaseDir) return "";
  return await mdplink.vfsReadText(mdplink.resolveLinkFile(currentBaseDir, relPath));
});
ipcMain.handle('setLinkConfig', async (event, { path: relPath, content }) => {
  if (!currentBaseDir) return { success: false };
  await mdplink.vfsWrite(mdplink.resolveLinkFile(currentBaseDir, relPath), Buffer.from(content, 'utf-8'));
  return { success: true };
});

// Machine-local "bypass jump host" toggle for SSH links.
ipcMain.handle('getSshBypassJump', async () => mdplink.getBypassJump());
ipcMain.handle('setSshBypassJump', async (event, value) => { mdplink.setBypassJump(value); return { success: true }; });

// ---- MCP integration (Claude Desktop etc.) ----------------------------------
// A local control bridge the stdio MCP proxy (app/mcp-server.cjs) forwards tool
// calls to. Opt-in via Settings → MCP (the renderer mirrors the setting here).
const mcpBridge = require('./mcp-bridge.cjs');
mcpBridge.init({
  getBaseDir: () => currentBaseDir,
  getWindow: () => mainWindow,
  getAssetPath: (sub) => getAssetPath(sub),
  // Machine-local talk-time reading speed (chars/min) for get_deck_outline.
  getReadingCpm: () => {
    try { const s = JSON.parse(fsSync.readFileSync(path.join(app.getPath('userData'), 'mdp-app-settings.json'), 'utf8')); return (s && s.readingCharsPerMin) || 320; }
    catch { return 320; }
  },
});
ipcMain.handle('setMcpEnabled', async (event, enabled) => (enabled ? await mcpBridge.start() : mcpBridge.stop()));
ipcMain.handle('getMcpInfo', async () => {
  // Path of the stdio server for the Claude Desktop config snippet. In a packaged
  // app the file is shipped asar-UNPACKED so plain Node can execute it.
  const serverPath = app.isPackaged
    ? path.join(__dirname, 'mcp-server.cjs').replace('app.asar', 'app.asar.unpacked')
    : path.join(__dirname, 'mcp-server.cjs');
  return { running: mcpBridge.isRunning(), port: mcpBridge.getPort(), serverPath, exePath: process.execPath, isPackaged: app.isPackaged };
});
ipcMain.on('mcp-response', (event, payload) => mcpBridge.handleRendererResponse(payload));

// The stdio-server launch spec written into a host's config (dev: plain node;
// packaged: MDP.exe run as node against the asar-unpacked file). `withType` adds
// the explicit `"type": "stdio"` that Claude Code's `~/.claude.json` expects.
function mdpServerSpec(withType) {
  const serverPath = app.isPackaged
    ? path.join(__dirname, 'mcp-server.cjs').replace('app.asar', 'app.asar.unpacked')
    : path.join(__dirname, 'mcp-server.cjs');
  const base = app.isPackaged
    ? { command: process.execPath, args: [serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { command: 'node', args: [serverPath] };
  return withType ? { type: 'stdio', ...base } : base;
}

// Well-known GLOBAL JSON config files we can read + register into. `appData` is
// Roaming (win) / Application Support (mac) / ~/.config (linux) — the Claude
// Desktop parent on every platform. Claude Code's USER scope lives at top-level
// `mcpServers` in ~/.claude.json (which also holds history/auth — handled with
// care below). VS Code stays copy-only (config is per-project).
function hostConfigPath(host) {
  if (host === 'claude-desktop') return path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json');
  if (host === 'cursor') return path.join(app.getPath('home'), '.cursor', 'mcp.json');
  if (host === 'claude-code') return path.join(app.getPath('home'), '.claude.json');
  return null;
}
// The config file to actually read/write for a host: an explicit user-picked path
// wins over the platform-default guess (the guess is often wrong for non-standard
// installs). `override` must be a non-empty string; anything else falls back.
function resolveHostConfigPath(host, override) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  return hostConfigPath(host);
}
// Claude Code's file is huge and sensitive → show ONLY its mcpServers section, and
// register with the explicit stdio `type`.
const isBigHostFile = (host) => host === 'claude-code';

// Read a host config for display: path, existence, the shown text (the whole small
// file, or just mcpServers for the big Claude Code file), whether `mdp` is already
// registered, and whether the file is unparseable.
ipcMain.handle('mcpGetHostConfig', async (event, host, overridePath) => {
  const p = resolveHostConfigPath(host, overridePath);
  if (!p) return { supported: false };
  try {
    const raw = fsSync.readFileSync(p, 'utf8');
    let parsed = null, invalid = false, hasEntry = false;
    try { parsed = JSON.parse(raw); hasEntry = !!(parsed && parsed.mcpServers && parsed.mcpServers.mdp); }
    catch { invalid = true; }
    const text = invalid
      ? (isBigHostFile(host) ? '(the file is not valid JSON)' : raw)
      : isBigHostFile(host)
        ? JSON.stringify({ mcpServers: (parsed && parsed.mcpServers) || {} }, null, 2)
        : raw;
    return { supported: true, path: p, exists: true, text, hasEntry, invalid, subset: isBigHostFile(host) };
  } catch {
    return { supported: true, path: p, exists: false, text: '', hasEntry: false, invalid: false, subset: isBigHostFile(host) };
  }
});

// Let the user PICK the host config JSON themselves, so MDP never has to guess a
// path. Defaults the dialog to the platform-default location. Returns the chosen
// absolute path (or { canceled: true }).
ipcMain.handle('mcpPickHostConfig', async (event, host) => {
  const guess = hostConfigPath(host);
  const opts = {
    title: 'Choose the MCP host config file',
    properties: ['openFile', 'createDirectory', 'promptToCreate', 'showHiddenFiles'],
    filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }],
  };
  if (guess) opts.defaultPath = guess;
  try {
    const res = await dialog.showOpenDialog(mainWindow, opts);
    if (res.canceled || !res.filePaths || !res.filePaths.length) return { canceled: true };
    return { canceled: false, path: res.filePaths[0] };
  } catch (e) {
    return { canceled: true, error: e.message };
  }
});

// Register (overwrite) the `mdp` entry in a host config, PRESERVING every other key
// and server. Refuses to touch a file that exists but isn't valid JSON. Stashes a
// one-file backup first (important for the big Claude Code config).
ipcMain.handle('mcpRegisterHost', async (event, host, overridePath) => {
  const p = resolveHostConfigPath(host, overridePath);
  if (!p) return { success: false, error: 'This host is set up by copying the snippet.' };
  let config = {};
  let existed = false;
  try {
    const text = fsSync.readFileSync(p, 'utf8');
    existed = true;
    try { config = JSON.parse(text); }
    catch { return { success: false, error: 'The existing config file is not valid JSON — fix it manually first (its contents are shown above).' }; }
    if (!config || typeof config !== 'object' || Array.isArray(config)) return { success: false, error: 'The existing config is not a JSON object.' };
  } catch { config = {}; /* file absent → create it */ }
  config.mcpServers = (config.mcpServers && typeof config.mcpServers === 'object') ? config.mcpServers : {};
  config.mcpServers.mdp = mdpServerSpec(isBigHostFile(host));
  try {
    fsSync.mkdirSync(path.dirname(p), { recursive: true });
    if (existed) { try { fsSync.copyFileSync(p, `${p}.mdp-backup`); } catch { /* best-effort backup */ } }
    fsSync.writeFileSync(p, JSON.stringify(config, null, 2));
    return { success: true, path: p, backup: existed ? `${p}.mdp-backup` : undefined };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Machine-local app settings (theme / font / shortcuts / author) — userData file,
// so they persist per install independent of the (possibly read-only) workspace.
const appSettingsFile = () => path.join(app.getPath('userData'), 'mdp-app-settings.json');
ipcMain.handle('getAppSettings', async () => {
  try { return JSON.parse(fsSync.readFileSync(appSettingsFile(), 'utf-8')); } catch { return null; }
});
ipcMain.handle('setAppSettings', async (event, obj) => {
  try { fsSync.writeFileSync(appSettingsFile(), JSON.stringify(obj, null, 2)); } catch { /* ignore */ }
  return { success: true };
});

// Offline cache for remote (`.mdplink` SSH) files.
ipcMain.handle('getCacheInfo', async () => mdplink.getCacheInfo());
ipcMain.handle('setCacheConfig', async (event, cfg) => { mdplink.setCacheConfig(cfg || {}); return mdplink.getCacheInfo(); });
ipcMain.handle('clearCache', async () => { mdplink.clearCache(); return mdplink.getCacheInfo(); });
ipcMain.handle('prefetchDeck', async (event, relPath) => {
  if (!currentBaseDir) return { ok: 0, fail: 0, total: 0 };
  return await mdplink.prefetchDeck(currentBaseDir, relPath);
});

// Native picker. `options.directory` selects a FOLDER (e.g. a local link target);
// otherwise a FILE (e.g. an SSH key). Returns the chosen path or null.
ipcMain.handle('pickFile', async (event, options) => {
  const directory = !!(options && options.directory);
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: [directory ? 'openDirectory' : 'openFile', 'showHiddenFiles'],
    title: (options && options.title) || (directory ? 'Select a folder' : 'Select a file'),
    filters: (options && options.filters) || [],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('getFileAsDataUrl', async (event, filePath) => {
  if (!currentBaseDir) return "";
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
  const base64 = (await mdplink.vfsReadBuffer(vresolve(filePath))).toString('base64');
  return `data:${mimeType};base64,${base64}`;
});

ipcMain.handle('deleteFiles', async (event, { paths }) => {
  if (!currentBaseDir) return { success: false };
  for (const p of paths) await mdplink.vfsRemove(vresolveSelf(p));
  return { success: true };
});

ipcMain.handle('renameFile', async (event, { oldPath, newPath }) => {
  if (!currentBaseDir) return { success: false };
  await mdplink.vfsRename(vresolve(oldPath), vresolve(newPath));
  return { success: true };
});

ipcMain.handle('moveFile', async (event, { sourcePaths, targetPath }) => {
  if (!currentBaseDir) return { success: false };
  for (const p of sourcePaths) {
    const fileName = path.basename(p);
    await mdplink.vfsRename(vresolve(p), vresolve(`${targetPath}/${fileName}`));
  }
  return { success: true };
});

// Pick a name that doesn't collide in `targetDir`, inserting " copy" (then
// " copy 2", …) before the extension. The extension is taken from the FIRST dot
// so compound types (`.slide.md`, `.mdpmod.xml`) stay intact.
const uniqueCopyName = (targetDir, baseName) => {
  const dot = baseName.indexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  let candidate = baseName;
  let i = 0;
  while (fsSync.existsSync(path.join(targetDir, candidate))) {
    i += 1;
    candidate = i === 1 ? `${stem} copy${ext}` : `${stem} copy ${i}${ext}`;
  }
  return candidate;
};

// Like uniqueCopyName but VFS-aware (works inside a local/remote `.mdplink` target).
const uniqueCopyNameVfs = async (targetDir, baseName) => {
  const dot = baseName.indexOf('.');
  const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
  const ext = dot > 0 ? baseName.slice(dot) : '';
  let candidate = baseName;
  let i = 0;
  while (await mdplink.vfsExists(mdplink.childOf(targetDir, candidate))) {
    i += 1;
    candidate = i === 1 ? `${stem} copy${ext}` : `${stem} copy ${i}${ext}`;
  }
  return candidate;
};

ipcMain.handle('copyFiles', async (event, { sourcePaths, targetPath }) => {
  if (!currentBaseDir) return { success: false };
  const targetDir = vresolve(targetPath || '');
  await mdplink.vfsMkdirp(targetDir);
  const created = [];
  for (const p of sourcePaths) {
    const destName = await uniqueCopyNameVfs(targetDir, path.basename(p));
    await mdplink.vfsCopy(vresolve(p), mdplink.childOf(targetDir, destName));
    created.push((targetPath ? `${targetPath}/${destName}` : destName).replace(/^\//, ''));
  }
  return { success: true, paths: created };
});

const getAssetPath = (filename) => {
  return isDev
    ? path.join(process.cwd(), 'public', filename)
    : path.join(app.getAppPath(), 'dist', filename);
};

// `dirs` = the target folder's `.mdp` chain (root→nearest); custom templates merge
// across it with the NEAREST winning by file name. Omitted → root `.mdp` (legacy).
ipcMain.handle('getTemplates', async (event, dirs) => {
  let templates = [];
  if (currentBaseDir) {
    const chain = Array.isArray(dirs) && dirs.length ? dirs : ['.mdp'];
    const byName = new Map();
    for (const cdir of chain) {
      try {
        for (const e of await mdplink.vfsList(vresolve(`${cdir}/templates`))) {
          if (!e.isDir && e.name.endsWith('.md')) byName.set(e.name, { name: e.name, path: `${cdir}/templates/${e.name}`, isCustom: true });
        }
      } catch (e) { /* templates dir absent in this `.mdp` */ }
    }
    templates.push(...byName.values());
  }
  const defaultDir = getAssetPath('templates');
  if (fsSync.existsSync(defaultDir)) {
    try {
      const files = await fs.readdir(defaultDir);
      const defaultTemplates = files.filter(f => f.endsWith('.md')).map(f => ({
        name: f,
        path: path.join(defaultDir, f),
        isCustom: false
      }));
      defaultTemplates.forEach(dt => {
        if (!templates.find(t => t.name === dt.name)) {
          templates.push(dt);
        }
      });
    } catch (e) {
      console.error('Error reading default templates:', e);
    }
  }
  if (templates.length === 0) {
    templates.push({ name: 'Default.slide.md', path: 'default', isCustom: false });
  }

  return templates;
});

ipcMain.handle('getTemplateContent', async (event, templatePath) => {
  try {
    // Built-in templates carry an ABSOLUTE asset path; workspace templates are
    // workspace-relative (may live in a nested `.mdp`, incl. behind a `.mdplink`).
    // The absolute check must be explicit — existsSync on a relative path would
    // resolve against the process CWD and could hit an unrelated file.
    if (templatePath && path.isAbsolute(templatePath) && fsSync.existsSync(templatePath)) {
      return await fs.readFile(templatePath, 'utf-8');
    }
    if (templatePath && currentBaseDir) {
      return await mdplink.vfsReadText(vresolve(templatePath));
    }
  } catch (e) {
    console.error('Error reading template content:', e);
  }
  return "# New Slide\n\n---\n\nContent...";
});

// `dirs` = the active deck's `.mdp` chain (root→nearest). Omitted → root `.mdp`.
ipcMain.handle('getSnipets', async (event, dirs) => {
  let snippets = [];
  const safeParseJSON = (str) => {
    return JSON.parse(str.replace(/^\uFEFF/, ''));
  };
  try {
    const defaultPath = getAssetPath('default-snippets.json');
    const data = await fs.readFile(defaultPath, 'utf-8');
    snippets = safeParseJSON(data);
  } catch (e) {
    console.error('Default snippets load failed:', e.message);
    snippets = [
      { category: "Markdown Basics", items: [ { label: "Bold", text: "**text**", description: "Make text bold" } ] },
      { category: "Slide Commands", items: [ { label: "New Slide", text: "\n---\n", description: "Create a new slide" } ] }
    ];
  }
  if (currentBaseDir) {
    // Custom snippet FILES cascade like other `.mdp` assets: merged across the
    // active deck's chain (root→nearest), the nearest `.mdp` winning by file name.
    const chain = Array.isArray(dirs) && dirs.length ? dirs : ['.mdp'];
    const byName = new Map();
    for (const cdir of chain) {
      try {
        for (const e of await mdplink.vfsList(vresolve(`${cdir}/snippets`))) {
          if (!e.isDir && e.name.toLowerCase().endsWith('.json')) byName.set(e.name, `${cdir}/snippets/${e.name}`);
        }
      } catch (dirErr) { /* snippets dir absent in this `.mdp` */ }
    }
    for (const [file, rel] of byName) {
      try {
        const data = await mdplink.vfsReadText(vresolve(rel));
        const customSnippets = safeParseJSON(data);
        if (!Array.isArray(customSnippets)) {
          console.error(`Skipped ${file}: the entire JSON must be wrapped in [ ].`);
          continue;
        }
        customSnippets.forEach(category => {
          if (category.items && Array.isArray(category.items)) {
            category.items.forEach(item => item.isCustom = true);
            const existingCat = snippets.find(c => c.category === category.category);
            if (existingCat) {
              existingCat.items.push(...category.items);
            } else {
              snippets.push(category);
            }
          }
        });
      } catch (fileErr) {
        console.error(`Error parsing custom snippet (${file}):`, fileErr.message);
      }
    }
  }
  return snippets;
});

async function buildFileTree(dir, basePath = '') {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const nodes = [];
    for (const entry of entries) {
      // App-managed folders live under a single `.mdp/` directory; keep it (its
      // non-dot subfolders pass naturally). Also keep `.mdpignore` so the
      // search-exclusion marker is visible/manageable in the tree (matches the web
      // backend, which does not filter dotfiles). Skip all other dotfiles.
      if (entry.name.startsWith('.') && entry.name !== '.mdp' && entry.name !== '.mdpignore' && entry.name !== '.git') {
        continue;
      }
      const nodePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      const isDir = entry.isDirectory();
      const node = {
        name: entry.name,
        path: nodePath,
        type: isDir ? 'directory' : 'file',
        isBinary: !isDir && /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(entry.name)
      };
      if (isDir) {
        // SEALED: a `.git` or `.mdpignore` directory is shown but NEVER walked — its
        // subtree is kept out of the tree entirely (excluded from browsing, search
        // and `.mdp` resolution).
        if (entry.name === '.git' || fsSync.existsSync(path.join(dir, entry.name, '.mdpignore'))) {
          node.children = [];
          node.slideIgnored = true;
          node.sealed = true;
        } else {
          node.children = await buildFileTree(path.join(dir, entry.name), nodePath);
        }
      }
      nodes.push(node);
    }
    return nodes.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
    });

  } catch (e) {
    console.error("Failed to build file tree:", e);
    return [];
  }
}

ipcMain.handle('getFileTree', async () => {
  if (!currentBaseDir) return [];
  // Link-aware tree (resolves `.mdplink` to local/remote contents).
  return (await mdplink.buildTree(currentBaseDir)).nodes;
});

// Lazily load the children of a deferred node (an SSH link or a remote subdir).
ipcMain.handle('getSubTree', async (event, relPath) => {
  if (!currentBaseDir) return { nodes: [] };
  return await mdplink.buildSubTree(currentBaseDir, relPath || '');
});

ipcMain.on('export-pdf', async (event, filename) => {
  const { BrowserWindow, dialog } = require('electron');
  const fs = require('fs');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  const defaultFileName = filename ? `${filename}.pdf` : 'presentation.pdf';
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export as PDF',
      defaultPath: defaultFileName,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });
    if (canceled || !filePath) return;
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true
    });
    await fs.promises.writeFile(filePath, pdfData);
  } catch (error) {
    // Never let a dialog/print failure bubble up and wedge the main process.
    console.error('PDF Export Error:', error);
  }
});

// Save arbitrary BASE64 binary content via a native "Save As" dialog (used by the
// PowerPoint/PPTX export). Returns { saved, filePath } or { saved:false, canceled }.
ipcMain.handle('saveBinaryDialog', async (event, { suggestedName, content, filterName, ext }) => {
  const { BrowserWindow, dialog } = require('electron');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { saved: false };
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'Export',
      defaultPath: currentBaseDir ? path.join(currentBaseDir, suggestedName || 'export') : (suggestedName || 'export'),
      filters: [{ name: filterName || 'File', extensions: [ext || 'bin'] }],
    });
    if (canceled || !filePath) return { saved: false, canceled: true };
    await fs.writeFile(filePath, Buffer.from(content, 'base64'));
    return { saved: true, filePath };
  } catch (error) {
    console.error('saveBinaryDialog Error:', error);
    return { saved: false, error: String(error) };
  }
});

// `dirs` = the active deck's `.mdp` config-dir chain (root→nearest); custom themes
// are merged across it with the NEAREST `.mdp` winning by name. Omitted/empty →
// `['.mdp']` (workspace root only = legacy behavior). Bundled defaults are lowest.
ipcMain.handle('getThemes', async (event, dirs) => {
  const byName = new Map();
  const defaultDir = getAssetPath('themes');
  if (fsSync.existsSync(defaultDir)) {
    try {
      for (const f of await fs.readdir(defaultDir)) if (f.endsWith('.css'))
        byName.set(f.replace('.css', ''), { name: f.replace('.css', ''), fileName: f, path: `themes/${f}`, isCustom: false });
    } catch (e) { console.error('Error reading default themes:', e); }
  }
  if (currentBaseDir) {
    const chain = Array.isArray(dirs) && dirs.length ? dirs : ['.mdp'];
    for (const cdir of chain) {
      try {
        for (const e of await mdplink.vfsList(vresolve(`${cdir}/themes`))) if (!e.isDir && e.name.endsWith('.css'))
          byName.set(e.name.replace('.css', ''), { name: e.name.replace('.css', ''), fileName: e.name, path: `${cdir}/themes/${e.name}`, isCustom: true });
      } catch (e) { /* themes dir absent in this `.mdp` */ }
    }
  }
  return [...byName.values()];
});

ipcMain.handle('getModules', async () => {
  let modules = [];

  if (currentBaseDir) {
    const customDir = path.join(currentBaseDir, '.mdp', 'modules');
    if (fsSync.existsSync(customDir)) {
      try {
        const files = await fs.readdir(customDir);
        const customModules = files.filter(f => f.endsWith('.mdpmod.xml')).map(f => ({
          name: f.replace('.mdpmod.xml', ''),
          fileName: f,
          path: `.mdp/modules/${f}`,
          isCustom: true
        }));
        modules.push(...customModules);
      } catch (e) { console.error('Error reading custom modules:', e); }
    }
  }

  const defaultDir = getAssetPath('modules');
  if (fsSync.existsSync(defaultDir)) {
    try {
      const files = await fs.readdir(defaultDir);
      const defaultModules = files.filter(f => f.endsWith('.mdpmod.xml')).map(f => ({
        name: f.replace('.mdpmod.xml', ''),
        fileName: f,
        path: `modules/${f}`,
        isCustom: false
      }));
      defaultModules.forEach(dm => {
        if (!modules.find(m => m.fileName === dm.fileName)) {
          modules.push(dm);
        }
      });
    } catch (e) { console.error('Error reading default modules:', e); }
  }
  return modules;
});

ipcMain.handle('getModuleContent', async (event, modulePath) => {
  try {
    if (modulePath) {
       const absolutePath = modulePath.startsWith('.mdp/')
          ? path.join(currentBaseDir, modulePath)
          : getAssetPath(modulePath);

       if (fsSync.existsSync(absolutePath)) {
         return await fs.readFile(absolutePath, 'utf-8');
       }
    }
  } catch (e) {
    console.error('Error reading module content:', e);
  }
  return "";
});

ipcMain.handle('getEffects', async () => {
  let effects = [];

  if (currentBaseDir) {
    const customDir = path.join(currentBaseDir, '.mdp', 'effects');
    if (fsSync.existsSync(customDir)) {
      try {
        const files = await fs.readdir(customDir);
        files.filter(f => f.endsWith('.mdpfx.xml')).forEach(f => {
          effects.push({ name: f.replace('.mdpfx.xml', ''), fileName: f, path: `.mdp/effects/${f}`, isCustom: true });
        });
      } catch (e) { console.error('Error reading custom effects:', e); }
    }
  }

  const defaultDir = getAssetPath('effects');
  if (fsSync.existsSync(defaultDir)) {
    try {
      const files = await fs.readdir(defaultDir);
      const defaultEffects = files.filter(f => f.endsWith('.mdpfx.xml')).map(f => ({
        name: f.replace('.mdpfx.xml', ''),
        fileName: f,
        path: `effects/${f}`,
        isCustom: false
      }));
      defaultEffects.forEach(de => {
        if (!effects.find(e => e.fileName === de.fileName)) {
          effects.push(de);
        }
      });
    } catch (e) { console.error('Error reading default effects:', e); }
  }
  return effects;
});

ipcMain.handle('getEffectContent', async (event, effectPath) => {
  try {
    if (effectPath) {
       const absolutePath = effectPath.startsWith('.mdp/')
          ? path.join(currentBaseDir, effectPath)
          : getAssetPath(effectPath);

       if (fsSync.existsSync(absolutePath)) {
         return await fs.readFile(absolutePath, 'utf-8');
       }
    }
  } catch (e) {
    console.error('Error reading effect content:', e);
  }
  return "";
});

ipcMain.on('set-modified', (event, modified) => {
  isModified = modified;
});
