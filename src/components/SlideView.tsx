import React, { memo, useEffect, useState } from 'react';
import mermaid from 'mermaid';
import './SlideViewer.css';

mermaid.initialize({ startOnLoad: false, theme: 'default' });

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

  useEffect(() => {
    if (!containerEl) return;
    const renderMermaid = async () => {
      const mermaidNodes = containerEl.querySelectorAll('.mermaid:not([data-processed="true"])');
      if (mermaidNodes.length === 0) return;
      for (const node of Array.from(mermaidNodes) as HTMLElement[]) {
        const code = node.textContent || '';
        try {
          await mermaid.parse(code);
          await mermaid.run({ nodes: [node] });
        } catch (error) {
           console.warn("Mermaid rendering skipped due to syntax error.");
           node.setAttribute('data-processed', 'true');
           node.style.color = 'red';
           node.style.whiteSpace = 'pre-wrap';
           node.style.border = '1px solid red';
           node.style.padding = '8px';
           node.style.backgroundColor = '#fff0f0';
           node.textContent = `Mermaid Syntax Error:\n${(error as Error).message || error}\n\n${code}`;
        }
      }
    };
    renderMermaid();
  }); 

  return (
    <div 
      className={`slide-content-wrapper markdown-body`}
      style={{ 
        width: '100%', 
        height: '100%', 
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