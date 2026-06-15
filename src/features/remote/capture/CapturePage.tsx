import { useEffect, useRef, useState } from 'react';
import { SlideView } from '../../slide/components/SlideView';
import { waitForRenderReady } from './captureReady';
import type { CaptureSlideData } from './captureTypes';

export default function CapturePage() {
  const [data, setData] = useState<CaptureSlideData | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

    let cancelled = false;
    (async () => {
      if (nodeRef.current) await waitForRenderReady(nodeRef.current);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!cancelled) (window as any).electronAPI?.sendCaptureReady?.(data.id);
    })();
    return () => { cancelled = true; };
  }, [data]);

  return (
    <div style={{ margin: 0, padding: 0, background: '#fff' }}>
      <div ref={nodeRef}>
        {data && (
          <SlideView
            html={data.html}
            className={data.className}
            header={data.header}
            footer={data.footer}
            basePath={data.basePath}
            slideSize={{ width: data.width, height: data.height }}
            isActive
            isEnabledPointerEvents={false}
          />
        )}
      </div>
    </div>
  );
}
