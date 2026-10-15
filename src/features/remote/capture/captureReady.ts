import { loadWorkspaceFonts } from '../../fonts/fontRuntime';

export async function waitForRenderReady(node: HTMLElement, settleMs = 350): Promise<void> {
  try {
    // Workspace fonts (`.mdp/fonts`) are loaded EXPLICITLY: `document.fonts.ready`
    // resolves as soon as no load is pending, which can be before the first layout
    // has even started one — a measurement or capture would then see the fallback.
    // (Of a split font, only the slices this slide's text needs.)
    await loadWorkspaceFonts(document, undefined, undefined, node.textContent || '');
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

/** `n` animation frames (a layer drawn, then painted) — or, for a page that gets no
 *  frames (a covered or minimized window, a display asleep: MDP behind the user's
 *  AI client during an MCP call), `maxMs`. Waiting for frames alone hung
 *  render_slide_image with `focus` until the MCP relay timed out. */
export function afterFrames(n = 2, maxMs = 100): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const step = (k: number) => requestAnimationFrame(() => (k <= 1 ? finish() : step(k - 1)));
    step(n);
    setTimeout(finish, maxMs);
  });
}

// ---- frames for a page that gets none -----------------------------------------------
// html-to-image waits for one animation frame per picture (createImage). A page that
// gets no frames — a covered or minimized window, a display gone to sleep, a
// background tab — would wait forever: an MCP export runs while the user is in their
// AI client, MDP behind it. While withFrameFallback runs, every requestAnimationFrame
// callback fires at the next frame or after FALLBACK_MS, whichever comes first.
const FALLBACK_MS = 50;
let fallbackDepth = 0;
let nativeRaf: typeof window.requestAnimationFrame | null = null;
let nativeCaf: typeof window.cancelAnimationFrame | null = null;
let fallbackSeq = 2e9;
const pendingFrames = new Map<number, { raf: number; timer: number }>();

function installFrameFallback(): void {
  nativeRaf = window.requestAnimationFrame;
  nativeCaf = window.cancelAnimationFrame;
  const raf = nativeRaf;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = ++fallbackSeq;
    let fired = false;
    const run = (t: number) => {
      if (fired) return;
      fired = true;
      const e = pendingFrames.get(id);
      pendingFrames.delete(id);
      if (e) { window.clearTimeout(e.timer); nativeCaf?.call(window, e.raf); }
      cb(t);
    };
    pendingFrames.set(id, { raf: raf.call(window, run), timer: window.setTimeout(() => run(performance.now()), FALLBACK_MS) });
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    const e = pendingFrames.get(id);
    if (!e) { nativeCaf?.call(window, id); return; }
    pendingFrames.delete(id);
    window.clearTimeout(e.timer);
    nativeCaf?.call(window, e.raf);
  };
}

/** Run `fn` with animation frames that come even when the page gets none (see
 *  above). Nests: the native functions come back when the outermost call ends. */
export async function withFrameFallback<T>(fn: () => Promise<T>): Promise<T> {
  if (fallbackDepth++ === 0) installFrameFallback();
  try {
    return await fn();
  } finally {
    if (--fallbackDepth === 0 && nativeRaf && nativeCaf) {
      window.requestAnimationFrame = nativeRaf;
      window.cancelAnimationFrame = nativeCaf;
      nativeRaf = null;
      nativeCaf = null;
    }
  }
}
