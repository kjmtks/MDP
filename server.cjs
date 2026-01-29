const express = require('express');
const path = require('path');
const fs = require('fs');
const { WebSocketServer, WebSocket } = require('ws'); 
const chokidar = require('chokidar');
const { spawn } = require('child_process');
const plantumlEncoder = require('plantuml-encoder');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('.');

if (!fs.existsSync(targetDir)) {
  console.error(`Error: Directory not found: ${targetDir}`);
  process.exit(1);
}

app.use(express.json({ limit: '10mb' }));
app.use('/files', express.static(targetDir));
app.use('/drawio', express.static(path.join(__dirname, 'drawio')));
app.use(express.static(path.join(__dirname, 'dist')));

app.get('/api/server-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  if (addresses.length === 0) {
    addresses.push('localhost');
  }
  res.json({
    ips: addresses,
    port: PORT,
    hostname: os.hostname()
  });
});

app.get('/plantuml/svg/:encoded', (req, res) => {
  const encoded = req.params.encoded;
  let decoded;
  try { decoded = plantumlEncoder.decode(encoded); } catch (e) { return res.status(400).send('<svg><text>Invalid Code</text></svg>'); }
  
  const plantumlJar = path.join(__dirname, 'plantuml', 'plantuml.jar');
  if (!fs.existsSync(plantumlJar)) return res.status(500).send('<svg><text y="20" fill="red">plantuml.jar not found</text></svg>');

  const child = spawn('java', ['-jar', plantumlJar, '-tsvg', '-pipe']);
  let stdoutData = '';
  child.stdout.on('data', d => { stdoutData += d.toString(); });
  child.on('close', c => {
    if (c === 0) { res.set('Content-Type', 'image/svg+xml'); res.send(stdoutData); }
    else { res.status(500).send('<svg><text fill="red">Error</text></svg>'); }
  });
  child.stdin.write(decoded);
  child.stdin.end();
});

const getFileTree = (dir, relativePath = '') => {
  const results = [];
  try {
    const list = fs.readdirSync(dir, { withFileTypes: true });
    list.forEach(dirent => {
      if (dirent.name.startsWith('.') || dirent.name === 'node_modules') return;
      const myPath = path.join(relativePath, dirent.name);
      if (dirent.isDirectory()) {
        results.push({ name: dirent.name, path: myPath.replace(/\\/g, '/'), type: 'directory', children: getFileTree(path.join(dir, dirent.name), myPath.replace(/\\/g, '/')) });
      } else {
        results.push({ name: dirent.name, path: myPath.replace(/\\/g, '/'), type: 'file', isBinary: false });
      }
    });
  } catch (err) {}
  return results.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
};

app.get('/api/files', (req, res) => res.json(getFileTree(targetDir)));

app.post('/api/save', (req, res) => {
  const { filename, content } = req.body;
  if (!filename) return res.status(400).json({ error: 'Filename is required' });
  const safeFilename = path.normalize(filename).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(targetDir, safeFilename);
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Saved: ${filePath}`);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

app.post('/api/create', (req, res) => {
  const { path: relativePath, type } = req.body;
  if (!relativePath || !type) return res.status(400).json({ error: 'Path and type are required' });
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(targetDir, safePath);
  try {
    if (type === 'directory') {
      if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
    } else {
      if (fs.existsSync(fullPath)) return res.status(400).json({ error: 'File already exists' });
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(fullPath, '# New Slide\n\n- Write your content here.', 'utf8');
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/config/shortcuts', (req, res) => {
    const p = path.join(__dirname, 'shortcuts.json');
    if (fs.existsSync(p)) res.sendFile(p); else res.json([]);
});

app.get('/api/config/template', (req, res) => {
    const p = path.join(__dirname, 'template.md');
    if (fs.existsSync(p)) res.sendFile(p); else res.send('');
});

app.get(/.*/, (req, res) => {
  const indexHtml = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
  else res.send('React app is not built.');
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// --- WebSocket ---
const wss = new WebSocketServer({ server });

const watcher = chokidar.watch(targetDir, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true });
watcher.on('all', () => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send('file-change');
  });
});

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'BROADCAST') {
        wss.clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg.payload));
          }
        });
      }
    } catch {
      // ignore
    }
  });
});