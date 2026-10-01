// Runtime side of workspace fonts: put the CSS into a document, load the faces,
// and share the current setup with the surfaces that render slides in ANOTHER
// document (the offscreen capture window, the presenter / output windows) and
// with the caches that bake text into images (charts, mermaid).
import { isElectron } from '../../api/apiClient';
import { FILES_PREFIX } from '../../api/base';
import { cssSignature, familiesInCss, parseFontFamilies } from './fontCss';

export const FONT_STYLE_ID = 'mdp-font-style';

/** URL a workspace font file is served at. The version token lets the servers
 *  hand it out as immutable (and the Electron main keep it in memory). */
export function fontFileUrl(path: string, version: string): string {
  const enc = path.replace(/^\//, '').split('/').map(encodeURIComponent).join('/');
  // Empty-authority form for Electron, so the leading `.mdp` segment is not
  // parsed as a host (see the mdp-file protocol handler).
  return `${isElectron() ? 'mdp-file:///' : FILES_PREFIX}${enc}?v=${encodeURIComponent(version)}`;
}

interface FontState { css: string; families: string[]; signature: string }
let state: FontState = { css: '', families: [], signature: cssSignature('') };
const listeners = new Set<() => void>();

export const getFontState = (): FontState => state;

/** Publish the CSS now in effect (called by useWorkspaceFonts). */
export function setFontState(css: string): void {
  const signature = cssSignature(css);
  if (signature === state.signature && css === state.css) return;
  state = { css, families: familiesInCss(css), signature };
  listeners.forEach((l) => { try { l(); } catch { /* keep notifying */ } });
}

export function subscribeFontState(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Put (or replace, or remove) the font CSS in a document. Unchanged text is left
 *  alone, so the loaded faces survive theme reloads and re-renders. */
export function applyFontCss(doc: Document, css: string, id = FONT_STYLE_ID): void {
  let el = doc.getElementById(id) as HTMLStyleElement | null;
  if (!css) { el?.remove(); return; }
  if (!el) {
    el = doc.createElement('style');
    el.id = id;
    doc.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

// A family name as compared: no quotes, no case. Trimmed FIRST — a computed
// `font-family` split at its commas gives ` "Noto Sans JP"`, quote after a space.
export const bare = (family: string) => family.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();

// Does a face's unicode-range cover any of these code points? (A split font —
// e.g. Google's ~120 slices of a CJK family — only needs the slices in use.)
export function rangeCovers(range: string, codePoints: number[]): boolean {
  const r = (range || '').trim();
  if (!r || /^U\+0+-10FFFF$/i.test(r)) return true;
  for (const part of r.split(',')) {
    const m = /^\s*U\+([0-9A-F?]+)(?:-([0-9A-F]+))?\s*$/i.exec(part);
    if (!m) continue;
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
    const hi = m[1].includes('?') ? parseInt(m[1].replace(/\?/g, 'F'), 16) : m[2] ? parseInt(m[2], 16) : lo;
    if (codePoints.some((cp) => cp >= lo && cp <= hi)) return true;
  }
  return false;
}

/** Load the faces of `families` declared in `doc` (e.g. via applyFontCss) — all
 *  of them, or with `text` only the slices of a split font that text needs.
 *  Resolves when they are loaded — or after `timeoutMs`, so a broken file can
 *  never hang a capture or an export. */
export async function loadFontFamilies(doc: Document, families: string[], timeoutMs = 8000, text?: string): Promise<void> {
  if (!doc.fonts || !families.length) return;
  const want = new Set(families.map(bare));
  const codePoints = text === undefined ? null
    : [...new Set(Array.from(text.slice(0, 50000), (c) => c.codePointAt(0) || 0))];
  const loads: Promise<unknown>[] = [];
  doc.fonts.forEach((ff) => {
    if (!want.has(bare(ff.family)) || ff.status === 'loaded') return;
    if (codePoints && !rangeCovers(ff.unicodeRange, codePoints)) return;
    loads.push(ff.load().catch(() => undefined));
  });
  if (!loads.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(loads),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  if (timer) clearTimeout(timer);
}

/** Load the workspace fonts declared by `css` in `doc` (a capture / output
 *  window passes the CSS it was given); `text` narrows split fonts to the slices
 *  it needs. */
export function loadWorkspaceFonts(doc: Document, css: string = state.css, timeoutMs?: number, text?: string): Promise<void> {
  return loadFontFamilies(doc, familiesInCss(css), timeoutMs, text);
}

/** Is a font family installed on THIS computer (not via `.mdp`)? Canvas text is
 *  measured with the family against each generic fallback: any width change means
 *  the system supplied the face. Only meaningful for families without an
 *  @font-face in the document. */
export function isFontInstalledLocally(family: string, doc: Document = document): boolean {
  const ctx = doc.createElement('canvas').getContext('2d');
  if (!ctx || !family.trim()) return false;
  const sample = 'mmmmmmmmmmlli WW@#01 あいう漢字カナ';
  const name = `"${family.replace(/["\\]/g, '')}"`;
  for (const generic of ['monospace', 'serif', 'sans-serif']) {
    ctx.font = `72px ${generic}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `72px ${name}, ${generic}`;
    if (ctx.measureText(sample).width !== base) return true;
  }
  return false;
}

/** The font-family stack slide text uses — the active theme's `.slide-content`
 *  rule with the folder's variables resolved. Charts and diagrams draw with it. */
export function slideFontStack(doc: Document = document): string {
  if (!doc.body) return 'sans-serif';
  const wrapper = doc.createElement('div');
  wrapper.className = 'slide-content-wrapper';
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
  const probe = doc.createElement('div');
  probe.className = 'slide-content';
  wrapper.appendChild(probe);
  doc.body.appendChild(wrapper);
  const stack = getComputedStyle(probe).fontFamily || 'sans-serif';
  wrapper.remove();
  return stack;
}

/** Make sure the workspace fonts in the slide font stack are loaded, and return
 *  the stack. Call before baking text into an image (a chart) or letting a
 *  library measure text (mermaid) — otherwise a fallback font gets baked in.
 *  `text` (what is about to be drawn) limits a split font to the slices needed. */
export async function ensureSlideFontsReady(doc: Document = document, text?: string): Promise<string> {
  const stack = slideFontStack(doc);
  const ours = new Set(state.families.map(bare));
  const families = parseFontFamilies(stack).filter((f) => ours.has(bare(f)));
  if (families.length) await loadFontFamilies(doc, families, 8000, text);
  return stack;
}
