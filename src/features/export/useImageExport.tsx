import { useCallback, useState } from 'react';
import { apiClient, isElectron } from '../../api/apiClient';
import { toPngDataUrl } from './pptxExport';
import type { RasterizeOptions, RasterizeResult } from '../remote/capture/captureTypes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;

interface Opts {
  slides: Slide[];
  slideSize: { width: number; height: number };
  basePath: string;
  themeCssUrl: string;
  /** Workspace path of the deck — the images land beside it. */
  deckPath: string | null;
  rasterize: (slide: Slide, opts: RasterizeOptions) => Promise<RasterizeResult>;
  onSaved?: (name: string) => void;
}

export interface ImageExportState {
  exportImages: () => Promise<void>;
  exporting: { done: number; total: number } | null;
}

/**
 * Export every slide as a PNG into a folder the USER picks
 * (`talk.slide.md` → `talk-01.png`, …; a single-slide deck → `talk.png`).
 *
 * The destination is asked for once, not once per slide, and may be anywhere on
 * disk — not just inside the workspace. Reuses the SAME rasterizer as the
 * PowerPoint image export, so the output matches the deck's @resolution exactly.
 */
export function useImageExport({ slides, slideSize, basePath, themeCssUrl, deckPath, rasterize, onSaved }: Opts): ImageExportState {
  const [exporting, setExporting] = useState<ImageExportState['exporting']>(null);

  const exportImages = useCallback(async () => {
    if (exporting) return;
    const visible = slides.filter((s: Slide) => !s.isHidden);
    // Never fail silently — a no-op click is indistinguishable from a broken one.
    if (!visible.length) { alert('Image export: this deck has no visible slides.'); return; }

    // `dir/talk.slide.md` → stem = 'talk'
    const full = deckPath || 'slides.slide.md';
    const slash = full.lastIndexOf('/');
    const stem = (slash === -1 ? full : full.slice(slash + 1)).replace(/\.slide\.md$/i, '').replace(/\.md$/i, '');
    const pad = String(visible.length).length;
    const nameOf = (i: number) => (visible.length === 1 ? `${stem}.png` : `${stem}-${String(i + 1).padStart(pad, '0')}.png`);

    // Ask once where the images go. The web build has no filesystem access, so it
    // falls back to the browser's own save UI (one download per slide).
    const dir = await apiClient.pickFile({ title: 'Choose a folder for the exported images', directory: true });
    if (!dir && isElectron()) return; // cancelled

    setExporting({ done: 0, total: visible.length });
    try {
      const written: string[] = [];
      for (let i = 0; i < visible.length; i++) {
        const shot = await rasterize(visible[i], { width: slideSize.width, height: slideSize.height, basePath, themeCssUrl });
        const png = await toPngDataUrl(shot.dataUrl);
        const b64 = png.split(',')[1];
        const name = nameOf(i);
        if (dir) {
          const sep = /\\/.test(dir) ? '\\' : '/';
          await apiClient.writeBinaryToPath(`${dir}${dir.endsWith(sep) ? '' : sep}${name}`, b64);
        } else {
          await apiClient.saveBinaryWithDialog(name, b64, { name: 'PNG Image', ext: 'png', mime: 'image/png' });
        }
        written.push(name);
        setExporting({ done: i + 1, total: visible.length });
      }
      onSaved?.(written.length === 1 ? written[0] : `${written.length} images (${written[0]} …)`);
    } catch (e) {
      console.error('Image export failed', e);
      alert('Image export failed: ' + ((e as Error)?.message || e));
    } finally {
      setExporting(null);
    }
  }, [slides, slideSize, basePath, themeCssUrl, deckPath, rasterize, onSaved, exporting]);

  return { exportImages, exporting };
}
