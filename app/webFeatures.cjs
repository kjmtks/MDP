// Feature switches of the MDP web server: what the site's administrator allows,
// and to whom. Shared (multi-user) mode keeps them in the deployment config
// (MDP_WEB_CONFIG — the same JSON as the spaces, see webspaces.cjs), re-read
// whenever that file changes, so an admin — or the site's portal writing the
// file — flips one without restarting MDP. Single-user mode takes them from
// config.cjs or the environment.
//
//   "videoExport": false                          — nobody (the shared default)
//   "videoExport": true                           — every signed-in user
//   "videoExport": ["admin", "group:lab", "alice"] — admins, members of a group
//                                                    (groupsFile), named users
//   "videoExportMaxMB": 4096                      — the largest file one export
//                                                    may write (default 4096)
//
// Single-user: config.cjs `videoExport` / `videoExportMaxMB`, or the environment
// MDP_VIDEO_EXPORT=0|1 and MDP_VIDEO_EXPORT_MAX_MB; video export is ON by default
// there (the one user is the administrator).

const fs = require('fs');

const DEFAULT_MAX_MB = 4096;
const falsy = (v) => /^(0|false|no|off)$/i.test(String(v));

function create({ configFile, webspaces, spaces, single }) {
  let cache = { mtime: -1, raw: {} };
  // The deployment config as it is NOW (cached until its mtime changes). An
  // unreadable or half-written file keeps the last good copy.
  const raw = () => {
    if (!configFile) return {};
    try {
      const st = fs.statSync(configFile);
      if (st.mtimeMs !== cache.mtime) {
        cache = { mtime: st.mtimeMs, raw: JSON.parse(fs.readFileSync(configFile, 'utf8')) || {} };
      }
    } catch { /* keep the last good copy */ }
    return cache.raw;
  };

  // Does `rule` (false | true | [audience…]) admit this request's user?
  const admits = (rule, req) => {
    if (rule === true) return true;
    if (!Array.isArray(rule)) return false;
    const user = webspaces.userOf(spaces, req);
    if (!user) return false;
    const groups = webspaces.groupsOf(req);
    return rule.some((r) => {
      const s = String(r);
      if (s === 'all') return true;
      if (s === 'admin') return webspaces.isAdmin(spaces, req);
      if (s.startsWith('group:')) return groups.includes(s.slice(6));
      return s === user;
    });
  };

  /** May this request's user use `feature`? */
  function allowed(req, feature) {
    if (feature !== 'videoExport') return false;
    if (spaces) return admits(raw().videoExport, req);
    const env = process.env.MDP_VIDEO_EXPORT;
    if (env !== undefined && env !== '') return !falsy(env);
    return single && single.videoExport !== undefined ? !!single.videoExport : true;
  }

  /** The limits that go with the switches. */
  function limits() {
    const mb = Number(spaces ? raw().videoExportMaxMB
      : (process.env.MDP_VIDEO_EXPORT_MAX_MB || (single && single.videoExportMaxMB)));
    return { videoMaxBytes: (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_MB) * 1024 * 1024 };
  }

  return { allowed, limits };
}

module.exports = { create };
