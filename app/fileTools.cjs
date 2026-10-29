// The MCP's FILE tools — so an AI can finish a deck's whole job through MDP, without
// reaching into the workspace by itself (2026-10-29, the author: 基本的に，極力
// インタラクションなしに生成を実現したいのだ). Until then a lesson plan beside a deck, a
// figure made in Python, a folder listing and a check of an exported PDF all meant
// Claude touching the NAS directly — and Claude Code asking the person each time.
//   read_file / write_file / patch_file / patch_files — text files (a lesson plan, a
//       flow, a skill, a glossary, a figure's .svg, a CSV …), BOM and line endings kept
//   put_file    — a figure, a PDF, a zip or a recording: copied from the AI's own temp
//       files (`from`), sent as base64, or copied from another workspace file (`copy`)
//   list_files  — names, sizes, times (and md5) of a folder, optionally by glob
//   delete_file — moved into .mdp/mcp-backups/deleted (never gone)
//   inspect_pdf — page count, each page's size in pt, a picture of the pages (renderer)
// Nothing here waits for a person: an overwrite or a delete keeps the previous bytes
// in .mdp/mcp-backups and says where; what only the AI can judge (a file the person is
// editing right now) comes back as the reason and the ways out. Writes stay inside the
// workspace (`.mdplink` targets included), and the files MDP itself keeps — decks,
// links, its settings, reviews, rehearsals, backups, modules and effects with their
// scripts — go through their own tools.
// The bridge passes its helpers in (file access through .mdplink, the renderer relay,
// the per-path lock), like reviewTools.cjs.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const METHODS = new Set(['read_file', 'write_file', 'patch_file', 'patch_files', 'put_file', 'list_files', 'delete_file', 'inspect_pdf']);

// Text files read_file / write_file / patch_file take (by extension, or a bare name).
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'text', 'log', 'json', 'jsonl', 'csv', 'tsv', 'ipynb', 'py', 'r', 'm', 'jl',
  'tex', 'bib', 'sty', 'cls', 'bst', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'svg', 'drawio',
  'html', 'htm', 'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'sh', 'bash', 'bat', 'cmd', 'ps1',
  'c', 'h', 'cc', 'cpp', 'hpp', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'pl', 'lua', 'sql',
  'vtt', 'srt', 'dot', 'gv', 'mmd', 'puml', 'plantuml', 'gitignore', 'mdpignore',
]);
const TEXT_NAMES = new Set(['readme', 'license', 'makefile', 'dockerfile', 'notes', 'todo']);

// What put_file writes besides text: each type is checked by its first bytes, so a
// file cannot come in under a picture's name.
const ftyp = (b) => b.length > 12 && b.slice(4, 8).toString('latin1') === 'ftyp';
const riff = (b, kind) => b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === kind;
const MAGIC = {
  png: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => /^GIF8[79]a/.test(b.slice(0, 6).toString('latin1')),
  webp: (b) => riff(b, 'WEBP'),
  bmp: (b) => b.slice(0, 2).toString('latin1') === 'BM',
  ico: (b) => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0,
  avif: (b) => ftyp(b) && /avi[fs]/.test(b.slice(8, 40).toString('latin1')),
  pdf: (b) => b.slice(0, 5).toString('latin1') === '%PDF-',
  zip: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7),
  mp4: ftyp,
  mov: (b) => ftyp(b) || /^(moov|mdat|wide|free|skip)$/.test(b.slice(4, 8).toString('latin1')),
  webm: (b) => b.length > 4 && b.readUInt32BE(0) === 0x1a45dfa3,
  mp3: (b) => b.slice(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  wav: (b) => riff(b, 'WAVE'),
  ogg: (b) => b.slice(0, 4).toString('latin1') === 'OggS',
};
const BINARY_KIND = {
  png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', webp: 'webp', bmp: 'bmp', ico: 'ico', avif: 'avif',
  pdf: 'pdf', zip: 'zip', mp4: 'mp4', m4v: 'mp4', m4a: 'mp4', mov: 'mov', webm: 'webm',
  mp3: 'mp3', wav: 'wav', ogg: 'ogg', oga: 'ogg', opus: 'ogg',
};

const READ_MAX_BYTES = 8 * 1024 * 1024;     // read_file: larger text is not something to read whole
const READ_MAX_CHARS = 150000;              // one answer's text; the rest by offset
const PUT_MAX_BYTES = 200 * 1024 * 1024;    // put_file from / copy (a recording may be big)
const BASE64_MAX_BYTES = 14 * 1024 * 1024;  // the bridge takes 20 MB per request, base64 included
const LIST_MAX = 5000;
const MD5_MAX_FILES = 300;
const MD5_MAX_BYTES = 100 * 1024 * 1024;
const PATCH_FILES_MAX = 50;
// Folders a recursive listing does not enter (the dir itself may still be listed).
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.ipynb_checkpoints']);
const SKIP_UNDER_MDP = new Set(['mcp-backups', 'review-snapshots']);

const extOf = (rel) => {
  const base = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1) : '';
};
const baseOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const isTextPath = (rel) => TEXT_EXT.has(extOf(rel)) || (!extOf(rel) && TEXT_NAMES.has(baseOf(rel).toLowerCase()));
const flat = (rel) => rel.replace(/[\\/]/g, '__');
const iso = (ms) => (ms ? new Date(ms).toISOString() : undefined);
// This computer's time (the person reads the folder names): YYYYMMDD-HHMMSS.
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const sameBytes = (a, b) => !!a && !!b && a.length === b.length && a.equals(b);
const mb = (n) => `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;

// A workspace-relative path, or why it is not one. `.mdplink` folders are part of the
// workspace (paths go THROUGH them), but nothing may climb out of it.
function cleanPath(p, what = 'path') {
  if (typeof p !== 'string' || !p.trim()) throw new Error(`"${what}" (a workspace-relative path, e.g. "lectures/授業計画.md") is required.`);
  const s = p.trim().replace(/\\/g, '/');
  if (s.includes('\0')) throw new Error(`"${what}" contains a NUL character.`);
  if (/^[a-zA-Z]:/.test(s) || s.startsWith('//') || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    throw new Error(`"${what}" must be a workspace-relative path (as MDP's file tree shows it, e.g. "KJNAS.mdplink/@personal/…/figs/a.svg"), not "${p}".`);
  }
  const segs = s.split('/').filter((x) => x && x !== '.');
  if (segs.some((x) => x === '..')) throw new Error(`"${what}" must not contain "..".`);
  return segs.join('/');
}

// The files MDP keeps for itself, which its own tools write. '' = writable.
function protectedReason(rel, action) {
  const lower = rel.toLowerCase();
  const segs = lower.split('/');
  // A deck may be DELETED like any file (it is kept in the backups); it is written
  // only by the deck tools.
  if (/\.slide\.md$/.test(lower) && action !== 'delete') {
    return 'a deck — write it with write_deck / patch_deck / replace_slide / batch_set_slides (they keep the open editor, the embedded images and the backups in step)';
  }
  if (lower.endsWith('.mdplink')) return 'a folder link (.mdplink) — where it points and how it is reached is the person\'s to set (MDP: Link settings)';
  if (segs.includes('.git')) return 'inside a .git folder';
  if (/(^|\/)\.mdp\/mcp-backups(\/|$)/.test(lower)) return 'MDP\'s backups (.mdp/mcp-backups) — read one with read_file, put one back with write_file or put_file {path, copy}';
  if (/(^|\/)\.mdp\/review-snapshots(\/|$)/.test(lower)) return 'a review snapshot (snapshot_deck takes them)';
  if (/(^|\/)\.mdp\/settings\.json$/.test(lower)) return 'MDP\'s settings';
  if (/\.review\.json$/.test(lower)) return 'a deck\'s review — add_review / resolve_review change it';
  if (/\.rehearsals\.json$/.test(lower)) return 'MDP\'s record of rehearsals and narrations (get_rehearsals reads it)';
  if (/\.mdpmod\.xml$/.test(lower) || /\.mdpfx\.xml$/.test(lower)) return 'a module / effect: its <script> runs inside MDP — write it with write_asset';
  return '';
}
function refuse(rel, action, where = '') {
  const why = protectedReason(rel, action);
  if (why) throw new Error(`${where}"${rel}" is ${why}. Nothing was ${action === 'delete' ? 'deleted' : 'written'}.`);
}

// Text in, text out: LF inside, the file's own BOM and line endings on disk.
function decodeText(buf, BOM) {
  const raw = buf.toString('utf-8');
  const bom = raw.startsWith(BOM);
  const body = bom ? raw.slice(1) : raw;
  return { text: body.replace(/\r\n?/g, '\n'), bom, crlf: /\r\n/.test(body), nonUtf8: body.includes('\uFFFD') };
}
const encodeText = (text, fmt, BOM) => Buffer.from((fmt.bom ? BOM : '') + (fmt.crlf ? text.replace(/\n/g, '\r\n') : text), 'utf-8');
const normalizeIn = (s, BOM) => { const t = String(s ?? '').replace(/\r\n?/g, '\n'); return t.startsWith(BOM) ? t.slice(1) : t; };

// `edits` = [{old_str | old, new_str | new, all?}], as patch_deck takes them.
function editsArg(list, where = '') {
  if (!Array.isArray(list) || !list.length) throw new Error(`${where}"edits" must be a non-empty array of {old_str, new_str, all?}.`);
  return list.map((ed, i) => {
    const o = ed && (ed.old_str ?? ed.old);
    const n = ed && (ed.new_str ?? ed.new);
    if (o == null || o === '') throw new Error(`${where}edits[${i}]: "old_str" (the exact text to replace) is required.`);
    if (n == null) throw new Error(`${where}edits[${i}]: "new_str" is required ("" deletes the text).`);
    return { old_str: String(o).replace(/\r\n?/g, '\n'), new_str: String(n).replace(/\r\n?/g, '\n'), all: !!ed.all };
  });
}

// Glob → RegExp over a path relative to the listed folder: ** any depth, * within a
// name, ? one character, {a,b} either.
function globRe(glob) {
  let re = '';
  const g = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { const end = g.indexOf('}', i); if (end < 0) { re += '\\{'; continue; } re += `(?:${g.slice(i + 1, end).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`; i = end; }
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

function createFileTools(h) {
  const { mdplink, vres, rly, withDeckLock, wsKeyOf, backupFiles, applyExactEdits, BOM, skillsLib, glossaryLib, markSkillsRead } = h;
  const lock = (baseDir, fn) => withDeckLock(`${wsKeyOf(baseDir)}\u0000files`, fn);

  async function readMaybe(baseDir, rel) {
    let buf;
    try { buf = await mdplink.vfsReadBuffer(vres(baseDir, rel)); } catch { return null; }
    return { buf, ...decodeText(buf, BOM) };
  }
  async function statMaybe(baseDir, rel) {
    try { return await mdplink.vfsStat(vres(baseDir, rel)); } catch { return null; }
  }

  // The tabs MDP has open for these paths (and whether the person has unsaved edits
  // there). A shared server has no editor: nothing is open.
  async function openTabs(baseDir, paths) {
    const r = await rly(baseDir, 'fileTabs', { paths }, 5000).catch(() => null);
    return (r && Array.isArray(r.tabs)) ? r.tabs : [];
  }
  // A file the person is editing (unsaved) is theirs until they save or close it.
  function guardOpen(tabs, force, action = 'written') {
    const busy = tabs.filter((t) => t.modified);
    if (!busy.length || force) return;
    throw new Error(`${busy.map((t) => `"${t.path}"`).join(', ')} ${busy.length > 1 ? 'are' : 'is'} open in MDP with UNSAVED edits — the person may be editing ${busy.length > 1 ? 'them' : 'it'}. Nothing was ${action}. Ways out: try again after they save or close it; or pass force: true to go ahead anyway (their unsaved edits stay in the editor, and MDP warns them that the file changed on disk when they save).`);
  }

  // A text file of a kind MDP reads is checked BEFORE it is written: an MDP config
  // that no longer parses, or a skill / glossary / persona whose frontmatter its reader
  // would get wrong (a second block under the first lost a skill its name and always,
  // 2026-10-27), would break quietly.
  function checkKind(rel, text, where = '') {
    const lower = rel.toLowerCase();
    const fail = (msg) => { throw new Error(`${where}${rel}: ${msg} Nothing was written.`); };
    if (/\.(json|ipynb)$/.test(lower)) {
      try { JSON.parse(text); } catch (e) { fail(`not valid JSON (${e.message}).`); }
      if (/(^|\/)\.mdp\/snippets\/[^/]+\.json$/.test(lower)) {
        const arr = JSON.parse(text);
        if (!Array.isArray(arr) || !arr.every((c) => c && typeof c === 'object' && Array.isArray(c.items))) fail('a snippet file is a JSON array of { category, items: [{ label, text }] } (get_asset_templates kind "snippet").');
      }
    }
    const skill = /(^|\/)\.mdp\/skills\/([^/]+)\/skill\.md$/.exec(lower);
    if (skill) {
      const folder = rel.split('/').slice(-2)[0];
      const fm = skillsLib.parseFrontmatter(text);
      if (fm.stray) fail(`${skillsLib.strayProblem(fm.stray)}.`);
      if (!fm.hasFrontmatter || !skillsLib.parseSkill(text, folder).description) fail(`a SKILL.md starts with a frontmatter giving at least a description:\n---\nname: ${folder}\ndescription: what it covers and when to read it\n---`);
      const fmName = fm.data.name;
      if (fmName !== undefined && String(fmName) !== folder) fail(`its frontmatter name is "${fmName}" but the folder is "${folder}" — they must be the same (Agent Skills).`);
    }
    if (/(^|\/)\.mdp\/glossary\/[^/]+\.md$/.test(lower)) {
      try { glossaryLib.checkGlossaryText(text); } catch (e) { fail(String(e.message || e).replace(/\s*Nothing was written\.?$/, '')); }
    }
    if (/(^|\/)\.mdp\/audience\/[^/]+\.md$/.test(lower)) {
      const fm = skillsLib.parseFrontmatter(text);
      if (fm.stray) fail(`the persona's ${skillsLib.strayProblem(fm.stray)}.`);
    }
  }

  // What the editor does about files written here: open tabs reload (the person's
  // unsaved edits are never touched), a rewritten .svg is drawn anew (MDP keeps inline
  // SVGs by path), saved-file listeners react (a glossary, the image library…), the
  // tree and the slides' images refresh.
  async function afterWrite(baseDir, written, deleted = []) {
    const texts = {};
    for (const w of written) if (w.text != null && w.text.length <= 256 * 1024) texts[w.path] = w.text;
    const r = await rly(baseDir, 'filesChanged', { paths: written.map((w) => w.path), deleted, texts }, 15000).catch(() => null);
    const skills = written.filter((w) => /(^|\/)\.mdp\/skills\/[^/]+\/SKILL\.md$/i.test(w.path)).map((w) => ({ path: w.path }));
    if (skills.length && markSkillsRead) markSkillsRead(baseDir, skills);
    return r && typeof r === 'object' ? r : {};
  }
  const tabNote = (r) => ({
    ...(r.reloadedTabs && r.reloadedTabs.length ? { reloadedTabs: r.reloadedTabs } : {}),
    ...(r.keptEdits && r.keptEdits.length ? { openWithUnsavedEdits: r.keptEdits } : {}),
    ...(r.closedTabs && r.closedTabs.length ? { closedTabs: r.closedTabs } : {}),
  });

  // put_file's `from`: a file on THIS computer — only from its temp folder (where an
  // AI's scratch files are) or from the workspace itself. Anything else would let a
  // tool call copy any file the person can read into the workspace, past the
  // permission the person gave the AI for its own file access.
  async function readLocalSource(baseDir, from) {
    if (typeof baseDir !== 'string') throw new Error('"from" (a file on this computer) works in the desktop app — send the bytes as "base64" here.');
    const given = String(from).trim();
    if (!path.isAbsolute(given)) throw new Error(`"from" must be an absolute path of a file on this computer (e.g. a figure in your temp folder), not "${given}". For a workspace file use "copy".`);
    const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
    const src = real(given);
    if (!src) throw new Error(`"from": no such file — ${given}. Nothing was written.`);
    const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    const roots = [real(os.tmpdir()), real(baseDir)].filter(Boolean);
    const inside = roots.some((r) => norm(src) === norm(r) || norm(src).startsWith(norm(r).replace(/[\\/]+$/, '') + path.sep));
    if (!inside) {
      throw new Error(`"from" must be a file in this computer's temp folder (${os.tmpdir()}) — where an AI's scratch files are — or in the workspace. Copy or write the file there first. Nothing was written.`);
    }
    const st = fs.statSync(src);
    if (!st.isFile()) throw new Error(`"from" is not a file: ${given}.`);
    if (st.size > PUT_MAX_BYTES) throw new Error(`"from" is ${mb(st.size)} — more than put_file takes (${mb(PUT_MAX_BYTES)}).`);
    return fs.readFileSync(src);
  }

  // Bytes for a destination: a picture / PDF / zip / recording must BE one (its first
  // bytes), a text type must be UTF-8 text. Returns the text for a text type.
  function checkBytes(rel, buf, where = '') {
    const ext = extOf(rel);
    if (ext === 'svg') {
      const d = decodeText(buf, BOM);
      if (buf.includes(0) || d.nonUtf8 || !/<svg[\s>]/i.test(d.text.slice(0, 65536))) throw new Error(`${where}"${rel}": the bytes are not an SVG (UTF-8 text with an <svg> element). Nothing was written.`);
      return { text: d.text, fmt: d };
    }
    const kind = BINARY_KIND[ext];
    if (kind) {
      if (!MAGIC[kind](buf)) throw new Error(`${where}"${rel}": the bytes are not a .${ext} file (its first bytes say otherwise). Nothing was written.`);
      return { text: null };
    }
    if (isTextPath(rel)) {
      const d = decodeText(buf, BOM);
      if (buf.includes(0) || d.nonUtf8) throw new Error(`${where}"${rel}": not UTF-8 text. Nothing was written.`);
      return { text: d.text, fmt: d };
    }
    throw new Error(`${where}"${rel}": put_file writes pictures (svg png jpg gif webp bmp ico avif), PDF, zip, recordings (mp4 m4v mov webm mp3 wav m4a ogg opus) and text files — not ".${ext || '(no extension)'}". Nothing was written.`);
  }

  async function handle(method, p, baseDir) {
    switch (method) {
      case 'read_file': {
        const rel = cleanPath(p.path);
        if (!isTextPath(rel)) {
          throw new Error(`"${rel}" is not a text file read_file reads (.${extOf(rel) || '(no extension)'}) — read_image shows a picture, inspect_pdf a PDF, list_files gives any file's size and md5.`);
        }
        let buf;
        try { buf = await mdplink.vfsReadBuffer(vres(baseDir, rel)); }
        catch (e) { throw new Error(`No file "${rel}" (${String((e && e.message) || e).slice(0, 120)}). list_files shows what is there.`); }
        if (buf.length > READ_MAX_BYTES) throw new Error(`"${rel}" is ${mb(buf.length)} — too large to read as text here.`);
        if (buf.includes(0)) throw new Error(`"${rel}" holds binary data (a NUL byte) — not a text file.`);
        const d = decodeText(buf, BOM);
        const lines = d.text.split('\n');
        const total = d.text.endsWith('\n') ? lines.length - 1 : lines.length;
        const from = Math.max(1, Math.floor(Number(p.offset) || 1));
        const limit = p.limit != null && Number(p.limit) > 0 ? Math.floor(Number(p.limit)) : null;
        let to = Math.min(total, limit ? from + limit - 1 : total);
        let content = from <= total ? lines.slice(from - 1, to).join('\n') : '';
        // Read to the end: the file's last line break too, so the text written back
        // (write_file) is the file as it was.
        if (to === total && total > 0 && d.text.endsWith('\n')) content += '\n';
        let cut = false;
        if (content.length > READ_MAX_CHARS) {
          const keep = content.slice(0, READ_MAX_CHARS);
          const n = keep.lastIndexOf('\n');
          content = n > 0 ? keep.slice(0, n) : keep;
          to = from + content.split('\n').length - 1;
          cut = true;
        }
        const [st, tabs] = await Promise.all([statMaybe(baseDir, rel), openTabs(baseDir, [rel])]);
        const lower = rel.toLowerCase();
        const better = /\.slide\.md$/.test(lower) ? 'This is the deck FILE; read_deck gives the editor\'s text (with unsaved edits) slide by slide.'
          : /\.rehearsals\.json$/.test(lower) ? 'get_rehearsals reads this with the deck\'s current plan beside each run.'
            : /\.review\.json$/.test(lower) ? 'get_review reads this with each finding located on the slides.'
              : /\.flow\.md$/.test(lower) ? 'get_flow also checks it against the slides.' : '';
        return {
          path: rel, lines: total, from, to, size: buf.length,
          ...(st && st.mtime ? { mtime: iso(st.mtime) } : {}),
          ...(d.bom ? { bom: true } : {}), ...(d.crlf ? { lineEndings: 'CRLF' } : {}),
          ...(d.nonUtf8 ? { encodingWarning: 'This file did not decode as UTF-8 (replacement characters) — it may be Shift_JIS; do not rewrite it, or the text is lost.' } : {}),
          ...(cut || to < total ? { more: `lines ${to + 1}–${total} not shown — pass offset: ${to + 1}` } : {}),
          ...(tabs.some((t) => t.modified) ? { openWithUnsavedEdits: 'MDP has this file open with unsaved edits — this is the file on disk, not the editor\'s text.' } : {}),
          ...(better ? { hint: better } : {}),
          content,
        };
      }

      case 'write_file': {
        const rel = cleanPath(p.path);
        refuse(rel, 'write');
        if (!isTextPath(rel)) throw new Error(`"${rel}": write_file writes text files (.md .txt .json .csv .py .tex .yaml .svg …) — a picture, a PDF or a zip goes in with put_file.`);
        if (typeof p.content !== 'string') throw new Error('"content" (the whole text) is required.');
        const text = normalizeIn(p.content, BOM);
        checkKind(rel, text);
        return lock(baseDir, async () => {
          guardOpen(await openTabs(baseDir, [rel]), p.force);
          const cur = await readMaybe(baseDir, rel);
          if (cur && cur.nonUtf8) throw new Error(`"${rel}" did not decode as UTF-8 — overwriting would lose its text; nothing was written.`);
          const out = encodeText(text, cur || {}, BOM);
          if (cur && sameBytes(cur.buf, out)) return { path: rel, saved: null, note: 'No change — the file already says that.' };
          const backups = cur ? await backupFiles(baseDir, [rel]) : [];
          await mdplink.vfsWrite(vres(baseDir, rel, 'w'), out);
          const r = await afterWrite(baseDir, [{ path: rel, text }]);
          return {
            path: rel, action: cur ? 'replaced' : 'created', bytes: out.length,
            ...(backups[0] ? { backup: backups[0] } : {}),
            ...(cur && (cur.crlf || cur.bom) ? { kept: [cur.bom ? 'BOM' : '', cur.crlf ? 'CRLF line endings' : ''].filter(Boolean).join(' + ') } : {}),
            ...tabNote(r),
          };
        });
      }

      case 'patch_file': {
        const rel = cleanPath(p.path);
        refuse(rel, 'write');
        if (!isTextPath(rel)) throw new Error(`"${rel}": patch_file edits text files — not .${extOf(rel) || '(no extension)'}.`);
        const edits = editsArg(Array.isArray(p.edits) ? p.edits : (p.old_str != null || p.old != null ? [{ old_str: p.old_str ?? p.old, new_str: p.new_str ?? p.new ?? '', all: p.all }] : null));
        return lock(baseDir, async () => {
          guardOpen(await openTabs(baseDir, [rel]), p.force);
          const cur = await readMaybe(baseDir, rel);
          if (!cur) throw new Error(`No file "${rel}" — create it with write_file.`);
          if (cur.nonUtf8) throw new Error(`"${rel}" did not decode as UTF-8 — editing would lose its text; nothing was written.`);
          const { text, replaced } = applyExactEdits(cur.text, edits, rel);
          if (text === cur.text) return { path: rel, saved: null, note: 'No change — the replacements give the same text.' };
          checkKind(rel, text);
          const out = encodeText(text, cur, BOM);
          const backups = await backupFiles(baseDir, [rel]);
          await mdplink.vfsWrite(vres(baseDir, rel, 'w'), out);
          const r = await afterWrite(baseDir, [{ path: rel, text }]);
          return { path: rel, saved: rel, replaced, ...(backups[0] ? { backup: backups[0] } : {}), ...tabNote(r) };
        });
      }

      case 'patch_files': {
        // Several files in ONE step: every edit must match (and every result pass its
        // check) before anything is written — a skill, a flow and a lesson plan changed
        // together, or none of them.
        const files = Array.isArray(p.files) ? p.files : null;
        if (!files || !files.length) throw new Error('"files" = [{path, edits} | {path, content}] is required.');
        if (files.length > PATCH_FILES_MAX) throw new Error(`At most ${PATCH_FILES_MAX} files per call.`);
        const items = files.map((f, i) => {
          const where = `files[${i}]: `;
          const rel = cleanPath(f && f.path, `files[${i}].path`);
          refuse(rel, 'write', where);
          if (!isTextPath(rel)) throw new Error(`${where}"${rel}" is not a text file — put_file writes pictures, PDFs and zips.`);
          const hasContent = typeof f.content === 'string';
          const hasEdits = Array.isArray(f.edits);
          if (hasContent === hasEdits) throw new Error(`${where}give "edits" (exact replacements) or "content" (the whole text) — one of the two.`);
          return { i, where, rel, content: hasContent ? normalizeIn(f.content, BOM) : null, edits: hasEdits ? editsArg(f.edits, where) : null };
        });
        const seen = new Set();
        for (const it of items) {
          if (seen.has(it.rel.toLowerCase())) throw new Error(`${it.where}"${it.rel}" is given twice — put all of its edits in one entry.`);
          seen.add(it.rel.toLowerCase());
        }
        return lock(baseDir, async () => {
          guardOpen(await openTabs(baseDir, items.map((x) => x.rel)), p.force);
          const plan = [];
          for (const it of items) {
            const cur = await readMaybe(baseDir, it.rel);
            if (it.edits && !cur) throw new Error(`${it.where}no file "${it.rel}" — give "content" to create it. Nothing was written.`);
            if (cur && cur.nonUtf8) throw new Error(`${it.where}"${it.rel}" did not decode as UTF-8. Nothing was written.`);
            let text = it.content;
            let replaced;
            if (it.edits) {
              try { ({ text, replaced } = applyExactEdits(cur.text, it.edits, it.rel)); }
              catch (e) { throw new Error(`${it.where}${String((e && e.message) || e)}`); }
            }
            checkKind(it.rel, text, it.where);
            const out = encodeText(text, cur || {}, BOM);
            plan.push({ ...it, cur, text, out, replaced, changed: !cur || !sameBytes(cur.buf, out) });
          }
          const todo = plan.filter((x) => x.changed);
          if (!todo.length) return { saved: [], note: 'No change — every file already says that.' };
          const backups = await backupFiles(baseDir, todo.filter((x) => x.cur).map((x) => x.rel));
          const done = [];
          for (const x of todo) {
            try {
              await mdplink.vfsWrite(vres(baseDir, x.rel, 'w'), x.out);
              done.push(x);
            } catch (e) {
              // Put back what was already written (the bytes read a moment ago; a new file removed).
              const back = [];
              for (const y of done.reverse()) {
                try {
                  if (y.cur) await mdplink.vfsWrite(vres(baseDir, y.rel, 'w'), y.cur.buf);
                  else await mdplink.vfsRemove(vres(baseDir, y.rel, 'w'));
                  back.push(y.rel);
                } catch { /* reported below */ }
              }
              const lost = done.length - back.length;
              throw new Error(`Writing "${x.rel}" failed (${String((e && e.message) || e).slice(0, 160)}). ${done.length ? `The ${done.length} file(s) written before it were put back${lost ? ` — except ${lost}: restore them from .mdp/mcp-backups` : ''}.` : 'Nothing had been written.'}`);
            }
          }
          const r = await afterWrite(baseDir, todo.map((x) => ({ path: x.rel, text: x.text })));
          const same = plan.filter((x) => !x.changed).map((x) => x.rel);
          return {
            saved: todo.map((x) => ({ path: x.rel, action: x.cur ? 'replaced' : 'created', ...(x.replaced != null ? { replaced: x.replaced } : {}) })),
            ...(same.length ? { unchanged: same } : {}),
            ...(backups.length ? { backups } : {}),
            ...tabNote(r),
          };
        });
      }

      case 'put_file': {
        const rel = cleanPath(p.path);
        refuse(rel, 'write');
        const given = ['from', 'base64', 'copy'].filter((k) => p[k] != null && String(p[k]).trim() !== '');
        if (given.length !== 1) throw new Error('Give exactly one source: "from" (an absolute path of a file on this computer, e.g. a figure your script wrote to the temp folder), "base64" (the bytes), or "copy" (another workspace file).');
        let buf;
        let source;
        if (p.from != null && String(p.from).trim()) {
          buf = await readLocalSource(baseDir, p.from);
          source = { from: String(p.from).trim() };
        } else if (p.base64 != null && String(p.base64).trim()) {
          const b64 = String(p.base64).trim().replace(/^data:[^,]*,/, '');
          if (b64.length > (BASE64_MAX_BYTES * 4) / 3 + 4) throw new Error(`"base64" is more than ${mb(BASE64_MAX_BYTES)} — write the file to the temp folder and give "from" instead.`);
          buf = Buffer.from(b64, 'base64');
          source = { base64: `${buf.length} bytes` };
        } else {
          const src = cleanPath(p.copy, 'copy');
          const st = await statMaybe(baseDir, src);
          if (!st || st.isDir) throw new Error(`"copy": no file "${src}".`);
          if (st.size > PUT_MAX_BYTES) throw new Error(`"copy" is ${mb(st.size)} — more than put_file takes (${mb(PUT_MAX_BYTES)}).`);
          buf = await mdplink.vfsReadBuffer(vres(baseDir, src));
          source = { copy: src };
        }
        const { text, fmt } = checkBytes(rel, buf);
        if (text != null) checkKind(rel, text);
        return lock(baseDir, async () => {
          guardOpen(await openTabs(baseDir, [rel]), p.force);
          const cur = await statMaybe(baseDir, rel);
          if (cur && cur.isDir) throw new Error(`"${rel}" is a folder.`);
          const before = cur ? await mdplink.vfsReadBuffer(vres(baseDir, rel)).catch(() => null) : null;
          if (before && sameBytes(before, buf)) return { path: rel, saved: null, note: 'No change — the file already has these bytes.' };
          const backups = cur ? await backupFiles(baseDir, [rel]) : [];
          await mdplink.vfsWrite(vres(baseDir, rel, 'w'), buf);
          const r = await afterWrite(baseDir, [{ path: rel, text: text != null && fmt ? text : null }]);
          return {
            path: rel, action: cur ? 'replaced' : 'created', bytes: buf.length, ...source,
            ...(backups[0] ? { backup: backups[0] } : {}),
            ...(/\.svg$/i.test(rel) && cur ? { note: 'The open deck\'s preview and MDP\'s renders draw the new SVG (MDP keeps inline SVGs by path — they were dropped).' } : {}),
            ...tabNote(r),
          };
        });
      }

      case 'list_files': {
        const dir = p.dir != null && String(p.dir).trim() !== '' && String(p.dir).trim() !== '.' ? cleanPath(String(p.dir), 'dir') : '';
        const glob = p.glob != null ? String(p.glob).trim() : '';
        const re = glob ? globRe(glob) : null;
        const recursive = !!p.recursive || /\*\*|\//.test(glob);
        const max = Math.min(Math.max(Number(p.limit) || 1000, 1), LIST_MAX);
        const top = await statMaybe(baseDir, dir);
        if (dir && (!top || !top.isDir)) {
          const hint = !top && !/\.mdplink(\/|$)/i.test(dir) ? ' (a linked folder is written with its .mdplink, e.g. "KJNAS.mdplink/@personal/…")' : '';
          throw new Error(top ? `"${dir}" is a file, not a folder.` : `No folder "${dir}"${hint}.`);
        }
        const out = [];
        let truncated = false;
        const walk = async (rel, sub, depth) => {
          let entries;
          try { entries = await mdplink.vfsList(vres(baseDir, rel)); }
          catch (e) { if (depth === 0) throw new Error(`Cannot list "${rel || '(workspace root)'}": ${String((e && e.message) || e).slice(0, 160)}`); return; }
          entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
          for (const e of entries) {
            if (out.length >= max) { truncated = true; return; }
            const childRel = rel ? `${rel}/${e.name}` : e.name;
            const childSub = sub ? `${sub}/${e.name}` : e.name;
            const link = !e.isDir && /\.mdplink$/i.test(e.name);
            const type = e.isDir ? 'dir' : link ? 'link' : 'file';
            if (!re || re.test(childSub)) {
              let { size, mtime } = e;
              if (type === 'file' && (size == null || mtime == null)) {
                const st = await statMaybe(baseDir, childRel);
                if (st) { size = st.size; mtime = st.mtime; }
              }
              out.push({ path: childRel, type, ...(type === 'file' && size != null ? { size } : {}), ...(mtime ? { mtime: iso(mtime) } : {}) });
            }
            const skip = SKIP_DIRS.has(e.name) || (SKIP_UNDER_MDP.has(e.name) && /(^|\/)\.mdp$/i.test(rel));
            if (recursive && e.isDir && !skip) await walk(childRel, childSub, depth + 1);
          }
        };
        await walk(dir, '', 0);
        let hashed = 0;
        if (p.md5) {
          for (const f of out) {
            if (f.type !== 'file' || hashed >= MD5_MAX_FILES || (f.size || 0) > MD5_MAX_BYTES) continue;
            try { f.md5 = crypto.createHash('md5').update(await mdplink.vfsReadBuffer(vres(baseDir, f.path))).digest('hex'); hashed++; } catch { /* unreadable */ }
          }
        }
        const files = out.filter((x) => x.type === 'file');
        return {
          dir: dir || '(workspace root)', ...(glob ? { glob } : {}), ...(recursive ? { recursive: true } : {}),
          count: out.length, files: files.length, bytes: files.reduce((s, f) => s + (f.size || 0), 0),
          ...(truncated ? { truncated: `the first ${max} — narrow it with glob, or raise limit (≤ ${LIST_MAX})` } : {}),
          ...(p.md5 && files.length > hashed ? { md5Skipped: files.length - hashed } : {}),
          entries: out,
          ...(out.some((x) => x.type === 'link') ? { note: 'type "link" = a .mdplink folder link: list it as a dir by its path with .mdplink (a recursive listing does not enter links).' } : {}),
        };
      }

      case 'delete_file': {
        // Never gone: the bytes move into .mdp/mcp-backups/deleted/<time>/ first, and
        // the file is removed only once they are there.
        const rel = cleanPath(p.path);
        refuse(rel, 'delete');
        return lock(baseDir, async () => {
          const st = await statMaybe(baseDir, rel);
          if (!st) throw new Error(`No file "${rel}".`);
          if (st.isDir) {
            const inside = await mdplink.vfsList(vres(baseDir, rel)).catch(() => null);
            if (!inside) throw new Error(`Cannot read the folder "${rel}".`);
            if (inside.length) throw new Error(`"${rel}" is a folder with ${inside.length} item(s) — delete its files first (each is kept in .mdp/mcp-backups); an empty folder is removed.`);
            await mdplink.vfsRemove(vres(baseDir, rel, 'w'));
            await afterWrite(baseDir, [], [rel]);
            return { deleted: rel, type: 'dir', note: 'An empty folder — nothing to keep.' };
          }
          guardOpen(await openTabs(baseDir, [rel]), p.force, 'deleted');
          const buf = await mdplink.vfsReadBuffer(vres(baseDir, rel));
          const bak = `.mdp/mcp-backups/deleted/${stamp()}/${flat(rel)}`;
          await mdplink.vfsWrite(vres(baseDir, bak, 'w'), buf);
          const kept = await statMaybe(baseDir, bak);
          if (!kept || kept.size !== buf.length) throw new Error(`Could not keep a copy of "${rel}" in .mdp/mcp-backups — it was NOT deleted.`);
          await mdplink.vfsRemove(vres(baseDir, rel, 'w'));
          const r = await afterWrite(baseDir, [], [rel]);
          const deck = /\.slide\.md$/i.test(rel);
          return {
            deleted: rel, bytes: buf.length, movedTo: bak,
            // A deck comes back through the deck tools (put_file never writes one).
            restore: deck
              ? `read_file {"path": ${JSON.stringify(bak)}} and write_deck {"path": ${JSON.stringify(rel)}, "content": <that text>}`
              : `put_file {"path": ${JSON.stringify(rel)}, "copy": ${JSON.stringify(bak)}}`,
            ...(deck ? { note: 'Its review, flow and rehearsal files (if any) stay beside it.' } : {}),
            ...tabNote(r),
          };
        });
      }

      case 'inspect_pdf': {
        const rel = cleanPath(p.path);
        if (!/\.pdf$/i.test(rel)) throw new Error('"path" must be a .pdf file.');
        const st = await statMaybe(baseDir, rel);
        if (!st || st.isDir) throw new Error(`No PDF "${rel}".`);
        const pages = p.pages == null ? undefined
          : Array.isArray(p.pages) ? p.pages.map(Number).filter((n) => Number.isInteger(n) && n > 0)
            : String(p.pages).split(',').flatMap((part) => {
              const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
              if (!m) return [];
              const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
              return Array.from({ length: Math.max(0, Math.min(b, a + 500) - a + 1) }, (_, k) => a + k);
            });
        const r = await rly(baseDir, 'inspectPdf', {
          path: rel, pages, sheet: p.sheet !== false, text: !!p.text,
          width: p.width != null ? Number(p.width) : undefined,
        }, 170000);
        return { ...r, size: st.size, ...(st.mtime ? { mtime: iso(st.mtime) } : {}) };
      }

      default:
        throw new Error(`Unknown tool: ${method}`);
    }
  }

  return { handles: (m) => METHODS.has(m), handle };
}

module.exports = { createFileTools, cleanPath, protectedReason, isTextPath, globRe, METHODS };
