import PptxGenJS from 'pptxgenjs';

// PowerPoint export: one high-res picture per slide, full-bleed — the slide exactly
// as MDP shows it (math, charts, modules, the theme) — and its @script in the notes
// pane, for the presenter (scriptNotes.ts). An "editable" mode that rebuilt slides
// as text boxes was dropped (2026-10-15): approximate by nature, and no longer wanted.

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
    if (!src || !src.startsWith('data:image/')) {
      reject(new Error(`PNG re-encode: nothing to decode (${(src || '').length} chars, starts "${(src || '').slice(0, 32)}")`));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 1;
      c.height = img.naturalHeight || 1;
      const ctx = c.getContext('2d');
      if (!ctx) { reject(new Error('2d context unavailable')); return; }
      ctx.drawImage(img, 0, 0);
      const out = c.toDataURL('image/png');
      if (!out.startsWith('data:image/')) {
        reject(new Error(`PNG encode failed at ${c.width}x${c.height} (got "${out.slice(0, 24)}")`));
        return;
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error(`PNG re-encode: source failed to decode (${src.length} chars, starts "${src.slice(0, 32)}")`));
    img.src = src;
  });
}

/** One slide: its picture, and `notes` (the presenter's script) in the notes pane. */
export function addImageSlide(pptx: PptxGenJS, pngDataUrl: string, slideSize: SlideSize, notes = ''): void {
  const { w, h } = inchesOf(slideSize);
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addImage({ data: pngDataUrl, x: 0, y: 0, w, h });
  if (notes) slide.addNotes(notes);
}
