import React, { useEffect, useRef, useState } from 'react';
import { SlideView } from '../slide/components/SlideView';
import { waitForRenderReady } from './capture/captureReady';
import { loadWorkspaceFonts } from '../fonts/fontRuntime';
import { measurePage, type LinePage } from './layoutCheck';

const CHUNK = 6;

// Every slide rendered off-screen at its full size, a few at a time, and measured
// (layoutCheck.ts) — the same on the host and on a remote device, so the two can
// be compared. Module scripts do not run (both sides measure the same static HTML).
export const LayoutProbe: React.FC<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  slideSize: { width: number; height: number };
  basePath?: string;
  fontCss?: string;
  onProgress?: (done: number, total: number) => void;
  onDone: (pages: LinePage[]) => void;
  onError: (e: unknown) => void;
}> = ({ slides, slideSize, basePath, fontCss, onProgress, onDone, onError }) => {
  const [from, setFrom] = useState(0);
  const pagesRef = useRef<LinePage[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onProgress, onDone, onError });
  useEffect(() => { cbRef.current = { onProgress, onDone, onError }; });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const host = hostRef.current;
      if (!host) return;
      // The deck's own fonts (the slices this text needs), then images; then the
      // inline SVGs, which arrive by fetch and take their room in the layout.
      await loadWorkspaceFonts(document, fontCss, 15000, host.textContent || '');
      await waitForRenderReady(host);
      const t0 = Date.now();
      while (Date.now() - t0 < 4000 && Array.from(host.querySelectorAll('.mdp-drawio-svg[data-svg-load]')).some((e) => !e.firstElementChild)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;
      host.querySelectorAll<HTMLElement>('[data-layout-probe]').forEach((box) => {
        const w = box.querySelector<HTMLElement>('.slide-content-wrapper');
        if (w) pagesRef.current.push(measurePage(Number(box.dataset.layoutProbe), w));
      });
      const next = from + CHUNK;
      cbRef.current.onProgress?.(Math.min(next, slides.length), slides.length);
      if (next >= slides.length) cbRef.current.onDone(pagesRef.current);
      else setFrom(next);
    })().catch((e) => { if (!cancelled) cbRef.current.onError(e); });
    return () => { cancelled = true; };
  }, [from, slides, fontCss]);

  return (
    <div ref={hostRef} aria-hidden style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none', zIndex: -1 }}>
      {slides.slice(from, from + CHUNK).map((s, i) => (
        <div key={from + i} data-layout-probe={from + i + 1}>
          <SlideView
            html={s.html} raw={s.raw} className={s.className} header={s.header} footer={s.footer} pageNumber={s.pageNumber}
            basePath={basePath} slideSize={slideSize} isActive isEnabledPointerEvents={false} runScripts={false} moduleRole="mirror"
          />
        </div>
      ))}
    </div>
  );
};
