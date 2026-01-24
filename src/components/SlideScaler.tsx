import React, { useRef, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  width?: number;
  height?: number;
  marginRate?: number;
};

export const SlideScaler: React.FC<Props> = ({ 
  children, 
  width = 1280, 
  height = 720,
  marginRate = 0.95
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: parentWidth, height: parentHeight } = entry.contentRect;
        const scaleX = parentWidth / width;
        const scaleY = parentHeight / height;
        const newScale = Math.min(scaleX, scaleY) * marginRate;
        setScale(newScale);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [width, height, marginRate]);

  return (
    <div 
      ref={containerRef} 
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${width}px`,
          height: `${height}px`,
          flexShrink: 0, 
          
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          backgroundColor: 'white',
          boxShadow: '0 0 20px rgba(0,0,0,0.1)'
        }}
      >
        {children}
      </div>
    </div>
  );
};