// Declared fonts — `<cdir>/fonts/requirements.json` says which fonts the decks
// beneath a `.mdp` need:
//
//   { "version": 1, "fonts": [
//     { "family": "Noto Sans JP", "source": "google" },
//     { "family": "HackGen", "category": "monospace", "license": "OFL-1.1",
//       "source": { "zip": "https://…/HackGen_v2.10.0.zip", "files": ["HackGen-Regular.ttf"] } },
//     { "family": "Hiragino Sans", "note": "Comes with macOS", "fallback": ["Noto Sans JP"] }
//   ] }
//
// An entry with a `source` can be installed (app/fontInstall.cjs downloads it into
// a font package); one without is a plain statement — the font itself is not
// shared, but everyone opening the decks learns what is missing and where to get
// it. Declarations cascade like the other `.mdp` assets: nearest wins by family.
// Pure functions — no DOM, no I/O.
import type {
  FontCategory, FontRequirement, FontRequirementStatus, FontSource, RequirementsFile, WorkspaceFont,
} from './fontTypes';

export const requirementsPath = (configDir: string) => `${configDir}/fonts/requirements.json`;

const CATEGORIES: FontCategory[] = ['sans-serif', 'serif', 'monospace', 'other'];
const clean = (s: unknown, max = 200) =>
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const urlWith = (s: unknown, protocols: string[]) => {
  const v = clean(s, 2000);
  try { return protocols.includes(new URL(v).protocol) ? v : ''; } catch { return ''; }
};
const strings = (a: unknown, max: number) =>
  (Array.isArray(a) ? a.map((x) => clean(x, 300)).filter(Boolean).slice(0, max) : []);

/** A `source` value in its canonical form, or undefined when it is not usable
 *  (downloads are https only). */
export function normalizeSource(src: unknown): FontSource | undefined {
  if (src === 'google') return 'google';
  if (!src || typeof src !== 'object') return undefined;
  const o = src as Record<string, unknown>;
  if (o.google) {
    const weights = (Array.isArray(o.weights) ? o.weights : []).map(Number)
      .filter((w) => Number.isInteger(w) && w >= 1 && w <= 1000);
    const name = typeof o.google === 'string' ? clean(o.google, 120) : '';
    return { google: name || true, ...(weights.length ? { weights } : {}) };
  }
  if (o.zip) {
    const zip = urlWith(o.zip, ['https:']);
    const files = strings(o.files, 40);
    return zip ? { zip, ...(files.length ? { files } : {}) } : undefined;
  }
  if (Array.isArray(o.urls)) {
    const urls = o.urls.map((u) => urlWith(u, ['https:'])).filter(Boolean).slice(0, 40);
    return urls.length ? { urls } : undefined;
  }
  if (o.url) {
    const url = urlWith(o.url, ['https:']);
    return url ? { url } : undefined;
  }
  return undefined;
}

/** Human label of a source ('' = declared only). */
export function sourceLabel(src: FontSource | undefined): string {
  if (!src) return '';
  if (src === 'google' || 'google' in src) return 'Google Fonts';
  if ('zip' in src) return 'ZIP download';
  return 'download';
}

/** Parse one requirements.json. Accepts `{ fonts: [...] }` or a bare array; an
 *  entry may be just a family name (declared only). */
export function parseRequirements(text: string, configDir: string): { fonts: FontRequirement[]; error?: string } {
  let data: unknown;
  try { data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); }
  catch (e) { return { fonts: [], error: `not valid JSON (${(e as Error).message})` }; }
  const list = Array.isArray(data) ? data
    : data && typeof data === 'object' && Array.isArray((data as { fonts?: unknown }).fonts) ? (data as { fonts: unknown[] }).fonts
    : null;
  if (!list) return { fonts: [], error: 'needs a "fonts" array' };
  const fonts: FontRequirement[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const o = (typeof item === 'string' ? { family: item } : item) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') continue;
    const family = clean(o.family, 120);
    if (!family || seen.has(family.toLowerCase())) continue;
    seen.add(family.toLowerCase());
    const source = normalizeSource(o.source);
    const license = clean(o.license, 60);
    const homepage = urlWith(o.homepage, ['https:', 'http:']);
    const note = clean(o.note, 1000);
    const fallback = (typeof o.fallback === 'string' ? [clean(o.fallback, 120)] : strings(o.fallback, 8).map((f) => f.slice(0, 120)))
      .filter((f) => f && f.toLowerCase() !== family.toLowerCase());
    fonts.push({
      family,
      ...(CATEGORIES.includes(o.category as FontCategory) ? { category: o.category as FontCategory } : {}),
      ...(source ? { source } : {}),
      ...(license ? { license } : {}),
      ...(homepage ? { homepage } : {}),
      ...(note ? { note } : {}),
      ...(fallback.length ? { fallback } : {}),
      configDir,
    });
  }
  return { fonts };
}

/** Merge the chain's files (root→nearest): a NEARER `.mdp` wins on a family. */
export function mergeRequirements(files: RequirementsFile[]): { fonts: FontRequirement[]; errors: { path: string; error: string }[] } {
  const byFamily = new Map<string, FontRequirement>();
  const errors: { path: string; error: string }[] = [];
  for (const f of files) {
    const { fonts, error } = parseRequirements(f.text, f.configDir);
    if (error) errors.push({ path: f.path, error });
    for (const r of fonts) {
      byFamily.delete(r.family.toLowerCase());          // re-insert: keep the nearer one's place last
      byFamily.set(r.family.toLowerCase(), r);
    }
  }
  return { fonts: [...byFamily.values()], errors };
}

/** Where each declared font stands on this computer. `isLocal` tells whether the
 *  OS has a family installed (see fontRuntime.isFontInstalledLocally). */
export function requirementStatuses(
  reqs: FontRequirement[], packaged: WorkspaceFont[], isLocal: (family: string) => boolean,
): FontRequirementStatus[] {
  return reqs.map((r) => {
    const pkg = packaged.find((f) => f.family.toLowerCase() === r.family.toLowerCase());
    if (pkg) return { ...r, state: 'packaged' as const, packagedIn: pkg.configDir };
    return { ...r, state: isLocal(r.family) ? 'local' as const : 'missing' as const };
  });
}

/** The JSON object stored for a declaration (without the renderer-only fields). */
export function toEntry(r: Omit<FontRequirement, 'configDir'> & { configDir?: string }): Record<string, unknown> {
  return {
    family: r.family,
    ...(r.category ? { category: r.category } : {}),
    ...(r.source ? { source: r.source } : {}),
    ...(r.license ? { license: r.license } : {}),
    ...(r.homepage ? { homepage: r.homepage } : {}),
    ...(r.note ? { note: r.note } : {}),
    ...(r.fallback?.length ? { fallback: r.fallback } : {}),
  };
}

// Edit a requirements.json text, keeping whatever else the file holds.
function load(text: string): { root: Record<string, unknown>; fonts: unknown[] } {
  let root: Record<string, unknown> = { version: 1, fonts: [] };
  if (text.trim()) {
    const data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    if (Array.isArray(data)) root = { version: 1, fonts: data };
    else if (data && typeof data === 'object') root = data as Record<string, unknown>;
  }
  const fonts = Array.isArray(root.fonts) ? [...root.fonts] : [];
  return { root, fonts };
}
const familyOf = (e: unknown) => (typeof e === 'string' ? e : e && typeof e === 'object' ? String((e as { family?: unknown }).family ?? '') : '').trim().toLowerCase();
const dump = (root: Record<string, unknown>, fonts: unknown[]) => `${JSON.stringify({ ...root, fonts }, null, 2)}\n`;

/** Add a declaration, or replace the one with the same family. Throws when the
 *  existing text is not JSON (the caller reports it rather than overwrite it). */
export function upsertRequirement(text: string, entry: Record<string, unknown>): string {
  const { root, fonts } = load(text);
  const key = familyOf(entry);
  const i = fonts.findIndex((e) => familyOf(e) === key);
  if (i >= 0) fonts[i] = entry; else fonts.push(entry);
  return dump(root, fonts);
}

export function removeRequirement(text: string, family: string): string {
  const { root, fonts } = load(text);
  return dump(root, fonts.filter((e) => familyOf(e) !== family.trim().toLowerCase()));
}
