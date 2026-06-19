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

export const PrintContainer: React.FC<PrintContainerProps> = React.memo(({ slides, slideSize, slideStyleVariables, drawings }) => (
  <div className="print-container">
    <style>{`
      @media print {
        @page { size: ${slideSize.width}px ${slideSize.height}px; margin: 0; }
        .print-slide-page { width: ${slideSize.width}px !important; height: ${slideSize.height}px !important; }
        .print-slide-content { width: 100% !important; height: 100% !important; }
      }
    `}</style>
    {slides.map((slide, index) => !slide.isHidden && (
        <div key={index} className="print-slide-page">
          <SlideView html={slide.html} pageNumber={slide.pageNumber} isActive={true} className={`print-slide-content ${slide.className || 'normal'}`} style={slideStyleVariables} slideSize={slideSize} header={slide.header} footer={slide.footer} drawings={drawings[index]} runScripts={false} />
        </div>
    ))}
  </div>
));