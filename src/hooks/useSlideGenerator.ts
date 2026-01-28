import { useState, useEffect, useRef } from 'react';
import { renderSlideHTML } from '../utils/slideParser'; 
import type { RawBlock, SlideData } from '../utils/slideParser';
import type { SlideContext } from '../utils/SlideContext';
import { processSlidesPostHtml } from '../utils/slidePostProcessing';

class SlideCacheManager {
  private prevSlides: SlideData[] = [];
  private prevContextStr: string = "";
  private prevBaseUrl: string = "";
  private prevLastUpdated: number = 0;

  // asyncメソッドに変更
  async process(
    blocks: RawBlock[], 
    globalContext: SlideContext, 
    baseUrl: string, 
    lastUpdated: number
  ): Promise<SlideData[]> {
    
    const currentContextStr = JSON.stringify(globalContext);
    const isContextChanged = this.prevContextStr !== currentContextStr;
    const isBaseUrlChanged = this.prevBaseUrl !== baseUrl;
    const isLastUpdatedChanged = this.prevLastUpdated !== lastUpdated;

    this.prevContextStr = currentContextStr;
    this.prevBaseUrl = baseUrl;
    this.prevLastUpdated = lastUpdated;

    const contentBlocks = blocks.slice(1);

    // Promise.all で並列にスライド生成・変換を行う
    const newSlides = await Promise.all(contentBlocks.map(async (block, index) => {
      const cachedSlide = this.prevSlides[index];

      // キャッシュチェック
      if (
        !isContextChanged &&
        !isBaseUrlChanged &&
        !isLastUpdatedChanged &&
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

      // 1. 基本HTML生成 (同期)
      const baseData = renderSlideHTML(block, globalContext, index + 1, baseUrl, lastUpdated);
      
      // 2. 後処理 (非同期): Mermaid/PlantUMLのSVG化
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
  lastUpdated: number
): SlideData[] => {
  const [slides, setSlides] = useState<SlideData[]>([]);
  const managerRef = useRef<SlideCacheManager>(new SlideCacheManager());

  useEffect(() => {
    let isMounted = true;

    const generate = async () => {
      try {
        const newSlides = await managerRef.current.process(blocks, globalContext, baseUrl, lastUpdated);
        if (isMounted) {
          setSlides(newSlides);
        }
      } catch (e) {
        console.error("Slide generation error:", e);
      }
    };

    generate();

    return () => { isMounted = false; };
  }, [blocks, globalContext, baseUrl, lastUpdated]);

  return slides;
};