// Multi-user "spaces" engine for the MDP web server (opt-in).
//
// MDP itself knows NOTHING about any particular site's folder layout or
// permission policy. A deployment describes its layout in a JSON config
// (MDP_WEB_CONFIG=/path/to/mdp-web.config.json).
//
//   {
//     "userHeader": "x-preferred-username",   // set by the reverse proxy AFTER auth
//     "admins": ["alice"],                    // user names with the "admin" role
//     "groupsFile": "/data/groups.json",      // optional: {group:[user,...]} snapshot,
//                                             //   maintained by the deployment
//     "spaces": [
//       { "path": "",       "root": "/srv/personal/{user}/slides",
//         "read": ["owner","admin"], "write": ["owner","admin"], "create": "own" },
//       { "path": "@homes", "root": "/srv/homes/{user}/slides",
//         "read": ["all"], "write": ["owner","admin"], "create": "own" },
//       { "path": "@group", "root": "/srv/groups/{group}/slides",
//         "read": ["member"], "write": ["member"], "create": "own" }
//     ]
//   }
//
//   * `path` ""    -> the workspace root the user lands in (exactly one).
//   * `path` "@x"  -> a virtual folder at the root of the tree.
//   * `root` may contain ONE placeholder, as a whole path segment:
//       {user}  -> one sub-folder per member (discovered by listing).
//       {group} -> one sub-folder per group; the requester sees only groups
//                  they belong to (membership from `groupsFile`).
//     Without a placeholder it is a single shared folder.
//   * `read` / `write`: any of
//       "owner"  - the member whose {user} folder it is
//       "member" - a member of the {group} this folder belongs to
//       "admin", "all".
//     A space nobody may read is hidden.
//   * `create`: "own" (for {user}) / "group" (for {group}) creates the
//     requester's own instance on sight, only if its PARENT already exists.
//     MDP never fabricates user homes; their creation is a deployment concern.
//
//   "rootListing": "home+spaces" (default) | "spaces-only"
//     Where the requester's own files appear in the tree. By default the
//     root space is spread across the root, with the "@x" folders beside it.
//     With "spaces-only" the root holds ONLY the "@x" folders, so a file
//     named like a space cannot hide it -- useful when the same tree is also
//     mounted as a plain filesystem. The root space is still created and
//     still resolves, so reach it through an "@x" space that shares its
//     `root` (give that space "owner" in `read`/`write`).
//
// Everything resolves to PLAIN local paths -- `.mdplink` indirection is
// deliberately not honoured in shared mode.

const fs = require('fs');
const path = require('path');

const SAFE_USER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_GROUP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_SPACE = /^@[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// A space whose `path` is exactly this expands into ONE TOP-LEVEL folder
// per group the requester belongs to: '@<group>'. (vs a static '@name'.)
const GROUP_ROOT = '@{group}';
// The app-managed content-profile folder. Must match MDP_DIR in
// src/features/workspace/specialFolders.ts.
const MDP_DIR = '.mdp';

const placeholderOf = (root) => {
  const r = String(root || '');
  if (r.includes('{user}')) return 'user';
  if (r.includes('{group}')) return 'group';
  return null;
};

function load(configPath) {
  if (!configPath) return null;
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const spaces = Array.isArray(raw.spaces) ? raw.spaces : [];
  const home = spaces.filter((s) => (s.path || '') === '');
  if (home.length !== 1) throw new Error('mdp-web.config: exactly one space with "path": "" is required');
  for (const s of spaces) {
    if (s.path && s.path !== GROUP_ROOT && !SAFE_SPACE.test(s.path)) throw new Error(`mdp-web.config: space path must look like "@name" or "@{group}": ${s.path}`);
    if (s.path === GROUP_ROOT && placeholderOf(s.root) !== 'group') throw new Error('mdp-web.config: a "@{group}" space needs {group} in its root');
    const marks = (String(s.root).match(/\{user\}|\{group\}/g) || []).length;
    if (marks > 1) throw new Error(`mdp-web.config: at most one placeholder per root: ${s.root}`);
    if (!s.root) throw new Error('mdp-web.config: every space needs a root');
    if (s.path === '' && placeholderOf(s.root) !== 'user') throw new Error('mdp-web.config: the root space needs {user} in its root');
  }
  const rootListing = String(raw.rootListing || 'home+spaces');
  if (rootListing !== 'home+spaces' && rootListing !== 'spaces-only') {
    throw new Error(`mdp-web.config: rootListing must be "home+spaces" or "spaces-only": ${rootListing}`);
  }
  return {
    userHeader: String(raw.userHeader || 'x-preferred-username').toLowerCase(),
    admins: new Set(Array.isArray(raw.admins) ? raw.admins : []),
    groupsFile: String(raw.groupsFile || ''),
    rootListing,
    spaces,
    home: home[0],
  };
}

function userOf(cfg, req) {
  const u = String(req.headers[cfg.userHeader] || '');
  return SAFE_USER.test(u) ? u : null;
}
const isAdmin = (cfg, req) => { const u = userOf(cfg, req); return !!u && cfg.admins.has(u); };
// The requester's groups: injected by the server (from groupsFile) as
// req.mdpGroups. Empty when unknown -> no group spaces are visible.
const groupsOf = (req) => (Array.isArray(req.mdpGroups) ? req.mdpGroups : []);

// --- rules ---------------------------------------------------------------
// `key` is the member (for {user}) or group (for {group}); `kind` its type.
const allows = (cfg, req, rule, kind, key) => (rule || []).some((r) =>
  r === 'all'
  || (r === 'admin' && isAdmin(cfg, req))
  || (r === 'owner' && kind === 'user' && key && key === userOf(cfg, req))
  || (r === 'member' && kind === 'group' && key && groupsOf(req).includes(key)));

// --- paths ---------------------------------------------------------------
const instanceDir = (space, key) => {
  const kind = placeholderOf(space.root);
  if (!kind) return space.root;
  return space.root.replace(kind === 'user' ? '{user}' : '{group}', key);
};

// --- locate --------------------------------------------------------------
// Split a workspace-relative path into { space, kind, key, abs }. `key` is the
// member/group; null for shared spaces. Returns null when it cannot serve it.
function locate(cfg, req, rel) {
  const safe = String(rel || '').replace(/\.\./g, '');
  const segs = safe.split('/').filter(Boolean);
  const seg0 = segs.length ? segs[0] : '';
  let named = seg0 && cfg.spaces.find((s) => s.path === seg0);
  // A dynamic group root '@<group>' (no static match, but a "@{group}" space
  // exists): route it to that space with key = <group>.
  if (!named && seg0.startsWith('@')) {
    const gr = cfg.spaces.find((s) => s.path === GROUP_ROOT);
    if (gr) {
      const g = seg0.slice(1);
      if (!SAFE_GROUP.test(g)) return null;
      const rest = segs.slice(1);
      return { space: gr, kind: 'group', key: g, dir: rest.length === 0,
               abs: path.join(instanceDir(gr, g), ...rest) };
    }
  }
  const space = named || cfg.home;
  const inSegs = named ? segs.slice(1) : segs;
  const kind = placeholderOf(space.root);
  let key = null;
  let rest = inSegs;
  if (kind === 'user') {
    if (named) {
      if (!inSegs.length) return { space, kind, key: null, dir: true, abs: null };
      key = inSegs[0];
      if (!SAFE_USER.test(key)) return null;
      rest = inSegs.slice(1);
    } else {
      key = userOf(cfg, req);
      if (!key) return null;
    }
  } else if (kind === 'group') {
    if (!inSegs.length) return { space, kind, key: null, dir: true, abs: null };
    key = inSegs[0];
    if (!SAFE_GROUP.test(key)) return null;
    rest = inSegs.slice(1);
  }
  return { space, kind, key, abs: path.join(instanceDir(space, key || ''), ...rest) };
}

const canRead = (cfg, req, loc) => !!loc && allows(cfg, req, loc.space.read, loc.kind, loc.key);
const canWrite = (cfg, req, loc) => !!loc && !loc.dir && allows(cfg, req, loc.space.write, loc.kind, loc.key);

// The requester's own instances in `create` spaces, made on sight (never the
// parent -- user homes / the groups root are the deployment's business).
function ensureOwn(cfg, req) {
  const me = userOf(cfg, req);
  if (!me) return;
  for (const space of cfg.spaces) {
    const kind = placeholderOf(space.root);
    if (kind === 'user' && space.create === 'own') {
      // A {user} home is managed elsewhere -- only create the slides subdir if
      // the home already exists.
      mk(instanceDir(space, me));
    } else if (kind === 'group' && space.create === 'group') {
      // A {group} folder is MDP-managed (no external owner), so create it in
      // full for each group the requester belongs to.
      for (const g of groupsOf(req)) { try { fs.mkdirSync(instanceDir(space, g), { recursive: true }); } catch { /* ignore */ } }
    }
  }
}
function mk(dir) {
  if (fs.existsSync(dir)) return;
  if (!fs.existsSync(path.dirname(dir))) return;
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}

// --- tree ----------------------------------------------------------------
const reprefix = (nodes, prefix) => nodes.map((n) => ({
  ...n,
  path: `${prefix}/${n.path}`,
  ...(n.children ? { children: reprefix(n.children, prefix) } : {}),
}));

// The root space's `.mdp/` alone, as a top-level node with its subtree (or
// nothing when there isn't one). See the note in tree().
function mdpOnly(dir, walk) {
  const abs = path.join(dir, MDP_DIR);
  try { if (!fs.statSync(abs).isDirectory()) return []; } catch { return []; }
  return [{ name: MDP_DIR, path: MDP_DIR, type: 'directory', slideIgnored: true,
            children: reprefix(walk(abs), MDP_DIR) }];
}

function tree(cfg, req, walk) {
  ensureOwn(cfg, req);
  const me = userOf(cfg, req);
  // "spaces-only" hides the root space's FILES (a file named "@homes" would
  // otherwise hide that space). Its `.mdp/` is NOT content, though: it is the
  // workspace's content profile (modules / themes / effects / templates), and
  // the client finds it by walking the TREE from the root down
  // (src/features/workspace/mdpScope.ts). Hiding it left every deck under
  // "@homes/…", "@groups/…" and "@projects/…" with no modules, themes or
  // effects at all, while the official assets sat downloaded in the root space
  // — "ダウンロードしたはずなのに存在しない" (2026-09-24 先生). A dot folder
  // cannot collide with an "@x" space name, so listing just this one does not
  // bring the hiding problem back.
  const out = cfg.rootListing === 'spaces-only'
    ? mdpOnly(instanceDir(cfg.home, me), walk) : walk(instanceDir(cfg.home, me));
  for (const space of cfg.spaces) {
    if (!space.path) continue;
    // Group-root template: one TOP-LEVEL '@<group>' per group of the user.
    if (space.path === GROUP_ROOT) {
      for (const g of groupsOf(req)) {
        if (!allows(cfg, req, space.read, 'group', g)) continue;
        const dir = instanceDir(space, g);
        let st; try { st = fs.statSync(dir); } catch { continue; }
        if (!st.isDirectory()) continue;
        out.push({ name: '@' + g, path: '@' + g, type: 'directory', slideIgnored: true,
                   children: reprefix(walk(dir), '@' + g) });
      }
      continue;
    }
    const kind = placeholderOf(space.root);
    if (!kind) {
      if (!allows(cfg, req, space.read, null, null)) continue;
      out.push({ name: space.path, path: space.path, type: 'directory', slideIgnored: true,
                 children: reprefix(walk(space.root), space.path) });
      continue;
    }
    // Per-{user}: list existing member folders the requester may read.
    // Per-{group}: iterate only the requester's OWN groups.
    const keys = kind === 'user' ? membersOf(space) : groupsOf(req);
    const kids = [];
    for (const key of keys) {
      if (!allows(cfg, req, space.read, kind, key)) continue;
      const dir = instanceDir(space, key);
      let st; try { st = fs.statSync(dir); } catch { continue; }
      if (!st.isDirectory()) continue;
      kids.push({ name: key, path: `${space.path}/${key}`, type: 'directory',
                  children: reprefix(walk(dir), `${space.path}/${key}`) });
    }
    if (kids.length) {
      out.push({ name: space.path, path: space.path, type: 'directory', slideIgnored: true, children: kids });
    }
  }
  return out;
}
const membersOf = (space) => {
  const [pre] = String(space.root).split('{user}');
  let names;
  try { names = fs.readdirSync(pre); } catch { return []; }
  return names.filter((n) => SAFE_USER.test(n) && !n.startsWith('@') && !n.startsWith('.')).sort();
};

module.exports = { load, userOf, isAdmin, groupsOf, locate, canRead, canWrite, ensureOwn, tree, instanceDir };
