import { useState, useMemo } from 'react';
import { renderSlideHTML } from '../utils/slideParser';
import type { RawBlock, SlideData } from '../utils/slideParser';
import type { SlideContext } from '../utils/SlideContext';

class SlideCacheManager {
  private prevSlides: SlideData[] = [];
  private prevContextStr: string = "";
  private prevBaseUrl: string = "";
  process(blocks: RawBlock[], globalContext: SlideContext, baseUrl: string, lastUpdated: number): SlideData[] {
    const currentContextStr = JSON.stringify(globalContext);
    const isContextChanged = this.prevContextStr !== currentContextStr;
    const isBaseUrlChanged = this.prevBaseUrl !== baseUrl;
    this.prevContextStr = currentContextStr;
    this.prevBaseUrl = baseUrl;
    const contentBlocks = blocks.slice(1);
    const newSlides: SlideData[] = contentBlocks.map((block, index) => {
      const cachedSlide = this.prevSlides[index];
      if (
        !isContextChanged &&
        !isBaseUrlChanged && 
        cachedSlide &&
        cachedSlide.raw === block.rawContent
      ) {
        if (cachedSlide.range.startLine !== block.startLine) {
           return {
             ...cachedSlide,
             range: { startLine: block.startLine, endLine: block.endLine }
           };
        }
        return cachedSlide;
      }
      return renderSlideHTML(block, globalContext, index + 1, baseUrl, lastUpdated);
    });

    this.prevSlides = newSlides;
    return newSlides;
  }
}

export const useSlideGenerator = (
  blocks: RawBlock[],
  globalContext: SlideContext,
  baseUrl: string,
  lastUpdated: number
): SlideData[] => {
  const [manager] = useState(() => new SlideCacheManager());
  return useMemo(() => {
    return manager.process(blocks, globalContext, baseUrl, lastUpdated);
  }, [manager, blocks, globalContext, baseUrl, lastUpdated]);
};