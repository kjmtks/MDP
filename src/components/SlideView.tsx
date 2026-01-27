import React, { memo, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import './SlideViewer.css';

mermaid.initialize({ 
  startOnLoad: false, 
  securityLevel: 'loose',
  flowchart: { htmlLabels: false },
  er: { useMaxWidth: false }
});

interface SlideViewProps {
  html: string;
  pageNumber?: number | null;
  isActive?: boolean;
  isEnabledPointerEvents?: boolean;
  slideSize: { width: number; height: number };
  style?: React.CSSProperties;
  className?: string;
  header?: string;
  footer?: string;
}

export const SlideView: React.FC<SlideViewProps> = memo(({ 
  html, 
  pageNumber, 
  isActive = true, 
  isEnabledPointerEvents = true,
  slideSize,
  style,
  className = '',
  header,
  footer,
}) => {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  
  const [processedHtml, setProcessedHtml] = useState<string>(html);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mountedRoots = useRef<any[]>([]);

  useEffect(() => {
    let isMounted = true;
    const processMermaid = async () => {
      if (!html.includes('class="mermaid"')) {
        if (isMounted) setProcessedHtml(html);
        return;
      }
      const div = document.createElement('div');
      div.innerHTML = html;
      const mermaidNodes = div.querySelectorAll('.mermaid');
      for (const node of Array.from(mermaidNodes)) {
        const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
        const code = node.textContent || '';
        try {
          const { svg } = await mermaid.render(id, code);
          const wrapper = document.createElement('div');
          wrapper.className = "mermaid-svg-wrapper";
          wrapper.innerHTML = svg;
          const svgEl = wrapper.querySelector('svg');
          if (svgEl) {
             svgEl.style.maxWidth = '100%';
             svgEl.style.height = 'auto';
             svgEl.style.display = 'block';
             svgEl.style.margin = '0 auto';
          }
          node.replaceWith(wrapper);
        } catch (error) {
          console.warn("Mermaid render error", error);
          const errDiv = document.createElement('div');
          errDiv.style.cssText = 'color:red; border:1px solid red; padding:4px; font-size:12px; white-space:pre-wrap; background-color:#fff0f0;';
          errDiv.textContent = `Mermaid Error:\n${(error as Error).message}\n\n${code}`;
          node.replaceWith(errDiv);
        }
      }

      if (isMounted) {
        setProcessedHtml(div.innerHTML);
      }
    };
    processMermaid();
    return () => { isMounted = false; };
  }, [html]);

  useEffect(() => {
    if (!containerEl) return;
    mountedRoots.current.forEach(root => {
      try { root.unmount(); } catch { /* ignore */ }
    });
    mountedRoots.current = [];
    // --- Chart.js ---
    const chartContainers = containerEl.querySelectorAll('.chartjs-render:not([data-processed="true"])');
    if (chartContainers.length > 0) {
      import('chart.js/auto').then(({ default: Chart }) => {
        chartContainers.forEach(container => {
          if ((container as HTMLElement).offsetParent === null && !isActive) return;
          container.setAttribute('data-processed', 'true');
          const canvas = container.querySelector('canvas');
          const base64 = container.getAttribute('data-chart');
          if (canvas && base64) {
            try {
              const jsonStr = decodeURIComponent(escape(atob(base64)));
              const config = JSON.parse(jsonStr);
              if (!config.options) config.options = {};
              config.options.maintainAspectRatio = false;
              config.options.responsive = true;
              new Chart(canvas, config);
            } catch (e) {
              console.error("ChartJS render error:", e);
              container.innerHTML = `<div style="color:red">Chart Render Error</div>`;
            }
          }
        });
      }).catch(err => {
        console.warn("Chart.js not found.", err);
      });
    }
    return () => {
      mountedRoots.current.forEach(root => {
        try { root.unmount(); } catch { /* ignore */ }
      });
      mountedRoots.current = [];
    };
    
  }, [processedHtml, containerEl, isActive]); 

  return (
    <div 
      className={`slide-content-wrapper markdown-body ${className}`}
      style={{ 
        width: `${slideSize.width}px`, 
        height: `${slideSize.height}px`,
        
        display: isActive ? 'block' : 'none',
        position: 'relative',
        backgroundColor: 'white',
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: isEnabledPointerEvents ? 'auto' : 'none',
        userSelect: isEnabledPointerEvents ? 'auto' : 'none',
        ...style,
        ...({
          '--slide-width': `${slideSize.width}px`,
          '--slide-height': `${slideSize.height}px`,
          '--slide-aspect-ratio': `${slideSize.width}/${slideSize.height}`,
        } as React.CSSProperties)
      }}
    >
      {header && (
        <div className="slide-header" dangerouslySetInnerHTML={{ __html: header }} />
      )}
      
      <div 
        ref={setContainerEl}
        className="slide-content" 
        dangerouslySetInnerHTML={{ __html: processedHtml }} 
        style={{ width: '100%', height: '100%' }} 
      />
      
      {footer && (
        <div className="slide-footer" dangerouslySetInnerHTML={{ __html: footer }} />
      )}
      {pageNumber && (
        <div className="slide-page-number">
          {pageNumber}
        </div>
      )}
    </div>
  );
});