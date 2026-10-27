'use strict';
// Slide skills — the author's own GUIDES for making slides in a folder, kept in its
// `.mdp` so an AI authoring through MCP follows them (the slide spec lists them,
// get_skill reads one; see app/mcp-bridge.cjs). Same layout as Agent Skills, so a
// skill also works as-is in Claude Code / claude.ai:
//
//   <cdir>/skills/<name>/SKILL.md   ---
//                                   name: lecture-slides
//                                   description: When to read it (what it covers).
//                                   always: true        # optional: whole text in the spec
//                                   ---
//                                   Markdown guide … optionally a "## Checklist" section
//   <cdir>/skills/<name>/<files>    optional references (example decks, word lists …)
//
// Skills cascade like the other `.mdp` assets: the chain is root→nearest and a
// NEARER `.mdp` wins on a name clash (so a subfolder can replace a parent's skill).
// Shared by app/main.cjs, server.cjs and app/mcp-bridge.cjs.

const MAX_SKILL = 256 * 1024;       // SKILL.md
const MAX_FILE = 256 * 1024;        // a reference file handed to the AI
const MAX_FILES = 60;
const SKILL_FILE = 'SKILL.md';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const TEXT_EXT = /\.(md|markdown|txt|json|csv|tsv|css|xml|ya?ml|html?|js|ts|py|tex|bib)$/i;

const clean = (s, max = 2000) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// --- frontmatter ---------------------------------------------------------------
// ONE definition of where a Markdown file's frontmatter is, for the reader
// (parseFrontmatter: skills, glossaries, personas) AND for every writer that changes a
// field (setFrontmatterLine below: the bridge's skill setters, glossary.cjs setField;
// the bridge's appendToSection; features/skills/skillTemplates.ts mirrors it): a BOM,
// CRLF and empty lines above the opening `---` (an editor's stray newline) are allowed,
// the dashes may carry trailing blanks, and `...` may close the block. A writer
// stricter than the reader once missed the frontmatter and PREPENDED a second one
// (2026-10-27: a `description` patch on a SKILL.md whose first line was empty — the
// reader reads only the first block, so the skill lost its `name` and `always`).
const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n(---|\.\.\.)[ \t]*(\n|$)/;
// What our frontmatters hold: a block of YAML-like lines with one of these keys is a
// frontmatter, not a thematic break followed by text.
const FRONTMATTER_KEYS = /^(name|description|always|tags|lang|primary|title)$/;

/** The text as the frontmatter is looked for in (BOM dropped, LF, no empty lines above
 *  the opening `---`) and its parts: `inner` (null = no frontmatter), `close` (--- or
 *  ...), `head` (the whole block with its line end) and `body`. */
function splitFrontmatter(text) {
  const src = stripBom(String(text ?? '')).replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+(?=---)/, '');
  const m = FRONTMATTER_RE.exec(src);
  return m
    ? { src, inner: m[1], close: m[2], head: m[0], body: src.slice(m[0].length) }
    : { src, inner: null, close: '---', head: '', body: src };
}

/** The keys of a SECOND frontmatter block right under the first (only empty lines
 *  between) — what a writer that missed the first one leaves behind. The reader
 *  ignores it, so its fields are lost. null when there is none. */
function strayFrontmatter(body) {
  const m = FRONTMATTER_RE.exec(String(body ?? '').replace(/^(?:[ \t]*\n)+(?=---)/, ''));
  if (!m) return null;
  const lines = m[1].split('\n').filter((l) => l.trim() && !/^\s*#/.test(l));
  if (!lines.length || !lines.every((l) => /^[A-Za-z_][\w-]*\s*:/.test(l) || /^\s/.test(l) || /^-\s/.test(l))) return null;
  const keys = lines.map((l) => (/^([A-Za-z_][\w-]*)\s*:/.exec(l) || [])[1]).filter(Boolean);
  return keys.some((k) => FRONTMATTER_KEYS.test(k)) ? keys : null;
}
const strayProblem = (keys) => `a second frontmatter block under the first (${keys.join(', ')}) is ignored, so those fields are lost — merge the two into one`;

// A small YAML subset is enough for our frontmatter: `key: value` scalars (quoted — a
// ` #` inside is text — or bare, true/false), `key: >` / `key: |` blocks and `- item`
// lists. `stray`: the keys of a second block under it (strayFrontmatter).
function parseFrontmatter(text) {
  const { src, inner, body } = splitFrontmatter(text);
  if (inner == null) return { data: {}, body: src, hasFrontmatter: false };
  const data = {};
  const lines = inner.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    const block = /^([>|])[-+]?$/.exec(value);
    if (block || value === '') {
      const rest = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) rest.push(lines[++i]);
      const items = rest.filter((l) => l.trim()).map((l) => l.trim());
      if (!block && items.length && items.every((l) => l.startsWith('- '))) {
        data[key] = items.map((l) => unquote(l.slice(2).trim()));
      } else if (block) {
        data[key] = block[1] === '|' ? rest.map((l) => l.replace(/^\s{1,4}/, '')).join('\n').trim() : items.join(' ');
      } else {
        data[key] = '';
      }
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
      continue;
    }
    const quoted = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)')\s*(?:#.*)?$/.exec(value);
    if (quoted) {
      data[key] = quoted[1] !== undefined ? unescapeDouble(quoted[1]) : quoted[2].replace(/''/g, "'");
      continue;
    }
    value = value.replace(/\s+#.*$/, '');
    data[key] = /^(true|yes|on)$/i.test(value) ? true : /^(false|no|off)$/i.test(value) ? false : unquote(value);
  }
  const stray = strayFrontmatter(body);
  return { data, body, hasFrontmatter: true, ...(stray ? { stray } : {}) };
}

// A double-quoted scalar's escapes (\" \\ \n \t \uXXXX …) in ONE pass: `\\n` is a
// backslash and an n, not a line break.
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
const unescapeDouble = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (m, c) => (c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ESCAPES[c] ?? c));

function unquote(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? unescapeDouble(inner) : inner.replace(/''/g, "'");
  }
  return s;
}

// A YAML scalar for a frontmatter line: plain when that is unambiguous, else quoted —
// either way parseFrontmatter reads back the text (whitespace runs made one space).
function yamlScalar(value) {
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s && !/^[-?:,[\]{}#&*!|>'"%@`\s]/.test(s) && !/:\s|\s#|:$/.test(s) && !/^(true|false|yes|no|on|off|null|~|[\d.+-]+)$/i.test(s)
    ? s : JSON.stringify(s);
}

/** Set one field of a Markdown file's frontmatter to `line` ("key: value"), or drop it
 *  (`line` null), every other line kept — the frontmatter found as parseFrontmatter
 *  finds it; a file without one gets one (when there is a line to write). The result
 *  is then READ BACK as parseFrontmatter reads it: `key` must give `expect` (when
 *  given; nothing when dropped), every other field what it gave before, and no second
 *  block may follow — else this throws, and the caller writes nothing. A file that
 *  already has a second block is refused as well (which of the two is meant is the
 *  author's call). → the text with LF line ends, without a BOM or empty lines above
 *  the frontmatter (the caller puts its BOM / CRLF back). */
function setFrontmatterLine(text, key, line, expect) {
  const fm = splitFrontmatter(text);
  const before = parseFrontmatter(fm.src);
  if (before.stray) throw new Error(`Could not change "${key}": ${strayProblem(before.stray)}. Nothing was written.`);
  let out;
  if (fm.inner == null) {
    out = line == null ? fm.src : `---\n${line}\n---\n\n${fm.src}`;
  } else {
    const lines = fm.inner.split('\n');
    const own = new RegExp(`^${key}\\s*:`);
    const kept = [];
    let placed = line == null;
    for (let i = 0; i < lines.length; i++) {
      if (!own.test(lines[i])) { kept.push(lines[i]); continue; }
      // the field's own lines: a block scalar's or a list's (indented, empty ones between)
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s+\S/.test(lines[j])) i = j;
        else if (lines[j].trim()) break;
      }
      if (!placed) { kept.push(line); placed = true; }     // in its place; a second copy dropped
    }
    if (!placed) { if (key === 'name') kept.unshift(line); else kept.push(line); }   // name leads, as in Agent Skills
    out = kept.some((l) => l.trim())
      ? `---\n${kept.join('\n')}\n${fm.close}${fm.head.endsWith('\n') ? '\n' : ''}${fm.body}`
      : fm.body.replace(/^\n(?=\n)/, '');                   // nothing left: no empty block
  }
  const after = parseFrontmatter(out);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const lost = Object.keys(before.data).filter((k) => k !== key && !same(after.data[k], before.data[k]));
  const why = after.stray ? strayProblem(after.stray)
    : line != null && !after.hasFrontmatter ? 'the result would have no frontmatter'
    : lost.length ? `${lost.join(', ')} would no longer read as before`
    : line == null ? (after.data[key] !== undefined ? `"${key}" would still be there` : '')
    : expect !== undefined && !same(after.data[key], expect) ? `it would read ${JSON.stringify(after.data[key])}, not ${JSON.stringify(expect)}` : '';
  if (why) throw new Error(`Could not change "${key}" in the frontmatter safely: ${why}. Nothing was written.`);
  return out;
}

// A heading that opens the skill's self-check. (Not `\b`: after Japanese text there
// is no word boundary in a JS regex.)
const isChecklistHeading = (text) =>
  /^(checklist|self-?check|review checklist|チェックリスト|確認項目|セルフチェック)(?![A-Za-z0-9_])/i.test(String(text).trim());

// The skill's self-check: the list items under a "Checklist" (チェックリスト /
// Self-check / 確認項目) heading, up to the next heading of the same or a higher
// level. check_deck / verify:true hand them back so the AI reviews its own deck.
function extractChecklist(body) {
  const lines = String(body).split('\n');
  const out = [];
  let level = 0;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      if (level && h[1].length <= level) break;
      if (!level && isChecklistHeading(h[2])) level = h[1].length;
      continue;
    }
    if (!level) continue;
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (item) out.push(clean(item[1], 400));
  }
  return out.slice(0, 40);
}

/** Parse a SKILL.md text into the fields MDP uses. `name` is the folder name —
 *  the identity get_skill takes; a different frontmatter name is kept as `title`. */
function parseSkill(text, folderName) {
  const { data, body, hasFrontmatter, stray } = parseFrontmatter(text);
  const fmName = clean(data.name, 64);
  return {
    name: folderName,
    ...(fmName && fmName !== folderName ? { title: fmName } : {}),
    description: clean(data.description, 1024),
    always: data.always === true,
    ...(Array.isArray(data.tags) ? { tags: data.tags.map((t) => clean(t, 40)).filter(Boolean).slice(0, 12) } : {}),
    body: body.trim(),
    checklist: extractChecklist(body),
    ...(!hasFrontmatter ? { problem: 'no frontmatter — start SKILL.md with ---, name:, description:, ---' }
      : stray ? { problem: strayProblem(stray), stray } : {}),
  };
}

// --- listing ------------------------------------------------------------------
async function listFilesUnder(vfs, resolveTarget, dir, prefix = '', depth = 0, out = []) {
  let entries = [];
  try { entries = await vfs.vfsList(resolveTarget(prefix ? `${dir}/${prefix}` : dir)); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_FILES || e.name.startsWith('.')) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDir) { if (depth < 2) await listFilesUnder(vfs, resolveTarget, dir, rel, depth + 1, out); }
    else if (rel !== SKILL_FILE) out.push(rel);
  }
  return out;
}

/** Every skill available to a deck whose `.mdp` chain is `chain` (root→nearest),
 *  NEAREST winning on a name clash. `resolveTarget` maps a workspace-relative path
 *  to a VFS target (mdplink.resolve / the server's `vres`). `withFiles` also lists
 *  each skill's reference files. */
async function listSkills(chain, resolveTarget, vfs, { withFiles = false } = {}) {
  const byName = new Map();
  for (const cdir of chain) {
    let dirs = [];
    try { dirs = (await vfs.vfsList(resolveTarget(`${cdir}/skills`))).filter((e) => e.isDir && NAME_RE.test(e.name)); }
    catch { continue; }                       // no skills folder in this `.mdp`
    for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = `${cdir}/skills/${d.name}`;
      let text;
      try { text = String(await vfs.vfsReadText(resolveTarget(`${dir}/${SKILL_FILE}`))); }
      catch { continue; }                     // a folder without SKILL.md is not a skill
      const skill = {
        ...parseSkill(text.slice(0, MAX_SKILL), d.name),
        path: `${dir}/${SKILL_FILE}`,
        dir,
        configDir: cdir,
        ...(text.length > MAX_SKILL ? { truncated: true } : {}),
      };
      if (withFiles) skill.files = await listFilesUnder(vfs, resolveTarget, dir);
      byName.set(d.name.toLowerCase(), skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A skill's reference files (paths relative to its folder; SKILL.md excluded). */
function listSkillFiles(skill, resolveTarget, vfs) {
  return listFilesUnder(vfs, resolveTarget, skill.dir);
}

/** Find a skill by folder name (or its frontmatter name), case-insensitively. */
function findSkill(skills, name) {
  const key = String(name || '').trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  return skills.find((s) => s.name.toLowerCase() === key) || skills.find((s) => (s.title || '').toLowerCase() === key) || null;
}

/** Validate a reference-file path relative to a skill folder: no "..", no hidden
 *  names, at most two folders deep. Returns the normalized path. */
function checkSkillFilePath(file) {
  const rel = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segs = rel.split('/');
  if (!rel || segs.some((s) => !s || s === '.' || s === '..' || s.startsWith('.'))) {
    throw new Error('"file" must be a path inside the skill folder (no "..", no hidden names).');
  }
  if (segs.length > 3) throw new Error('"file" may be at most two folders deep inside the skill.');
  return rel;
}
const isSkillTextFile = (rel) => TEXT_EXT.test(rel) || /\.slide\.md$/i.test(rel);

/** Read one reference file of a skill (a path relative to its folder). Text only —
 *  an image is handed back as a path for read_image. */
async function readSkillFile(skill, file, resolveTarget, vfs) {
  const rel = checkSkillFilePath(file);
  const path = `${skill.dir}/${rel}`;
  if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(rel)) return { path, image: true, hint: 'Look at it with read_image (path).' };
  if (!isSkillTextFile(rel)) throw new Error(`"${rel}" is not a text file get_skill can return.`);
  const text = String(await vfs.vfsReadText(resolveTarget(path)));
  return { path, content: text.slice(0, MAX_FILE), ...(text.length > MAX_FILE ? { truncated: true } : {}) };
}

module.exports = {
  listSkills, listSkillFiles, findSkill, readSkillFile, checkSkillFilePath, isSkillTextFile,
  parseSkill, parseFrontmatter, extractChecklist, isChecklistHeading, SKILL_FILE, NAME_RE,
  splitFrontmatter, strayFrontmatter, strayProblem, setFrontmatterLine, yamlScalar,
};
