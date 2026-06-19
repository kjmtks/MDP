import React from 'react';
import { SlideScaler } from './SlideScaler';
import { SlideView } from './SlideView';
import type { Stroke } from '../../drawing/components/DrawingOverlay';

interface SlideOverviewGridProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  currentSlideIndex: number;
  slideSize: { width: number; height: number };
  drawings: Record<number, Stroke[]>;
  onSelectSlide: (index: number) => void;
}

export const SlideOverviewGrid: React.FC<SlideOverviewGridProps> = React.memo(({ slides, currentSlideIndex, slideSize, drawings, onSelectSlide }) => (
  <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', backgroundColor: '#202020', padding: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '2rem', alignContent: 'flex-start' }}>
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
));