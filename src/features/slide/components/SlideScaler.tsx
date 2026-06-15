import React, { useRef, useLayoutEffect, useState } from 'react';
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

  // useLayoutEffect + an immediate synchronous measure so the correct scale is
  // applied BEFORE the first paint. Otherwise the default scale=1 (slide at full
  // natural size, clipped by overflow:hidden) shows for one frame on every mount
  // — visible as a flicker when a slide frame remounts on a no-transition slide
  // change (ResizeObserver's first callback is async and arrives a frame late).
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      // Use the LAYOUT size (clientWidth/Height), not getBoundingClientRect():
      // the latter includes ancestor CSS transforms, so when a slide mounts
      // inside a slideshow transition frame that is mid-transform (e.g. zoom's
      // `scale(0.8)` or flip's `rotateY(90deg)`), the measured box is shrunk or
      // collapsed and the wrong fit scale gets locked in — the slide stays small
      // after the transition. clientWidth/Height are immune to ancestor
      // transforms and give the true available space.
      const availW = container.clientWidth;
      const availH = container.clientHeight;
      if (availW <= 0 || availH <= 0) return;
      const newScale = Math.min(availW / width, availH / height) * marginRate;
      if (newScale > 0 && Number.isFinite(newScale)) setScale(newScale);
    };

    measure();

    const observer = new ResizeObserver(() => measure());
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