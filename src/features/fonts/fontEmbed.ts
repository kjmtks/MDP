// @font-face CSS with the font files INLINED as data: URLs, for drawing a node
// through an SVG image (html-to-image's `fontEmbedCSS`) — an SVG image may load
// nothing by itself. Only the faces the node uses: its families, one format per
// face (woff2 first), and of a split font only the slices its text needs. Left to
// html-to-image, every frame would carry a CJK family's ~120 slices — megabytes.
import { bare, rangeCovers } from './fontRuntime';

const inlined = new Map<string, Promise<string>>();   // font URL -> data: URL (per page)

const dataUrlOf = (url: string): Promise<string> => {
  let p = inlined.get(url);
  if (!p) {
    p = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    });
    p.catch(() => inlined.delete(url));   // a failed fetch may be retried by a later frame
    inlined.set(url, p);
  }
  return p;
};

// The `src` entry to keep: woff2 when offered, else the first url().
function pickSource(src: string, base: string): { url: string; format: string } | null {
  const found: { url: string; format: string }[] = [];
  const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)\s*(?:format\(\s*(['"]?)([^'")]+)\3\s*\))?/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[2].startsWith('data:')) return { url: m[2], format: m[4] || '' };
    try { found.push({ url: new URL(m[2], base).href, format: m[4] || '' }); } catch { /* unparsable */ }
  }
  return found.find((f) => f.format === 'woff2' || /\.woff2(\?|$)/i.test(f.url)) || found[0] || null;
}

// (Rule TYPES, not instanceof: the sheets may belong to another frame's realm.)
function collectFaces(rules: CSSRuleList, base: string, out: { rule: CSSFontFaceRule; base: string }[]) {
  for (const rule of Array.from(rules)) {
    if (rule.type === 5 /* FONT_FACE_RULE */) out.push({ rule: rule as CSSFontFaceRule, base });
    else if (rule.type === 3 /* IMPORT_RULE */) {
      const sheet = (rule as CSSImportRule).styleSheet;
      try { if (sheet) collectFaces(sheet.cssRules, sheet.href || base, out); } catch { /* cross-origin */ }
    } else if ('cssRules' in rule) {
      collectFaces((rule as CSSGroupingRule).cssRules, base, out);   // @media, @supports, @layer
    }
  }
}

/** The inlined @font-face CSS that `node` (in `doc`) needs to be drawn as it looks. */
export async function embedFontCss(doc: Document, node: HTMLElement): Promise<string> {
  const view = doc.defaultView || window;
  const families = new Set<string>();
  const walk = (el: Element) => {
    view.getComputedStyle(el).fontFamily.split(',').forEach((f) => families.add(bare(f)));
    for (const c of Array.from(el.children)) walk(c);
  };
  walk(node);
  const codePoints = [...new Set(Array.from((node.textContent || '').slice(0, 50000), (c) => c.codePointAt(0) || 0))];

  const faces: { rule: CSSFontFaceRule; base: string }[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try { collectFaces(sheet.cssRules, sheet.href || doc.baseURI, faces); } catch { /* a cross-origin sheet */ }
  }
  const css = await Promise.all(faces.map(async ({ rule, base }) => {
    const s = rule.style;
    if (!families.has(bare(s.getPropertyValue('font-family')))) return '';
    const range = s.getPropertyValue('unicode-range');
    if (range && !rangeCovers(range, codePoints)) return '';
    const src = pickSource(s.getPropertyValue('src'), base);
    if (!src) return '';
    try {
      const data = src.url.startsWith('data:') ? src.url : await dataUrlOf(src.url);
      const keep = ['font-family', 'font-style', 'font-weight', 'font-stretch', 'unicode-range']
        .map((p) => [p, s.getPropertyValue(p)] as const)
        .filter(([, v]) => v)
        .map(([p, v]) => `${p}:${v};`)
        .join('');
      return `@font-face{${keep}src:url("${data}")${src.format ? ` format("${src.format}")` : ''};}`;
    } catch {
      return '';   // unreachable file: that face falls back, the frame is still drawn
    }
  }));
  return css.filter(Boolean).join('\n');
}
