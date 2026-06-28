import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import * as pdfjsLib from 'pdfjs-dist';
// Bundled module worker (offline — no CDN). `?worker` lets Vite instantiate it via
// the app's own asset mechanism, which works in dev, the web build AND packaged
// Electron (custom protocol) — unlike a `?url` + workerSrc string, which Chromium's
// file/custom-protocol can refuse to load. The port is shared for all documents;
// doc.destroy() never terminates an externally-provided port, so this is safe.
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { apiClient } from '../../api/apiClient';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfjsWorker();

interface Props {
  // Workspace-relative path of the PDF (routed through the VFS — local, or a
  // `.mdplink` SSH/local target — by apiClient.getFileAsDataUrl).
  path: string;
  // Bumped to force a re-fetch/re-render when the file is replaced on disk.
  version?: number;
}

// Decode the (VFS-aware) data URL into raw bytes for pdf.js.
async function fetchPdfBytes(path: string): Promise<Uint8Array> {
  const dataUrl = await apiClient.getFileAsDataUrl(path);
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Render a PDF to a stack of page canvases in a scrollable, app-themed pane.
// Pages are rasterised at device-pixel resolution (crisp) and CSS-scaled to fit
// the pane width, so panel resizes don't need a re-render.
export const PdfView: React.FC<Props> = ({ path, version }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let doc: any = null;
    const host = hostRef.current;
    setStatus('loading');
    setError('');

    (async () => {
      try {
        const data = await fetchPdfBytes(path);
        if (cancelled) return;
        doc = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled || !host) return;
        host.innerHTML = '';

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const avail = (host.clientWidth || 800) - 48;
        const targetWidth = Math.min(Math.max(avail, 320), 1100);

        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelled) return;
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const cssScale = targetWidth / base.width;
          const viewport = page.getViewport({ scale: cssScale * dpr });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.cssText = `width:${targetWidth}px;height:auto;display:block;margin:0 auto 16px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,0.35);border-radius:2px;max-width:100%;`;
          host.appendChild(canvas);

          const ctx = canvas.getContext('2d');
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (!cancelled) { setError((e as Error)?.message || 'Failed to load PDF.'); setStatus('error'); }
      }
    })();

    return () => {
      cancelled = true;
      try { doc?.destroy?.(); } catch { /* ignore */ }
    };
  }, [path, version]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: 'relative', backgroundColor: 'var(--app-bg-editor)' }}>
      {status !== 'ready' && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, color: 'var(--app-text-disabled)', zIndex: 1 }}>
          {status === 'loading'
            ? <><CircularProgress size={24} sx={{ color: 'var(--app-accent)' }} /><Typography variant="body2">Loading PDF…</Typography></>
            : <Typography variant="body2" sx={{ color: 'var(--app-danger)' }}>{error}</Typography>}
        </Box>
      )}
      <Box ref={hostRef} sx={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden', p: 3, boxSizing: 'border-box' }} />
    </Box>
  );
};
