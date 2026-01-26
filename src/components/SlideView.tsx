import React, { memo } from 'react';
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