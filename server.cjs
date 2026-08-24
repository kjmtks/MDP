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

// In multi-user (spaces) mode the single rootDir is never used and the app
// dir may be mounted read-only -- don't create it.
if (!process.env.MDP_WEB_CONFIG && !fs.existsSync(rootDir)) {
  console.log(`Creating directory: ${rootDir}`);
  fs.mkdirSync(rootDir, { recursive: true });
}

const getSafePath = (targetPath) => {
  const safePath = (targetPath || '').replace(/\.\./g, '');
  return path.join(rootDir, safePath);
};

// ---- Multi-user web mode (opt-in; no config -> behavior is unchanged) ----
// MDP_WEB_CONFIG=/path/to/mdp-web.config.json describes the deployment's
// folder layout and permission policy (see app/webspaces.cjs for the schema).
// MDP itself carries NO site-specific policy: which directories exist, who
// may read or write whose, and what the virtual folders are called all live
// in that config, owned by the deployment.
//
// In this mode `.mdplink` resolution is DISABLED (a user-authored link file
// could point the server at any local path or make it open SSH sessions),
// and the chokidar watcher is skipped -- inotify does not fire across CIFS
// mounts anyway, and mutating API routes broadcast 'file-change' themselves.
const webspaces = require('./app/webspaces.cjs');
const SPACES = webspaces.load(process.env.MDP_WEB_CONFIG || '');
const MULTI = !!SPACES;
// Group membership snapshot {group:[user,...]}, maintained by the
// deployment (the lab portal writes it from LDAP). Re-read on mtime
// change; membership rarely changes so this is cheap and robust.
let groupsCache = { at: 0, mtime: 0, map: {} };
function groupsOfUser(user) {
  const file = MULTI ? SPACES.groupsFile : '';
  if (!file || !user) return [];
  try {
    const st = fs.statSync(file);
    if (st.mtimeMs !== groupsCache.mtime) {
      groupsCache = { at: Date.now(), mtime: st.mtimeMs, map: JSON.parse(fs.readFileSync(file, 'utf8')) };
    }
  } catch { /* missing/unreadable -> no groups */ return []; }
  const map = groupsCache.map || {};
  return Object.keys(map).filter((g) => Array.isArray(map[g]) && map[g].includes(user));
}

if (MULTI) {
  app.use((req, res, next) => {
    // Only workspace routes need a user; keep static assets cheap.
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/files/')) return next();
    const user = webspaces.userOf(SPACES, req);
    if (!user) return res.status(401).json({ error: 'unidentified user' });
    req.mdpGroups = groupsOfUser(user);   // for {group} spaces (see webspaces)
    next();
  });
}

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
  // sharedMode: the multi-user web deployment. The client hides features
  // that don't exist there (`.mdplink` links / SSH / offline cache).
  // The server's interface list and hostname are the operator's business,
  // not the users' -- clients on a shared server connect via location.host.
  if (MULTI) return res.json({ ips: [], port: PORT, hostname: '', mode: 'local', sharedMode: true });
  res.json({ ips: addresses, port: PORT, hostname: os.hostname(), mode: 'local', sharedMode: false });
});

// NOTE: the old Java-based `/plantuml/svg` route was removed — PlantUML now renders
// entirely in the browser via `@plantuml/core` (WASM), so no `java`/plantuml.jar and
// no server round-trip. See src/features/slide/parser/plantumlPlugin.ts.

// Resolve a workspace-relative path. Single-user mode goes through the
// `.mdplink`-aware resolver; shared mode asks the spaces engine (plain local
// paths only, permission model included).
const vres = (req, rel) => {
  if (!MULTI) return mdplink.resolve(rootDir, rel || '');
  const loc = webspaces.locate(SPACES, req, rel);
  if (!loc || !webspaces.canRead(SPACES, req, loc) || !loc.abs) {
    const e = new Error('not found'); e.status = 404; throw e;
  }
  return { kind: 'local', abs: loc.abs };
};
const assertWritable = (req, rel) => {
  if (!MULTI) return;
  const loc = webspaces.locate(SPACES, req, rel);
  if (!loc || !webspaces.canRead(SPACES, req, loc)) {
    const e = new Error('not found'); e.status = 404; throw e;
  }
  if (!webspaces.canWrite(SPACES, req, loc)) {
    const e = new Error('read-only here'); e.status = 403; throw e;
  }
};

app.get('/api/files', async (req, res) => {
  // Multi-user mode: plain walk (no `.mdplink` following -- see vres).
  if (MULTI) {
    try { return res.json(webspaces.tree(SPACES, req, getFileTree)); }
    catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  }
  try { res.json((await mdplink.buildTree(rootDir)).nodes); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Lazily load a deferred subtree (an SSH link or a remote subdir) on expand.
app.get('/api/subtree', async (req, res) => {
  if (MULTI) {
    // No lazy (SSH) nodes exist without links; answer with a plain walk anyway.
    try { const t = vres(req, req.query.path || ''); return res.json({ nodes: getFileTree(t.abs) }); }
    catch (e) { return res.status(e.status || 500).json({ error: e.message, nodes: [] }); }
  }
  try { res.json(await mdplink.buildSubTree(rootDir, req.query.path || '')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Advisory edit locks (shared mode) --------------------------------------
// Markdown autosaves on every keystroke, so two people editing one file would
// clobber each other. First opener of a file holds a lock; later openers are
// served read-only. A lock is renewed by heartbeat and expires on its own so a
// closed tab never wedges a file. Keyed by RESOLVED absolute path (so the same
// file reached via '@homes/<me>' and one's own root is one lock).
const LOCK_TTL_MS = 45 * 1000;
const editLocks = new Map();   // absPath -> { user, at }
const lockHolder = (abs) => {
  const l = editLocks.get(abs);
  if (!l) return null;
  if (Date.now() - l.at > LOCK_TTL_MS) { editLocks.delete(abs); return null; }
  return l.user;
};
const takeLock = (abs, user) => { editLocks.set(abs, { user, at: Date.now() }); };

app.post('/api/lock', (req, res) => {
  if (!MULTI) return res.json({ ok: true, owner: null });
  let abs; try { abs = vres(req, req.body.path).abs; } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const me = webspaces.userOf(SPACES, req);
  const holder = lockHolder(abs);
  if (holder && holder !== me) return res.json({ ok: false, owner: holder });
  takeLock(abs, me);
  res.json({ ok: true, owner: me });
});

app.post('/api/unlock', (req, res) => {
  if (!MULTI) return res.json({ ok: true });
  let abs; try { abs = vres(req, req.body.path).abs; } catch { return res.json({ ok: true }); }
  const me = webspaces.userOf(SPACES, req);
  if (editLocks.get(abs) && editLocks.get(abs).user === me) editLocks.delete(abs);
  res.json({ ok: true });
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
    assertWritable(req, req.body.filename);
    if (MULTI) {
      const abs = vres(req, req.body.filename).abs;
      const me = webspaces.userOf(SPACES, req);
      const holder = lockHolder(abs);
      if (holder && holder !== me) {
        return res.status(409).json({ success: false, error: 'locked', owner: holder });
      }
      takeLock(abs, me);   // saving implies editing -> hold the lock
    }
    await mdplink.vfsWrite(vres(req, req.body.filename), content);
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ success: false, error: e.message }); }
});

app.post('/api/rename', async (req, res) => {
  const { oldPath, newPath } = req.body;
  try {
    assertWritable(req, oldPath); assertWritable(req, newPath);
    await mdplink.vfsRename(vres(req, oldPath), vres(req, newPath));
    if (MULTI) pokeClients(); res.json({ success: true });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post('/api/delete', async (req, res) => {
  try {
    for (const p of req.body.paths) assertWritable(req, p);
    for (const p of req.body.paths) await mdplink.vfsRemove(vresSelf(req, p));
    if (MULTI) pokeClients(); res.json({ success: true });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.post('/api/move', async (req, res) => {
  const { sourcePaths, targetPath } = req.body;
  try {
    assertWritable(req, targetPath);
    for (const p of sourcePaths) assertWritable(req, p);
    await mdplink.vfsMkdirp(vres(req, targetPath));
    for (const p of sourcePaths) await mdplink.vfsRename(vres(req, p), vres(req, `${targetPath}/${path.basename(p)}`));
    if (MULTI) pokeClients();
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
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
    assertWritable(req, targetPath || '');
    const targetDir = vres(req, targetPath || '');
    await mdplink.vfsMkdirp(targetDir);
    const created = [];
    for (const p of sourcePaths) {
      const destName = await uniqueCopyNameVfs(targetDir, path.basename(p));
      await mdplink.vfsCopy(vres(req, p), mdplink.childOf(targetDir, destName));
      created.push((targetPath ? `${targetPath}/${destName}` : destName).replace(/^\//, ''));
    }
    if (MULTI) pokeClients();
    res.json({ success: true, paths: created });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Read/write a `.mdplink` file's RAW JSON config (bypasses link traversal).
// `.mdplink` / SSH / cache endpoints act on server-global state and on links,
// both of which are disabled in multi-user mode. Reads answer inert defaults
// (the settings UI polls some of them); writes are refused.
const multiOff = (res) => res.status(403).json({ error: 'disabled on the shared server' });

app.get('/api/linkConfig', async (req, res) => {
  if (MULTI) return multiOff(res);
  try { res.type('text/plain').send(await mdplink.vfsReadText(mdplink.resolveLinkFile(rootDir, req.query.path || ''))); }
  catch (e) { res.status(500).send(e.message); }
});
app.post('/api/linkConfig', async (req, res) => {
  if (MULTI) return multiOff(res);
  try { await mdplink.vfsWrite(mdplink.resolveLinkFile(rootDir, req.body.path || ''), Buffer.from(String(req.body.content ?? ''), 'utf-8')); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Machine-local "bypass jump host" toggle for SSH links.
app.get('/api/sshBypassJump', (req, res) => res.json({ bypassJump: MULTI ? false : mdplink.getBypassJump() }));
app.post('/api/sshBypassJump', (req, res) => { if (MULTI) return multiOff(res); mdplink.setBypassJump(!!req.body.bypassJump); res.json({ success: true }); });

// Offline cache for remote (`.mdplink` SSH) files.
app.get('/api/cacheInfo', (req, res) => res.json(MULTI ? { enabled: false } : mdplink.getCacheInfo()));
app.post('/api/cacheConfig', (req, res) => { if (MULTI) return multiOff(res); mdplink.setCacheConfig(req.body || {}); res.json(mdplink.getCacheInfo()); });
app.post('/api/clearCache', (req, res) => { if (MULTI) return multiOff(res); mdplink.clearCache(); res.json(mdplink.getCacheInfo()); });
app.post('/api/prefetchDeck', async (req, res) => {
  if (MULTI) return multiOff(res);   // offline pinning is a link feature
  try { res.json(await mdplink.prefetchDeck(rootDir, req.body.path || '')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/create', async (req, res) => {
  const { path: createPath, type } = req.body;
  try {
    assertWritable(req, createPath);
    if (type === 'directory') await mdplink.vfsMkdirp(vres(req, createPath));
    else await mdplink.vfsWrite(vres(req, createPath), Buffer.from('', 'utf-8'));
    if (MULTI) pokeClients();
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
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
    const buf = await mdplink.vfsReadBuffer(vres(req, virtualPath));
    const ext = path.extname(virtualPath).toLowerCase().replace('.', '');
    res.set('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    res.status(404).send('Not found');
  }
});

// Modules/effects read straight off the workspace root; per-request (the
// requester's home space) in multi-user mode.
const targetDirOf = (req) => (MULTI ? vres(req, '').abs : rootDir);

const publicDir = process.env.NODE_ENV === 'development' 
  ? path.join(process.cwd(), 'public') 
  : path.join(__dirname, 'dist');

const safeParseJSON = (str) => JSON.parse(str.replace(/^\uFEFF/, ''));

// Built-in asset lookups take a client-supplied relative path; resolve it
// and refuse anything that escapes publicDir ('..' traversal).
const underPublic = (rel) => {
  const abs = path.resolve(publicDir, String(rel || ''));
  return abs.startsWith(path.resolve(publicDir) + path.sep) ? abs : null;
};

// Site-wide shared assets (shared mode): prepended to every asset cascade
// so the user's own `.mdp` (later in the chain) wins on a name clash.
const siteAssetDirs = () => (MULTI ? (SPACES.assetDirs || []) : []);
const assetChain = (raw) => [
  ...siteAssetDirs(),
  ...String(raw || '.mdp').split(',').map((s) => s.trim()).filter(Boolean),
];

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
  const chain = assetChain(req.query.dirs);
  const byName = new Map();
  for (const cdir of chain) {
    try {
      for (const e of await mdplink.vfsList(vres(req, `${cdir}/snippets`))) {
        if (!e.isDir && e.name.toLowerCase().endsWith('.json')) byName.set(e.name, `${cdir}/snippets/${e.name}`);
      }
    } catch (dirErr) { /* snippets dir absent in this `.mdp` */ }
  }
  for (const [file, rel] of byName) {
    try {
      const data = await mdplink.vfsReadText(vres(req, rel));
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
  const chain = assetChain(req.query.dirs);
  const byName = new Map();
  for (const cdir of chain) {
    try {
      for (const e of await mdplink.vfsList(vres(req, `${cdir}/templates`))) {
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
         return res.send(await mdplink.vfsReadText(vres(req, templatePath)));
       }
       const absolutePath = underPublic(templatePath);
       if (absolutePath && fs.existsSync(absolutePath)) {
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
  const chain = assetChain(req.query.dirs);
  for (const cdir of chain) {
    try {
      for (const e of await mdplink.vfsList(vres(req, `${cdir}/themes`))) if (!e.isDir && e.name.endsWith('.css'))
        byName.set(e.name.replace('.css', ''), { name: e.name.replace('.css', ''), fileName: e.name, path: `${cdir}/themes/${e.name}`, isCustom: true });
    } catch (e) { /* themes dir absent */ }
  }
  res.json([...byName.values()]);
});

app.get('/api/modules', async (req, res) => {
  let modules = [];
  // Site-wide shared assets first; the user's own entry of the same file
  // name replaces it below (the UI de-duplicates by name, last wins).
  for (const adir of siteAssetDirs()) {
    try {
      for (const e of await mdplink.vfsList(vres(req, `${adir}/modules`))) {
        if (!e.isDir && e.name.endsWith('.mdpmod.xml')) {
          modules.push({ name: e.name.replace('.mdpmod.xml', ''), fileName: e.name,
                     path: `${adir}/modules/${e.name}`, isCustom: true });
        }
      }
    } catch (dirErr) { /* shared modules dir absent */ }
  }
  const customDir = path.join(targetDirOf(req), '.mdp', 'modules');
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
       if (MULTI && modulePath.startsWith('@')) {
         return res.send(await mdplink.vfsReadText(vres(req, modulePath)));
       }
       const absolutePath = modulePath.startsWith('.mdp/')
          ? path.join(targetDirOf(req), modulePath.replace(/\.\./g, ''))
          : underPublic(modulePath);

       if (absolutePath && fs.existsSync(absolutePath)) {
         return res.send(await fs.promises.readFile(absolutePath, 'utf-8'));
       }
    }
  } catch(e) { console.error(e); }
  res.send("");
});

app.get('/api/effects', async (req, res) => {
  let effects = [];
  // Site-wide shared assets first; the user's own entry of the same file
  // name replaces it below (the UI de-duplicates by name, last wins).
  for (const adir of siteAssetDirs()) {
    try {
      for (const e of await mdplink.vfsList(vres(req, `${adir}/effects`))) {
        if (!e.isDir && e.name.endsWith('.mdpfx.xml')) {
          effects.push({ name: e.name.replace('.mdpfx.xml', ''), fileName: e.name,
                     path: `${adir}/effects/${e.name}`, isCustom: true });
        }
      }
    } catch (dirErr) { /* shared effects dir absent */ }
  }
  const customDir = path.join(targetDirOf(req), '.mdp', 'effects');
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
       if (MULTI && effectPath.startsWith('@')) {
         return res.send(await mdplink.vfsReadText(vres(req, effectPath)));
       }
       const absolutePath = effectPath.startsWith('.mdp/')
          ? path.join(targetDirOf(req), effectPath.replace(/\.\./g, ''))
          : underPublic(effectPath);

       if (absolutePath && fs.existsSync(absolutePath)) {
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

const pokeClients = () => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send('file-change');
  });
};
if (!MULTI) {
  const watcher = chokidar.watch(rootDir, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true });
  watcher.on('all', pokeClients);
}

const { attachRelay } = require('./app/remoteRelay.cjs');
// Shared mode: relay presentation-control traffic ONLY between sockets of the
// SAME authenticated user (PC + tablet of one person). Without this, any
// signed-in user could listen to -- or drive -- someone else's presentation.
attachRelay(wss, MULTI
  ? { userOf: (req) => String((req.headers || {})[SPACES.userHeader] || '') }
  : {});