import React from 'react';
import { SlideScaler } from './SlideScaler';
import { SlideView } from './SlideView';
import type { Stroke } from './DrawingOverlay';

type ContentProps = {
  htmlContent: string;
  slideSize: { width: number; height: number };
  className?: string;
  header?: string;
  footer?: string;
  drawings?: Stroke[];
};

const ThumbnailContent = React.memo<ContentProps>(({ htmlContent, slideSize, className, header, footer, drawings }) => {
  return (
    <div
      className="thumbnail-frame"
      style={{ aspectRatio: `${slideSize.width} / ${slideSize.height}` }}
    >
      <SlideScaler width={slideSize.width} height={slideSize.height}>
        <SlideView 
          html={htmlContent}
          isActive={true}
          className={className}
          slideSize={slideSize}
          header={header}
          footer={footer}
          drawings={drawings}
          isEnabledPointerEvents={false}
        />
      </SlideScaler>
    </div>
  );
});

type Props = {
  htmlContent: string;
  slideSize: { width: number; height: number };
  className?: string;
  isActive: boolean;
  onClick: () => void;
  pageNumber?: number | null;
  isHidden: boolean;
  isCover: boolean;
  header?: string;
  footer?: string;
  drawings?: Stroke[];
};

export const SlideThumbnail: React.FC<Props> = ({ htmlContent, slideSize, className, isActive, onClick, pageNumber, isHidden, isCover, header, footer, drawings }) => {
  return (
    <div 
      className={`thumbnail-wrapper ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      {pageNumber && (
        <div className="thumbnail-number">{pageNumber}</div>
      )}
      {isHidden && (
        <div className="thumbnail-hidden"></div>
      )}
      {isCover && (
        <div className="thumbnail-cover"></div>
      )}
      <ThumbnailContent htmlContent={htmlContent} slideSize={slideSize} className={className} header={header} footer={footer} drawings={drawings} />
    </div>
  );
};