export async function waitForRenderReady(node: HTMLElement, settleMs = 350): Promise<void> {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch {
    /* ignore */
  }

  const imgs = Array.from(node.querySelectorAll('img')) as HTMLImageElement[];
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalHeight !== 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
    ),
  );

  // <object>/SVG and Chart.js canvases do not expose a reliable load event; settle.
  await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
}

// Never ask an encoder for more than this on either side. A deck can set
// <!-- @resolution --> to several times the default canvas, and at 1.5x that
// reaches five-figure pixel counts for no visible gain.
export const MAX_RASTER_DIM = 4096;

export function dataUrlToWebp(src: string, width: number, height: number, scale = 1.5, quality = 0.9): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!src || !src.startsWith('data:image/')) {
      reject(new Error(`capture produced no image (${(src || '').length} chars, starts "${(src || '').slice(0, 32)}")`));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const fit = Math.min(1, MAX_RASTER_DIM / Math.max(width * scale, height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale * fit);
      canvas.height = Math.round(height * scale * fit);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('2d context unavailable')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/webp', quality);
      // A canvas that cannot encode returns 'data:,' rather than throwing.
      if (!out.startsWith('data:image/')) {
        reject(new Error(`webp encode failed at ${canvas.width}x${canvas.height} (got "${out.slice(0, 24)}")`));
        return;
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error(`webp encode: capture failed to decode (${src.length} chars, starts "${src.slice(0, 32)}")`));
    img.src = src;
  });
}
