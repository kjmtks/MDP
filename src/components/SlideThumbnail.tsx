import React from 'react';
import { SlideScaler } from './SlideScaler';
import { SlideView } from './SlideView';
type ContentProps = {
  htmlContent: string;
  slideSize: { width: number; height: number };
  className?: string;
  header?: string;
  footer?: string;
};

const ThumbnailContent = React.memo<ContentProps>(({ htmlContent, slideSize, className, header, footer }) => {
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
};

export const SlideThumbnail: React.FC<Props> = ({ htmlContent, slideSize, className, isActive, onClick, pageNumber, isHidden, isCover, header, footer }) => {
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
      <ThumbnailContent htmlContent={htmlContent} slideSize={slideSize} className={className} header={header} footer={footer} />
    </div>
  );
};