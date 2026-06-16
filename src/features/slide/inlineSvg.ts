import { apiClient, isElectron } from '../../api/apiClient';

// Inline drawio/other SVGs into the slide DOM instead of <object>/<img>. Inline
// SVG (a) survives the per-commit innerHTML replace without reloading (no white
// flicker, unlike <object>), (b) keeps foreignObject math, and (c) exposes its
// <text> to the deck's CSS so themes can restyle drawio typography.
//
// Keyed cache: a key is a workspace path (file) or 'd:<hash>' (data-URI). The
// SlideView placeholder carries the key; a layout effect injects the cached SVG
// before paint. `fallback` holds an <object> data url drawn if processing fails,
// so a diagram is never lost.

const cache = new Map<string, string>();        // key → processed <svg> string ('' = failed)
const fallback = new Map<string, string>();     // key → <object> data url
const inflight = new Map<string, Promise<string>>();

export function getCachedSvg(key: string): string | undefined { return cache.get(key); }
export function getFallback(key: string): string | undefined { return fallback.get(key); }

// Parse each processed SVG string into a <template> ONCE, then inject clones.
// cloneNode is far cheaper than re-parsing the (often large) SVG string via
// innerHTML on every slide re-render — the main cost behind drawio re-render
// flicker and slow tab switches.
const nodeCache = new Map<string, HTMLTemplateElement>();
export function getSvgNode(key: string): DocumentFragment | null {
  const svg = cache.get(key);
  if (!svg) return null;
  let tpl = nodeCache.get(key);
  if (!tpl) { tpl = document.createElement('template'); tpl.innerHTML = svg; nodeCache.set(key, tpl); }
  return tpl.content.cloneNode(true) as DocumentFragment;
}

function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Sanitize, scope ids, make fonts theme-overridable. Returns inline <svg> or ''. */
function processSvg(raw: string, key: string): string {
  try {
    const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return '';
    const svg = doc.querySelector('svg');
    if (!svg) return '';

    // 1. Sanitize.
    svg.querySelectorAll('script').forEach((s) => s.remove());
    svg.querySelectorAll('*').forEach((el) => {
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        if ((a.name === 'href' || a.name === 'xlink:href') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
      }
    });

    // 2. Scope ids + references (gradients/clips/markers) to avoid collisions.
    const prefix = `ds${hashKey(key)}_`;
    const ids = new Set<string>();
    svg.querySelectorAll('[id]').forEach((el) => { if (el.id) ids.add(el.id); });
    if (ids.size) {
      svg.querySelectorAll('*').forEach((el) => {
        if (el.id && ids.has(el.id)) el.id = prefix + el.id;
        for (const a of Array.from(el.attributes)) {
          let v = a.value;
          v = v.replace(/url\(\s*#([^)\s]+)\s*\)/g, (m, id) => (ids.has(id) ? `url(#${prefix}${id})` : m));
          if ((a.name === 'href' || a.name === 'xlink:href') && v.startsWith('#') && ids.has(v.slice(1))) v = `#${prefix}${v.slice(1)}`;
          if (v !== a.value) el.setAttribute(a.name, v);
        }
      });
    }

    // 3. Make fonts overridable via CSS vars (default = original). Apply to ALL
    //    elements — drawio renders labels either as SVG <text>/<tspan> OR as HTML
    //    inside <foreignObject> (HTML labels / math), so restricting to text/tspan
    //    would miss the latter. Font-* attributes are moved into the style so the
    //    var() default works.
    svg.querySelectorAll('*').forEach((el) => {
      let style = el.getAttribute('style') || '';
      const famAttr = el.getAttribute('font-family');
      if (famAttr && !/font-family/i.test(style)) { style += `;font-family:${famAttr}`; el.removeAttribute('font-family'); }
      const szAttr = el.getAttribute('font-size');
      if (szAttr && !/font-size/i.test(style)) { style += `;font-size:${szAttr}`; el.removeAttribute('font-size'); }
      if (!/font-family|font-size/i.test(style)) return;
      // font-family default = `inherit`, so drawio text follows the deck/slide
      // font automatically (and a plain `font-family` on any ancestor wins via
      // inheritance). --mdp-drawio-font still overrides explicitly. font-size
      // keeps the diagram's original value (changing it would break layout).
      if (/font-family/i.test(style)) style = style.replace(/font-family\s*:\s*[^;]+/i, 'font-family:var(--mdp-drawio-font, inherit)');
      if (/font-size/i.test(style)) style = style.replace(/font-size\s*:\s*([^;]+)/i, (_m, s) => `font-size:var(--mdp-drawio-font-size, ${String(s).trim()})`);
      el.setAttribute('style', style.replace(/^;+/, ''));
    });

    // Also handle font-* inside any embedded <style> blocks (drawio sometimes
    // declares label fonts there rather than inline).
    svg.querySelectorAll('style').forEach((st) => {
      let css = st.textContent || '';
      if (!/font-family|font-size/i.test(css)) return;
      css = css.replace(/font-family\s*:\s*[^;}]+/gi, 'font-family:var(--mdp-drawio-font, inherit)');
      css = css.replace(/font-size\s*:\s*([^;}]+)/gi, (_m, s) => `font-size:var(--mdp-drawio-font-size, ${String(s).trim()})`);
      st.textContent = css;
    });

    // 4. Responsive + theming hook.
    svg.setAttribute('class', `${svg.getAttribute('class') || ''} mdp-drawio-svg-el`.trim());
    const sstyle = svg.getAttribute('style') || '';
    if (!/max-width/i.test(sstyle)) svg.setAttribute('style', `${sstyle};max-width:100%;height:auto`.replace(/^;+/, ''));

    return new XMLSerializer().serializeToString(svg);
  } catch {
    return '';
  }
}

/** Load (or return cached) a processed inline SVG for a workspace file path. */
export function loadSvg(path: string): Promise<string> {
  fallback.set(path, (isElectron() ? 'mdp-file://' : '/files/') + path.split('/').map(encodeURIComponent).join('/'));
  const cached = cache.get(path);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(path);
  if (existing) return existing;
  const p = apiClient
    .readFileText(path)
    .then((raw) => { const out = processSvg(raw, path); cache.set(path, out); inflight.delete(path); return out; })
    .catch(() => { cache.set(path, ''); inflight.delete(path); return ''; });
  inflight.set(path, p);
  return p;
}

/** Warm the cache for every workspace `.svg` referenced in the given slide HTML,
 *  so print / remote-rasterize (which may render never-previewed slides) find the
 *  inline SVG ready instead of racing an async fetch. */
export async function prewarmSvgs(htmls: string[], basePath: string): Promise<void> {
  const toWsPath = (src: string): string => {
    let s = src.split('?')[0];
    if (s.startsWith('mdp-file://')) s = s.slice('mdp-file://'.length);
    else if (s.startsWith('/files/')) s = s.slice('/files/'.length);
    else if (s.startsWith('/')) s = s.slice(1);
    else s = basePath ? `${basePath}/${s}` : s;
    try { s = decodeURIComponent(s); } catch { /* ignore */ }
    return s;
  };
  const paths = new Set<string>();
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  for (const h of htmls) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(h)) !== null) {
      const src = m[1];
      if (/^(data:|https?:|blob:)/i.test(src)) continue;
      if (!src.toLowerCase().split('?')[0].endsWith('.svg')) continue;
      paths.add(toWsPath(src));
    }
  }
  await Promise.all([...paths].map((p) => loadSvg(p)));
}

/** Synchronously register/process a `data:image/svg+xml` URI; returns its key. */
export function registerDataUri(dataUri: string): string {
  const key = 'd:' + hashKey(dataUri);
  if (!cache.has(key)) {
    fallback.set(key, dataUri);
    let raw = '';
    try {
      const comma = dataUri.indexOf(',');
      if (comma > 0) {
        const meta = dataUri.slice(0, comma);
        const data = dataUri.slice(comma + 1);
        raw = /;base64/i.test(meta) ? decodeBase64Utf8(data) : decodeURIComponent(data);
      }
    } catch { raw = ''; }
    cache.set(key, raw ? processSvg(raw, key) : '');
  }
  return key;
}
