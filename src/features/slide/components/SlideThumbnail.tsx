import React from 'react';
import { SlideScaler } from './SlideScaler';
import { SlideView } from './SlideView';
import type { Stroke } from '../../drawing/components/DrawingOverlay';

type ContentProps = {
  htmlContent: string;
  slideSize: { width: number; height: number };
  className?: string;
  header?: string;
  footer?: string;
  drawings?: Stroke[];
  // The deck's folder: SlideView resolves relative image/SVG paths against it,
  // and inlines workspace `.svg` (drawio) files from the resulting path. Without
  // it a `./figs/x.drawio.svg` is looked up at the workspace root and stays blank.
  basePath?: string;
  raw?: string;
};

const ThumbnailContent = React.memo<ContentProps>(({ htmlContent, slideSize, className, header, footer, drawings, basePath, raw }) => {
  return (
    <div
      className="thumbnail-frame"
      style={{ aspectRatio: `${slideSize.width} / ${slideSize.height}` }}
    >
      <SlideScaler width={slideSize.width} height={slideSize.height}>
        <SlideView
          html={htmlContent}
          raw={raw}
          basePath={basePath}
          isActive={true}
          className={className}
          slideSize={slideSize}
          header={header}
          footer={footer}
          drawings={drawings}
          isEnabledPointerEvents={false}
          runScripts={false}
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
  basePath?: string;
  raw?: string;
};

export const SlideThumbnail: React.FC<Props> = ({ htmlContent, slideSize, className, isActive, onClick, pageNumber, isHidden, isCover, header, footer, drawings, basePath, raw }) => {
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
      <ThumbnailContent htmlContent={htmlContent} slideSize={slideSize} className={className} header={header} footer={footer} drawings={drawings} basePath={basePath} raw={raw} />
    </div>
  );
};