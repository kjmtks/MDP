import { useCallback, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import { withFrameFallback } from '../remote/capture/captureReady';
import type { RasterizeOptions, RasterizeResult } from '../remote/capture/captureTypes';
import { createPptx, pptxToBase64, addImageSlide, toPngDataUrl } from './pptxExport';
import { scriptNotes } from './scriptNotes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;

interface Opts {
  slides: Slide[];
  slideSize: { width: number; height: number };
  basePath?: string;
  themeCssUrl?: string;
  title: string;
  // Reused image rasterizer (Electron capturePage / web html-to-image).
  rasterize: (slide: Slide, opts: RasterizeOptions) => Promise<RasterizeResult>;
  // Called after a successful save (e.g. to refresh the file tree so the .pptx shows).
  onSaved?: (fileName: string) => void;
}

export interface PptxExportState {
  /** `toPath` (MCP export_pptx): save there in the workspace, no dialog — and fail
   *  loudly. → the saved name, or null (cancelled / nothing to export). */
  exportPptx: (toPath?: string) => Promise<string | null>;
  exporting: { done: number; total: number } | null;
}

/**
 * Export the deck to a .pptx: each slide a full-bleed picture (math / charts
 * pixel-perfect), its @script in the notes pane. Saved via the platform save path
 * (Electron dialog / web download), or into the workspace (`toPath`).
 */
export function usePptxExport({ slides, slideSize, basePath, themeCssUrl, title, rasterize, onSaved }: Opts): PptxExportState {
  const [exporting, setExporting] = useState<PptxExportState['exporting']>(null);

  const exportPptx = useCallback(async (toPath?: string): Promise<string | null> => {
    if (!slides.length || exporting) {
      if (toPath) throw new Error(exporting ? 'A PowerPoint export is already running.' : 'The deck has no slides.');
      return null;
    }
    setExporting({ done: 0, total: slides.length });
    try {
      const pptx = createPptx(slideSize);
      // The web build draws each picture with html-to-image, which waits for an
      // animation frame: frames must come even while the tab is in the background.
      await withFrameFallback(async () => {
        for (let i = 0; i < slides.length; i++) {
          const shot = await rasterize(slides[i], { width: slideSize.width, height: slideSize.height, basePath, themeCssUrl });
          addImageSlide(pptx, await toPngDataUrl(shot.dataUrl), slideSize, scriptNotes(slides[i]?.raw || ''));
          setExporting({ done: i + 1, total: slides.length });
        }
      });
      const b64 = await pptxToBase64(pptx);
      if (toPath) {
        await apiClient.saveFile(toPath, b64, true);
        onSaved?.(toPath);
        return toPath;
      }
      const safe = (title || 'slides').replace(/[\\/:*?"<>|]/g, '_');
      const fileName = `${safe}.pptx`;
      const saved = await apiClient.saveBinaryWithDialog(fileName, b64, {
        name: 'PowerPoint Presentation',
        ext: 'pptx',
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      if (saved) onSaved?.(fileName);
      return saved ? fileName : null;
    } catch (e) {
      if (toPath) throw e;
      console.error('PPTX export failed', e);
      alert('PowerPoint export failed: ' + ((e as Error)?.message || e));
      return null;
    } finally {
      setExporting(null);
    }
  }, [slides, slideSize, basePath, themeCssUrl, rasterize, title, exporting, onSaved]);

  return { exportPptx, exporting };
}
