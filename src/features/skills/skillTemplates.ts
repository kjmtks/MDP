// Starting points for a new slide skill (`.mdp/skills/<name>/SKILL.md`), and the
// small frontmatter edit the Configure dialog needs. The starter guide is the same
// file the MCP bridge hands out (get_asset_templates kind "skill").
import starterGuide from '../../../public/default-skill.md?raw';

export type SkillTemplateKind = 'starter' | 'blank';

// Folder names: letters, digits, - and _ (the same rule as app/mcp-bridge.cjs).
export const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A skill name from free text ("Lecture slides" → "lecture-slides"). */
export const skillSlug = (s: string) =>
  s.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

const BLANK = `---
name: my-skill
description: いつ読むか（何についてのガイドか）を1行で書く．
---

# ガイド

## 決まり

-

## Checklist

-
`;

/** SKILL.md text for a new skill of that name. */
export function skillTemplate(name: string, kind: SkillTemplateKind, always?: boolean): string {
  let text = (kind === 'starter' ? starterGuide : BLANK).replace(/\r\n?/g, '\n');
  text = setFrontmatterScalar(text, 'name', name);
  if (always !== undefined) text = setFrontmatterScalar(text, 'always', always);
  return text;
}

// Where the frontmatter is — found as the reader (app/skills.cjs splitFrontmatter)
// finds it, KEEP IN STEP: a BOM, CRLF and empty lines above the opening `---`, blanks
// after the dashes, `...` closing. A setter stricter than the reader once missed the
// frontmatter and prepended a SECOND one (2026-10-27): the skill lost its `name` and
// `always`.
const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n(---|\.\.\.)[ \t]*(\n|$)/;
const FRONTMATTER_KEYS = /^(name|description|always|tags|lang|primary|title)$/;

interface FrontmatterParts { src: string; inner: string | null; close: string; head: string; body: string }

/** The LF text without a BOM or empty lines above the opening `---`, and its parts. */
export function splitFrontmatter(text: string): FrontmatterParts {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+(?=---)/, '');
  const m = FRONTMATTER_RE.exec(src);
  return m
    ? { src, inner: m[1], close: m[2], head: m[0], body: src.slice(m[0].length) }
    : { src, inner: null, close: '---', head: '', body: src };
}

/** The keys of a second frontmatter block right under the first — the reader ignores
 *  it (skills.cjs strayFrontmatter). */
export function strayFrontmatter(body: string): string[] | null {
  const m = FRONTMATTER_RE.exec(body.replace(/^(?:[ \t]*\n)+(?=---)/, ''));
  if (!m) return null;
  const lines = m[1].split('\n').filter((l) => l.trim() && !/^\s*#/.test(l));
  if (!lines.length || !lines.every((l) => /^[A-Za-z_][\w-]*\s*:/.test(l) || /^\s/.test(l) || /^-\s/.test(l))) return null;
  const keys = lines.map((l) => (/^([A-Za-z_][\w-]*)\s*:/.exec(l) || [])[1]).filter((k): k is string => !!k);
  return keys.some((k) => FRONTMATTER_KEYS.test(k)) ? keys : null;
}

/** The last line of a field: a block scalar's or a list's lines (indented, empty ones
 *  between) go with it. */
function fieldEnd(lines: string[], i: number): number {
  let end = i;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\s+\S/.test(lines[j])) end = j;
    else if (lines[j].trim()) break;
  }
  return end;
}

/** Each field's text in a frontmatter; a key given twice → the later, as the reader. */
function fieldTexts(inner: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = inner.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const k = /^([A-Za-z_][\w-]*)\s*:/.exec(lines[i]);
    if (!k) continue;
    const end = fieldEnd(lines, i);
    out.set(k[1], lines.slice(i, end + 1).join('\n'));
    i = end;
  }
  return out;
}

/** Set (or add) a `key: value` line in the frontmatter, keeping everything else (the
 *  file's BOM and line ends too). Throws — nothing to write — when the result would
 *  not read back: the key's new line, every other field as it was, no second block. */
export function setFrontmatterScalar(text: string, key: string, value: string | boolean): string {
  const bom = text.charCodeAt(0) === 0xfeff;
  const crlf = /\r\n/.test(text);
  const v = typeof value === 'boolean' ? String(value) : /^[\w.-]+$/.test(value) ? value : JSON.stringify(value);
  const line = `${key}: ${v}`;
  const fm = splitFrontmatter(text);
  const stray = fm.inner === null ? null : strayFrontmatter(fm.body);
  if (stray) throw new Error(`This file has a second frontmatter block under the first (${stray.join(', ')}), which is ignored — merge the two into one in the editor first.`);
  let out: string;
  if (fm.inner === null) {
    out = `---\n${line}\n---\n\n${fm.src}`;
  } else {
    const lines = fm.inner.split('\n');
    const own = new RegExp(`^${key}\\s*:`);
    const kept: string[] = [];
    let placed = false;
    for (let i = 0; i < lines.length; i++) {
      if (!own.test(lines[i])) { kept.push(lines[i]); continue; }
      i = fieldEnd(lines, i);
      if (!placed) { kept.push(line); placed = true; }     // in its place; a second copy dropped
    }
    if (!placed) { if (key === 'name') kept.unshift(line); else kept.push(line); }
    out = `---\n${kept.join('\n')}\n${fm.close}${fm.head.endsWith('\n') ? '\n' : ''}${fm.body}`;
  }
  // read it back as the reader will
  const back = splitFrontmatter(out);
  const before = fm.inner === null ? new Map<string, string>() : fieldTexts(fm.inner);
  const after = back.inner === null ? null : fieldTexts(back.inner);
  const changed = after ? [...before].filter(([k, t]) => k !== key && after.get(k) !== t).map(([k]) => k) : [];
  if (!after || after.get(key) !== line || strayFrontmatter(back.body) || changed.length) {
    throw new Error(`Could not set "${key}" in the frontmatter safely${changed.length ? ` (${changed.join(', ')} would change)` : ''} — nothing was written.`);
  }
  return (bom ? '\uFEFF' : '') + (crlf ? out.replace(/\n/g, '\r\n') : out);
}
