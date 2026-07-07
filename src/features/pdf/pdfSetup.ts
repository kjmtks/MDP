import * as pdfjsLib from 'pdfjs-dist';
// Bundled module worker (offline — no CDN). `?worker` lets Vite instantiate it via
// the app's own asset mechanism, which works in dev, the web build AND packaged
// Electron (custom protocol).
import PdfjsWorkerCtor from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { apiClient } from '../../api/apiClient';

export { pdfjsLib };

/**
 * Open a PDF with its OWN worker. pdf.js caches ONE PDFWorker per port, and a
 * loadingTask.destroy() tears that shared instance down — with PdfView and
 * PdfThumbnails both alive on a single GlobalWorkerOptions.workerPort, switching
 * documents raced the two destroys ("PDFWorker.fromPort - the worker is being
 * destroyed"). A dedicated worker per document isolates the lifecycles; destroy()
 * also terminates the underlying Worker thread.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openPdfDocument(data: Uint8Array): { promise: Promise<any>; destroy: () => void } {
  const port: Worker = new PdfjsWorkerCtor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worker = new (pdfjsLib as any).PDFWorker({ port });
  const task = pdfjsLib.getDocument({ data, worker });
  return {
    promise: task.promise,
    destroy: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (task as any).destroy?.()?.catch?.(() => {});
      try { worker.destroy(); } catch { /* ignore */ }
      try { port.terminate(); } catch { /* ignore */ }
    },
  };
}

// Decode a PDF (routed through the VFS — local or a `.mdplink` target) into bytes.
export async function fetchPdfBytes(path: string): Promise<Uint8Array> {
  const dataUrl = await apiClient.getFileAsDataUrl(path);
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Jump the main PdfView to a page (1-indexed). detail: { path, page }.
export const PDF_GOTO_PAGE_EVENT = 'mdp-pdf-goto-page';
// Emitted by PdfView when the page most visible in its viewport changes, so the
// thumbnail rail can highlight the current page. detail: { path, page }.
export const PDF_PAGE_CHANGED_EVENT = 'mdp-pdf-page-changed';
