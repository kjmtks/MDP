'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { attachRelay } = require('./remoteRelay.cjs');
const remoteFiles = require('./remoteFiles.cjs');
const mdplink = require('./mdplink.cjs');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.vtt': 'text/vtt',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac',
};

// A workspace file the presentation GRANTED to its live remote devices
// (remoteFiles.cjs) — nothing else of the workspace is served. Byte ranges: Safari
// (every iPhone / iPad browser) plays video / audio only from a server that
// answers them.
async function sendGranted(req, res, rel) {
  const target = remoteFiles.lookup(req, rel);
  if (!target) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(rel).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    // A workspace font carries a version token (?v=) that changes with the file.
    'Cache-Control': /^\.(woff2?|ttf|otf)$/.test(ext) && /[?&]v=/.test(req.url || '') ? 'public, max-age=31536000, immutable' : 'no-store',
  };
  const local = target.kind !== 'ssh' && target.abs;
  try {
    const { size } = await mdplink.vfsStat(target);
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (m && (m[1] || m[2])) {
      const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
      const end = Math.min(m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1, size - 1);
      if (!(start <= end) || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) });
      if (local) { fs.createReadStream(target.abs, { start, end }).on('error', () => res.destroy()).pipe(res); return; }
      res.end((await mdplink.vfsReadBuffer(target)).subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': String(size) });
    if (local) { fs.createReadStream(target.abs).on('error', () => res.destroy()).pipe(res); return; }
    res.end(await mdplink.vfsReadBuffer(target));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
}

function rankIp(ip) {
  if (ip.startsWith('192.168.137.')) return 0;
  if (ip.startsWith('192.168.')) return 1;
  if (ip.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  if (ip.startsWith('169.254.')) return 9;
  return 5;
}

function getIpCandidates() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        list.push({ name, address: addr.address });
      }
    }
  }
  list.sort((a, b) => rankIp(a.address) - rankIp(b.address));
  return list;
}

function sendFile(res, filePath, fallbackHtml) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (fallbackHtml) {
        fs.readFile(fallbackHtml, (e2, idx) => {
          if (e2) { res.writeHead(404); res.end('Not found'); }
          else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(idx); }
        });
      } else {
        res.writeHead(404); res.end('Not found');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}

let current = null;

function startRemoteServer({ distPath }) {
  if (current) return Promise.resolve(publicInfo());

  const indexHtml = path.join(distPath, 'index.html');

  const server = http.createServer((req, res) => {
    const rawPath = (req.url || '/').split('?')[0];
    // A live remote device: its presentation's session (a cookie of channel +
    // token), then the files that presentation granted.
    if (rawPath === '/api/remote/session') {
      const q = new URLSearchParams((req.url || '').split('?')[1] || '');
      const cookie = remoteFiles.sessionCookie(q.get('channel'), q.get('token'));
      res.writeHead(cookie ? 204 : 400, cookie ? { 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } : {});
      res.end();
      return;
    }
    if (rawPath.startsWith('/files/')) { sendGranted(req, res, rawPath.slice('/files/'.length)); return; }
    let pathname = '/';
    try { pathname = decodeURIComponent(rawPath); } catch { pathname = '/'; }
    if (pathname === '/') pathname = '/index.html';

    const resolved = path.normalize(path.join(distPath, pathname));
    if (!resolved.startsWith(distPath)) { res.writeHead(403); res.end('Forbidden'); return; }

    // Serve the file if it has an extension; otherwise treat as an SPA route -> index.html.
    if (path.extname(resolved)) sendFile(res, resolved, indexHtml);
    else sendFile(res, indexHtml, null);
  });

  const wss = new WebSocketServer({ server });
  attachRelay(wss);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      current = { server, wss, port: server.address().port };
      resolve(publicInfo());
    });
  });
}

function publicInfo() {
  if (!current) return null;
  return { port: current.port, ips: getIpCandidates() };
}

function getRemoteInfo() {
  return publicInfo();
}

function stopRemoteServer() {
  remoteFiles.revoke();
  if (!current) return;
  try { current.wss.close(); } catch { /* ignore */ }
  try { current.server.close(); } catch { /* ignore */ }
  current = null;
}

module.exports = { startRemoteServer, stopRemoteServer, getRemoteInfo, getIpCandidates };
