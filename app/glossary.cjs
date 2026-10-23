'use strict';
// Glossaries — how the NARRATOR reads the terms of a field, kept in a folder's `.mdp`
// so a deck never has to spell every reading out with a ruby ([[SHAP|シャップ]]).
// One file per field, reused by every deck beneath the folder:
//
//   <cdir>/glossary/<name>.md    ---
//                                description: 機械学習の用語の読み     # optional
//                                lang: ja                              # optional (see below)
//                                ---
//                                | 用語 | 読み | メモ |
//                                |---|---|---|
//                                | Shapley値 | シャプレーち | |
//                                | SHAP | シャップ | 説明手法 |
//
// The terms are Markdown table rows: the columns named 用語 / term and 読み / reading
// (else the first two); others (メモ, note…) are for people. Text around the tables
// is free. `lang`: the narration language the readings are for (a ja glossary must
// not turn "SHAP" into katakana in an English line); without it, Japanese readings
// mean ja, anything else applies to every line.
//
// Glossaries cascade like the other `.mdp` assets: the chain is root→nearest, and a
// NEARER `.mdp` wins — on a file name (a subfolder can replace a parent's glossary)
// and, when the renderer merges them, on a term. Shared by app/main.cjs, server.cjs
// and app/mcp-bridge.cjs.

const { parseFrontmatter } = require('./skills.cjs');

const DIR = 'glossary';
const MAX_FILE = 512 * 1024;
const MAX_TERMS = 5000;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;
const JA = /[぀-ヿ㐀-鿿]/;

const clean = (s, max = 2000) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

// --- one file ------------------------------------------------------------------
const TERM_COL = /^(用語|語|表記|term|terms|word|words)$/i;
const READING_COL = /^(読み|よみ|読み方|reading|readings|yomi|pronunciation|発音)$/i;
const NOTE_COL = /^(メモ|備考|説明|意味|note|notes|description|meaning)$/i;

/** A table row's cells (`| a | b |`), `\|` kept as a literal pipe. */
function rowCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}
const isDelimiterRow = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
// A cell written as code (`SHAP`) means the bare term.
const bare = (cell) => { const m = /^`([^`]+)`$/.exec(cell); return m ? m[1] : cell; };
// What a term and a reading may hold: they become a narration ruby [[term|reading]].
const termProblem = (t) => (/[[\]|\n]/.test(t) ? 'a term cannot hold [ ] or |' : '');
const readingProblem = (r) => (/[[\]|\n]/.test(r) ? 'a reading cannot hold [ ] or |' : '');

/** Parse a glossary file: its terms (in file order; a term twice → the later row,
 *  noted), description, lang (given, or inferred from the readings) and problems. */
function parseGlossary(text, name = '') {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const { data, body } = parseFrontmatter(src);
  const lines = body.split('\n');
  const offset = src.split('\n').length - lines.length;     // the frontmatter's lines
  const terms = new Map();
  const problems = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence || !/^\s*\|/.test(line)) continue;
    // a table: its header (when a delimiter row follows), then its rows
    let ti = 0;
    let ri = 1;
    let ni = -1;
    let start = i;
    if (i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const head = rowCells(line);
      const t = head.findIndex((h) => TERM_COL.test(h));
      const r = head.findIndex((h) => READING_COL.test(h));
      if (t >= 0) ti = t;
      if (r >= 0) ri = r; else if (t >= 0) ri = t === 0 ? 1 : 0;
      ni = head.findIndex((h) => NOTE_COL.test(h));
      start = i + 2;
    }
    let j = start;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      if (isDelimiterRow(lines[j])) continue;
      const cells = rowCells(lines[j]);
      const term = bare(clean(cells[ti] || '', 200));
      const reading = clean(cells[ri] || '', 400);
      if (!term && !reading) continue;
      const lineNo = offset + j + 1;
      if (!term || !reading) { problems.push(`line ${lineNo}: ${!term ? 'no term' : `no reading for "${term}"`}`); continue; }
      const bad = termProblem(term) || readingProblem(reading);
      if (bad) { problems.push(`line ${lineNo}: "${term}" — ${bad}`); continue; }
      if (terms.has(term)) problems.push(`line ${lineNo}: "${term}" is given twice — the later reading is used`);
      if (terms.size >= MAX_TERMS && !terms.has(term)) { problems.push(`more than ${MAX_TERMS} terms — the rest are ignored`); break; }
      const note = ni >= 0 ? clean(cells[ni] || '', 400) : '';
      terms.set(term, { term, reading, ...(note ? { note } : {}) });
    }
    i = j - 1;
  }
  const list = [...terms.values()];
  const given = clean(data.lang, 20).toLowerCase();
  const japanese = list.filter((t) => JA.test(t.reading)).length;
  const lang = given || (list.length && japanese * 2 >= list.length ? 'ja' : '');
  return {
    name,
    description: clean(data.description, 1024),
    lang,
    ...(given ? {} : { langInferred: true }),
    terms: list,
    problems,
  };
}

// --- listing ------------------------------------------------------------------
/** Every glossary available to a deck whose `.mdp` chain is `chain` (root→nearest),
 *  in that order — a nearer `.mdp`'s file of the same name REPLACES a parent's.
 *  `resolveTarget` maps a workspace-relative path to a VFS target. */
async function listGlossaries(chain, resolveTarget, vfs) {
  const byName = new Map();
  for (const cdir of chain) {
    let files = [];
    try { files = (await vfs.vfsList(resolveTarget(`${cdir}/${DIR}`))).filter((e) => !e.isDir && /\.md$/i.test(e.name) && !e.name.startsWith('.')); }
    catch { continue; }                       // no glossary folder in this `.mdp`
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = f.name.replace(/\.md$/i, '');
      if (!NAME_RE.test(name)) continue;
      const path = `${cdir}/${DIR}/${f.name}`;
      let text;
      try { text = String(await vfs.vfsReadText(resolveTarget(path))); } catch { continue; }
      byName.delete(name.toLowerCase());      // re-insert: the nearer one comes later
      byName.set(name.toLowerCase(), {
        ...parseGlossary(text.slice(0, MAX_FILE), name),
        path,
        configDir: cdir,
        ...(text.length > MAX_FILE ? { truncated: true } : {}),
      });
    }
  }
  return [...byName.values()];
}

/** Find a glossary by name, case-insensitively. */
function findGlossary(glossaries, name) {
  const key = String(name || '').trim().replace(/\.md$/i, '').toLowerCase();
  return glossaries.find((g) => g.name.toLowerCase() === key) || null;
}

const primary = (lang) => String(lang || '').toLowerCase().split(/[-_]/)[0];
const termKey = (lang, term) => `${primary(lang)}\u0000${term}`;

/** The terms in effect for a deck: every glossary merged in chain order, a later
 *  (nearer) one winning on a term of its language (as the renderer's
 *  mergeGlossaries). → [{ term, reading, note?, lang, from }] */
function mergeTerms(glossaries) {
  const map = new Map();
  for (const g of glossaries) for (const t of g.terms) map.set(termKey(g.lang, t.term), { ...t, lang: g.lang, from: g.name });
  return [...map.values()];
}

/** The same term with different readings in two glossaries the deck gets (for the
 *  same language — the later one is used). */
function conflicts(glossaries) {
  const seen = new Map();
  const out = [];
  for (const g of glossaries) {
    for (const t of g.terms) {
      const k = termKey(g.lang, t.term);
      const prev = seen.get(k);
      if (prev && prev.reading !== t.reading) {
        out.push({ term: t.term, readings: [{ glossary: prev.from, reading: prev.reading }, { glossary: g.name, reading: t.reading }], used: t.reading });
      }
      seen.set(k, { reading: t.reading, from: g.name });
    }
  }
  return out;
}

// --- writing (MCP) ------------------------------------------------------------
const escCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
const row = (t) => `| ${escCell(t.term)} | ${escCell(t.reading)} | ${escCell(t.note || '')} |`;
const yamlLine = (key, value) => `${key}: ${JSON.stringify(String(value))}`;

/** A whole glossary file. */
function renderGlossary({ title = '', description = '', lang = '', terms = [] } = {}) {
  const fm = ['---', ...(description ? [yamlLine('description', description)] : []), ...(lang ? [`lang: ${lang}`] : []), '---'];
  return [
    ...(fm.length > 2 ? fm : []),
    ...(fm.length > 2 ? [''] : []),
    ...(title ? [`# ${title}`, ''] : []),
    '| 用語 | 読み | メモ |',
    '|---|---|---|',
    ...terms.map(row),
    '',
  ].join('\n');
}

/** Change terms in a glossary's Markdown, keeping everything else: a term already
 *  there gets its reading (and note, when given) in its own row; a new term is a new
 *  row at the end of the last table (a table is added when there is none); `remove`
 *  deletes rows. → { text, updated, added, removed, missing } */
function setTerms(text, set = [], remove = []) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const want = new Map(set.map((t) => [t.term, t]));
  const drop = new Set(remove);
  const out = [];
  let updated = 0;
  let removed = 0;
  let lastRow = -1;
  let inFence = false;
  // columns of the table being read
  let ti = 0;
  let ri = 1;
  let ni = -1;
  let width = 3;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const tableLine = !inFence && /^\s*\|/.test(line);
    if (tableLine && i + 1 < lines.length && isDelimiterRow(lines[i + 1])) {
      const head = rowCells(line);
      const t = head.findIndex((h) => TERM_COL.test(h));
      const r = head.findIndex((h) => READING_COL.test(h));
      ti = t >= 0 ? t : 0;
      ri = r >= 0 ? r : (t === 0 || t < 0 ? 1 : 0);
      ni = head.findIndex((h) => NOTE_COL.test(h));
      width = head.length;
      out.push(line, lines[i + 1]);
      lastRow = out.length - 1;
      i++;
      continue;
    }
    if (tableLine && !isDelimiterRow(line)) {
      const cells = rowCells(line);
      const term = bare(cells[ti] || '');
      if (drop.has(term)) { removed++; drop.delete(term); continue; }
      const w = want.get(term);
      if (w) {
        while (cells.length < width) cells.push('');
        cells[ri] = w.reading;
        if (w.note !== undefined && ni >= 0) cells[ni] = w.note;
        out.push(`| ${cells.map(escCell).join(' | ')} |`);
        want.delete(term);
        updated++;
      } else {
        out.push(line);
      }
      lastRow = out.length - 1;
      continue;
    }
    out.push(line);
  }
  const fresh = [...want.values()];
  if (fresh.length) {
    if (lastRow >= 0) {
      out.splice(lastRow + 1, 0, ...fresh.map((t) => {
        const cells = new Array(Math.max(width, 2)).fill('');
        cells[ti] = t.term;
        cells[ri] = t.reading;
        if (ni >= 0) cells[ni] = t.note || '';
        return `| ${cells.map(escCell).join(' | ')} |`;
      }));
    } else {
      while (out.length && !out[out.length - 1].trim()) out.pop();
      out.push('', '| 用語 | 読み | メモ |', '|---|---|---|', ...fresh.map(row), '');
    }
  }
  let result = out.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  return { text: result, updated, added: fresh.length, removed, missing: [...drop] };
}

/** Set (or add / drop) a frontmatter field of a glossary's Markdown. */
function setField(text, key, value) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---(\n|$)/.exec(src);
  const lineOf = value === '' || value == null ? null : (key === 'lang' ? `lang: ${value}` : yamlLine(key, value));
  if (!m) return lineOf ? `---\n${lineOf}\n---\n\n${src}` : src;
  const lines = m[1].split('\n').filter((l) => !new RegExp(`^${key}\\s*:`).test(l));
  if (lineOf) lines.push(lineOf);
  const head = lines.length ? `---\n${lines.join('\n')}\n---${m[2]}` : '';
  return head + src.slice(m[0].length).replace(/^\n(?=\n)/, '');
}

// --- writing (the app: the Configure dialog's term table, the editor's "Add to glossary…")
/** A path a glossary may be written at: `<a folder's .mdp>/glossary/<name>.md`
 *  (workspace-relative). → { cdir, name } or null. */
function glossaryPathParts(rel) {
  const m = /^((?:[^/]+\/)*\.mdp)\/glossary\/([^/]+)\.md$/.exec(String(rel || '').replace(/\\/g, '/'));
  if (!m || !NAME_RE.test(m[2]) || m[1].split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
  return { cdir: m[1], name: m[2] };
}

/** One edit of a glossary file, everything else in it kept: terms set (a new term is
 *  a new row) and removed, the description and lang (undefined = unchanged, '' =
 *  dropped). `text` null = no such file: made when `create` (with the name as its
 *  title). Terms are checked as parseGlossary would read them. → { text, updated,
 *  added, removed, missing, created } */
function editGlossaryText(text, { set = [], remove = [], description, lang, create = false, name = '' } = {}) {
  const terms = (Array.isArray(set) ? set : []).map((t) => ({
    term: clean(t && t.term, 200), reading: clean(t && t.reading, 400),
    ...(t && t.note !== undefined ? { note: clean(t.note, 400) } : {}),
  }));
  for (const t of terms) {
    if (!t.term || !t.reading) throw new Error(`Each term needs a reading${t.term ? ` ("${t.term}")` : ''}.`);
    const bad = termProblem(t.term) || readingProblem(t.reading);
    if (bad) throw new Error(`"${t.term}": ${bad}.`);
  }
  let src = text;
  let created = false;
  if (src == null) {
    if (!create) throw new Error('There is no such glossary.');
    src = renderGlossary({ title: name, description: description || '', lang: lang || '' });
    created = true;
  }
  const r = setTerms(src, terms, (Array.isArray(remove) ? remove : []).map((x) => clean(x, 200)).filter(Boolean));
  let out = r.text;
  if (description !== undefined) out = setField(out, 'description', clean(description, 1024));
  if (lang !== undefined) out = setField(out, 'lang', clean(lang, 20).toLowerCase());
  return { text: out, updated: r.updated, added: r.added, removed: r.removed, missing: r.missing, created };
}

module.exports = {
  DIR, NAME_RE, MAX_TERMS,
  parseGlossary, listGlossaries, findGlossary, mergeTerms, conflicts,
  renderGlossary, setTerms, setField, termProblem, readingProblem,
  glossaryPathParts, editGlossaryText,
};
