// The fast video export's pictures in the web build — what the desktop app's
// capture window does: CapturePage at the slide's size, the build step settled and
// the subtitle drawn in, here in a hidden iframe of this page. Its own document, so
// the job's theme, module CSS and fonts never touch the editor's; it draws each
// frame itself (html-to-image) and hands back an ImageBitmap. One at a time — the
// export awaits each frame.
import type { CaptureSlideData, WebCaptureMessage } from '../remote/capture/captureTypes';

const FRAME_TIMEOUT_MS = 60_000;

export interface WebCapturer {
  capture: (data: CaptureSlideData) => Promise<ImageBitmap>;
  close: () => void;
}

/** Load the capture page; resolves once it listens. */
export async function openWebCapturer(width: number, height: number, signal: AbortSignal): Promise<WebCapturer> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // In the viewport (an off-screen frame may be throttled) but invisible and under
  // everything; laid out at the slide's size, as the capture window is.
  Object.assign(frame.style, {
    position: 'fixed', left: '0', top: '0', width: `${width}px`, height: `${height}px`, border: '0',
    opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  frame.src = `${window.location.pathname}#/capture`;

  let pending: { id: number; resolve: (b: ImageBitmap) => void; reject: (e: Error) => void; timer: number } | null = null;
  let hello!: () => void;
  const ready = new Promise<void>((r) => { hello = r; });
  const onMessage = (ev: MessageEvent<WebCaptureMessage>) => {
    if (ev.source !== frame.contentWindow || ev.origin !== window.location.origin) return;
    const m = ev.data;
    if (m?.type === 'hello') hello();
    else if ((m?.type === 'captured' || m?.type === 'failed') && pending && m.id === pending.id) {
      const p = pending;
      pending = null;
      window.clearTimeout(p.timer);
      if (m.type === 'captured') p.resolve(m.bitmap);
      else p.reject(new Error(`A video frame could not be drawn: ${m.message}`));
    }
  };
  const close = () => {
    window.removeEventListener('message', onMessage);
    frame.remove();
    if (pending) { window.clearTimeout(pending.timer); pending.reject(new DOMException('The video export was cancelled.', 'AbortError')); pending = null; }
  };
  window.addEventListener('message', onMessage);
  document.body.appendChild(frame);

  const loading = new Promise<never>((_, reject) => {
    const t = window.setTimeout(() => reject(new Error('The capture page did not load.')), FRAME_TIMEOUT_MS);
    void ready.then(() => window.clearTimeout(t));
    signal.addEventListener('abort', () => reject(new DOMException('The video export was cancelled.', 'AbortError')), { once: true });
  });
  loading.catch(() => { /* raced below */ });
  try {
    await Promise.race([ready, loading]);
  } catch (e) {
    close();
    throw e;
  }
  signal.addEventListener('abort', close, { once: true });

  return {
    capture: (data) => new Promise<ImageBitmap>((resolve, reject) => {
      if (!frame.isConnected) { reject(new DOMException('The video export was cancelled.', 'AbortError')); return; }
      const timer = window.setTimeout(() => {
        if (pending?.id !== data.id) return;
        pending = null;
        reject(new Error('A video frame took too long to draw.'));
      }, FRAME_TIMEOUT_MS);
      pending = { id: data.id, resolve, reject, timer };
      frame.contentWindow!.postMessage({ type: 'capture', data } satisfies WebCaptureMessage, window.location.origin);
    }),
    close,
  };
}
