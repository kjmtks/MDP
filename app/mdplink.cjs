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
// In the file tree a `.mdplink` is shown as a DIRECTORY whose children are the
// target's contents. Any workspace path that crosses a `.mdplink` segment (e.g.
// `a/b/server1.mdplink/sub/deck.slide.md`) is routed to the link target.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { Client } = require('ssh2');

const expandHome = (p) => (p && p.startsWith('~')) ? path.join(os.homedir(), p.slice(1)) : p;
const isFileSync = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// Join a POSIX remote base with extra path segments (remote paths are always '/').
const posixJoin = (base, segs) => {
  let p = String(base || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  for (const s of segs) p = (p === '/' ? '' : p) + '/' + s;
  return p || '/';
};

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
    return { type: 'ssh', host: cfg.host, port: Number(cfg.port) || 22, user: cfg.user || cfg.username,
             path: cfg.path, identityFile: cfg.identityFile || cfg.privateKey, passphrase: cfg.passphrase,
             password: cfg.password };
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

// ---- SSH/SFTP connection pool ----------------------------------------------
const pool = new Map(); // key -> { sftpPromise, conn, alive }
const poolKey = (c) => JSON.stringify([c.host, c.port, c.user, c.identityFile || '', c.password ? 1 : 0]);

function getSftp(cfg) {
  const key = poolKey(cfg);
  const existing = pool.get(key);
  if (existing && existing.alive) return existing.sftpPromise;
  const entry = { alive: true };
  entry.sftpPromise = new Promise((resolveP, rejectP) => {
    const conn = new Client();
    entry.conn = conn;
    const fail = (e) => { entry.alive = false; pool.delete(key); rejectP(e); };
    conn.on('ready', () => {
      conn.sftp((err, sftp) => err ? fail(err) : resolveP(sftp));
    }).on('error', fail).on('close', () => { entry.alive = false; pool.delete(key); });
    const opts = { host: cfg.host, port: cfg.port || 22, username: cfg.user, readyTimeout: 20000, keepaliveInterval: 15000 };
    try {
      if (cfg.identityFile) opts.privateKey = fs.readFileSync(expandHome(cfg.identityFile));
      if (cfg.passphrase) opts.passphrase = cfg.passphrase;
      if (cfg.password) opts.password = cfg.password;
      conn.connect(opts);
    } catch (e) { fail(e); }
  });
  pool.set(key, entry);
  return entry.sftpPromise;
}

const sftpCall = (sftp, method, ...args) => new Promise((res, rej) =>
  sftp[method](...args, (err, data) => err ? rej(err) : res(data)));

function closeAll() {
  for (const { conn } of pool.values()) { try { conn && conn.end(); } catch { /* ignore */ } }
  pool.clear();
}

// ---- VFS ops (target-aware: local fs or remote sftp) -----------------------
async function vfsList(target) {
  if (target.kind === 'ssh') {
    const sftp = await getSftp(target.cfg);
    const list = await sftpCall(sftp, 'readdir', target.rpath);
    // longname[0] === 'd' marks a directory; fall back to attrs.mode.
    return list.map((e) => ({ name: e.filename, isDir: (e.longname || '')[0] === 'd' || ((e.attrs.mode & 0o170000) === 0o040000) }));
  }
  const entries = await fsp.readdir(target.abs, { withFileTypes: true });
  return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
}

async function vfsReadBuffer(target) {
  if (target.kind === 'ssh') { const sftp = await getSftp(target.cfg); return await sftpCall(sftp, 'readFile', target.rpath); }
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
      nodes.push({ name: displayName, path: nodePath, type: 'directory', isLink: true, linkType, ...(linkError ? { linkError } : {}), ...(lazy ? { lazy: true } : {}), children });
      continue;
    }
    // Hide dotfiles (matches the local tree) except the app folders.
    if (e.name.startsWith('.') && e.name !== '.mdp' && e.name !== '.mdpignore') continue;
    if (e.isDir) {
      if (remote) {
        // Defer listing remote subdirectories until they're expanded.
        nodes.push({ name: e.name, path: nodePath, type: 'directory', lazy: true, children: [] });
      } else {
        const sub = depth < 12 ? await buildTree(baseDir, nodePath, depth + 1) : { nodes: [] };
        const node = { name: e.name, path: nodePath, type: 'directory', children: sub.nodes };
        // `.mdpignore` marker only meaningful on local dirs.
        if (isFileSync(path.join(target.abs, e.name, '.mdpignore'))) node.slideIgnored = true;
        nodes.push(node);
      }
    } else {
      nodes.push({ name: e.name, path: nodePath, type: 'file', isBinary: /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(e.name) });
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

module.exports = {
  resolve, resolveLinkFile, parseLink, buildTree, buildSubTree, closeAll,
  vfsList, vfsReadText, vfsReadBuffer, vfsWrite, vfsRemove, vfsRename, vfsMkdirp,
  vfsStat, vfsExists, vfsCopy, childOf, posixJoin,
};
