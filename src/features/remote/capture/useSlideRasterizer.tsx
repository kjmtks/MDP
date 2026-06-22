import { useCallback, useEffect, useRef, useState } from 'react';
import { SlideView } from '../../slide/components/SlideView';
import { isElectron } from '../../../api/apiClient';
import { loadedModules } from '../../modules/moduleManager';
import { waitForRenderReady, dataUrlToWebp } from './captureReady';
import type { RasterizeOptions, RasterizeResult, SlideLinkRect } from './captureTypes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;

interface Job {
  slide: Slide;
  opts: Required<Pick<RasterizeOptions, 'width' | 'height' | 'scale'>> & RasterizeOptions;
  resolve: (res: RasterizeResult) => void;
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
      const node = nodeRef.current;
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
        // The image comes from the offscreen window, but link rects are measured
        // from the (always-mounted) web node below — settle it first.
        if (node) await waitForRenderReady(node);
      } else {
        if (!node) throw new Error('capture node missing');
        await waitForRenderReady(node);
        const htmlToImage = await import('html-to-image');
        src = await htmlToImage.toPng(node, { width, height, cacheBust: true, pixelRatio: 1 });
      }

      if (cancelled) return;

      // Collect clickable hyperlink hotspots (fractions of the slide size) so the
      // image-based remote can overlay tap targets.
      const links: SlideLinkRect[] = [];
      if (node && width > 0 && height > 0) {
        const base = node.getBoundingClientRect();
        node.querySelectorAll('a.mdp-slide-link').forEach((el) => {
          const target = (el as HTMLElement).dataset.mdpTarget;
          if (!target) return;
          const r = (el as HTMLElement).getBoundingClientRect();
          links.push({ x: (r.left - base.left) / width, y: (r.top - base.top) / height, w: r.width / width, h: r.height / height, target });
        });
      }

      const webp = await dataUrlToWebp(src, width, height, scale);
      if (cancelled) return;
      job.resolve({ dataUrl: webp, links });
      setJob(null);
    })().catch((err) => {
      if (!cancelled) { job.reject(err); setJob(null); }
    });

    return () => { cancelled = true; };
  }, [job]);

  const rasterize = useCallback(
    (slide: Slide, opts: RasterizeOptions) =>
      new Promise<RasterizeResult>((resolve, reject) => {
        setJob({
          slide,
          opts: { scale: 1.5, ...opts },
          resolve,
          reject,
        });
      }),
    [],
  );

  // Mount the measurement node whenever a job is active (both platforms) so link
  // hotspots can be read from it. On Electron the PNG still comes from captureSlide.
  const host =
    job ? (
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
