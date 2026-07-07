import { useState, useEffect, useRef } from 'react';
import { renderSlideHTML } from '../parser/slideParser';
import type { RawBlock, SlideData } from '../parser/slideParser';
import type { SlideContext } from '../parser/SlideContext';
import { processSlidesPostHtml } from '../parser/slidePostProcessing';

class SlideCacheManager {
  private prevSlides: SlideData[] = [];
  private prevContextStr: string = "";
  private prevBaseUrl: string = "";
  private prevLastUpdated: number = 0;
  private prevModuleEpoch: number = 0;

  async process(
    blocks: RawBlock[],
    globalContext: SlideContext,
    baseUrl: string,
    lastUpdated: number,
    moduleEpoch: number = 0
  ): Promise<SlideData[]> {

    const currentContextStr = JSON.stringify(globalContext);
    const isContextChanged = this.prevContextStr !== currentContextStr;
    const isBaseUrlChanged = this.prevBaseUrl !== baseUrl;
    const isLastUpdatedChanged = this.prevLastUpdated !== lastUpdated;
    // When modules/effects (re)load, their markdown transforms change, so any
    // slide parsed before they were registered must be re-rendered. (This blanket
    // invalidation is intentionally kept: slide chrome — @header/@footer — is
    // module-expanded AFTER the split, so a per-slide raw comparison would miss a
    // late module registration there. The cost is acceptable now that EditorPage
    // no longer bumps the epoch when registries/content are unchanged.)
    const isModuleEpochChanged = this.prevModuleEpoch !== moduleEpoch;

    this.prevContextStr = currentContextStr;
    this.prevBaseUrl = baseUrl;
    this.prevLastUpdated = lastUpdated;
    this.prevModuleEpoch = moduleEpoch;

    const contentBlocks = blocks.slice(1);

    const newSlides = await Promise.all(contentBlocks.map(async (block, index) => {
      const cachedSlide = this.prevSlides[index];

      if (
        !isContextChanged &&
        !isBaseUrlChanged &&
        !isLastUpdatedChanged &&
        !isModuleEpochChanged &&
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

      const baseData = renderSlideHTML(block, globalContext, index + 1, baseUrl, lastUpdated);

      const processedHtml = await processSlidesPostHtml(baseData.html);

      return { ...baseData, html: processedHtml };
    }));

    this.prevSlides = newSlides;
    return newSlides;
  }
}

export const useSlideGenerator = (
  blocks: RawBlock[],
  globalContext: SlideContext,
  baseUrl: string,
  lastUpdated: number,
  moduleEpoch: number = 0
): SlideData[] => {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const managerRef = useRef<SlideCacheManager>(new SlideCacheManager());

  useEffect(() => {
    let isMounted = true;

    const generate = async () => {
      try {
        const newSlides = await managerRef.current.process(blocks, globalContext, baseUrl, lastUpdated, moduleEpoch);
        if (isMounted) {
          setSlides(newSlides);
        }
      } catch (e) {
        console.error("Slide generation error:", e);
      }
    };

    generate();

    return () => { isMounted = false; };
  }, [blocks, globalContext, baseUrl, lastUpdated, moduleEpoch]);

  return slides;
};