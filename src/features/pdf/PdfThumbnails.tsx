import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { openPdfDocument, fetchPdfBytes, PDF_GOTO_PAGE_EVENT, PDF_PAGE_CHANGED_EVENT } from './pdfSetup';

interface Props {
  path: string;
  version?: number;
}

// Cap on simultaneously-rasterised thumbnails (small, so a higher cap than the main
// view); the farthest-from-viewport one is evicted back to a placeholder.
const MAX_RENDERED = 60;

// A rail of small page thumbnails for the PDF shown in the preview. VIRTUALIZED like
// PdfView: every page gets a placeholder with its exact reserved height up front, and
// each is rasterised only when it scrolls near the rail (IntersectionObserver) and
// evicted when far. Clicking scrolls the main PdfView to that page; as the preview
// scrolls, the current page's thumbnail is highlighted + revealed here.
export const PdfThumbnails: React.FC<Props> = ({ path, version }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapsRef = useRef<Record<number, HTMLDivElement>>({});
  const prevPathRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  const applyHighlight = (page: number) => {
    for (const [p, el] of Object.entries(wrapsRef.current)) {
      const active = Number(p) === page;
      el.style.outline = active ? '2px solid var(--app-accent)' : '';
      el.style.outlineOffset = active ? '1px' : '';
    }
  };

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let doc: any = null;
    let handle: ReturnType<typeof openPdfDocument> | null = null;
    let observer: IntersectionObserver | null = null;
    const rendered = new Set<number>();
    const retried = new Set<number>();
    const host = hostRef.current;
    // Only reset the highlighted page on a NEW PDF; an in-place reload (same path,
    // version bump) keeps the current page.
    const samePath = prevPathRef.current === path;
    prevPathRef.current = path;
    if (host) host.innerHTML = '';
    wrapsRef.current = {};
    if (!samePath) { currentPageRef.current = 1; setCurrentPage(1); }
    setStatus('loading');

    (async () => {
      try {
        const data = await fetchPdfBytes(path);
        if (cancelled) return;
        handle = openPdfDocument(data);
        doc = await handle.promise;
        if (cancelled || !host) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetWidth = Math.min(Math.max((host.clientWidth || 200) - 24, 90), 240);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pages: any[] = [];
        const heights: number[] = [];
        const boxCss = `width:${targetWidth}px;display:block;margin:0 auto 2px;border-radius:2px;`;
        const canvasCss = `${boxCss}height:auto;background:#fff;border:1px solid var(--app-border);box-shadow:0 1px 4px rgba(0,0,0,0.3);`;
        const makePlaceholder = (n: number) => {
          const ph = document.createElement('div');
          ph.style.cssText = `${boxCss}height:${heights[n]}px;background:var(--app-bg-elevated);border:1px solid var(--app-border);`;
          return ph;
        };

        const MARGIN = 400; // keep in sync with the observer's rootMargin
        const teardown = (n: number) => {
          const w = wrapsRef.current[n];
          if (!w) return;
          rendered.delete(n);
          if (w.firstChild) w.replaceChild(makePlaceholder(n), w.firstChild);
          // Re-observe so a still-near-visible evicted page re-renders (see PdfView).
          if (observer) { observer.unobserve(w); observer.observe(w); }
        };
        const maybeEvict = () => {
          const vTop = host.scrollTop - MARGIN;
          const vBot = host.scrollTop + host.clientHeight + MARGIN;
          const center = host.scrollTop + host.clientHeight / 2;
          while (rendered.size > MAX_RENDERED) {
            let far = 0, farDist = -1;
            for (const n of rendered) {
              const w = wrapsRef.current[n];
              if (!w) continue;
              const top = w.offsetTop;
              // Never evict inside the observation window (teardown re-observes —
              // evicting there would loop).
              if (top + w.offsetHeight > vTop && top < vBot) continue;
              const dist = Math.abs((top + w.offsetHeight / 2) - center);
              if (dist > farDist) { farDist = dist; far = n; }
            }
            if (!far) break;
            teardown(far);
          }
        };
        const renderPage = async (n: number) => {
          if (!n || rendered.has(n) || cancelled) return;
          const wrapper = wrapsRef.current[n];
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
            // Torn down (evicted) while rendering → discard (see PdfView).
            if (cancelled || !rendered.has(n)) return;
            if (wrapper.firstChild) wrapper.replaceChild(canvas, wrapper.firstChild);
            else wrapper.insertBefore(canvas, wrapper.firstChild);
            maybeEvict();
          } catch {
            rendered.delete(n);
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
        }, { root: host, rootMargin: '400px 0px' });

        for (let n = 1; n <= doc.numPages; n++) {
          const p = await doc.getPage(n);
          if (cancelled) return;
          const v = p.getViewport({ scale: 1 });
          pages[n] = p;
          heights[n] = Math.max(1, Math.round(targetWidth * (v.height / v.width)));

          const wrapper = document.createElement('div');
          wrapper.dataset.pdfPage = String(n);
          wrapper.style.cssText = 'margin:0 auto 12px;cursor:pointer;border-radius:3px;';
          wrapper.title = `Page ${n}`;
          wrapper.addEventListener('click', () =>
            window.dispatchEvent(new CustomEvent(PDF_GOTO_PAGE_EVENT, { detail: { path, page: n } })));

          const label = document.createElement('div');
          label.textContent = String(n);
          label.style.cssText = 'text-align:center;font-size:0.7rem;color:var(--app-text-disabled);';

          wrapper.appendChild(makePlaceholder(n));
          wrapper.appendChild(label);
          host.appendChild(wrapper);
          wrapsRef.current[n] = wrapper;
          observer.observe(wrapper);
        }
        if (!cancelled) { applyHighlight(currentPageRef.current); setStatus('ready'); }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      handle?.destroy();
    };
  }, [path, version]);

  // The preview reported its current page → track it (for the active PDF).
  useEffect(() => {
    const onChanged = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      if (d.path && d.path !== path) return;
      if (typeof d.page === 'number') setCurrentPage(d.page);
    };
    window.addEventListener(PDF_PAGE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PDF_PAGE_CHANGED_EVENT, onChanged);
  }, [path]);

  // Highlight the current page's thumbnail and keep it visible in the rail.
  useEffect(() => {
    applyHighlight(currentPage);
    const host = hostRef.current;
    const el = wrapsRef.current[currentPage];
    if (host && el) {
      const top = el.offsetTop;
      const bot = top + el.offsetHeight;
      if (top < host.scrollTop || bot > host.scrollTop + host.clientHeight) {
        host.scrollTo({ top: Math.max(0, top - 20), behavior: 'smooth' });
      }
    }
  }, [currentPage]);

  // `hostRef` is BOTH the scroller AND the (imperatively-filled) container, so
  // scrollTop / offsetTop math and scroll-into-view are consistent.
  return (
    <Box sx={{ height: '100%', position: 'relative', bgcolor: 'var(--app-bg-panel)' }}>
      {status !== 'ready' && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, pointerEvents: 'none' }}>
          {status === 'loading'
            ? <CircularProgress size={18} sx={{ color: 'var(--app-accent)' }} />
            : <Typography sx={{ color: 'var(--app-danger)', fontSize: '0.8rem', textAlign: 'center', px: 2 }}>Could not render PDF thumbnails.</Typography>}
        </Box>
      )}
      <Box ref={hostRef} sx={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', p: 1, boxSizing: 'border-box' }} />
    </Box>
  );
};
