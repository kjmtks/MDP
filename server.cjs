const express = require('express');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const { spawn } = require('child_process');
const plantumlEncoder = require('plantuml-encoder');

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

app.get('/plantuml/svg/:encoded', (req, res) => {
  const encoded = req.params.encoded;
  let decoded;
  
  try {
    decoded = plantumlEncoder.decode(encoded);
  } catch (e) {
    return res.status(400).send('<svg><text>Invalid PlantUML Code</text></svg>');
  }

  const plantumlJar = path.join(__dirname, 'plantuml', 'plantuml.jar');
  
  if (!fs.existsSync(plantumlJar)) {
    return res.status(500).send('<svg><text y="20" fill="red">Error: plantuml.jar not found on server.</text></svg>');
  }

  const child = spawn('java', ['-jar', plantumlJar, '-tsvg', '-pipe']);
  
  let stdoutData = '';
  let stderrData = '';

  child.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  child.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  child.on('error', (err) => {
    console.error('Failed to start Java:', err);
    res.status(500).send(`<svg><text y="20" fill="red">Error: Failed to execute Java. Is Java installed?</text></svg>`);
  });

  child.on('close', (code) => {
    if (code === 0) {
      res.set('Content-Type', 'image/svg+xml');
      res.send(stdoutData);
    } else {
      console.error('PlantUML Error:', stderrData);
      res.status(500).send(`<svg><text y="20" fill="red">PlantUML Error (Exit code ${code})</text><text y="40" fill="gray">${stderrData}</text></svg>`);
    }
  });

  child.stdin.write(decoded);
  child.stdin.end();
});

const isBinaryFile = (filePath) => {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  } catch (err) {
    return false;
  }
};

app.get('/api/config/template', (req, res) => {
  const templatePath = path.join(__dirname, 'template.md');
  if (fs.existsSync(templatePath)) {
    try {
      const content = fs.readFileSync(templatePath, 'utf8');
      res.send(content);
    } catch (e) {
      res.status(500).send('Error reading template.md');
    }
  } else {
    res.send("# New Slide\n\nContent...");
  }
});

app.get('/api/config/snipets', (req, res) => {
  const snipetsPath = path.join(__dirname, 'snipets.json');
  if (fs.existsSync(snipetsPath)) {
    try {
      const content = fs.readFileSync(snipetsPath, 'utf8');
      res.header('Content-Type', 'application/json');
      res.send(content);
    } catch (e) {
      res.status(500).json({ error: 'Error reading snipets.json' });
    }
  } else {
    res.json([]);
  }
});

const getFileTree = (dir, relativePath = '') => {
  const results = [];
  try {
    const list = fs.readdirSync(dir, { withFileTypes: true });
    
    list.forEach(dirent => {
      if (dirent.name.startsWith('.') || dirent.name === 'node_modules') return;

      const myPath = path.join(relativePath, dirent.name);
      
      if (dirent.isDirectory()) {
        results.push({
          name: dirent.name,
          path: myPath.replace(/\\/g, '/'),
          type: 'directory',
          children: getFileTree(path.join(dir, dirent.name), myPath.replace(/\\/g, '/'))
        });
      } else {
        const fullPath = path.join(dir, dirent.name);
        const isBinary = isBinaryFile(fullPath);
        results.push({
          name: dirent.name,
          path: myPath.replace(/\\/g, '/'),
          type: 'file',
          isBinary: isBinary
        });
      }
    });
  } catch (err) {
    console.error("Error scanning directory:", err);
  }
  return results.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === 'directory' ? -1 : 1;
  });
};

app.get('/api/files', (req, res) => {
  const tree = getFileTree(targetDir);
  res.json(tree);
});

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
  if (!relativePath || !type) {
    return res.status(400).json({ error: 'Path and type are required' });
  }
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(targetDir, safePath);
  try {
    if (type === 'directory') {
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    } else {
      if (fs.existsSync(fullPath)) {
        return res.status(400).json({ error: 'File already exists' });
      }
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      const initialContent = `# New Slide\n\n- Write your content here.`;
      fs.writeFileSync(fullPath, initialContent, 'utf8');
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get(/.*/, (req, res) => {
  const indexHtml = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.send('React app is not built. Please run "npm run build".');
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`--------------------------------------------------`);
  console.log(` Hosting directory: ${targetDir}`);
  console.log(` Server running at: http://localhost:${PORT}`);
  console.log(`--------------------------------------------------`);
});

const wss = new WebSocketServer({ server });
const broadcast = (message) => {
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(message);
  });
};

const watcher = chokidar.watch(targetDir, {
  ignored: /(^|[\/\\])\../,
  persistent: true,
  ignoreInitial: true,
  usePolling: true,
  interval: 2000,
});

let debounceTimer;
const notifyClients = () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    console.log("* File change detected");
    broadcast('file-change');
  }, 300);
};

watcher
  .on('add', notifyClients)
  .on('change', notifyClients)
  .on('unlink', notifyClients)
  .on('addDir', notifyClients)
  .on('unlinkDir', notifyClients);