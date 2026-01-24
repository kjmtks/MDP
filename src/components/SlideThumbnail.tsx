import React from 'react';
import { SlideScaler } from './SlideScaler';
import { SlideView } from './SlideView';
type ContentProps = {
  htmlContent: string;
  slideSize: { width: number; height: number };
  className?: string;
};

const ThumbnailContent = React.memo<ContentProps>(({ htmlContent, slideSize, className }) => {
  return (
    <div className="thumbnail-frame">
      <SlideScaler width={1280} height={720}>
        <SlideView 
          html={htmlContent}
          isActive={true}
          className={className}
          slideSize={slideSize}
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
};

export const SlideThumbnail: React.FC<Props> = ({ htmlContent, slideSize, className, isActive, onClick, pageNumber, isHidden, isCover }) => {
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
      <ThumbnailContent htmlContent={htmlContent} slideSize={slideSize} className={className} />
    </div>
  );
};