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

/** Set (or add) a `key: value` line in the frontmatter, keeping everything else. */
export function setFrontmatterScalar(text: string, key: string, value: string | boolean): string {
  const src = text.replace(/\r\n?/g, '\n');
  const v = typeof value === 'boolean' ? String(value) : /^[\w.-]+$/.test(value) ? value : JSON.stringify(value);
  const m = /^---\n([\s\S]*?)\n---(\n|$)/.exec(src);
  if (!m) return `---\n${key}: ${v}\n---\n\n${src}`;
  const lines = m[1].split('\n');
  const i = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (i >= 0) {
    let j = i + 1;
    while (j < lines.length && /^\s+\S/.test(lines[j])) j++;
    lines.splice(i, j - i, `${key}: ${v}`);
  } else if (key === 'name') {
    lines.unshift(`${key}: ${v}`);
  } else {
    lines.push(`${key}: ${v}`);
  }
  return `---\n${lines.join('\n')}\n---${m[2]}${src.slice(m[0].length)}`;
}
