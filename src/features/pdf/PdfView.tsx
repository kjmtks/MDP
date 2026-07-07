import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { openPdfDocument, fetchPdfBytes, PDF_GOTO_PAGE_EVENT, PDF_PAGE_CHANGED_EVENT } from './pdfSetup';

interface Props {
  // Workspace-relative path of the PDF (routed through the VFS — local, or a
  // `.mdplink` SSH/local target — by apiClient.getFileAsDataUrl).
  path: string;
  // Bumped to force a re-fetch/re-render when the file is replaced on disk.
  version?: number;
}

// Cap on simultaneously-rasterised pages, so peak memory stays bounded even when
// the user scrolls a large PDF end to end (the farthest-from-viewport page is
// evicted back to a reserved-height placeholder).
const MAX_RENDERED = 24;

// Render a PDF as a scrollable, app-themed stack of pages. VIRTUALIZED: every page
// gets a placeholder with its EXACT reserved height up front (so scroll height and
// `data-pdf-page` anchors are stable — goto lands precisely and scrolling doesn't
// jitter), but a page is only RASTERISED when it scrolls near the viewport
// (IntersectionObserver) and is evicted when far away. Two-way synced with the
// thumbnail rail via PDF_GOTO / PAGE_CHANGED events.
export const PdfView: React.FC<Props> = ({ path, version }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const prevPathRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let doc: any = null;
    let handle: ReturnType<typeof openPdfDocument> | null = null;
    let observer: IntersectionObserver | null = null;
    const rendered = new Set<number>();
    const wraps: Record<number, HTMLElement> = {};
    const retried = new Set<number>();
    const host = hostRef.current;
    // An in-place reload (same path, version bumped) preserves scroll position.
    const samePath = prevPathRef.current === path;
    prevPathRef.current = path;
    const savedScroll = samePath && host ? host.scrollTop : 0;
    // Clear the previous PDF IMMEDIATELY (before the async load).
    if (host) host.innerHTML = '';
    setStatus('loading');
    setError('');

    (async () => {
      try {
        const data = await fetchPdfBytes(path);
        if (cancelled) return;
        handle = openPdfDocument(data);
        doc = await handle.promise;
        if (cancelled || !host) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetWidth = Math.min(Math.max((host.clientWidth || 800) - 48, 320), 1100);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pages: any[] = [];
        const heights: number[] = [];
        const placeholderCss = (n: number) => `width:${targetWidth}px;height:${heights[n]}px;margin:0 auto;background:var(--app-bg-elevated);border-radius:2px;`;
        const canvasCss = `width:${targetWidth}px;height:auto;display:block;margin:0 auto;background:#fff;border-radius:2px;`;

        const MARGIN = 600; // keep in sync with the observer's rootMargin
        const teardown = (n: number) => {
          const w = wraps[n];
          if (!w) return;
          rendered.delete(n);
          const ph = document.createElement('div');
          ph.style.cssText = placeholderCss(n);
          w.replaceChildren(ph);
          // Re-observe: a wrapper still inside the observation margin never gets a
          // NEW intersection callback (its state didn't change), so without this a
          // near-visible evicted page would stay a blank placeholder.
          if (observer) { observer.unobserve(w); observer.observe(w); }
        };
        const maybeEvict = () => {
          const vTop = host.scrollTop - MARGIN;
          const vBot = host.scrollTop + host.clientHeight + MARGIN;
          const center = host.scrollTop + host.clientHeight / 2;
          while (rendered.size > MAX_RENDERED) {
            let far = 0, farDist = -1;
            for (const n of rendered) {
              const w = wraps[n];
              if (!w) continue;
              const top = w.offsetTop;
              // Never evict inside the observation window — teardown re-observes,
              // so evicting there would just re-render in a loop.
              if (top + w.offsetHeight > vTop && top < vBot) continue;
              const dist = Math.abs((top + w.offsetHeight / 2) - center);
              if (dist > farDist) { farDist = dist; far = n; }
            }
            if (!far) break; // everything rendered is near-visible → allow exceeding the cap
            teardown(far);
          }
        };
        const renderPage = async (n: number) => {
          if (!n || rendered.has(n) || cancelled) return;
          const wrapper = wraps[n];
          if (!wrapper) return;
          rendered.add(n);
          try {
            const page = pages[n] || await doc.getPage(n);
            if (cancelled) return;
            const scale = (targetWidth / page.getViewport({ scale: 1 }).width) * dpr;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.cssText = canvasCss;
            const ctx = canvas.getContext('2d');
            if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
            // Torn down (evicted) while rendering → discard; a fresh intersection
            // will re-render it. Writing anyway would leave an untracked canvas.
            if (cancelled || !rendered.has(n)) return;
            wrapper.replaceChildren(canvas);
            maybeEvict();
          } catch {
            rendered.delete(n);
            // One retry for a transient failure: re-observe so a fresh intersection
            // callback fires even though the wrapper is still on-screen.
            if (!cancelled && observer && !retried.has(n)) {
              retried.add(n);
              observer.unobserve(wrapper);
              observer.observe(wrapper);
            }
          }
        };

        observer = new IntersectionObserver((entries) => {
          for (const e of entries) {
            if (e.isIntersecting) renderPage(Number((e.target as HTMLElement).dataset.pdfPage));
          }
        }, { root: host, rootMargin: '600px 0px' });

        for (let n = 1; n <= doc.numPages; n++) {
          const p = await doc.getPage(n); // cheap: page dict, no rasterisation
          if (cancelled) return;
          const v = p.getViewport({ scale: 1 });
          pages[n] = p;
          heights[n] = Math.max(1, Math.round(targetWidth * (v.height / v.width)));
          const wrapper = document.createElement('div');
          wrapper.dataset.pdfPage = String(n);
          wrapper.style.cssText = `width:${targetWidth}px;margin:0 auto 16px;box-shadow:0 2px 10px rgba(0,0,0,0.35);border-radius:2px;max-width:100%;`;
          const ph = document.createElement('div');
          ph.style.cssText = placeholderCss(n);
          wrapper.appendChild(ph);
          host.appendChild(wrapper);
          wraps[n] = wrapper;
          observer.observe(wrapper);
          if (n === 1 && !cancelled) setStatus('ready'); // show page 1 immediately
        }
        if (!cancelled) {
          setStatus('ready');
          if (samePath && savedScroll) host.scrollTop = savedScroll;
        }
      } catch (e) {
        if (!cancelled) { setError((e as Error)?.message || 'Failed to load PDF.'); setStatus('error'); }
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      handle?.destroy();
    };
  }, [path, version]);

  // A thumbnail click asks this view to scroll to a page (for the active PDF).
  useEffect(() => {
    const onGoto = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.path && d.path !== path) return;
      const host = hostRef.current;
      const el = host?.querySelector(`[data-pdf-page="${d.page}"]`) as HTMLElement | null;
      if (host && el) host.scrollTo({ top: Math.max(0, el.offsetTop - 12), behavior: 'smooth' });
    };
    window.addEventListener(PDF_GOTO_PAGE_EVENT, onGoto);
    return () => window.removeEventListener(PDF_GOTO_PAGE_EVENT, onGoto);
  }, [path]);

  // Report the page most visible in the viewport (on scroll) so the thumbnail rail
  // can highlight it. Only on an actual change; rAF-throttled. Wrappers always have a
  // reserved height, so this is stable even before pages rasterise. Depends on
  // `version` too so `lastPage` resets after an in-place reload.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let lastPage = 0;
    const emit = () => {
      raf = 0;
      const vTop = host.scrollTop;
      const vBot = vTop + host.clientHeight;
      let best = 0, bestVis = -1;
      host.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((el) => {
        const top = el.offsetTop;
        const vis = Math.min(top + el.offsetHeight, vBot) - Math.max(top, vTop);
        if (vis > bestVis) { bestVis = vis; best = Number(el.dataset.pdfPage) || 0; }
      });
      if (best && best !== lastPage) {
        lastPage = best;
        window.dispatchEvent(new CustomEvent(PDF_PAGE_CHANGED_EVENT, { detail: { path, page: best } }));
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(emit); };
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => { host.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [path, version]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: 'relative', backgroundColor: 'var(--app-bg-editor)' }}>
      {status !== 'ready' && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, color: 'var(--app-text-disabled)', zIndex: 1, pointerEvents: 'none' }}>
          {status === 'loading'
            ? <><CircularProgress size={24} sx={{ color: 'var(--app-accent)' }} /><Typography variant="body2">Loading PDF…</Typography></>
            : <Typography variant="body2" sx={{ color: 'var(--app-danger)' }}>{error}</Typography>}
        </Box>
      )}
      <Box ref={hostRef} sx={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', p: 3, boxSizing: 'border-box' }} />
    </Box>
  );
};
