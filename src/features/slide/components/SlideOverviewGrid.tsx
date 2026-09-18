import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SlideScaler } from './SlideScaler';
import { SlideView } from './SlideView';
import { estimateTalkMinutes, formatTalkMinutes } from '../talkTime';
import { useAppSettings } from '../../settings/AppSettingsContext';
import type { Stroke } from '../../drawing/components/DrawingOverlay';

interface SlideOverviewGridProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  currentSlideIndex: number;
  slideSize: { width: number; height: number };
  drawings: Record<number, Stroke[]>;
  onSelectSlide: (index: number) => void;
  // The deck's folder, so relative images and inlined drawio/SVG files resolve
  // (a mirror surface receives it over the sync channel).
  basePath?: string;
}

export const SlideOverviewGrid: React.FC<SlideOverviewGridProps> = React.memo(({ slides, currentSlideIndex, slideSize, drawings, onSelectSlide, basePath }) => {
  const { settings } = useAppSettings();
  const cpm = settings.readingCharsPerMin;
  const visibleCount = slides.filter((s) => !s.isHidden).length;
  // Estimated talk time — recomputed when the slide set or reading speed changes.
  const minutes = useMemo(() => estimateTalkMinutes(slides, cpm), [slides, cpm]);

  // The grid sizes itself to ITS CONTAINER, not the screen: the same component is
  // used full-window in the editor, in the presenter tool, and in the small output
  // window. A fixed 300px column left narrow containers with one oversized
  // thumbnail running off the edge, so the column width tracks the measured width.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setBoxW(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setBoxW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = boxW > 0 && boxW < 560;
  const pad = compact ? 10 : 32;
  const gap = compact ? 10 : 32;
  // Aim for ~4 columns, never wider than the original 300px and never so narrow
  // that a thumbnail is unreadable. Unmeasured (first paint) → the old 300px.
  const minCol = boxW > 0 ? Math.round(Math.min(300, Math.max(110, boxW / 4))) : 300;

  return (
    <div ref={boxRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', backgroundColor: '#202020', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#202020', padding: compact ? '6px 10px 5px' : '1rem 2rem 0.6rem', display: 'flex', alignItems: 'baseline', gap: compact ? '0.6rem' : '1.25rem', fontSize: compact ? '0.72rem' : '0.85rem', borderBottom: '1px solid var(--app-border)' }}>
        <span style={{ color: 'var(--app-text-secondary)', fontWeight: 600 }}>{visibleCount} slide{visibleCount === 1 ? '' : 's'}</span>
        <span
          style={{ color: 'var(--app-text-muted)' }}
          title="Estimated talk time — each slide's <!-- @time … --> if set, else read time from substantial notes, else a complexity estimate. Set @time per slide for accuracy. A pacing guide, not exact."
        >
          {formatTalkMinutes(minutes)} talk
        </span>
      </div>
      <div style={{ padding: pad, display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${minCol}px, 100%), 1fr))`, gap, alignContent: 'flex-start' }}>
        {slides.map((slide, index) => (
          <div key={index} onClick={() => onSelectSlide(index)} className={`thumbnail-wrapper ${index === currentSlideIndex ? 'active' : ''}`} style={{ cursor: 'pointer', transform: index === currentSlideIndex ? 'scale(1.02)' : 'none', transition: 'transform 0.1s', display: slide.isHidden ? 'none' : 'block', position: 'relative', minWidth: 0 }}>
            {slide.pageNumber && <div className="thumbnail-number">{slide.pageNumber}</div>}
            {slide.isHidden && <div className="thumbnail-hidden"></div>}
            {slide.isCover && <div className="thumbnail-cover"></div>}
            <div className="thumbnail-frame" style={{ aspectRatio: `${slideSize.width} / ${slideSize.height}`, background: 'white', opacity: slide.isHidden ? 0.5 : 1, pointerEvents: 'none' }}>
              <SlideScaler width={slideSize.width} height={slideSize.height}>
                <SlideView html={slide.html} raw={slide.raw} basePath={basePath} pageNumber={slide.pageNumber} className={slide.className} isActive={true} slideSize={slideSize} isEnabledPointerEvents={false} header={slide.header} footer={slide.footer} drawings={drawings[index]} slideIndex={index} moduleRole="mirror" runScripts={false} />
              </SlideScaler>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
