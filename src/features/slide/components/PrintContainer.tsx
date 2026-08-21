import React from 'react';
import { SlideView } from './SlideView';
import type { Stroke } from '../../drawing/components/DrawingOverlay';

interface PrintContainerProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  slideSize: { width: number; height: number };
  slideStyleVariables: React.CSSProperties;
  drawings: Record<number, Stroke[]>;
}

export const PrintContainer: React.FC<PrintContainerProps> = React.memo(({ slides, slideSize, slideStyleVariables, drawings }) => {
  // slideSize.width is BASE_HEIGHT * aspectW / aspectH and is usually FRACTIONAL
  // (841:1189 → 509.268…). Chromium rounds the @page box to whole device units,
  // so a fractional page size and an exactly-fractional slide box disagree by a
  // sub-pixel and the last hairline row spills — the page then prints a touch
  // short/tall. Round once and use the SAME integers for both.
  const pageW = Math.round(slideSize.width);
  const pageH = Math.round(slideSize.height);
  return (
  <div className="print-container">
    <style>{`
      @media print {
        @page { size: ${pageW}px ${pageH}px; margin: 0; }
        .print-slide-page { width: ${pageW}px !important; height: ${pageH}px !important; overflow: hidden; }
        .print-slide-content { width: 100% !important; height: 100% !important; }
      }
    `}</style>
    {slides.map((slide, index) => !slide.isHidden && (
        <div key={index} className="print-slide-page">
          <SlideView html={slide.html} pageNumber={slide.pageNumber} isActive={true} className={`print-slide-content ${slide.className || 'normal'}`} style={slideStyleVariables} slideSize={slideSize} header={slide.header} footer={slide.footer} drawings={drawings[index]} runScripts={false} />
        </div>
    ))}
  </div>
  );
});