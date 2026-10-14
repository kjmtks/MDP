// Does a device break the lines where this computer does? The live remote renders
// the deck itself, so a different text engine (every iPhone / iPad browser is
// WebKit) could wrap a line elsewhere even with the same font files. Both sides
// render every slide the same way (LayoutProbe) and record, per text element, where
// each new line starts; the host compares the two.

/** One element's own text (its direct text nodes, as is) and the indices in it
 *  where a new line starts. */
export interface LineItem { k: number; t: string; b: number[] }
/** One slide: its content's height (an overflow shows there) and its elements. */
export interface LinePage { n: number; h: number; items: LineItem[] }

export interface LayoutReport { id: string; rev: number; ua: string; pages: LinePage[] }
export interface LayoutDiff { slide: number; text: string; host: string[]; device: string[]; kind: 'lines' | 'height' | 'content' }
export interface LayoutResult { id: string; slides: number; same: number; diffs: LayoutDiff[]; error?: string }

// Never measured: KaTeX's hidden MathML copy, the focus overlay, SVG's own text
// (placed by coordinates — it does not wrap).
const SKIP = '.katex-mathml, [data-mdp-focus-layer], script, style, svg text, svg tspan';

/** Where the lines start in each text element of a rendered slide (`root` =
 *  SlideView's wrapper). Elements are numbered in document order. */
export function measureLineBreaks(root: HTMLElement): LineItem[] {
  const out: LineItem[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
    const el = t.parentElement;
    if (!el || seen.has(el) || !t.data.trim() || el.closest(SKIP)) continue;
    seen.add(el);
    const nodes = Array.from(el.childNodes).filter((n): n is Text => n.nodeType === 3);
    let text = '';
    const breaks: number[] = [];
    let prevTop: number | null = null;
    let prevH = 0;
    for (const node of nodes) {
      const data = node.data;
      for (let i = 0; i < data.length; i++) {
        const ch = data[i];
        if (!/\s/.test(ch)) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getClientRects()[0];
          if (r && r.height > 0) {
            if (prevTop !== null && r.top > prevTop + prevH * 0.5) breaks.push(text.length);
            prevTop = r.top;
            prevH = r.height;
          }
        }
        text += ch;
      }
    }
    out.push({ k: out.length, t: text, b: breaks });
  }
  return out;
}

/** A slide's measurement (`root` = SlideView's wrapper). */
export function measurePage(n: number, root: HTMLElement): LinePage {
  const content = root.querySelector<HTMLElement>('.slide-content');
  return { n, h: Math.round(content ? content.scrollHeight : root.scrollHeight), items: measureLineBreaks(root) };
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** An element's lines, as text (for the report). */
function linesOf(item: LineItem): string[] {
  const cuts = [0, ...item.b, item.t.length];
  const lines: string[] = [];
  for (let i = 0; i < cuts.length - 1; i++) lines.push(squash(item.t.slice(cuts[i], cuts[i + 1])));
  return lines.map((l) => (l.length > 28 ? `${l.slice(0, 28)}…` : l));
}

/** The device's pages against the host's: the text elements, where their lines
 *  start, the content heights. */
export function compareLayouts(host: LinePage[], device: LinePage[]): { same: number; diffs: LayoutDiff[] } {
  const diffs: LayoutDiff[] = [];
  let same = 0;
  for (const h of host) {
    const d = device.find((p) => p.n === h.n);
    if (!d) continue;
    let differs = false;
    if (h.items.length !== d.items.length || h.items.some((it, i) => squash(it.t) !== squash(d.items[i]?.t || ''))) {
      diffs.push({ slide: h.n, text: '', host: [`${h.items.length} text elements`], device: [`${d.items.length} text elements`], kind: 'content' });
      differs = true;
    } else {
      h.items.forEach((it, i) => {
        const o = d.items[i];
        if (it.b.join() === o.b.join()) return;
        diffs.push({ slide: h.n, text: squash(it.t).slice(0, 40), host: linesOf(it), device: linesOf(o), kind: 'lines' });
        differs = true;
      });
    }
    if (Math.abs(h.h - d.h) > 2) {
      diffs.push({ slide: h.n, text: '', host: [`content ${h.h}px high`], device: [`content ${d.h}px high`], kind: 'height' });
      differs = true;
    }
    if (!differs) same++;
  }
  return { same, diffs };
}
