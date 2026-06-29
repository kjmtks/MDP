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
  await new Promise((resolve) => {
    const handler = (e, id) => {
      if (id === data.id) { ipcMain.removeListener('capture-ready', handler); resolve(); }
    };
    ipcMain.on('capture-ready', handler);
  });
  const img = await win.webContents.capturePage();
  return img.toDataURL();
});

app.on('before-quit', () => {
  remoteServer.stopRemoteServer();
  mdplink.closeAll();
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
  const full = path.join(currentBaseDir, relPath || '');
  const err = await shell.openPath(full); // '' on success, else an error message
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

ipcMain.handle('getTemplates', async () => {
  let templates = [];
  if (currentBaseDir) {
    const customDir = path.join(currentBaseDir, '.mdp', 'templates');
    if (fsSync.existsSync(customDir)) {
      try {
        const files = await fs.readdir(customDir);
        const customTemplates = files.filter(f => f.endsWith('.md')).map(f => ({
          name: f,
          path: path.join(customDir, f),
          isCustom: true
        }));
        templates.push(...customTemplates);
      } catch (e) {
        console.error('Error reading custom templates:', e);
      }
    }
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
    if (templatePath && fsSync.existsSync(templatePath)) {
      return await fs.readFile(templatePath, 'utf-8');
    }
  } catch (e) {
    console.error('Error reading template content:', e);
  }
  return "# New Slide\n\n---\n\nContent...";
});

ipcMain.handle('getSnipets', async () => {
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
    const customDir = path.join(currentBaseDir, '.mdp', 'snippets');
    if (fsSync.existsSync(customDir)) {
      try {
        const files = await fs.readdir(customDir);
        const jsonFiles = files.filter(f => f.toLowerCase().endsWith('.json'));
        for (const file of jsonFiles) {
          try {
            const filePath = path.join(customDir, file);
            const data = await fs.readFile(filePath, 'utf-8');
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
      } catch (dirErr) {
        console.error('Error reading .snippets directory:', dirErr.message);
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
      if (entry.name.startsWith('.') && entry.name !== '.mdp' && entry.name !== '.mdpignore') {
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
        node.children = await buildFileTree(path.join(dir, entry.name), nodePath);
        // A `.mdpignore` file excludes this directory (and its subtree) from the
        // workspace slide search; it stays browsable / referenceable. (`.mdpignore`
        // is a dotfile, skipped above, so check the filesystem directly.)
        if (fsSync.existsSync(path.join(dir, entry.name, '.mdpignore'))) node.slideIgnored = true;
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

ipcMain.handle('getThemes', async () => {
  let themes = [];

  if (currentBaseDir) {
    const customDir = path.join(currentBaseDir, '.mdp', 'themes');
    if (fsSync.existsSync(customDir)) {
      try {
        const files = await fs.readdir(customDir);
        themes = files.filter(f => f.endsWith('.css')).map(f => ({
          name: f.replace('.css', ''),
          fileName: f,
          path: `.mdp/themes/${f}`,
          isCustom: true
        }));
      } catch (e) { console.error('Error reading custom themes:', e); }
    }
  }

  const defaultDir = getAssetPath('themes');
  if (fsSync.existsSync(defaultDir)) {
    try {
      const files = await fs.readdir(defaultDir);
      const defaultThemes = files.filter(f => f.endsWith('.css')).map(f => ({
        name: f.replace('.css', ''),
        fileName: f,
        path: `themes/${f}`,
        isCustom: false
      }));
      themes = [...themes, ...defaultThemes];
    } catch (e) { console.error('Error reading default themes:', e); }
  }
  return themes;
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
