const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const chokidar = require('chokidar');
const plantumlEncoder = require('plantuml-encoder');
const { spawn } = require('child_process');
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

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

if (!fs.existsSync(rootDir)) {
  console.log(`Creating directory: ${rootDir}`);
  fs.mkdirSync(rootDir, { recursive: true });
}

const getSafePath = (targetPath) => {
  const safePath = (targetPath || '').replace(/\.\./g, '');
  return path.join(rootDir, safePath);
};

const getFileTree = (dir, baseDir = dir) => {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
      
      if (stat && stat.isDirectory()) {
        results.push({
          name: file,
          path: relativePath,
          type: 'directory',
          children: getFileTree(filePath, baseDir)
        });
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
  res.json({ ips: addresses, port: PORT, hostname: os.hostname(), mode: 'local' });
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

app.get('/api/files', (req, res) => {
  res.json(getFileTree(rootDir));
});

app.post('/api/save', (req, res) => {
  const p = path.join(rootDir, req.body.filename);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let content = req.body.content;  
  if (typeof content === 'string' && content.startsWith('data:image/')) {
    const base64Data = content.split(',')[1];
    if (base64Data) {
      content = Buffer.from(base64Data, 'base64');
    }
  } 
  else if (req.body.isBase64) {
    content = Buffer.from(content, 'base64');
  }
  fs.writeFile(p, content, (err) => res.json({ success: !err }));
});

app.post('/api/rename', (req, res) => {
  const { oldPath, newPath } = req.body;
  try {
    fs.renameSync(path.join(rootDir, oldPath), path.join(rootDir, newPath));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/delete', (req, res) => {
  const { paths } = req.body;
  try {
    paths.forEach(p => {
      const fullP = path.join(rootDir, p);
      if (fs.existsSync(fullP)) fs.rmSync(fullP, { recursive: true, force: true });
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/move', (req, res) => {
  const { sourcePaths, targetPath } = req.body;
  const targetDir = path.join(rootDir, targetPath);
  try {
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    sourcePaths.forEach(p => {
      const fullP = path.join(rootDir, p);
      const fileName = path.basename(fullP);
      fs.renameSync(fullP, path.join(targetDir, fileName));
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/create', (req, res) => {
  const { path: createPath, type } = req.body;
  const physicalPath = getSafePath(createPath);

  try {
      if (type === 'directory') {
          if (!fs.existsSync(physicalPath)) fs.mkdirSync(physicalPath, { recursive: true });
      } else {
          const dir = path.dirname(physicalPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(physicalPath, '');
      }
      res.json({ success: true });
  } catch (e) {
      res.status(500).json({ error: e.message });
  }
});

app.get('/files/*path', (req, res) => {
  let virtualPath = req.params.path || req.params[0];
  if (Array.isArray(virtualPath)) virtualPath = virtualPath.join('/');
  if (!virtualPath) return res.status(400).send('Path required');
  try {
    virtualPath = decodeURIComponent(virtualPath);
  } catch (e) {
  }
  const p = path.join(rootDir, virtualPath.replace(/\.\./g, ''));

  if (fs.existsSync(p)) {
    if (fs.statSync(p).isDirectory()) {
      return res.status(403).send('Is a directory');
    }
    res.sendFile(path.resolve(p), { dotfiles: 'allow' }, (err) => {
      if (err) {
        console.error(`sendFile error (${p}):`, err.message);
        if (!res.headersSent) res.status(404).end();
      }
    });
  } else {
    res.status(404).send('Not found');
  }
});

const targetDir = rootDir;

const publicDir = process.env.NODE_ENV === 'development' 
  ? path.join(process.cwd(), 'public') 
  : path.join(__dirname, 'dist');

const safeParseJSON = (str) => JSON.parse(str.replace(/^\uFEFF/, ''));

app.get('/api/snippets', async (req, res) => {
  let snippets = [];
  try {
    const data = await fs.promises.readFile(path.join(publicDir, 'default-snippets.json'), 'utf-8');
    snippets = safeParseJSON(data);
  } catch (e) {
    console.error('Default snippets error:', e.message);
  }

  const customDir = path.join(targetDir, '.mdp', 'snippets');
  if (fs.existsSync(customDir)) {
    try {
      const files = await fs.promises.readdir(customDir);
      for (const file of files.filter(f => f.toLowerCase().endsWith('.json'))) {
        try {
          const data = await fs.promises.readFile(path.join(customDir, file), 'utf-8');
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
    } catch (dirErr) { console.error('Error reading .snippets:', dirErr.message); }
  }
  res.json(snippets);
});

app.get('/api/templates', async (req, res) => {
  let templates = [];
  const customDir = path.join(targetDir, '.mdp', 'templates');
  if (fs.existsSync(customDir)) {
    try {
      const files = await fs.promises.readdir(customDir);
      templates.push(...files.filter(f => f.endsWith('.md')).map(f => ({
        name: f, path: `.mdp/templates/${f}`, isCustom: true
      })));
    } catch (e) { console.error(e); }
  }

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
       const absolutePath = templatePath.startsWith('.mdp/')
          ? path.join(targetDir, templatePath)
          : path.join(publicDir, templatePath);
       if (fs.existsSync(absolutePath)) {
         return res.send(await fs.promises.readFile(absolutePath, 'utf-8'));
       }
    }
  } catch(e) { console.error(e); }
  res.send("# New Slide\n\nContent...");
});

app.get('/api/themes', async (req, res) => {
  let themes = [];
  const customDir = path.join(targetDir, '.mdp', 'themes');
  if (fs.existsSync(customDir)) {
    try {
      const files = await fs.promises.readdir(customDir);
      themes = files.filter(f => f.endsWith('.css')).map(f => ({
        name: f.replace('.css', ''), fileName: f, path: `.mdp/themes/${f}`, isCustom: true
      }));
    } catch (e) {}
  }

  const defaultDir = path.join(publicDir, 'themes');
  if (fs.existsSync(defaultDir)) {
    try {
      const files = await fs.promises.readdir(defaultDir);
      const defaultThemes = files.filter(f => f.endsWith('.css')).map(f => ({
        name: f.replace('.css', ''), fileName: f, path: `themes/${f}`, isCustom: false
      }));
      themes = [...themes, ...defaultThemes];
    } catch (e) {}
  }
  res.json(themes);
});

app.get('/api/modules', async (req, res) => {
  let modules = [];
  const customDir = path.join(targetDir, '.mdp', 'modules');
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
       const absolutePath = modulePath.startsWith('.mdp/')
          ? path.join(targetDir, modulePath)
          : path.join(publicDir, modulePath);

       if (fs.existsSync(absolutePath)) {
         return res.send(await fs.promises.readFile(absolutePath, 'utf-8'));
       }
    }
  } catch(e) { console.error(e); }
  res.send("");
});

app.get('/api/effects', async (req, res) => {
  let effects = [];
  const customDir = path.join(targetDir, '.mdp', 'effects');
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
       const absolutePath = effectPath.startsWith('.mdp/')
          ? path.join(targetDir, effectPath)
          : path.join(publicDir, effectPath);

       if (fs.existsSync(absolutePath)) {
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

const watcher = chokidar.watch(rootDir, { ignored: /(^|[\/\\])\../, persistent: true, ignoreInitial: true });
watcher.on('all', () => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send('file-change');
  });
});

const { attachRelay } = require('./app/remoteRelay.cjs');
attachRelay(wss);