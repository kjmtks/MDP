// .mdplink — a file that acts like a symbolic link to another directory, either a
// LOCAL path or a REMOTE directory over SSH/SFTP. Shared by the Electron main
// process (app/main.cjs) and the web server (server.cjs) so both resolve links the
// same way.
//
// A `<name>.mdplink` file contains JSON:
//   { "type": "local", "path": "D:/shared/decks" }
//   { "type": "ssh", "host": "h", "port": 22, "user": "u", "path": "/remote/dir",
//     "identityFile": "C:/Users/me/.ssh/id_ed25519", "passphrase": "..." }
//
// An SSH link may reach its host through a jump/bastion host (equivalent to the
// OpenSSH `ProxyJump`, or a `ProxyCommand ssh -W %h:%p jump`):
//   { "type": "ssh", "host": "target", "path": "/dir", "identityFile": "...",
//     "proxyJump": { "host": "bastion", "port": 22, "user": "u2",
//                    "identityFile": "..." } }   // or "proxyJump": "u2@bastion:22"
// Jump `user`/`identityFile`/`passphrase` default to the target's when omitted.
//
// In the file tree a `.mdplink` is shown as a DIRECTORY whose children are the
// target's contents. Any workspace path that crosses a `.mdplink` segment (e.g.
// `a/b/server1.mdplink/sub/deck.slide.md`) is routed to the link target.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Client } = require('ssh2');

const expandHome = (p) => (p && p.startsWith('~')) ? path.join(os.homedir(), p.slice(1)) : p;
const isFileSync = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// Join a POSIX remote base with extra path segments (remote paths are always '/').
const posixJoin = (base, segs) => {
  let p = String(base || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  for (const s of segs) p = (p === '/' ? '' : p) + '/' + s;
  return p || '/';
};

// Normalize a `proxyJump` value (an object, or a "user@host:port" shorthand) into a
// connection config. Missing user/key/passphrase fall back to the target host's.
function normalizeJump(j, main) {
  if (!j) return undefined;
  if (typeof j === 'string') {
    const m = j.trim().match(/^(?:([^@]+)@)?([^@:]+)(?::(\d+))?$/);
    if (!m) throw new Error(`Invalid proxyJump "${j}"`);
    j = { user: m[1], host: m[2], port: m[3] };
  }
  if (!j.host) throw new Error('proxyJump needs a "host"');
  return {
    host: j.host,
    port: Number(j.port) || 22,
    user: j.user || j.username || main.user,
    identityFile: j.identityFile || j.privateKey || main.identityFile,
    passphrase: j.passphrase != null ? j.passphrase : main.passphrase,
    password: j.password,
  };
}

function parseLink(content, sourcePath) {
  let cfg;
  try {
    cfg = JSON.parse(content);
  } catch (e1) {
    // Hand-edited Windows paths usually have unescaped backslashes, e.g.
    // "C:\Users\me\.ssh\id" — invalid JSON. Treat EVERY backslash as a literal
    // path separator (escape them all, preserving any already-escaped pairs) and
    // retry, so such configs still load. (A valid file parsed on the first try.)
    try {
      const NUL = String.fromCharCode(0);
      cfg = JSON.parse(content.split('\\\\').join(NUL).split('\\').join('\\\\').split(NUL).join('\\\\'));
    } catch {
      throw new Error(`Invalid .mdplink JSON (${sourcePath}): ${e1.message}`);
    }
  }
  const type = (cfg.type || (cfg.host ? 'ssh' : 'local')).toLowerCase();
  if (type === 'ssh') {
    if (!cfg.host || !cfg.path) throw new Error(`.mdplink (ssh) needs "host" and "path" (${sourcePath})`);
    const base = { type: 'ssh', host: cfg.host, port: Number(cfg.port) || 22, user: cfg.user || cfg.username,
                   path: cfg.path, identityFile: cfg.identityFile || cfg.privateKey, passphrase: cfg.passphrase,
                   password: cfg.password };
    base.proxyJump = normalizeJump(cfg.proxyJump || cfg.jump, base);
    return base;
  }
  if (!cfg.path) throw new Error(`.mdplink (local) needs "path" (${sourcePath})`);
  return { type: 'local', path: cfg.path };
}

// Resolve a workspace-relative path (under baseDir) to a concrete target, following
// any `.mdplink` it crosses. Local links nest; once a path enters an SSH link, the
// remainder is joined onto the remote path (no further link detection remotely).
function resolve(baseDir, relPath) {
  const segs = String(relPath || '').split(/[\\/]+/).filter((s) => s && s !== '.');
  return resolveSegs(baseDir, segs, 0);
}
function resolveSegs(localBase, segs, depth) {
  if (depth > 20) return { kind: 'local', abs: localBase };
  let cur = localBase;
  for (let i = 0; i < segs.length; i++) {
    const candidate = path.join(cur, segs[i]);
    if (segs[i].toLowerCase().endsWith('.mdplink') && isFileSync(candidate)) {
      const link = parseLink(fs.readFileSync(candidate, 'utf8'), candidate);
      const rest = segs.slice(i + 1);
      if (link.type === 'ssh') return { kind: 'ssh', cfg: link, rpath: posixJoin(link.path, rest) };
      const targetBase = path.isAbsolute(link.path) ? link.path : path.join(path.dirname(candidate), link.path);
      return resolveSegs(targetBase, rest, depth + 1);
    }
    cur = candidate;
  }
  return { kind: 'local', abs: cur };
}

// Resolve to the `.mdplink` FILE itself (not the directory it points at) so its
// raw JSON config can be read/written. The PARENT is resolved (so a link nested
// inside another local/remote link still works), then the file name is appended.
function resolveLinkFile(baseDir, relPath) {
  const segs = String(relPath || '').split(/[\\/]+/).filter((s) => s && s !== '.');
  if (!segs.length) return { kind: 'local', abs: baseDir };
  const parent = resolveSegs(baseDir, segs.slice(0, -1), 0);
  return childOf(parent, segs[segs.length - 1]);
}

// ---- Machine-local state ---------------------------------------------------
// `bypassJump` toggles whether SSH links connect THROUGH their `proxyJump` bastion
// or DIRECTLY. It's environment-specific (the same .mdplink config is used where the
// bastion is needed AND where the target is directly reachable), so it lives in a
// machine-local file (NOT the workspace), set from the UI. Cache config lives here too.
let bypassJump = false;
let cacheEnabled = true;
let cacheMaxBytes = 300 * 1024 * 1024; // 300 MB default
let localStatePath = null;

function persistLocalState() {
  if (!localStatePath) return;
  try { fs.writeFileSync(localStatePath, JSON.stringify({ bypassJump, cacheEnabled, cacheMaxBytes })); } catch { /* ignore */ }
}
function initLocalState(filePath, cDir) {
  localStatePath = filePath;
  try {
    const s = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    bypassJump = !!s.bypassJump;
    if (typeof s.cacheEnabled === 'boolean') cacheEnabled = s.cacheEnabled;
    if (typeof s.cacheMaxBytes === 'number' && s.cacheMaxBytes > 0) cacheMaxBytes = s.cacheMaxBytes;
  } catch { /* no file yet → defaults */ }
  if (cDir) { cacheDir = cDir; loadCacheIndex(); }
}
function getBypassJump() { return bypassJump; }
function setBypassJump(v) {
  bypassJump = !!v;
  closeAll(); // drop pooled connections so they rebuild with/without the jump hop
  persistLocalState();
}

// ---- Offline cache ---------------------------------------------------------
// Demand-driven: a remote file/listing is cached only when actually READ (i.e. a
// file a slide references, or a directory that was browsed) — never the whole tree.
// Online → revalidate via stat (serve cache if size+mtime match, else refetch);
// offline / connection failure → serve the cached copy. Bounded by an LRU size cap.
// Every cache step is defensively guarded so a cache fault never breaks a real read.
let cacheDir = null;
let cacheIndex = {};            // key -> { rpath, host, size, mtime, atime, dir?, listing? }
let cacheSaveTimer = null;

const cacheKey = (cfg, rpath) =>
  crypto.createHash('sha1').update(JSON.stringify([cfg.host, cfg.port, cfg.user, rpath])).digest('hex');
const blobPath = (key) => path.join(cacheDir, 'blobs', key);

function loadCacheIndex() {
  try { cacheIndex = JSON.parse(fs.readFileSync(path.join(cacheDir, 'index.json'), 'utf8')) || {}; }
  catch { cacheIndex = {}; }
}
function saveCacheIndexSoon() {
  if (!cacheDir || cacheSaveTimer) return;
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null;
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(path.join(cacheDir, 'index.json'), JSON.stringify(cacheIndex)); } catch { /* ignore */ }
  }, 800);
}
function cacheUsedBytes() { return Object.values(cacheIndex).reduce((a, m) => a + (m.size || 0), 0); }
function enforceCacheCap() {
  let used = cacheUsedBytes();
  if (used <= cacheMaxBytes) return;
  const files = Object.entries(cacheIndex).filter(([, m]) => !m.dir).sort((a, b) => (a[1].atime || 0) - (b[1].atime || 0));
  for (const [k, m] of files) {
    if (used <= cacheMaxBytes) break;
    try { fs.unlinkSync(blobPath(k)); } catch { /* ignore */ }
    used -= (m.size || 0);
    delete cacheIndex[k];
  }
}
function cacheGetFile(key) {
  const m = cacheIndex[key];
  if (!m || m.dir) return null;
  try { const buf = fs.readFileSync(blobPath(key)); m.atime = Date.now(); saveCacheIndexSoon(); return { buf, meta: m }; }
  catch { delete cacheIndex[key]; return null; }
}
function cachePutFile(key, buf, meta) {
  if (!cacheDir) return;
  try {
    fs.mkdirSync(path.join(cacheDir, 'blobs'), { recursive: true });
    fs.writeFileSync(blobPath(key), buf);
    cacheIndex[key] = { ...meta, dir: false, size: buf.length, atime: Date.now() };
    enforceCacheCap();
    saveCacheIndexSoon();
  } catch { /* ignore — caching is best-effort */ }
}
function cacheGetListing(key) { const m = cacheIndex[key]; if (m && m.dir) { m.atime = Date.now(); return m.listing; } return null; }
function cachePutListing(key, listing, meta) {
  if (!cacheDir) return;
  cacheIndex[key] = { ...meta, dir: true, listing, size: 0, atime: Date.now() };
  saveCacheIndexSoon();
}
function clearCache() {
  for (const k of Object.keys(cacheIndex)) { if (!cacheIndex[k].dir) { try { fs.unlinkSync(blobPath(k)); } catch { /* ignore */ } } }
  cacheIndex = {};
  saveCacheIndexSoon();
}
function getCacheInfo() {
  return { enabled: cacheEnabled, maxBytes: cacheMaxBytes, usedBytes: cacheUsedBytes(),
           count: Object.values(cacheIndex).filter((m) => !m.dir).length };
}
function setCacheConfig({ enabled, maxBytes } = {}) {
  if (typeof enabled === 'boolean') cacheEnabled = enabled;
  if (typeof maxBytes === 'number' && maxBytes > 0) cacheMaxBytes = maxBytes;
  enforceCacheCap();
  persistLocalState();
  saveCacheIndexSoon();
}

// ---- SSH/SFTP connection pool ----------------------------------------------
const pool = new Map(); // key -> { sftpPromise, conns: Client[], alive }
const jumpKey = (j) => j ? [j.host, j.port, j.user, j.identityFile || ''] : 0;
// `bypassJump` is part of the key so a direct vs through-bastion session never share
// a pooled connection (also defensively re-keyed; closeAll already clears on toggle).
const poolKey = (c) => JSON.stringify([c.host, c.port, c.user, c.identityFile || '', c.password ? 1 : 0, bypassJump ? 0 : jumpKey(c.proxyJump)]);

// Open one SSH connection. `sock` (a stream from a jump host's forwarded channel)
// makes this connection tunnel through that host. Resolves with the ready Client;
// every Client is tracked on `entry.conns` for cleanup.
function connectClient(cfg, sock, entry, onDead) {
  return new Promise((resolveP, rejectP) => {
    const conn = new Client();
    entry.conns.push(conn);
    const fail = (e) => { onDead(); rejectP(e); };
    conn.on('ready', () => resolveP(conn)).on('error', fail).on('close', onDead);
    const opts = { host: cfg.host, port: cfg.port || 22, username: cfg.user, readyTimeout: 20000, keepaliveInterval: 15000 };
    try {
      if (cfg.identityFile) opts.privateKey = fs.readFileSync(expandHome(cfg.identityFile));
      if (cfg.passphrase) opts.passphrase = cfg.passphrase;
      if (cfg.password) opts.password = cfg.password;
      if (sock) opts.sock = sock;
      conn.connect(opts);
    } catch (e) { fail(e); }
  });
}

// Establish the SFTP session for `cfg`, tunnelling through `cfg.proxyJump` first if
// one is configured (connect the jump host, forward a channel to the target, then
// SSH the target over that channel).
async function openSftp(cfg, entry, onDead) {
  let sock;
  if (cfg.proxyJump && !bypassJump) {
    const jump = await connectClient(cfg.proxyJump, undefined, entry, onDead);
    sock = await new Promise((res, rej) =>
      jump.forwardOut('127.0.0.1', 0, cfg.host, cfg.port || 22, (err, stream) => err ? rej(err) : res(stream)));
  }
  const conn = await connectClient(cfg, sock, entry, onDead);
  return await new Promise((res, rej) => conn.sftp((err, sftp) => err ? rej(err) : res(sftp)));
}

function getSftp(cfg) {
  const key = poolKey(cfg);
  const existing = pool.get(key);
  if (existing && existing.alive) return existing.sftpPromise;
  const entry = { alive: true, conns: [] };
  const onDead = () => { entry.alive = false; if (pool.get(key) === entry) pool.delete(key); };
  entry.sftpPromise = openSftp(cfg, entry, onDead).catch((e) => { onDead(); throw e; });
  pool.set(key, entry);
  return entry.sftpPromise;
}

const sftpCall = (sftp, method, ...args) => new Promise((res, rej) =>
  sftp[method](...args, (err, data) => err ? rej(err) : res(data)));

function closeAll() {
  for (const { conns } of pool.values()) {
    for (const conn of conns || []) { try { conn && conn.end(); } catch { /* ignore */ } }
  }
  pool.clear();
}

// ---- VFS ops (target-aware: local fs or remote sftp) -----------------------
async function vfsList(target) {
  if (target.kind === 'ssh') {
    const key = (cacheEnabled && cacheDir) ? cacheKey(target.cfg, 'DIR:' + target.rpath) : null;
    try {
      const sftp = await getSftp(target.cfg);
      const list = await sftpCall(sftp, 'readdir', target.rpath);
      // longname[0] === 'd' marks a directory; fall back to attrs.mode.
      const mapped = list.map((e) => ({ name: e.filename, isDir: (e.longname || '')[0] === 'd' || ((e.attrs.mode & 0o170000) === 0o040000) }));
      if (key) cachePutListing(key, mapped, { rpath: target.rpath, host: target.cfg.host });
      return mapped;
    } catch (e) {
      // Offline / connection failure → serve the last cached listing if we have it.
      if (key) { const cached = cacheGetListing(key); if (cached) return cached; }
      throw e;
    }
  }
  const entries = await fsp.readdir(target.abs, { withFileTypes: true });
  return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
}

async function vfsReadBuffer(target) {
  if (target.kind === 'ssh') {
    if (!cacheEnabled || !cacheDir) { const sftp = await getSftp(target.cfg); return await sftpCall(sftp, 'readFile', target.rpath); }
    const key = cacheKey(target.cfg, target.rpath);
    try {
      const sftp = await getSftp(target.cfg);
      let st = null;
      try { st = await sftpCall(sftp, 'stat', target.rpath); } catch { /* serve fresh if stat unsupported */ }
      const cached = cacheGetFile(key);
      // Revalidate: an unchanged file (same size+mtime) is served from cache — fast,
      // and avoids re-downloading large images over a slow link.
      if (cached && st && cached.meta.size === st.size && cached.meta.mtime === st.mtime) return cached.buf;
      const buf = await sftpCall(sftp, 'readFile', target.rpath);
      cachePutFile(key, buf, { rpath: target.rpath, host: target.cfg.host, mtime: st ? st.mtime : 0 });
      return buf;
    } catch (e) {
      const cached = cacheGetFile(key);
      if (cached) return cached.buf; // offline fallback
      throw e;
    }
  }
  return await fsp.readFile(target.abs);
}
async function vfsReadText(target) { return (await vfsReadBuffer(target)).toString('utf-8'); }

async function vfsMkdirp(target) {
  if (target.kind === 'ssh') {
    const sftp = await getSftp(target.cfg);
    const parts = target.rpath.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) { cur += '/' + p; try { await sftpCall(sftp, 'mkdir', cur); } catch { /* exists */ } }
    return;
  }
  await fsp.mkdir(target.abs, { recursive: true });
}

async function vfsWrite(target, buffer) {
  if (target.kind === 'ssh') {
    const sftp = await getSftp(target.cfg);
    const dir = target.rpath.replace(/\/[^/]*$/, '') || '/';
    await vfsMkdirp({ kind: 'ssh', cfg: target.cfg, rpath: dir }).catch(() => {});
    return await sftpCall(sftp, 'writeFile', target.rpath, buffer);
  }
  await fsp.mkdir(path.dirname(target.abs), { recursive: true });
  await fsp.writeFile(target.abs, buffer);
}

async function vfsRemove(target) {
  if (target.kind === 'ssh') {
    const sftp = await getSftp(target.cfg);
    const st = await sftpCall(sftp, 'stat', target.rpath).catch(() => null);
    if (st && st.isDirectory()) {
      const list = await sftpCall(sftp, 'readdir', target.rpath);
      for (const e of list) await vfsRemove({ kind: 'ssh', cfg: target.cfg, rpath: posixJoin(target.rpath, [e.filename]) });
      return await sftpCall(sftp, 'rmdir', target.rpath);
    }
    return await sftpCall(sftp, 'unlink', target.rpath);
  }
  await fsp.rm(target.abs, { recursive: true, force: true });
}

const childOf = (target, name) => target.kind === 'ssh'
  ? { kind: 'ssh', cfg: target.cfg, rpath: posixJoin(target.rpath, [name]) }
  : { kind: 'local', abs: path.join(target.abs, name) };

async function vfsStat(target) {
  if (target.kind === 'ssh') { const sftp = await getSftp(target.cfg); const s = await sftpCall(sftp, 'stat', target.rpath); return { isDir: s.isDirectory(), size: s.size }; }
  const s = await fsp.stat(target.abs); return { isDir: s.isDirectory(), size: s.size };
}
async function vfsExists(target) { try { await vfsStat(target); return true; } catch { return false; } }

async function vfsCopy(src, dst) {
  if ((await vfsStat(src)).isDir) {
    await vfsMkdirp(dst);
    for (const e of await vfsList(src)) await vfsCopy(childOf(src, e.name), childOf(dst, e.name));
  } else {
    await vfsWrite(dst, await vfsReadBuffer(src));
  }
}

async function vfsRename(src, dst) {
  if (src.kind === 'ssh' && dst.kind === 'ssh') {
    const sftp = await getSftp(src.cfg);
    return await sftpCall(sftp, 'rename', src.rpath, dst.rpath);
  }
  if (src.kind === 'local' && dst.kind === 'local') return await fsp.rename(src.abs, dst.abs);
  // Cross-backend move: copy bytes then remove the source.
  await vfsWrite(dst, await vfsReadBuffer(src));
  await vfsRemove(src);
}

// Recursive, link-aware file tree. `linkType` is set on link nodes. SSH links and
// every remote subdirectory are NOT walked here — they're marked `lazy` so the tree
// renders without waiting on the (slow) SFTP connection; their children are fetched
// on demand (see buildSubTree). Errors in a subtree degrade to an empty/error node.
async function buildTree(baseDir, relPath = '', depth = 0) {
  const target = resolve(baseDir, relPath);
  let entries;
  try { entries = await vfsList(target); } catch (e) { return { error: e.message, nodes: [] }; }
  const remote = target.kind === 'ssh';
  const nodes = [];
  for (const e of entries) {
    const nodePath = relPath ? `${relPath}/${e.name}` : e.name;
    const isLink = target.kind === 'local' && !e.isDir && e.name.toLowerCase().endsWith('.mdplink');
    if (isLink) {
      let linkType = 'local', children = [], linkError, lazy = false;
      try {
        const link = parseLink(fs.readFileSync(path.join(target.abs, e.name), 'utf8'), e.name);
        linkType = link.type;
        // A remote (SSH) target is loaded lazily — never connect during the tree
        // build. A local target is cheap, so keep walking it inline.
        if (link.type === 'ssh') lazy = true;
        else if (depth < 12) { const sub = await buildTree(baseDir, nodePath, depth + 1); children = sub.nodes; linkError = sub.error; }
      } catch (err) { linkError = err.message; }
      // Display the virtual directory name (without `.mdplink`); the PATH keeps the
      // extension so it still resolves through the link.
      const displayName = e.name.replace(/\.mdplink$/i, '');
      // `remote: true` marks nodes with NO local filesystem path (an SSH link, or
      // anything under one) so the UI can hide "Reveal in Explorer" for them.
      nodes.push({ name: displayName, path: nodePath, type: 'directory', isLink: true, linkType, ...(linkType === 'ssh' ? { remote: true } : {}), ...(linkError ? { linkError } : {}), ...(lazy ? { lazy: true } : {}), children });
      continue;
    }
    // Hide dotfiles (matches the local tree) except the app folders and `.git`
    // (shown as a sealed, non-expandable folder below).
    if (e.name.startsWith('.') && e.name !== '.mdp' && e.name !== '.mdpignore' && e.name !== '.git') continue;
    if (e.isDir) {
      if (remote) {
        // Defer listing remote subdirectories until they're expanded.
        nodes.push({ name: e.name, path: nodePath, type: 'directory', lazy: true, remote: true, children: [] });
      } else if (e.name === '.git' || isFileSync(path.join(target.abs, e.name, '.mdpignore'))) {
        // SEALED: a `.git` or `.mdpignore` directory is shown but NEVER walked — its
        // subtree is kept out of the tree entirely, so it is excluded from browsing,
        // search and `.mdp` resolution.
        nodes.push({ name: e.name, path: nodePath, type: 'directory', children: [], slideIgnored: true, sealed: true });
      } else {
        const sub = depth < 12 ? await buildTree(baseDir, nodePath, depth + 1) : { nodes: [] };
        nodes.push({ name: e.name, path: nodePath, type: 'directory', children: sub.nodes });
      }
    } else {
      nodes.push({ name: e.name, path: nodePath, type: 'file', isBinary: /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(e.name), ...(remote ? { remote: true } : {}) });
    }
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'directory' ? -1 : 1)));
  return { nodes };
}

// Load one lazily-deferred subtree on demand: the children of a `.mdplink` link or
// of a remote subdirectory at `relPath`. Returns `{ nodes, error }`.
async function buildSubTree(baseDir, relPath) {
  return await buildTree(baseDir, relPath, 0);
}

// Asset references a deck points at (relative/absolute workspace paths). Skips
// http/data/aliases (those are embedded or local, not remote files to cache).
function extractDeckRefs(text) {
  const refs = new Set();
  const add = (r) => {
    if (!r) return;
    r = r.trim().split('?')[0].split('#')[0];
    if (!r || /^(https?:|data:|mdp-file:|app-asset:|@)/i.test(r) || r.startsWith('/files/')) return;
    refs.add(r);
  };
  let m;
  const mdImg = /!\[[^\]]*\]\(\s*([^)\s]+)/g; while ((m = mdImg.exec(text))) add(m[1]);
  const htmlImg = /<img[^>]+src\s*=\s*["']([^"']+)["']/gi; while ((m = htmlImg.exec(text))) add(m[1]);
  return [...refs];
}
// Resolve a workspace-relative ref against the deck's directory (handles ./ and ../).
function joinWorkspace(dir, rel) {
  if (rel.startsWith('/')) return rel.slice(1);
  const out = [];
  for (const p of (dir + rel).split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop(); else out.push(p);
  }
  return out.join('/');
}
// Prefetch a deck + the remote assets it references into the offline cache, so the
// deck renders offline. Reading through the VFS populates the cache as a side effect.
async function prefetchDeck(baseDir, relPath) {
  const t = resolve(baseDir, relPath);
  let text;
  try { text = (await vfsReadBuffer(t)).toString('utf-8'); }
  catch (e) { return { ok: 0, fail: 0, total: 0, error: e.message }; }
  const deckDir = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/') + 1) : '';
  const refs = extractDeckRefs(text);
  let ok = 0, fail = 0;
  for (const ref of refs) {
    try {
      const rt = resolve(baseDir, joinWorkspace(deckDir, ref));
      if (rt.kind === 'ssh') await vfsReadBuffer(rt); // downloads + caches
      ok++;
    } catch { fail++; }
  }
  return { ok, fail, total: refs.length };
}

module.exports = {
  resolve, resolveLinkFile, parseLink, buildTree, buildSubTree, closeAll,
  vfsList, vfsReadText, vfsReadBuffer, vfsWrite, vfsRemove, vfsRename, vfsMkdirp,
  vfsStat, vfsExists, vfsCopy, childOf, posixJoin,
  initLocalState, getBypassJump, setBypassJump,
  getCacheInfo, setCacheConfig, clearCache, prefetchDeck,
};
