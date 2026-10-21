// A reviewer points at a slide for the AI that made the deck. "Copy reference" gives
// one line to paste into the chat with the comment: the deck, the slide (its number
// for the MCP tools, its printed page, its @id, its heading), the place right-clicked
// — named as get_focus_targets names it — and the words selected. "Copy image" gives
// the slide as a picture with those places framed in red.
import { placeAt, placesOf, screenLines, slidePoint, type FocusBox } from '../focus/focusTargets';

/** What was pointed at on one slide (boxes in slide px). */
export interface SlidePick {
  /** The slide's place in the deck, from 0 (the MCP tools' `slide` is this + 1). */
  index: number;
  /** The place under the pointer; `text`: a named place's / a formula's words. */
  place: { target: string; text: string; box: FocusBox } | null;
  /** The words selected on the slide ('' = none) and their lines. */
  quote: string;
  quoteBoxes: FocusBox[];
}

interface SlideLike { id?: string; isHidden?: boolean; isCover?: boolean; pageNumber?: number | null; raw?: string }

const clean = (s: string, max: number) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A piece of the slide as it reads: a formula as shown (the slides' KaTeX writes
 *  HTML only — a module's own MathML copy gives its TeX), the overlays left out. */
function readText(node: Node): string {
  const box = document.createElement('div');
  box.appendChild(node.cloneNode(true));
  box.querySelectorAll('.katex').forEach((k) => {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    k.replaceWith(tex ? `\\(${tex.trim()}\\)` : (k.querySelector('.katex-html')?.textContent || ''));
  });
  box.querySelectorAll('.katex-mathml, .mdp-focus-layer, .mdp-ink-edit, style, script').forEach((x) => x.remove());
  return box.textContent || '';
}

/** The words of a named place or a formula (`#name`, `math:N`); '' for the targets
 *  that carry their words already ("…", item:"…", cell:"…"). A part of a formula
 *  gives the whole formula — the AI finds the part by its \focus{name}{…}. */
function placeText(root: HTMLElement, target: string): string {
  const content = (root.querySelector('.slide-content') as HTMLElement | null) || root;
  const named = /^#([\p{L}\p{N}_.-]+)$/u.exec(target);
  if (named) {
    const n = CSS.escape(named[1]);
    const el = content.querySelector(`[data-mdp-focus="${n}"], [data-mdp-tag="${n}"], svg [data-focus="${n}"], svg #${n}`);
    return el ? clean(readText(el.closest('.katex') || el), 80) : '';
  }
  const math = /^math:(\d+)$/.exec(target);
  if (math) {
    const k = content.querySelectorAll('.katex')[Number(math[1]) - 1];
    return k ? clean(readText(k), 80) : '';
  }
  return '';
}

/** What the right-click at (clientX, clientY) on a rendered slide points at: the
 *  smallest place there, and the words selected on this slide. */
export function pickAt(root: HTMLElement, clientX: number, clientY: number, index: number): SlidePick {
  const p = slidePoint(root, clientX, clientY);
  const hit = placeAt(placesOf(root), p, 4 / p.k);
  const place = hit ? { target: hit.target, text: placeText(root, hit.target), box: hit.box } : null;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.rangeCount && root.contains(sel.anchorNode) && root.contains(sel.focusNode)) {
    const range = sel.getRangeAt(0);
    const quote = clean(readText(range.cloneContents()), 200);
    if (quote) return { index, place, quote, quoteBoxes: screenLines(root, range.getClientRects()) };
  }
  return { index, place, quote: '', quoteBoxes: [] };
}

/** The slide's first heading as written (Markdown, its TeX kept). */
export function slideHeading(raw: string): string {
  const m = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(String(raw || '').replace(/<!--[\s\S]*?-->/g, ''));
  return m ? clean(m[1], 80) : '';
}

/** One line for the AI's chat, e.g.
 *  `lectures/02.slide.md p.12 (slide 13, @id eprop) 「和の期待値は…」 › #sum 「\(E(X+Y)=…\)」 › 「selected words」` */
export function slideReference(deckPath: string, slide: SlideLike, pick: SlidePick): string {
  const page = slide.isCover ? 'cover' : slide.isHidden ? 'hidden slide' : slide.pageNumber ? `p.${slide.pageNumber}` : '';
  const at = [`slide ${pick.index + 1}`, slide.id ? `@id ${slide.id}` : ''].filter(Boolean).join(', ');
  const heading = slideHeading(slide.raw || '');
  let s = `${deckPath}${page ? ` ${page}` : ''} (${at})`;
  if (heading) s += ` 「${heading}」`;
  if (pick.place) s += ` › ${pick.place.target}${pick.place.text ? ` 「${pick.place.text}」` : ''}`;
  if (pick.quote) s += ` › 「${pick.quote}」`;
  return s;
}

/** The boxes to frame in the picture: the words selected, else the place. */
export const pickedBoxes = (pick: SlidePick): FocusBox[] => (pick.quoteBoxes.length ? pick.quoteBoxes : pick.place ? [pick.place.box] : []);

/** A slide's picture (any image URL, `slideWidth` slide px wide) as a PNG, the boxes
 *  (slide px) framed in red. */
export async function markedPng(src: string, slideWidth: number, boxes: readonly FocusBox[]): Promise<Blob> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  if (!g) throw new Error('No canvas to draw the picture on.');
  g.drawImage(img, 0, 0);
  const s = c.width / (slideWidth || c.width);
  g.strokeStyle = '#e53935';
  g.lineWidth = Math.max(3, Math.round(c.width / 400));
  g.lineJoin = 'round';
  const pad = 5 * s;
  for (const b of boxes) g.strokeRect(b.x * s - pad, b.y * s - pad, b.w * s + 2 * pad, b.h * s + 2 * pad);
  return new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png'));
}
