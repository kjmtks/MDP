// Pure builders for the CSS that makes workspace fonts usable: one @font-face per
// face, plus the folder's default-font choices as variables. No DOM access here —
// see fontRuntime.ts for injecting / loading.
import type { WorkspaceFont, MdpFontDefaults, FontCategory, FontRequirement } from './fontTypes';

/** A CSS string literal: double quotes, with quote / backslash / control
 *  characters escaped (font.json is workspace content — never paste it raw). */
export function cssString(s: string): string {
  return '"' + String(s)
    .replace(/[\\"]/g, '\\$&')
    // eslint-disable-next-line no-control-regex -- escaping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `) + '"';
}

const GENERIC: Record<FontCategory, string> = {
  'sans-serif': 'sans-serif', serif: 'serif', monospace: 'monospace', other: 'sans-serif',
};
const WEIGHT_RE = /^\d{1,3}( \d{1,3})?$/;
const STYLES = new Set(['normal', 'italic', 'oblique']);
const RANGE_RE = /^[Uu]\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(, [Uu]\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$/;

/** One @font-face per face of every font. `urlFor(path, version)` gives the URL
 *  the platform serves that workspace file at. `font-display: block` — the files
 *  are local, so a brief invisible moment beats text reflowing from a fallback
 *  (which would also skew measurements taken right after load). A face with a
 *  unicode-range is one slice of a split font; the browser fetches only the
 *  slices the text needs. */
export function buildFontFaceCss(fonts: WorkspaceFont[], urlFor: (path: string, version: string) => string): string {
  const out: string[] = [];
  for (const f of fonts) {
    for (const face of f.faces) {
      const weight = WEIGHT_RE.test(face.weight) ? face.weight : '400';
      const style = STYLES.has(face.style) ? face.style : 'normal';
      const range = face.unicodeRange && RANGE_RE.test(face.unicodeRange) ? ` unicode-range: ${face.unicodeRange};` : '';
      out.push(
        `@font-face { font-family: ${cssString(f.family)}; ` +
        `src: url(${cssString(urlFor(face.path, face.version))}) format(${cssString(face.format || 'woff2')}); ` +
        `font-weight: ${weight}; font-style: ${style};${range} font-display: block; }`,
      );
    }
  }
  return out.join('\n');
}

/** A family name as a font-family value: the family, the fallbacks its
 *  declaration names (requirements.json — used where the font is missing), then
 *  the generic family of its category. */
export function familyStack(family: string, fonts: WorkspaceFont[], requirements: FontRequirement[] = []): string {
  const key = family.toLowerCase();
  const known = fonts.find((f) => f.family.toLowerCase() === key);
  const declared = requirements.find((r) => r.family.toLowerCase() === key);
  const names = [family, ...(declared?.fallback || []).filter((f) => f.toLowerCase() !== key)];
  return `${names.map(cssString).join(', ')}, ${GENERIC[known?.category || declared?.category || 'sans-serif']}`;
}

/** The folder's default fonts (content.json `fonts`) as the variables the base
 *  stylesheet and the official themes read (`--mdp-font-body/-heading/-mono`),
 *  plus rules that apply them even under a custom theme that names its own fonts
 *  (`:root` lifts them just above a theme's `.slide-content …` rules, while a
 *  slide's own @addstyle rules for descendants still win). */
export function buildFontDefaultsCss(defaults: MdpFontDefaults, fonts: WorkspaceFont[], requirements: FontRequirement[] = []): string {
  const vars: string[] = [];
  const rules: string[] = [];
  const body = (defaults.body || '').trim();
  const heading = (defaults.heading || '').trim();
  const mono = (defaults.mono || '').trim();
  if (body) {
    vars.push(`--mdp-font-body: ${familyStack(body, fonts, requirements)};`);
    rules.push(':root .slide-content-wrapper, :root .slide-content { font-family: var(--mdp-font-body); }');
  }
  if (heading) {
    vars.push(`--mdp-font-heading: ${familyStack(heading, fonts, requirements)};`);
    rules.push(':root .slide-content :is(h1, h2, h3, h4, h5, h6) { font-family: var(--mdp-font-heading); }');
  }
  if (mono) {
    vars.push(`--mdp-font-mono: ${familyStack(mono, fonts, requirements)};`);
    rules.push(':root .slide-content-wrapper :is(code, kbd, samp, pre, .code-block-wrapper, .code-filename) { font-family: var(--mdp-font-mono); }');
  }
  if (!vars.length) return '';
  return `:root { ${vars.join(' ')} }\n${rules.join('\n')}`;
}

/** Split a CSS font-family list into bare family names (quotes removed). */
export function parseFontFamilies(stack: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  for (const ch of String(stack || '')) {
    if (quote) { if (ch === quote) quote = ''; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ',') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Family names declared by the @font-face rules of a CSS text. */
export function familiesInCss(css: string): string[] {
  const out = new Set<string>();
  for (const m of String(css || '').matchAll(/@font-face\s*\{[^}]*?font-family:\s*"((?:[^"\\]|\\.)*)"/g)) {
    out.add(m[1].replace(/\\(.)/g, '$1'));
  }
  return [...out];
}

/** Short, stable fingerprint (FNV-1a/32) — keys caches on the font setup. */
export function cssSignature(css: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < css.length; i++) h = Math.imul(h ^ css.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
