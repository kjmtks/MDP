// MDP MCP control bridge — a token-authenticated HTTP server on 127.0.0.1 that the
// stdio MCP proxy (app/mcp-server.cjs, launched by Claude Desktop) forwards tool
// calls to. File tools run here against the VFS (mdplink — so `.mdplink` local/SSH
// targets work); live tools are relayed to the renderer over IPC. Opt-in from
// Settings → MCP; while running, {port, token} is handshaked via
// ~/.mdp/mcp-bridge.json (deleted on stop/quit).

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const mdplink = require('./mdplink.cjs');

let ctx = null;         // { getBaseDir, getWindow, getAssetPath }
let server = null;
let token = null;
let port = 0;

const handshakeFile = () => path.join(os.homedir(), '.mdp', 'mcp-bridge.json');

// ---- renderer relay ----------------------------------------------------------
const pending = new Map();
let seq = 0;

function relay(method, params, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const win = ctx.getWindow();
    if (!win || win.isDestroyed()) return reject(new Error('The MDP editor window is not available.'));
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The MDP editor did not respond in time.'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    win.webContents.send('mcp-request', { id, method, params });
  });
}

function handleRendererResponse(payload) {
  const p = pending.get(payload && payload.id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(payload.id);
  if (payload.ok) p.resolve(payload.result);
  else p.reject(new Error(payload.error || 'editor error'));
}

// ---- helpers -----------------------------------------------------------------

const requireDeckPath = (p) => {
  if (!p || typeof p !== 'string') throw new Error('A workspace-relative "path" is required.');
  if (p.includes('..')) throw new Error('Path must not contain "..".');
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
};

// Track an unterminated HTML comment across lines (see the frontend parser): a
// multi-line `<!-- @note: … -->` may contain a bare `---`, which must NOT split.
function advanceComment(line, inComment) {
  let i = 0;
  while (i < line.length) {
    if (!inComment) {
      const open = line.indexOf('<!--', i);
      if (open === -1) break;
      inComment = true; i = open + 4;
    } else {
      const close = line.indexOf('-->', i);
      if (close === -1) return true;
      inComment = false; i = close + 3;
    }
  }
  return inComment;
}

// Fence- AND comment-aware split on `---` lines — mirrors the frontend slide parser
// (splitMarkdownToBlocks). blocks[0] is the meta page; blocks[1..] are the slides.
function splitBlocks(md) {
  const lines = String(md).split(/\r?\n/);
  const blocks = [];
  let cur = [];
  let inCode = false;
  let inComment = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) inCode = !inCode;
    const sep = !inCode && !inComment && /^---$/.test(line.trim());
    if (!inCode) inComment = advanceComment(line, inComment);
    if (sep) { blocks.push(cur.join('\n')); cur = []; }
    else cur.push(line);
  }
  blocks.push(cur.join('\n'));
  return blocks;
}
const joinBlocks = (blocks) => blocks.join('\n---\n');

// `.mdp` cascade chain for a deck (root→nearest), same rule as the frontend
// resolver: ancestor dirs (bounded by the workspace root) that contain `.mdp`.
async function mdpChainDirs(baseDir, deckPath) {
  const tree = (await mdplink.buildTree(baseDir)).nodes || [];
  const childrenAt = (dir) => {
    if (!dir) return tree;
    let nodes = tree;
    for (const seg of dir.split('/')) {
      const f = nodes.find((n) => n.type === 'directory' && n.name === seg);
      if (!f || !f.children) return null;
      nodes = f.children;
    }
    return nodes;
  };
  const segs = (deckPath || '').split('/').filter(Boolean);
  segs.pop();
  const dirs = [''];
  let cur = '';
  for (const s of segs) { cur = cur ? `${cur}/${s}` : s; dirs.push(cur); }
  const chain = dirs.filter((d) => {
    const kids = childrenAt(d);
    return !!kids && kids.some((n) => n.name === '.mdp' && n.type === 'directory');
  });
  return chain.length ? chain.map((d) => (d ? `${d}/.mdp` : '.mdp')) : ['.mdp'];
}

// Effective DISABLED module names across the chain (nearest explicit wins).
async function disabledModules(baseDir, configDirs) {
  const state = new Map();
  for (const cdir of configDirs) {
    try {
      const c = JSON.parse(await mdplink.vfsReadText(mdplink.resolve(baseDir, `${cdir}/content.json`)));
      for (const [name, enabled] of Object.entries((c && c.modules) || {})) state.set(name, !!enabled);
    } catch { /* no content.json in this .mdp */ }
  }
  return new Set([...state].filter(([, en]) => !en).map(([n]) => n));
}

// Scope-aware asset listing: bundled defaults first, then each `.mdp` in the chain
// (nearest wins by file name).
async function listScoped(baseDir, configDirs, subdir, ext, builtinDir) {
  const byName = new Map();
  try {
    for (const f of fs.readdirSync(builtinDir)) {
      if (f.endsWith(ext)) byName.set(f, { name: f.slice(0, -ext.length), path: `builtin:${subdir}/${f}` });
    }
  } catch { /* no bundled dir */ }
  for (const cdir of configDirs) {
    try {
      for (const e of await mdplink.vfsList(mdplink.resolve(baseDir, `${cdir}/${subdir}`))) {
        if (!e.isDir && e.name.endsWith(ext)) byName.set(e.name, { name: e.name.slice(0, -ext.length), path: `${cdir}/${subdir}/${e.name}` });
      }
    } catch { /* subdir absent in this .mdp */ }
  }
  return [...byName.values()];
}

// Merge the image-alias library across a `.mdp` chain (root→nearest, nearest wins
// by alias). Each entry: { alias, kind: 'path'|'data'|'url', rel?, data?, url?,
// description?, tags? }. `rel` is the workspace-relative path of a managed
// `.mdp/images/<f>` file (rebased to the owning `.mdp`).
async function readLibrary(baseDir, chain) {
  const byAlias = new Map();
  for (const cdir of chain) {
    let reg;
    try { reg = JSON.parse(await mdplink.vfsReadText(mdplink.resolve(baseDir, `${cdir}/images/registry.json`))); }
    catch { continue; } // this `.mdp` has no library
    for (const [alias, value] of Object.entries((reg && reg.images) || {})) {
      const v = String(value);
      const kind = v.startsWith('data:') ? 'data' : /^https?:/i.test(v) ? 'url' : 'path';
      byAlias.set(alias, {
        alias, kind,
        ...(kind === 'path' ? { rel: v.replace(/^\/?\.mdp\/images\//, `${cdir}/images/`) } : {}),
        ...(kind === 'data' ? { data: v } : {}),
        ...(kind === 'url' ? { url: v } : {}),
        ...(reg.descriptions && reg.descriptions[alias] ? { description: reg.descriptions[alias] } : {}),
        ...(reg.tags && reg.tags[alias] && reg.tags[alias].length ? { tags: reg.tags[alias] } : {}),
      });
    }
  }
  return byAlias;
}

// The `.mdp` chain for a deck arg, falling back to the workspace ROOT scope when no
// deck is given AND none is active — so the library is readable headlessly too.
async function scopeChain(baseDir, deckArg) {
  const deckPath = deckArg ? requireDeckPath(deckArg) : await activeDeckPath().catch(() => '');
  return mdpChainDirs(baseDir, deckPath);
}

// Directives that are part of the slide format itself (not module invocations).
const BUILTIN_DIRECTIVES = new Set([
  'title', 'subtitle', 'date', 'presenter', 'affiliation', 'contact', 'tags',
  'aspect', 'theme', 'css', 'transition', 'build', 'header', 'footer', 'end',
  'note', 'pageclass', 'id', 'caption', 'cover', 'hide', 'draw', 'drawing', 'addstyle',
]);

// Lazy up to the closing `-->` (not `[^>]`, which truncates values containing '>').
const metaField = (meta, name) => ((meta.match(new RegExp(`<!--\\s*@${name}\\s+([\\s\\S]*?)\\s*-->`)) || [])[1] || '').trim();

// Embedded binary (inline base64 images / drawio) can be HUGE — a single
// `data:image/png;base64,…` is easily 100KB+ (~30k tokens). For the AI's view we
// replace each long base64 payload with a CONTENT-ADDRESSED placeholder
// (`…base64,MDP_ELIDED_<sha1-16>`). This is REVERSIBLE: on any deck write we expand
// each placeholder back to the real bytes by matching its hash against the current
// file (expandBinary), so even if the AI round-trips the shortened text through
// write_deck, the images are restored — not lost. A placeholder that can't be
// matched blocks the write (no silent data loss). Structure is kept for the AI.
const blobHash = (payload) => crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
const BLOB_RE = /(data:[\w.+-]+\/[\w.+-]+;base64,)([A-Za-z0-9+/=]{200,})/g;
const PLACEHOLDER_RE = /data:[\w.+-]+\/[\w.+-]+;base64,MDP_ELIDED_([0-9a-f]{16})/g;

function elideBinary(text) {
  let elided = 0;
  const out = text.replace(BLOB_RE, (_m, head, body) => { elided++; return `${head}MDP_ELIDED_${blobHash(body)}`; });
  return { text: out, elided };
}

// hash → full real `data:…` value, built from a text that still has real blobs.
function blobMap(text) {
  const map = new Map();
  for (const m of String(text).matchAll(BLOB_RE)) map.set(blobHash(m[2]), m[0]);
  return map;
}

// Expand MDP_ELIDED_<hash> placeholders in `content` using the real blobs present
// in `sourceText` (the current deck). Returns { text, unresolved }.
function expandBinary(content, sourceText) {
  if (!content.includes('MDP_ELIDED_')) return { text: content, unresolved: 0 };
  const map = blobMap(sourceText);
  let unresolved = 0;
  const text = content.replace(PLACEHOLDER_RE, (whole, hash) => {
    const real = map.get(hash);
    if (real) return real;
    unresolved++;
    return whole;
  });
  return { text, unresolved };
}

// Low-token per-slide structure summary (heading, bullets, modules, notes, volume).
function outlineDeck(text) {
  const blocks = splitBlocks(text);
  const meta = blocks[0] || '';
  const slides = blocks.slice(1).map((raw, i) => {
    const noComments = raw.replace(/<!--[\s\S]*?-->/g, ' ');
    const heading = ((noComments.match(/^\s*#{1,3}\s+(.+)$/m) || [])[1] || '').trim();
    const bullets = (noComments.match(/^\s*(?:[-*+]|\d+\.)\s+\S/gm) || []).length;
    const modules = [...new Set([...raw.matchAll(/<!--\s*@([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((n) => !BUILTIN_DIRECTIVES.has(n)))];
    const notes = [...raw.matchAll(/<!--\s*@note:\s*([\s\S]*?)-->/g)].map((m) => m[1]);
    const chars = noComments.replace(/\s+/g, '').length;
    const noteChars = notes.join('').replace(/\s+/g, '').length;
    return {
      slide: i + 1,
      heading: heading || undefined,
      bullets: bullets || undefined,
      modules: modules.length ? modules : undefined,
      chars,
      ...(noteChars ? { noteChars } : {}),
      ...(/<!--\s*@cover\s*-->/i.test(raw) ? { cover: true } : {}),
      ...(/<!--\s*@hide\s*-->/i.test(raw) ? { hidden: true } : {}),
    };
  });
  // Rough speaking-time estimate: notes are the script when present, else slide
  // text; ~320 chars/min (Japanese ≈300–350; adjust mentally for English).
  const speakChars = slides.reduce((a, s) => a + (s.noteChars || s.chars), 0);
  return {
    title: metaField(meta, 'title') || undefined,
    subtitle: metaField(meta, 'subtitle') || undefined,
    theme: metaField(meta, 'theme') || undefined,
    tags: metaField(meta, 'tags') ? metaField(meta, 'tags').split(/[,;]/).map((t) => t.trim()).filter(Boolean) : undefined,
    slideCount: slides.length,
    estimatedMinutes: Math.round((speakChars / 320) * 10) / 10,
    slides,
  };
}

// MDP decks are UTF-8. We read/write UTF-8 everywhere, but PRESERVE a file's
// original byte encoding on round-trip so an AI edit never introduces a spurious
// whole-file diff: strip a leading BOM for the AI's view, remember whether the file
// had one (+ its line endings), and re-apply both when writing back to disk.
const BOM = '\uFEFF';

// Current text of a deck (BOM-stripped) + its encoding profile: the live editor
// content when open, else the file. `nonUtf8` flags a file that decoded with
// U+FFFD replacement chars — i.e. it is NOT valid UTF-8 (e.g. Shift_JIS/CP932).
async function currentDeckText(baseDir, deckPath) {
  try {
    const r = await relay('getDeckText', { path: deckPath }, 8000);
    if (r && r.open) {
      const text = String(r.text || '').replace(/^\uFEFF/, '');
      return { text, open: true, bom: false, crlf: /\r\n/.test(text), nonUtf8: false };
    }
  } catch { /* editor unavailable → fall back to disk */ }
  let buf;
  try { buf = await mdplink.vfsReadBuffer(mdplink.resolve(baseDir, deckPath)); }
  catch { return { text: '', open: false, bom: false, crlf: false, nonUtf8: false, missing: true }; }
  let text = buf.toString('utf-8');
  const bom = text.charCodeAt(0) === 0xFEFF;
  if (bom) text = text.slice(1);
  return { text, open: false, bom, crlf: /\r\n/.test(text), nonUtf8: text.includes('�') };
}

// Refuse to rewrite a file that is not valid UTF-8 — decoding it as UTF-8 and
// writing it back would replace every non-ASCII byte with U+FFFD, destroying the
// original text. Callers of any deck-WRITE must run this first.
function assertUtf8Writable(enc, deckPath) {
  if (enc && enc.nonUtf8) {
    throw new Error(`"${deckPath}" does not look like UTF-8 (it decoded with replacement characters, e.g. it may be Shift_JIS/CP932). Refusing to overwrite it — that would corrupt the text. Ask the user to re-save it as UTF-8 first.`);
  }
}

// Keep the PREVIOUS bytes of a closed deck before overwriting it, so a bad AI edit
// is recoverable. Backups live under the workspace root's `.mdp/mcp-backups/`
// (one per deck path, overwritten each write) — off in the deck folders.
async function backupDeck(baseDir, deckPath) {
  try {
    const prev = await mdplink.vfsReadBuffer(mdplink.resolve(baseDir, deckPath));
    const flat = deckPath.replace(/[\\/]/g, '__');
    await mdplink.vfsMkdirp(mdplink.resolve(baseDir, '.mdp/mcp-backups'));
    await mdplink.vfsWrite(mdplink.resolve(baseDir, `.mdp/mcp-backups/${flat}.bak`), prev);
  } catch { /* file doesn't exist yet (new deck) → nothing to back up */ }
}

// Write a deck back: as an unsaved edit in the editor when open (the user reviews
// and saves), else straight to disk — preserving the original BOM + line endings,
// after stashing a recovery copy. Elided image placeholders are EXPANDED back to
// the real bytes (from the current file) so a round-tripped read_deck copy never
// drops images; an unmatched placeholder blocks the write instead of losing data.
async function writeDeckBack(baseDir, deckPath, newText, open, enc) {
  if (newText.includes('MDP_ELIDED_')) {
    const { text, unresolved } = expandBinary(newText, (enc && enc.text) || '');
    if (unresolved) {
      throw new Error(`This content has ${unresolved} shortened image placeholder(s) (MDP_ELIDED_…) that don't match any image in the current deck, so writing it would LOSE those images. read_deck shortens embedded images to save tokens — don't rebuild the whole deck from that copy; use patch_deck / replace_slide / append_slide for targeted edits.`);
    }
    newText = text;
  }
  if (open) {
    const r = await relay('setOpenDeckText', { path: deckPath, text: newText }, 10000);
    if (r && r.applied) return { appliedTo: 'editor (unsaved — ask the user to save)' };
  }
  await backupDeck(baseDir, deckPath);
  let out = enc && enc.crlf ? newText.split('\n').join('\r\n') : newText;
  if (enc && enc.bom) out = BOM + out;
  await mdplink.vfsWrite(mdplink.resolve(baseDir, deckPath), Buffer.from(out, 'utf-8'));
  relay('refreshTree', {}, 5000).catch(() => {});
  return { appliedTo: 'file (previous version saved to .mdp/mcp-backups/)' };
}

// Serialize the read-modify-write of any deck by PATH: MCP hosts can fire tool
// calls concurrently, and two overlapping edits to one deck would otherwise lose
// an update (both read the same base, the second write wins).
const deckLocks = new Map();
function withDeckLock(key, fn) {
  const prev = deckLocks.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  deckLocks.set(key, run.then(() => {}, () => {}));
  return run;
}
const WRITE_METHODS = new Set(['write_deck', 'append_slide', 'replace_slide', 'patch_deck', 'edit_slides', 'set_notes']);

// ---- tool implementations ------------------------------------------------------

async function callTool(method, params) {
  const baseDir = ctx.getBaseDir();
  if (!baseDir) throw new Error('No workspace folder is open in MDP.');
  const p = params || {};

  // Serialize concurrent writes to the SAME deck (lost-update prevention).
  if (WRITE_METHODS.has(method) && p.path && typeof p.path === 'string') {
    return withDeckLock(requireDeckPath(p.path), () => callToolInner(method, p, baseDir));
  }
  return callToolInner(method, p, baseDir);
}

async function callToolInner(method, p, baseDir) {

  switch (method) {
    case 'list_decks': {
      const tree = (await mdplink.buildTree(baseDir)).nodes || [];
      const decks = [];
      (function walk(nodes) {
        for (const n of nodes || []) {
          if (n.type === 'file' && /\.slide\.md$/i.test(n.name)) decks.push(n.path);
          if (n.children) walk(n.children);
        }
      })(tree);
      return { decks, hint: 'Read one or two existing decks to imitate the user\'s style before authoring.' };
    }

    case 'read_deck': {
      const deckPath = requireDeckPath(p.path);
      const cur = await currentDeckText(baseDir, deckPath);
      const slideCount = Math.max(0, splitBlocks(cur.text).length - 1);
      const { text: content, elided } = elideBinary(cur.text);
      return {
        path: deckPath, openInEditor: cur.open, slideCount,
        ...(cur.nonUtf8 ? { encodingWarning: 'This file did NOT decode as valid UTF-8 (it shows replacement characters). It is likely Shift_JIS/CP932 or similar. Do NOT rewrite it with write_deck/patch_deck/etc. — that would corrupt the text; ask the user to convert it to UTF-8 first.' } : {}),
        ...(elided ? { binaryElided: `${elided} embedded image(s) were shortened to MDP_ELIDED_… placeholders to save tokens. They are auto-restored on write, so the images are NOT lost even if you write_deck this content back — but keep each placeholder EXACTLY as-is. Prefer patch_deck / replace_slide / append_slide for edits (cheaper and safer).` } : {}),
        ...(content.length > 40000 ? { sizeHint: 'Large deck — prefer get_deck_outline for orientation and patch_deck for edits.' } : {}),
        content,
      };
    }

    case 'write_deck': {
      const deckPath = requireDeckPath(p.path);
      if (!/\.slide\.md$/i.test(deckPath)) throw new Error('Deck path must end in .slide.md');
      if (typeof p.content !== 'string') throw new Error('"content" is required.');
      const cur = await currentDeckText(baseDir, deckPath);
      assertUtf8Writable(cur, deckPath);
      const res = await writeDeckBack(baseDir, deckPath, p.content, cur.open, cur);
      return { path: deckPath, slideCount: Math.max(0, splitBlocks(p.content).length - 1), ...res };
    }

    case 'append_slide': {
      const deckPath = requireDeckPath(p.path);
      if (typeof p.content !== 'string') throw new Error('"content" is required.');
      const cur = await currentDeckText(baseDir, deckPath);
      assertUtf8Writable(cur, deckPath);
      const blocks = splitBlocks(cur.text);
      blocks.push(`\n${p.content.trim()}\n`);
      const res = await writeDeckBack(baseDir, deckPath, joinBlocks(blocks), cur.open, cur);
      return { path: deckPath, slide: blocks.length - 1, slideCount: blocks.length - 1, ...res };
    }

    case 'replace_slide': {
      const deckPath = requireDeckPath(p.path);
      const n = Number(p.slide);
      if (typeof p.content !== 'string') throw new Error('"content" is required.');
      const cur = await currentDeckText(baseDir, deckPath);
      assertUtf8Writable(cur, deckPath);
      const blocks = splitBlocks(cur.text);
      if (!Number.isInteger(n) || n < 0 || n >= blocks.length) {
        throw new Error(`"slide" must be 0 (meta) … ${blocks.length - 1}; the deck has ${blocks.length - 1} slide(s).`);
      }
      blocks[n] = `\n${p.content.trim()}\n`;
      const res = await writeDeckBack(baseDir, deckPath, joinBlocks(blocks), cur.open, cur);
      return { path: deckPath, slide: n, slideCount: blocks.length - 1, ...res };
    }

    case 'set_notes': {
      const deckPath = requireDeckPath(p.path);
      const n = Number(p.slide);
      if (typeof p.notes !== 'string') throw new Error('"notes" is required (empty string clears the note).');
      if (p.notes.includes('-->')) throw new Error('Speaker notes must not contain "-->" (it would close the HTML comment).');
      const cur = await currentDeckText(baseDir, deckPath);
      assertUtf8Writable(cur, deckPath);
      const blocks = splitBlocks(cur.text);
      if (!Number.isInteger(n) || n < 1 || n >= blocks.length) {
        throw new Error(`"slide" must be 1 … ${blocks.length - 1} (notes attach to content slides, not the meta page).`);
      }
      let block = blocks[n];
      // In 'replace' (default) strip existing @note directives; 'append' keeps them.
      if (p.mode !== 'append') block = block.replace(/[ \t]*<!--\s*@note:[\s\S]*?-->[ \t]*\r?\n?/g, '');
      const note = p.notes.trim();
      if (note) block = `${block.replace(/\s*$/, '')}\n<!-- @note: ${note} -->\n`;
      blocks[n] = block;
      const res = await writeDeckBack(baseDir, deckPath, joinBlocks(blocks), cur.open, cur);
      return { path: deckPath, slide: n, mode: p.mode === 'append' ? 'append' : 'replace', cleared: !note, ...res };
    }

    case 'list_modules': {
      const deckPath = p.deck ? requireDeckPath(p.deck) : await activeDeckPath();
      const chain = await mdpChainDirs(baseDir, deckPath);
      const disabled = await disabledModules(baseDir, chain);
      const all = await listScoped(baseDir, chain, 'modules', '.mdpmod.xml', ctx.getAssetPath('modules'));
      return { scope: chain, modules: all.map((m) => ({ ...m, disabled: disabled.has(m.name) || undefined })) };
    }

    case 'list_themes': {
      const deckPath = p.deck ? requireDeckPath(p.deck) : await activeDeckPath();
      const chain = await mdpChainDirs(baseDir, deckPath);
      const themes = await listScoped(baseDir, chain, 'themes', '.css', ctx.getAssetPath('themes'));
      return { scope: chain, themes: themes.map((t) => t.name) };
    }

    case 'read_module': {
      const mp = String(p.path || '');
      if (mp.startsWith('builtin:')) {
        const rel = mp.slice('builtin:'.length);
        if (rel.includes('..')) throw new Error('Invalid module path.');
        return fs.readFileSync(path.join(ctx.getAssetPath(''), rel), 'utf-8');
      }
      return await mdplink.vfsReadText(mdplink.resolve(baseDir, requireDeckPath(mp)));
    }

    case 'get_deck_outline': {
      const deckPath = p.path ? requireDeckPath(p.path) : await activeDeckPath();
      const { text } = await currentDeckText(baseDir, deckPath);
      return { path: deckPath, ...outlineDeck(text), note: 'estimatedMinutes ≈ speaking time from notes (or slide text when a slide has no note) at ~320 chars/min.' };
    }

    case 'search_decks': {
      const query = String(p.query || '').toLowerCase();
      const wantTags = Array.isArray(p.tags) ? p.tags.map((t) => String(t).toLowerCase()) : [];
      if (!query && !wantTags.length) throw new Error('Provide "query" and/or "tags".');
      const tree = (await mdplink.buildTree(baseDir)).nodes || [];
      const decks = [];
      (function walk(nodes) {
        for (const n of nodes || []) {
          if (n.type === 'file' && /\.slide\.md$/i.test(n.name)) decks.push(n.path);
          if (n.children) walk(n.children);
        }
      })(tree);
      const results = [];
      for (const deckPath of decks.slice(0, 300)) {
        let text;
        try { text = await mdplink.vfsReadText(mdplink.resolve(baseDir, deckPath)); } catch { continue; }
        const meta = splitBlocks(text)[0] || '';
        const title = metaField(meta, 'title');
        const subtitle = metaField(meta, 'subtitle');
        const tags = metaField(meta, 'tags').split(/[,;]/).map((t) => t.trim()).filter(Boolean);
        if (wantTags.length && !wantTags.every((t) => tags.some((x) => x.toLowerCase() === t))) continue;
        let score = wantTags.length ? 2 : 0;
        let matchedIn;
        if (query) {
          const lower = text.toLowerCase();
          if (title.toLowerCase().includes(query)) { score += 3; matchedIn = 'title'; }
          else if (tags.some((t) => t.toLowerCase().includes(query))) { score += 2; matchedIn = 'tags'; }
          else if (subtitle.toLowerCase().includes(query)) { score += 2; matchedIn = 'subtitle'; }
          else if (lower.includes(query)) {
            score += 1; matchedIn = 'body';
          } else continue;
        }
        results.push({ path: deckPath, title: title || undefined, tags: tags.length ? tags : undefined, matchedIn, score });
      }
      results.sort((a, b) => b.score - a.score);
      return { results: results.slice(0, 20).map(({ score, ...r }) => r) };
    }

    case 'patch_deck': {
      const deckPath = requireDeckPath(p.path);
      const oldStr = String(p.old_str ?? '');
      if (!oldStr) throw new Error('"old_str" is required.');
      const cur = await currentDeckText(baseDir, deckPath);
      assertUtf8Writable(cur, deckPath);
      const text = cur.text;
      const count = text.split(oldStr).length - 1;
      if (count === 0) throw new Error('old_str not found in the deck (it must match exactly, including whitespace).');
      if (count > 1 && !p.all) throw new Error(`old_str matches ${count} times — make it more specific, or pass all=true.`);
      const next = p.all ? text.split(oldStr).join(String(p.new_str ?? '')) : text.replace(oldStr, String(p.new_str ?? ''));
      const res = await writeDeckBack(baseDir, deckPath, next, cur.open, cur);
      return { path: deckPath, replaced: p.all ? count : 1, ...res };
    }

    case 'edit_slides': {
      const deckPath = requireDeckPath(p.path);
      const cur = await currentDeckText(baseDir, deckPath);
      assertUtf8Writable(cur, deckPath);
      const blocks = splitBlocks(cur.text);
      const N = blocks.length - 1;
      const inRange = (v, lo, hi, what) => {
        if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`"${what}" must be ${lo}…${hi} (deck has ${N} slide(s)).`);
        return v;
      };
      if (p.op === 'insert') {
        if (typeof p.content !== 'string') throw new Error('"content" is required for insert.');
        const after = inRange(Number(p.after ?? N), 0, N, 'after');
        blocks.splice(after + 1, 0, `\n${p.content.trim()}\n`);
      } else if (p.op === 'delete') {
        blocks.splice(inRange(Number(p.slide), 1, N, 'slide'), 1);
      } else if (p.op === 'move') {
        const from = inRange(Number(p.slide), 1, N, 'slide');
        const to = inRange(Number(p.to), 1, N, 'to');
        const [b] = blocks.splice(from, 1);
        blocks.splice(to, 0, b);
      } else {
        throw new Error('"op" must be insert | delete | move.');
      }
      const res = await writeDeckBack(baseDir, deckPath, joinBlocks(blocks), cur.open, cur);
      return { path: deckPath, op: p.op, slideCount: blocks.length - 1, ...res };
    }

    case 'list_images': {
      const chain = await scopeChain(baseDir, p.deck);
      const lib = await readLibrary(baseDir, chain);
      // Expose `path` for managed files; hide the internal `data:` payload (huge).
      const images = [...lib.values()].map(({ rel, data, ...e }) => ({ ...e, ...(rel ? { path: rel } : {}) }));
      return { scope: chain, images, hint: 'Reference as ![alt](@alias); use read_image (alias or path) to see one.' };
    }

    case 'list_templates': {
      const chain = await mdpChainDirs(baseDir, await activeDeckPath().catch(() => ''));
      const templates = await listScoped(baseDir, chain, 'templates', '.md', ctx.getAssetPath('templates'));
      return { templates };
    }

    case 'read_template': {
      const tp = String(p.path || '');
      if (tp.startsWith('builtin:')) {
        const rel = tp.slice('builtin:'.length);
        if (rel.includes('..')) throw new Error('Invalid template path.');
        return fs.readFileSync(path.join(ctx.getAssetPath(''), rel), 'utf-8');
      }
      return await mdplink.vfsReadText(mdplink.resolve(baseDir, requireDeckPath(tp)));
    }

    case 'read_theme': {
      const name = String(p.name || '').replace(/\.css$/i, '');
      if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid theme name.');
      const deckPath = p.deck ? requireDeckPath(p.deck) : await activeDeckPath().catch(() => '');
      const chain = await mdpChainDirs(baseDir, deckPath);
      for (const cdir of [...chain].reverse()) { // nearest first
        try { return await mdplink.vfsReadText(mdplink.resolve(baseDir, `${cdir}/themes/${name}.css`)); } catch { /* keep looking */ }
      }
      try { return fs.readFileSync(path.join(ctx.getAssetPath('themes'), `${name}.css`), 'utf-8'); }
      catch { throw new Error(`Theme "${name}" not found (see list_themes).`); }
    }

    case 'get_asset_templates': {
      const read = (rel) => { try { return fs.readFileSync(path.join(ctx.getAssetPath(''), rel), 'utf-8'); } catch { return ''; } };
      return {
        module: read('default-module.mdpmod.xml'),
        effect: read('default-effect.mdpfx.xml'),
        theme: read('themes/default.css'),
        note: 'Module: <name>/<description>/<params>/<render>/<styles>/<script>; add <aiSpec> so the module explains itself to AIs. Effect: <enter>/<emphasis>/<leave> phases with <css>/<cssActive>. Theme: CSS overriding the slide design tokens (--bg-color, --text-color, --accent-color, --base-font-size, …).',
      };
    }

    case 'write_asset': {
      const kind = String(p.kind || '');
      const name = String(p.name || '');
      const content = String(p.content ?? '');
      if (!/^[\w-]+$/.test(name)) throw new Error('"name" must be letters/digits/-/_.');
      if (!content.trim()) throw new Error('"content" is required.');
      const spec = {
        module: { sub: 'modules', ext: '.mdpmod.xml', check: /<module[\s>][\s\S]*<name>/ },
        effect: { sub: 'effects', ext: '.mdpfx.xml', check: /<effect[\s>][\s\S]*<name>/ },
        theme: { sub: 'themes', ext: '.css', check: /./ },
      }[kind];
      if (!spec) throw new Error('"kind" must be module | effect | theme.');
      if (!spec.check.test(content)) throw new Error(`Content does not look like a valid ${kind} file — see get_asset_templates.`);
      const dir = p.dir ? requireDeckPath(p.dir) : '';
      const rel = `${dir ? dir + '/' : ''}.mdp/${spec.sub}/${name}${spec.ext}`;
      const hasScript = /<script[\s>]/i.test(content);
      // The renderer decides per the user's "Creating modules/themes/effects"
      // setting: 'auto' approves silently; 'confirm' shows a review dialog (a module
      // <script> RUNS in the app). If the user declines, do not write.
      const ok = await relay('confirmAssetWrite', { kind, name, rel, hasScript, content }, 300000);
      if (!ok || !ok.approved) throw new Error('The user declined to save this asset.');
      await mdplink.vfsWrite(mdplink.resolve(baseDir, rel), Buffer.from(content, 'utf-8'));
      // Tree refresh re-registers modules/effects and refreshes the theme list live.
      relay('refreshTree', {}, 5000).catch(() => {});
      return { saved: rel, note: kind === 'module' && hasScript ? 'Registered live — its <script> will run in MDP.' : 'Registered live.' };
    }

    // Live tools → renderer.
    case 'validate_deck': return await relay('validateDeck', { path: p.path ? requireDeckPath(p.path) : undefined }, 30000);
    case 'read_image': {
      const maxWidth = p.maxWidth ? Number(p.maxWidth) : undefined;
      if (p.alias) {
        // Resolve the alias HERE against the deck's `.mdp` library chain (works for
        // any scope, and headlessly), then hand a concrete path/data to the
        // renderer to rasterise + downscale.
        const chain = await scopeChain(baseDir, p.deck);
        const e = (await readLibrary(baseDir, chain)).get(String(p.alias));
        if (!e) throw new Error(`Unknown image alias "${p.alias}" in this scope (see list_images).`);
        if (e.kind === 'url') throw new Error(`Alias "${p.alias}" points at a URL — it cannot be fetched (offline-first).`);
        return await relay('readImage', e.kind === 'data' ? { dataUrl: e.data, maxWidth } : { path: e.rel, maxWidth }, 30000);
      }
      if (p.path) return await relay('readImage', { path: requireDeckPath(p.path), maxWidth }, 30000);
      throw new Error('Provide "path" or "alias".');
    }
    case 'render_deck_overview': return await relay('renderDeckOverview', { thumbWidth: p.thumbWidth ? Number(p.thumbWidth) : undefined }, 170000);
    case 'get_slide_spec': return await relay('spec', {}, 30000);
    case 'get_active_deck': return await relay('activeDeck', {}, 10000);
    case 'open_deck': return await relay('openDeck', { path: requireDeckPath(p.path) }, 20000);
    case 'goto_slide': return await relay('gotoSlide', { slide: Number(p.slide) }, 10000);
    case 'insert_at_cursor': return await relay('insertAtCursor', { text: String(p.text ?? '') }, 10000);
    case 'measure_slides': return await relay('measureSlides', {}, 120000);
    case 'render_slide_image': return await relay('renderSlideImage', { slide: Number(p.slide), width: p.width ? Number(p.width) : undefined }, 120000);

    default:
      throw new Error(`Unknown tool: ${method}`);
  }
}

async function activeDeckPath() {
  const r = await relay('activeDeck', {}, 8000).catch(() => null);
  if (!r || !r.path) throw new Error('No deck is open — pass "deck" or open one with open_deck.');
  return r.path;
}

// ---- server lifecycle ------------------------------------------------------------

const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

function init(context) { ctx = context; }

function start() {
  return new Promise((resolve) => {
    if (server) return resolve({ running: true, port });
    token = crypto.randomBytes(24).toString('hex');
    server = http.createServer((req, res) => {
      const deny = (code, msg) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: msg })); };
      if (!isLoopback(req.socket.remoteAddress)) return deny(403, 'forbidden');
      if (req.method !== 'POST' || req.url !== '/rpc') return deny(404, 'not found');
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 20 * 1024 * 1024) req.destroy(); });
      req.on('end', async () => {
        try {
          const { token: t, method, params } = JSON.parse(body);
          const a = Buffer.from(String(t || ''));
          const b = Buffer.from(String(token || ''));
          if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return deny(403, 'bad token');
          const result = await callTool(method, params);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result }));
        } catch (e) {
          deny(200, String((e && e.message) || e));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      try {
        fs.mkdirSync(path.dirname(handshakeFile()), { recursive: true });
        fs.writeFileSync(handshakeFile(), JSON.stringify({ port, token, pid: process.pid }));
      } catch { /* handshake write best-effort */ }
      resolve({ running: true, port });
    });
  });
}

function stop() {
  if (server) { try { server.close(); } catch { /* ignore */ } server = null; }
  port = 0;
  token = null;
  try {
    // Only remove our own handshake (another MDP instance may own the file).
    const h = JSON.parse(fs.readFileSync(handshakeFile(), 'utf8'));
    if (h.pid === process.pid) fs.unlinkSync(handshakeFile());
  } catch { /* ignore */ }
  return { running: false };
}

const isRunning = () => !!server;
const getPort = () => port;

module.exports = { init, start, stop, isRunning, getPort, handleRendererResponse };
