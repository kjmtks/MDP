import { useMemo, useEffect } from 'react';
import type { FileType } from '../../../types';
import { BASE_HEIGHT } from '../../../constants';
import { splitMarkdownToBlocks, parseGlobalContext } from '../parser/slideParser';
import { useSlideGenerator } from './useSlideGenerator';
import { isElectron } from '../../../api/apiClient';
import type { ThemeOption } from '../../../types';

export const useSlideProcessor = (
  currentFileName: string | null,
  currentFileType: FileType,
  debouncedMarkdown: string,
  lastUpdated: number,
  themes: ThemeOption[],
  // Bumped when modules/effects finish (re)loading, to force a slide re-parse so
  // slides rendered before registration get their module/build transforms.
  moduleEpoch: number = 0,
) => {
  const baseUrl = useMemo(() => {
    const prefix = isElectron() ? 'mdp-file://' : '/files/';
    if (!currentFileName) return prefix;
    const lastSlashIndex = currentFileName.lastIndexOf('/');
    return lastSlashIndex === -1 ? prefix : `${prefix}${currentFileName.substring(0, lastSlashIndex)}/`;
  }, [currentFileName]);

  const processedMarkdown = useMemo(() => debouncedMarkdown, [debouncedMarkdown]);

  // 'markdown' = slide deck → split on `---`. 'doc' = a plain markdown file →
  // ONE block (so `---` stays an <hr>, not a slide break) rendered through the SAME
  // pipeline (modules, KaTeX, mermaid, plantuml, charts, image refs) as slides.
  const blocks = useMemo(() => {
    if (currentFileType === 'markdown') return splitMarkdownToBlocks(processedMarkdown);
    // The generator treats block[0] as the meta/preamble page and renders content
    // from block[1] on. A document has no preamble, so prepend an empty one and put
    // the whole file in block[1] (one HTML output, `---` kept as <hr>).
    if (currentFileType === 'doc') return [
      { id: 'doc-pre', rawContent: '', startLine: 1, endLine: 1 },
      { id: 'doc', rawContent: processedMarkdown, startLine: 1, endLine: processedMarkdown.split('\n').length },
    ];
    return [];
  }, [processedMarkdown, currentFileType]);

  const globalContext = useMemo(() => parseGlobalContext(blocks.length > 0 ? blocks[0].rawContent : ""), [blocks]);

  const rawSlides = useSlideGenerator(blocks, globalContext, baseUrl, lastUpdated, moduleEpoch);

  // Rendered HTML for a plain markdown document (empty unless type === 'doc').
  const docHtml = useMemo(() => (currentFileType === 'doc' ? (rawSlides[0]?.html || '') : ''), [currentFileType, rawSlides]);

  const slides = useMemo(() => {
    // A document is not a slide deck — keep `slides` empty so nothing treats it as
    // presentable (no slideshow / thumbnails / export).
    if (currentFileType === 'doc') return [];
    const offset = blocks.length - rawSlides.length;
    let logicalPageCount = 0;
    return rawSlides.map((slide, index) => {
      const rawContent = blocks[index + offset]?.rawContent || "";
      const isHidden = /<!--\s+@hide\s+-->/.test(rawContent);
      const isCover = /<!--\s+@cover\s+-->/i.test(rawContent);
      let pageNumber = null;
      if (!isHidden && !isCover) { logicalPageCount++; pageNumber = logicalPageCount; }

      let html = slide.html;
      html = html.replace(/src="(?:\/files\/|mdp-file:\/\/)?(blob:https?:\/\/[^"?]+)(?:\?[^"]*)?"/g, 'src="$1"');
      html = html.replace(/src="(?:\/files\/|mdp-file:\/\/)([^"]+)"([^>]*)alt="@drawio"/g, 'src="$1"$2alt="@drawio"');
      html = html.replace(/alt="@drawio"([^>]*)src="(?:\/files\/|mdp-file:\/\/)([^"]+)"/g, 'alt="@drawio"$1src="$2"');

      return { ...slide, html, isHidden, isCover, pageNumber };
    });
  }, [rawSlides, blocks, currentFileType]);

  const slideSize = useMemo(() => {
    const [aspectW, aspectH] = globalContext.aspectRatio;
    return { width: (BASE_HEIGHT * (aspectW || 16)) / (aspectH || 9), height: BASE_HEIGHT };
  }, [globalContext.aspectRatio]);

  const slideStyleVariables = useMemo(() => ({
    '--slide-width': `${slideSize.width}px`,
    '--slide-height': `${slideSize.height}px`,
    '--slide-aspect-ratio': `${slideSize.width}/${slideSize.height}`
  } as React.CSSProperties), [slideSize]);

  const themeCssUrl = useMemo(() => {
    let targetCssUrl = '';

    if (globalContext.cssPath) {
      let cssPath = globalContext.cssPath;
      if (!cssPath.startsWith('http') && !cssPath.startsWith('data:')) {
        const prefix = isElectron() ? 'mdp-file://' : '/files/';
        if (cssPath.startsWith('/')) {
          cssPath = `${prefix}${cssPath.substring(1)}`;
        } else {
          cssPath = `${baseUrl}${cssPath}`;
        }
      }
      targetCssUrl = cssPath;
    }
    else if (globalContext.themeName) {
      const theme = themes.find(t => t.name === globalContext.themeName || t.fileName === globalContext.themeName);
      if (theme) {
        if (isElectron()) {
          targetCssUrl = theme.isCustom ? `mdp-file://${theme.path}` : `app-asset://${theme.path}`;
        } else {
          targetCssUrl = theme.isCustom ? `/files/${theme.path}` : `/${theme.path}`;
        }
      }
    }
    return targetCssUrl;
  }, [globalContext.cssPath, globalContext.themeName, baseUrl, themes]);

  useEffect(() => {
    const linkId = 'mdp-theme-style';
    let link = document.getElementById(linkId) as HTMLLinkElement;
    if (themeCssUrl) {
      if (!link) {
        link = document.createElement('link');
        link.id = linkId;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      const href = `${themeCssUrl}${themeCssUrl.includes('?') ? '&' : '?'}t=${lastUpdated}`;
      if (link.getAttribute('href') !== href) link.href = href;
    } else if (link) {
      document.head.removeChild(link);
    }
  }, [themeCssUrl, lastUpdated]);

  return { baseUrl, globalContext, slides, docHtml, slideSize, slideStyleVariables, themeCssUrl };
};