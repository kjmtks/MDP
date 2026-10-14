'use strict';

// Files a LIVE remote device may read (the remote that renders the deck itself —
// src/features/remote/liveRemote.ts): exactly the ones the deck being presented
// needs, listed by the host (a GRANT per channel), and only by a device that holds
// that presentation's channel + token (the QR code) — in a cookie, so an <img> or a
// font request carries it. Shared by the desktop app's remote server and the web
// server: nothing else of the workspace is ever served to a device.
const COOKIE = 'mdp_remote';
const MAX_FILES = 4000;
const TTL_MS = 12 * 60 * 60 * 1000;

const grants = new Map();   // channel → { token, files: Map(rel → target), at }

/** A workspace path as one key: decoded, '/'-separated, no leading slash, no
 *  `.` / `..` segments (a `..` that would leave the root makes it unusable). */
function normRel(p) {
  let s = String(p || '');
  try { s = decodeURIComponent(s); } catch { /* keep */ }
  const out = [];
  for (const seg of s.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return ''; out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
}

const validId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s);

/** The host's list for its channel: `[{ rel, target }]` (target = the VFS target
 *  resolved by the HOST, with the host's own rights). Replaces an earlier list. */
function grant(channel, token, entries) {
  if (!validId(channel) || !validId(token)) return 0;
  const files = new Map();
  for (const e of entries || []) {
    const rel = normRel(e && e.rel);
    if (rel && e.target && files.size < MAX_FILES) files.set(rel, e.target);
  }
  grants.set(channel, { token, files, at: Date.now() });
  return files.size;
}

function revoke(channel) { if (channel) grants.delete(channel); else grants.clear(); }

function cookiesOf(req) {
  const out = {};
  for (const part of String((req.headers && req.headers.cookie) || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** The Set-Cookie for a device of this presentation (checked on every read). */
function sessionCookie(channel, token, basePath = '/') {
  if (!validId(channel) || !validId(token)) return '';
  return `${COOKIE}=${encodeURIComponent(`${channel}.${token}`)}; Path=${basePath || '/'}; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`;
}

/** The target a request may read at workspace path `rel`, or null. */
function lookup(req, rel) {
  let v = cookiesOf(req)[COOKIE];
  if (!v) return null;
  try { v = decodeURIComponent(v); } catch { return null; }
  const dot = v.indexOf('.');
  if (dot < 1) return null;
  const channel = v.slice(0, dot);
  const token = v.slice(dot + 1);
  const g = grants.get(channel);
  if (!g || g.token !== token) return null;
  if (Date.now() - g.at > TTL_MS) { grants.delete(channel); return null; }
  return g.files.get(normRel(rel)) || null;
}

module.exports = { grant, revoke, lookup, sessionCookie, normRel, COOKIE };
