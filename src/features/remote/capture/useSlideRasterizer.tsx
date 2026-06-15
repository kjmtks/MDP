import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideView } from '../../slide/components/SlideView';
import { isElectron } from '../../../api/apiClient';
import { loadedModules } from '../../modules/moduleManager';
import { waitForRenderReady, dataUrlToWebp } from './captureReady';
import type { RasterizeOptions } from './captureTypes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;

interface Job {
  slide: Slide;
  opts: Required<Pick<RasterizeOptions, 'width' | 'height' | 'scale'>> & RasterizeOptions;
  resolve: (dataUrl: string) => void;
  reject: (err: unknown) => void;
}

let jobSeq = 0;

/**
 * Produces a WebP data URL of a single slide that matches the PC rendering.
 * Electron uses an offscreen capturePage; the Web build uses html-to-image on a
 * hidden full-size SlideView. Callers must serialize (await) calls.
 */
export function useSlideRasterizer() {
  const [job, setJob] = useState<Job | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;

    (async () => {
      const { width, height, scale, basePath, themeCssUrl } = job.opts;
      let src: string;

      if (isElectron()) {
        // The capture window is a separate document with no module CSS; ship the
        // registered modules' styles in so module boxes rasterize styled.
        const moduleCss = Object.values(loadedModules)
          .map((m) => m.style)
          .filter(Boolean)
          .join('\n');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        src = await (window as any).electronAPI.captureSlide({
          id: ++jobSeq,
          html: job.slide.html,
          className: job.slide.className,
          header: job.slide.header,
          footer: job.slide.footer,
          basePath,
          themeCssUrl,
          moduleCss,
          width,
          height,
        });
      } else {
        const node = nodeRef.current;
        if (!node) throw new Error('capture node missing');
        await waitForRenderReady(node);
        const htmlToImage = await import('html-to-image');
        src = await htmlToImage.toPng(node, { width, height, cacheBust: true, pixelRatio: 1 });
      }

      if (cancelled) return;
      const webp = await dataUrlToWebp(src, width, height, scale);
      if (cancelled) return;
      job.resolve(webp);
      setJob(null);
    })().catch((err) => {
      if (!cancelled) { job.reject(err); setJob(null); }
    });

    return () => { cancelled = true; };
  }, [job]);

  const rasterize = useCallback(
    (slide: Slide, opts: RasterizeOptions) =>
      new Promise<string>((resolve, reject) => {
        setJob({
          slide,
          opts: { scale: 1.5, ...opts },
          resolve,
          reject,
        });
      }),
    [],
  );

  const host =
    !isElectron() && job ? (
      <div style={{ position: 'fixed', left: -100000, top: 0, width: job.opts.width, height: job.opts.height, pointerEvents: 'none', opacity: 0, zIndex: -1 }} aria-hidden>
        <div ref={nodeRef}>
          <SlideView
            html={job.slide.html}
            className={job.slide.className}
            header={job.slide.header}
            footer={job.slide.footer}
            basePath={job.opts.basePath}
            slideSize={{ width: job.opts.width, height: job.opts.height }}
            isActive
            isEnabledPointerEvents={false}
            // Mirror so the off-screen capture never owns/mutates module sync
            // state; interactive modules are rasterized in their initial state.
            moduleRole="mirror"
          />
        </div>
      </div>
    ) : null;

  return { rasterize, host };
}
