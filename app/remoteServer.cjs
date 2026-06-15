'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { attachRelay } = require('./remoteRelay.cjs');

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
  '.map': 'application/json',
};

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
    let pathname = '/';
    try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); } catch { pathname = '/'; }
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
  if (!current) return;
  try { current.wss.close(); } catch { /* ignore */ }
  try { current.server.close(); } catch { /* ignore */ }
  current = null;
}

module.exports = { startRemoteServer, stopRemoteServer, getRemoteInfo, getIpCandidates };
