import React, { memo, useEffect, useRef, useState } from 'react';
import { DrawingOverlay, type Stroke } from './DrawingOverlay';
import './SlideViewer.css';

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
  drawings?: Stroke[];
  onAddStroke?: (stroke: Stroke) => void;
  isInteracting?: boolean;
  toolType?: 'pen' | 'eraser';
  color?: string;
  lineWidth?: number;
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
  drawings = [],
  onAddStroke,
  isInteracting = false,
  toolType,
  color,
  lineWidth
}) => {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mountedRoots = useRef<any[]>([]);

  useEffect(() => {
    if (!containerEl) return;

    mountedRoots.current.forEach(root => {
      try { root.unmount(); } catch { /* ignore */ }
    });
    mountedRoots.current = [];
    
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
  }, [html, containerEl, isActive]);

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
        className={`slide-content ${className}`} 
        dangerouslySetInnerHTML={{ __html: html }} 
        style={{ width: '100%', height: '100%' }}
      />
      {drawings && drawings.length > 0 && (
        <DrawingOverlay
          width={slideSize.width}
          height={slideSize.height}
          data={drawings}
          isInteracting={isInteracting}
          onAddStroke={onAddStroke}
          toolType={toolType}
          color={color}
          lineWidth={lineWidth}
        />
      )}
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