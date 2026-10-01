import { useEffect, useRef, useState } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import { SlideView } from '../../slide/components/SlideView';
import { waitForRenderReady } from './captureReady';
import type { CaptureSlideData, WebCaptureMessage } from './captureTypes';
import { applyFontCss, loadWorkspaceFonts } from '../../fonts/fontRuntime';
import { embedFontCss } from '../../fonts/fontEmbed';

const KATEX_DELIMS = [
  { left: '\\(', right: '\\)', display: false },
  { left: '\\[', right: '\\]', display: true },
];

// The web build has no capture window: the fast video export loads this page in
// a hidden iframe of the editor (webCapture.ts) and talks to it by postMessage —
// the page draws each frame itself (html-to-image) and hands back an ImageBitmap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inIframe = !(window as any).electronAPI && window.parent !== window;
const toParent = (m: WebCaptureMessage, transfer: Transferable[] = []) => window.parent.postMessage(m, window.location.origin, transfer);

// The frame at the requested pixel size: the node keeps the slide's CSS size and
// is drawn at a pixel ratio (text rasterized at the final scale).
async function drawFrame(node: HTMLElement, d: CaptureSlideData): Promise<ImageBitmap> {
  const { toCanvas } = await import('html-to-image');
  const canvas = await toCanvas(node, {
    width: d.width, height: d.height, pixelRatio: (d.outWidth || d.width) / d.width,
    backgroundColor: '#fff', fontEmbedCSS: await embedFontCss(document, node),
  });
  return createImageBitmap(canvas);
}

export default function CapturePage() {
  const [data, setData] = useState<CaptureSlideData | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (inIframe) {
      const onMessage = (ev: MessageEvent<WebCaptureMessage>) => {
        if (ev.source !== window.parent || ev.origin !== window.location.origin) return;
        if (ev.data?.type === 'capture') setData(ev.data.data);
      };
      window.addEventListener('message', onMessage);
      toParent({ type: 'hello' });
      return () => window.removeEventListener('message', onMessage);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI;
    return api?.onCaptureRender?.((d: CaptureSlideData) => setData(d));
  }, []);

  useEffect(() => {
    if (!data) return;

    if (data.themeCssUrl) {
      const id = 'mdp-capture-theme';
      let link = document.getElementById(id) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      link.href = data.themeCssUrl;
    }

    // Inject module CSS (this capture window has its own document) so module
    // boxes render styled in the rasterized image.
    {
      const id = 'mdp-capture-module-css';
      let style = document.getElementById(id) as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement('style');
        style.id = id;
        document.head.appendChild(style);
      }
      style.textContent = data.moduleCss || '';
    }
    // Workspace fonts — same text left alone, so the loaded faces are reused
    // across captures.
    applyFontCss(document, data.fontCss || '');

    // The subtitle (video frames): text first — markup stays escaped — then its
    // math typeset in place; a KaTeX error leaves the plain text.
    const cap = captionRef.current;
    if (cap) {
      cap.textContent = data.caption || '';
      try { renderMathInElement(cap, { delimiters: KATEX_DELIMS, throwOnError: false }); } catch { /* plain text */ }
    }

    let cancelled = false;
    (async () => {
      // Load the workspace fonts explicitly before the capture: `document.fonts.ready`
      // alone can resolve before the first layout has even started a font load.
      await loadWorkspaceFonts(document, data.fontCss || '', undefined, nodeRef.current?.textContent ?? undefined);
      if (nodeRef.current) await waitForRenderReady(nodeRef.current);
      if (cancelled) return;
      if (inIframe) {
        try {
          const bitmap = await drawFrame(nodeRef.current!, data);
          toParent({ type: 'captured', id: data.id, bitmap }, [bitmap]);
        } catch (e) {
          toParent({ type: 'failed', id: data.id, message: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).electronAPI?.sendCaptureReady?.(data.id);
    })();
    return () => { cancelled = true; };
  }, [data]);

  // A video frame is rendered at the slide's own size and scaled up with a
  // transform (text is rasterized at the final scale), so the layout matches every
  // other surface. Not the window zoom: that is shared by all file:// windows. (The
  // web iframe draws at a pixel ratio instead — see drawFrame.)
  const scale = data?.outWidth && !inIframe ? data.outWidth / data.width : 1;
  return (
    <div style={{ margin: 0, padding: 0, background: '#fff' }}>
      <div ref={nodeRef} style={{
        position: 'relative', width: data?.width, height: data?.height,
        ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: '0 0' } : {}),
      }}>
        {data && (
          <SlideView
            // A fresh mount per capture: a later step of the same slide would
            // otherwise take the ANIMATED path and be captured mid-effect.
            key={data.id}
            html={data.html}
            className={data.className}
            header={data.header}
            footer={data.footer}
            basePath={data.basePath}
            pageNumber={data.pageNumber}
            buildStep={data.buildStep}
            slideSize={{ width: data.width, height: data.height }}
            isActive
            isEnabledPointerEvents={false}
          />
        )}
        {data?.caption && (
          // Sized from the slide, so it scales with the frame (≈ the auto-play's caption).
          <div ref={captionRef} style={{
            position: 'absolute', left: '50%', bottom: data.height * 0.045, transform: 'translateX(-50%)',
            maxWidth: data.width * 0.88, width: 'max-content', boxSizing: 'border-box',
            padding: `${data.height * 0.012}px ${data.height * 0.028}px`, borderRadius: data.height * 0.016,
            background: 'rgba(0,0,0,.72)', color: '#fff', textAlign: 'center',
            fontFamily: 'var(--mdp-font-body, "Noto Sans JP", sans-serif)',
            fontSize: data.height * 0.04, lineHeight: 1.35, fontWeight: 600,
            textShadow: '0 1px 3px rgba(0,0,0,.6)', whiteSpace: 'pre-wrap', zIndex: 10,
          }} />
        )}
      </div>
    </div>
  );
}
