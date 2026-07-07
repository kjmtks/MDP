import React, { useMemo } from 'react';
import { SlideScaler } from './SlideScaler';
import { SlideView } from './SlideView';
import { estimateTalkMinutes, formatTalkMinutes } from '../talkTime';
import type { Stroke } from '../../drawing/components/DrawingOverlay';

interface SlideOverviewGridProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  currentSlideIndex: number;
  slideSize: { width: number; height: number };
  drawings: Record<number, Stroke[]>;
  onSelectSlide: (index: number) => void;
}

export const SlideOverviewGrid: React.FC<SlideOverviewGridProps> = React.memo(({ slides, currentSlideIndex, slideSize, drawings, onSelectSlide }) => {
  const visibleCount = slides.filter((s) => !s.isHidden).length;
  // Estimated talk time — recomputed only when the slide set changes.
  const minutes = useMemo(() => estimateTalkMinutes(slides), [slides]);
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', backgroundColor: '#202020', display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: '#202020', padding: '1rem 2rem 0.6rem', display: 'flex', alignItems: 'baseline', gap: '1.25rem', fontSize: '0.85rem', borderBottom: '1px solid var(--app-border)' }}>
        <span style={{ color: 'var(--app-text-secondary)', fontWeight: 600 }}>{visibleCount} slide{visibleCount === 1 ? '' : 's'}</span>
        <span
          style={{ color: 'var(--app-text-muted)' }}
          title="Estimated speaking time — from speaker notes where present, else slide text (~320 chars/min). A pacing guide, not exact."
        >
          {formatTalkMinutes(minutes)} talk
        </span>
      </div>
      <div style={{ padding: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '2rem', alignContent: 'flex-start' }}>
        {slides.map((slide, index) => (
          <div key={index} onClick={() => onSelectSlide(index)} className={`thumbnail-wrapper ${index === currentSlideIndex ? 'active' : ''}`} style={{ cursor: 'pointer', transform: index === currentSlideIndex ? 'scale(1.02)' : 'none', transition: 'transform 0.1s', display: slide.isHidden ? 'none' : 'block', position: 'relative' }}>
            {slide.pageNumber && <div className="thumbnail-number">{slide.pageNumber}</div>}
            {slide.isHidden && <div className="thumbnail-hidden"></div>}
            {slide.isCover && <div className="thumbnail-cover"></div>}
            <div className="thumbnail-frame" style={{ aspectRatio: `${slideSize.width} / ${slideSize.height}`, background: 'white', opacity: slide.isHidden ? 0.5 : 1, pointerEvents: 'none' }}>
              <SlideScaler width={slideSize.width} height={slideSize.height}>
                <SlideView html={slide.html} pageNumber={slide.pageNumber} className={slide.className} isActive={true} slideSize={slideSize} isEnabledPointerEvents={false} header={slide.header} footer={slide.footer} drawings={drawings[index]} slideIndex={index} moduleRole="mirror" runScripts={false} />
              </SlideScaler>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
