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

// --- SKILL.md ------------------------------------------------------------------
// A small YAML subset is enough for skill frontmatter: `key: value` scalars
// (quoted or bare, true/false), `key: >` / `key: |` blocks and `- item` lists.
function parseFrontmatter(text) {
  const src = stripBom(String(text)).replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { data: {}, body: src, hasFrontmatter: false };
  const data = {};
  const lines = m[1].split('\n');
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
    value = value.replace(/\s+#.*$/, '');
    data[key] = /^(true|yes|on)$/i.test(value) ? true : /^(false|no|off)$/i.test(value) ? false : unquote(value);
  }
  return { data, body: src.slice(m[0].length), hasFrontmatter: true };
}

function unquote(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? inner.replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n') : inner.replace(/''/g, "'");
  }
  return s;
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
  const { data, body, hasFrontmatter } = parseFrontmatter(text);
  const fmName = clean(data.name, 64);
  return {
    name: folderName,
    ...(fmName && fmName !== folderName ? { title: fmName } : {}),
    description: clean(data.description, 1024),
    always: data.always === true,
    ...(Array.isArray(data.tags) ? { tags: data.tags.map((t) => clean(t, 40)).filter(Boolean).slice(0, 12) } : {}),
    body: body.trim(),
    checklist: extractChecklist(body),
    ...(hasFrontmatter ? {} : { problem: 'no frontmatter — start SKILL.md with ---, name:, description:, ---' }),
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
};
