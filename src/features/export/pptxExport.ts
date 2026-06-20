import PptxGenJS from 'pptxgenjs';

// PowerPoint export. Two strategies:
//  - IMAGE: one high-res snapshot per slide, placed full-bleed. Pixel-perfect for
//    math (KaTeX), charts, modules and themes — the slide is exactly what you see.
//  - EDITABLE: reconstruct each slide from its rendered DOM — pure-text blocks
//    become editable PowerPoint text boxes (positioned by their on-screen box),
//    while anything visual (math, figures, charts, tables, modules) is placed as
//    an image so it still looks right. Approximate by nature.
//
// No JS library renders LaTeX into native (editable) PowerPoint equations, so math
// is always an image in both modes — guaranteeing it is correct.

const DPI = 96; // map slide px -> inches so the aspect ratio is exact
type SlideSize = { width: number; height: number };
const inchesOf = (s: SlideSize) => ({ w: s.width / DPI, h: s.height / DPI });

export function createPptx(slideSize: SlideSize): PptxGenJS {
  const pptx = new PptxGenJS();
  const { w, h } = inchesOf(slideSize);
  pptx.defineLayout({ name: 'MDP', width: w, height: h });
  pptx.layout = 'MDP';
  return pptx;
}

export async function pptxToBase64(pptx: PptxGenJS): Promise<string> {
  return (await pptx.write({ outputType: 'base64' })) as string;
}

// Re-encode any image data URL (e.g. the rasterizer's WebP) to PNG, which every
// PowerPoint version renders reliably.
export function toPngDataUrl(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 1;
      c.height = img.naturalHeight || 1;
      const ctx = c.getContext('2d');
      if (!ctx) { reject(new Error('2d context unavailable')); return; }
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

export function addImageSlide(pptx: PptxGenJS, pngDataUrl: string, slideSize: SlideSize): void {
  const { w, h } = inchesOf(slideSize);
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addImage({ data: pngDataUrl, x: 0, y: 0, w, h });
}

// ---- editable mode ---------------------------------------------------------

const rgbToHex = (rgb: string): string => {
  const m = (rgb || '').match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return '000000';
  return [m[0], m[1], m[2]]
    .map((n) => Math.max(0, Math.min(255, Math.round(parseFloat(n)))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
};
const pxToPt = (px: number) => Math.round(px * 0.75 * 100) / 100;

// Elements that must stay an image (their look can't be reproduced as text).
const VISUAL = 'img,svg,canvas,table,.katex,.katex-display,[class*="mdp-mod-"],[class*="chartjs"],.mermaid-img-wrapper,.plantuml-svg-wrapper';
const hasVisual = (el: Element) => el.matches(VISUAL) || !!el.querySelector(VISUAL);
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'blockquote', 'ul', 'ol']);

export async function addEditableSlide(
  pptx: PptxGenJS,
  rootNode: HTMLElement,
  slideSize: SlideSize,
  capture: (el: HTMLElement) => Promise<string>,
): Promise<void> {
  const wrapper = (rootNode.querySelector('.slide-content-wrapper') as HTMLElement) || rootNode;
  const base = wrapper.getBoundingClientRect();
  if (base.width < 1 || base.height < 1) return;
  const { w: inW, h: inH } = inchesOf(slideSize);
  const sx = inW / base.width;
  const sy = inH / base.height;
  const box = (r: DOMRect) => ({
    x: (r.left - base.left) * sx,
    y: (r.top - base.top) * sy,
    w: r.width * sx,
    h: r.height * sy,
  });

  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };

  const content = (wrapper.querySelector('.slide-content') as HTMLElement) || wrapper;
  for (const el of Array.from(content.children) as HTMLElement[]) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const pos = box(r);
    const tag = el.tagName.toLowerCase();

    if (TEXT_TAGS.has(tag) && !hasVisual(el)) {
      const cs = getComputedStyle(el);
      const heading = /^h[1-6]$/.test(tag);
      const opts = {
        ...pos,
        fontSize: pxToPt(parseFloat(cs.fontSize) || 18),
        color: rgbToHex(cs.color),
        bold: (parseInt(cs.fontWeight, 10) || 400) >= 600 || heading,
        italic: cs.fontStyle === 'italic',
        align: (['left', 'center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : 'left'),
        valign: 'top',
        margin: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      if (tag === 'ul' || tag === 'ol') {
        const items = (Array.from(el.querySelectorAll(':scope > li')) as HTMLElement[]).map((li) => ({
          text: (li.textContent || '').trim(),
          options: { bullet: tag === 'ul' ? true : { type: 'number' }, breakLine: true },
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (items.length) slide.addText(items as any, opts);
      } else {
        const text = (el.textContent || '').trim();
        if (text) slide.addText(text, opts);
      }
    } else {
      try {
        const url = await capture(el);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (url) slide.addImage({ data: url, ...pos } as any);
      } catch { /* skip a region that fails to capture */ }
    }
  }

  // Header / footer chrome → image overlay at its box (usually modules).
  for (const sel of ['.slide-header', '.slide-footer']) {
    const chrome = wrapper.querySelector(sel) as HTMLElement | null;
    if (!chrome || chrome.childElementCount === 0) continue;
    const r = chrome.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    try {
      const url = await capture(chrome);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (url) slide.addImage({ data: url, ...box(r) } as any);
    } catch { /* skip */ }
  }
}
