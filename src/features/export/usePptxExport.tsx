import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideView } from '../slide/components/SlideView';
import { apiClient } from '../../api/apiClient';
import { waitForRenderReady } from '../remote/capture/captureReady';
import type { RasterizeOptions } from '../remote/capture/captureTypes';
import { createPptx, pptxToBase64, addImageSlide, addEditableSlide, toPngDataUrl } from './pptxExport';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;
export type PptxMode = 'image' | 'editable';

interface Opts {
  slides: Slide[];
  slideSize: { width: number; height: number };
  basePath?: string;
  themeCssUrl?: string;
  title: string;
  // Reused image rasterizer (Electron capturePage / web html-to-image).
  rasterize: (slide: Slide, opts: RasterizeOptions) => Promise<string>;
  // Called after a successful save (e.g. to refresh the file tree so the .pptx shows).
  onSaved?: (fileName: string) => void;
}

export interface PptxExportState {
  exportPptx: (mode: PptxMode) => Promise<void>;
  exporting: { mode: PptxMode; done: number; total: number } | null;
  host: React.ReactNode;
}

/**
 * Export the deck to a .pptx. IMAGE mode snapshots each slide full-bleed (math /
 * charts pixel-perfect). EDITABLE mode renders each slide off-screen and rebuilds
 * it as positioned text boxes + image regions (see addEditableSlide). Saved via
 * the platform save path (Electron dialog / web download).
 */
export function usePptxExport({ slides, slideSize, basePath, themeCssUrl, title, rasterize, onSaved }: Opts): PptxExportState {
  const [exporting, setExporting] = useState<PptxExportState['exporting']>(null);
  // Off-screen render slot used by EDITABLE mode (needs the live DOM to read
  // element boxes and capture visual regions).
  const [renderSlide, setRenderSlide] = useState<Slide | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef<((node: HTMLElement) => void) | null>(null);

  useEffect(() => {
    if (!renderSlide) return;
    let cancelled = false;
    (async () => {
      const node = nodeRef.current;
      if (!node) return;
      await waitForRenderReady(node);
      if (!cancelled && readyRef.current) readyRef.current(node);
    })();
    return () => { cancelled = true; };
  }, [renderSlide]);

  const renderOne = useCallback(
    (slide: Slide) => new Promise<HTMLElement>((resolve) => { readyRef.current = resolve; setRenderSlide(slide); }),
    [],
  );

  const exportPptx = useCallback(async (mode: PptxMode) => {
    if (!slides.length || exporting) return;
    setExporting({ mode, done: 0, total: slides.length });
    try {
      const pptx = createPptx(slideSize);
      if (mode === 'image') {
        for (let i = 0; i < slides.length; i++) {
          const shot = await rasterize(slides[i], { width: slideSize.width, height: slideSize.height, basePath, themeCssUrl });
          addImageSlide(pptx, await toPngDataUrl(shot), slideSize);
          setExporting({ mode, done: i + 1, total: slides.length });
        }
      } else {
        const htmlToImage = await import('html-to-image');
        const capture = (el: HTMLElement) => htmlToImage.toPng(el, { cacheBust: true, pixelRatio: 2 });
        for (let i = 0; i < slides.length; i++) {
          const node = await renderOne(slides[i]);
          await addEditableSlide(pptx, node, slideSize, capture);
          setExporting({ mode, done: i + 1, total: slides.length });
        }
      }
      const b64 = await pptxToBase64(pptx);
      const safe = (title || 'slides').replace(/[\\/:*?"<>|]/g, '_');
      const fileName = `${safe}.pptx`;
      const saved = await apiClient.saveBinaryWithDialog(fileName, b64, {
        name: 'PowerPoint Presentation',
        ext: 'pptx',
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      });
      if (saved) onSaved?.(fileName);
    } catch (e) {
      console.error('PPTX export failed', e);
      alert('PowerPoint export failed: ' + ((e as Error)?.message || e));
    } finally {
      setExporting(null);
      setRenderSlide(null);
      readyRef.current = null;
    }
  }, [slides, slideSize, basePath, themeCssUrl, rasterize, renderOne, title, exporting, onSaved]);

  const host = renderSlide ? (
    <div
      style={{ position: 'fixed', left: -100000, top: 0, width: slideSize.width, height: slideSize.height, pointerEvents: 'none', opacity: 0, zIndex: -1 }}
      aria-hidden
    >
      <div ref={nodeRef}>
        <SlideView
          html={renderSlide.html}
          className={renderSlide.className}
          header={renderSlide.header}
          footer={renderSlide.footer}
          basePath={basePath}
          slideSize={slideSize}
          isActive
          isEnabledPointerEvents={false}
          runScripts={false}
          moduleRole="mirror"
        />
      </div>
    </div>
  ) : null;

  return { exportPptx, exporting, host };
}
