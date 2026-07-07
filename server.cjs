const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const mdplink = require('./app/mdplink.cjs');
// Machine-local SSH state (jump-host bypass toggle, cache config) + offline cache
// dir, kept next to the server.
mdplink.initLocalState(path.join(__dirname, '.mdp-local.json'), path.join(__dirname, '.mdp-cache'));
const os = require('os');

const dotenv = require('dotenv');
if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
} else {
  dotenv.config();
}

let config;
try {
  config = require('./config.cjs');
} catch (e) {
  console.warn("config.cjs not found, using default settings.");
  config = { rootDir: './files' };
}

const app = express();
const PORT = process.env.PORT || config.port || 3000;

// CORS: the app is served SAME-ORIGIN (LAN clients hit this server directly; the
// Vite dev server proxies /api and /files), so no cross-origin access is needed.
// Only loopback origins are acknowledged — any other cross-origin page gets no
// CORS headers, so its preflighted JSON writes to /api/* are blocked by the
// browser (drive-by CSRF from visited websites).
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / non-browser clients
    try {
      const h = new URL(origin).hostname;
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return cb(null, true);
    } catch { /* fall through */ }
    cb(null, false);
  },
}));
app.use(express.json({ limit: '50mb' }));

// A malformed request must never take the whole server down (async route handlers
// have no global Express catcher; Node's default is process exit).
process.on('unhandledRejection', (err) => console.error('[MDP] Unhandled rejection:', err));

let rootDir = path.resolve('.');
if (process.argv[2]) {
  rootDir = path.resolve(process.argv[2]);
} else if (process.env.ROOT_DIR) {
  rootDir = path.resolve(process.env.ROOT_DIR);
} else if (config.rootDir) {
  rootDir = path.resolve(config.rootDir);
} else {
  rootDir = path.resolve('./files');
}

if (!fs.existsSync(rootDir)) {
  console.log(`Creating directory: ${rootDir}`);
  fs.mkdirSync(rootDir, { recursive: true });
}

const getSafePath = (targetPath) => {
  const safePath = (targetPath || '').replace(/\.\./g, '');
  return path.join(rootDir, safePath);
};

const getFileTree = (dir, baseDir = dir) => {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
      
      if (stat && stat.isDirectory()) {
        const node = {
          name: file,
          path: relativePath,
          type: 'directory',
          children: getFileTree(filePath, baseDir)
        };
        // A `.mdpignore` file marks a directory (and its subtree) to be excluded
        // from the workspace slide search — it stays browsable / referenceable.
        if (fs.existsSync(path.join(filePath, '.mdpignore'))) node.slideIgnored = true;
        results.push(node);
      } else {
        const isImage = /\.(png|jpe?g|gif|svg|webp)$/i.test(file);
        results.push({
          name: file,
          path: relativePath,
          type: 'file',
          isBinary: isImage
        });
      }
    });
  } catch (e) {}
  return results.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'directory' ? -1 : 1;
  });
};

// --- API ---
app.use(express.static(path.join(__dirname, 'dist')));
app.use('/drawio', express.static(path.join(__dirname, 'drawio')));

app.get('/api/server-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  if (addresses.length === 0) addresses.push('localhost');
  res.json({ ips: addresses, port: PORT, hostname: os.hostname(), mode: 'local' });
});

// NOTE: the old Java-based `/plantuml/svg` route was removed — PlantUML now renders
// entirely in the browser via `@plantuml/core` (WASM), so no `java`/plantuml.jar and
// no server round-trip. See src/features/slide/parser/plantumlPlugin.ts.

// Resolve a workspace-relative path through any `.mdplink` (local or SSH) it crosses.
const vres = (rel) => mdplink.resolve(rootDir, rel || '');
// Resolve to the `.mdplink` FILE itself (not its target) so delete acts on the link.
const vresSelf = (rel) =>
  /\.mdplink$/i.test(rel || '') ? mdplink.resolveLinkFile(rootDir, rel) : vres(rel);

app.get('/api/files', async (req, res) => {
  try { res.json((await mdplink.buildTree(rootDir)).nodes); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Lazily load a deferred subtree (an SSH link or a remote subdir) on expand.
app.get('/api/subtree', async (req, res) => {
  try { res.json(await mdplink.buildSubTree(rootDir, req.query.path || '')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/save', async (req, res) => {
  // Body coercion INSIDE the try: a malformed body (e.g. isBase64 with a non-string
  // content) must return 400, not raise an unhandled rejection.
  try {
    let content = req.body.content;
    if (typeof content === 'string' && content.startsWith('data:image/')) {
      const base64Data = content.split(',')[1];
      content = base64Data ? Buffer.from(base64Data, 'base64') : Buffer.from('');
    } else if (req.body.isBase64) {
      content = Buffer.from(String(content ?? ''), 'base64');
    } else {
      content = Buffer.from(String(content ?? ''), 'utf-8');
    }
    await mdplink.vfsWrite(vres(req.body.filename), content);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/rename', async (req, res) => {
  const { oldPath, newPath } = req.body;
  try { await mdplink.vfsRename(vres(oldPath), vres(newPath)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/delete', async (req, res) => {
  try { for (const p of req.body.paths) await mdplink.vfsRemove(vresSelf(p)); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/move', async (req, res) => {
  const { sourcePaths, targetPath } = req.body;
  try {
    await mdplink.vfsMkdirp(vres(targetPath));
    for (const p of sourcePaths) await mdplink.vfsRename(vres(p), vres(`${targetPath}/${path.basename(p)}`));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// VFS-aware unique copy name (works inside a local/remote `.mdplink` target).
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

app.post('/api/copy', async (req, res) => {
  const { sourcePaths, targetPath } = req.body;
  try {
    const targetDir = vres(targetPath || '');
    await mdplink.vfsMkdirp(targetDir);
    const created = [];
    for (const p of sourcePaths) {
      const destName = await uniqueCopyNameVfs(targetDir, path.basename(p));
      await mdplink.vfsCopy(vres(p), mdplink.childOf(targetDir, destName));
      created.push((targetPath ? `${targetPath}/${destName}` : destName).replace(/^\//, ''));
    }
    res.json({ success: true, paths: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Read/write a `.mdplink` file's RAW JSON config (bypasses link traversal).
app.get('/api/linkConfig', async (req, res) => {
  try { res.type('text/plain').send(await mdplink.vfsReadText(mdplink.resolveLinkFile(rootDir, req.query.path || ''))); }
  catch (e) { res.status(500).send(e.message); }
});
app.post('/api/linkConfig', async (req, res) => {
  try { await mdplink.vfsWrite(mdplink.resolveLinkFile(rootDir, req.body.path || ''), Buffer.from(String(req.body.content ?? ''), 'utf-8')); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Machine-local "bypass jump host" toggle for SSH links.
app.get('/api/sshBypassJump', (req, res) => res.json({ bypassJump: mdplink.getBypassJump() }));
app.post('/api/sshBypassJump', (req, res) => { mdplink.setBypassJump(!!req.body.bypassJump); res.json({ success: true }); });

// Offline cache for remote (`.mdplink` SSH) files.
app.get('/api/cacheInfo', (req, res) => res.json(mdplink.getCacheInfo()));
app.post('/api/cacheConfig', (req, res) => { mdplink.setCacheConfig(req.body || {}); res.json(mdplink.getCacheInfo()); });
app.post('/api/clearCache', (req, res) => { mdplink.clearCache(); res.json(mdplink.getCacheInfo()); });
app.post('/api/prefetchDeck', async (req, res) => {
  try { res.json(await mdplink.prefetchDeck(rootDir, req.body.path || '')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/create', async (req, res) => {
  const { path: createPath, type } = req.body;
  try {
    if (type === 'directory') await mdplink.vfsMkdirp(vres(createPath));
    else await mdplink.vfsWrite(vres(createPath), Buffer.from('', 'utf-8'));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const MIME_BY_EXT = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', css: 'text/css', js: 'text/javascript', json: 'application/json', md: 'text/plain', txt: 'text/plain' };

app.get('/files/*path', async (req, res) => {
  let virtualPath = req.params.path || req.params[0];
  if (Array.isArray(virtualPath)) virtualPath = virtualPath.join('/');
  if (!virtualPath) return res.status(400).send('Path required');
  try { virtualPath = decodeURIComponent(virtualPath); } catch (e) { /* keep raw */ }
  virtualPath = virtualPath.replace(/\.\./g, '');
  try {
    // VFS-aware: serves files behind a `.mdplink` (local or remote SFTP) too.
    const buf = await mdplink.vfsReadBuffer(vres(virtualPath));
    const ext = path.extname(virtualPath).toLowerCase().replace('.', '');
    res.set('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    res.status(404).send('Not found');
  }
});

const targetDir = rootDir;

const publicDir = process.env.NODE_ENV === 'development' 
  ? path.join(process.cwd(), 'public') 
  : path.join(__dirname, 'dist');

const safeParseJSON = (str) => JSON.parse(str.replace(/^\uFEFF/, ''));

app.get('/api/snippets', async (req, res) => {
  let snippets = [];
  try {
    const data = await fs.promises.readFile(path.join(publicDir, 'default-snippets.json'), 'utf-8');
    snippets = safeParseJSON(data);
  } catch (e) {
    console.error('Default snippets error:', e.message);
  }

  // Custom snippet FILES cascade like other `.mdp` assets (dirs CSV, root→nearest;
  // nearest wins by file name). Omitted → root `.mdp` only.
  const chain = String(req.query.dirs || '.mdp').split(',').map(s => s.trim()).filter(Boolean);
  const byName = new Map();
  for (const cdir of chain) {
    try {
      for (const e of await mdplink.vfsList(vres(`${cdir}/snippets`))) {
        if (!e.isDir && e.name.toLowerCase().endsWith('.json')) byName.set(e.name, `${cdir}/snippets/${e.name}`);
      }
    } catch (dirErr) { /* snippets dir absent in this `.mdp` */ }
  }
  for (const [file, rel] of byName) {
    try {
      const data = await mdplink.vfsReadText(vres(rel));
      const customSnippets = safeParseJSON(data);
      if (Array.isArray(customSnippets)) {
        customSnippets.forEach(category => {
          if (category.items && Array.isArray(category.items)) {
            category.items.forEach(item => item.isCustom = true);
            const existingCat = snippets.find(c => c.category === category.category);
            if (existingCat) existingCat.items.push(...category.items);
            else snippets.push(category);
          }
        });
      }
    } catch (fileErr) { console.error(`Error parsing ${file}:`, fileErr.message); }
  }
  res.json(snippets);
});

// `dirs` (CSV) = the target folder's `.mdp` chain (root→nearest); custom templates
// merge across it, NEAREST wins by file name. Omitted → root `.mdp` (legacy).
app.get('/api/templates', async (req, res) => {
  let templates = [];
  const chain = String(req.query.dirs || '.mdp').split(',').map(s => s.trim()).filter(Boolean);
  const byName = new Map();
  for (const cdir of chain) {
    try {
      for (const e of await mdplink.vfsList(vres(`${cdir}/templates`))) {
        if (!e.isDir && e.name.endsWith('.md')) byName.set(e.name, { name: e.name, path: `${cdir}/templates/${e.name}`, isCustom: true });
      }
    } catch (e) { /* templates dir absent in this `.mdp` */ }
  }
  templates.push(...byName.values());

  const defaultDir = path.join(publicDir, 'templates');
  if (fs.existsSync(defaultDir)) {
    try {
      const files = await fs.promises.readdir(defaultDir);
      const defaultTemplates = files.filter(f => f.endsWith('.md')).map(f => ({
        name: f, path: `templates/${f}`, isCustom: false
      }));
      defaultTemplates.forEach(dt => {
        if (!templates.find(t => t.name === dt.name)) templates.push(dt);
      });
    } catch (e) { console.error(e); }
  }
  
  if (templates.length === 0) {
    templates.push({ name: 'Default.slide.md', path: 'default', isCustom: false });
  }
  
  res.json(templates);
});

app.get('/api/templateContent', async (req, res) => {
  try {
    const templatePath = req.query.path;
    if (templatePath && templatePath !== 'default') {
       // Workspace templates may live in a NESTED `.mdp` (cascade) or behind a
       // `.mdplink` — resolve through the VFS; built-ins come from publicDir.
       if (templatePath.includes('.mdp/')) {
         return res.send(await mdplink.vfsReadText(vres(templatePath)));
       }
       const absolutePath = path.join(publicDir, templatePath);
       if (fs.existsSync(absolutePath)) {
         return res.send(await fs.promises.readFile(absolutePath, 'utf-8'));
       }
    }
  } catch(e) { console.error(e); }
  res.send("# New Slide\n\nContent...");
});

// `dirs` (CSV) = the active deck's `.mdp` config-dir chain (root→nearest); custom
// themes merge across it, NEAREST wins by name. Omitted → `.mdp` (root, legacy).
app.get('/api/themes', async (req, res) => {
  const byName = new Map();
  const defaultDir = path.join(publicDir, 'themes');
  if (fs.existsSync(defaultDir)) {
    try {
      for (const f of await fs.promises.readdir(defaultDir)) if (f.endsWith('.css'))
        byName.set(f.replace('.css', ''), { name: f.replace('.css', ''), fileName: f, path: `themes/${f}`, isCustom: false });
    } catch (e) {}
  }
  const chain = String(req.query.dirs || '.mdp').split(',').map(s => s.trim()).filter(Boolean);
  for (const cdir of chain) {
    try {
      for (const e of await mdplink.vfsList(vres(`${cdir}/themes`))) if (!e.isDir && e.name.endsWith('.css'))
        byName.set(e.name.replace('.css', ''), { name: e.name.replace('.css', ''), fileName: e.name, path: `${cdir}/themes/${e.name}`, isCustom: true });
    } catch (e) { /* themes dir absent */ }
  }
  res.json([...byName.values()]);
});

app.get('/api/modules', async (req, res) => {
  let modules = [];
  const customDir = path.join(targetDir, '.mdp', 'modules');
  if (fs.existsSync(customDir)) {
    try {
      const files = await fs.promises.readdir(customDir);
      modules = files.filter(f => f.endsWith('.mdpmod.xml')).map(f => ({
        name: f.replace('.mdpmod.xml', ''),
        fileName: f,
        path: `.mdp/modules/${f}`,
        isCustom: true
      }));
    } catch (e) {}
  }

  const defaultDir = path.join(publicDir, 'modules');
  if (fs.existsSync(defaultDir)) {
    try {
      const files = await fs.promises.readdir(defaultDir);
      const defaultModules = files.filter(f => f.endsWith('.mdpmod.xml')).map(f => ({
        name: f.replace('.mdpmod.xml', ''),
        fileName: f,
        path: `modules/${f}`,
        isCustom: false
      }));
      defaultModules.forEach(dm => {
        if (!modules.find(m => m.fileName === dm.fileName)) modules.push(dm);
      });
    } catch (e) {}
  }
  res.json(modules);
});

app.get('/api/moduleContent', async (req, res) => {
  try {
    const modulePath = req.query.path;
    if (modulePath) {
       const absolutePath = modulePath.startsWith('.mdp/')
          ? path.join(targetDir, modulePath)
          : path.join(publicDir, modulePath);

       if (fs.existsSync(absolutePath)) {
         return res.send(await fs.promises.readFile(absolutePath, 'utf-8'));
       }
    }
  } catch(e) { console.error(e); }
  res.send("");
});

app.get('/api/effects', async (req, res) => {
  let effects = [];
  const customDir = path.join(targetDir, '.mdp', 'effects');
  if (fs.existsSync(customDir)) {
    try {
      const files = await fs.promises.readdir(customDir);
      files.filter(f => f.endsWith('.mdpfx.xml')).forEach(f => {
        effects.push({ name: f.replace('.mdpfx.xml', ''), fileName: f, path: `.mdp/effects/${f}`, isCustom: true });
      });
    } catch (e) {}
  }

  const defaultDir = path.join(publicDir, 'effects');
  if (fs.existsSync(defaultDir)) {
    try {
      const files = await fs.promises.readdir(defaultDir);
      const defaultEffects = files.filter(f => f.endsWith('.mdpfx.xml')).map(f => ({
        name: f.replace('.mdpfx.xml', ''),
        fileName: f,
        path: `effects/${f}`,
        isCustom: false
      }));
      defaultEffects.forEach(de => {
        if (!effects.find(e => e.fileName === de.fileName)) effects.push(de);
      });
    } catch (e) {}
  }
  res.json(effects);
});

app.get('/api/effectContent', async (req, res) => {
  try {
    const effectPath = req.query.path;
    if (effectPath) {
       const absolutePath = effectPath.startsWith('.mdp/')
          ? path.join(targetDir, effectPath)
          : path.join(publicDir, effectPath);

       if (fs.existsSync(absolutePath)) {
         return res.send(await fs.promises.readFile(absolutePath, 'utf-8'));
       }
    }
  } catch(e) { console.error(e); }
  res.send("");
});

app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/files/')) return res.status(404).send('Not found');
  const indexHtml = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  } else {
    res.send('React app is not built.');
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Serving directory: ${rootDir}`);
});

const wss = new WebSocketServer({ server });

const watcher = chokidar.watch(rootDir, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true });
watcher.on('all', () => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send('file-change');
  });
});

const { attachRelay } = require('./app/remoteRelay.cjs');
attachRelay(wss);