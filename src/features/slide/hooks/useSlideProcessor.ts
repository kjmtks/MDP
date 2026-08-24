import { FILES_PREFIX, WEB_BASE } from '../../../api/base';
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
    const prefix = isElectron() ? 'mdp-file://' : FILES_PREFIX;
    if (!currentFileName) return prefix;
    const lastSlashIndex = currentFileName.lastIndexOf('/');
    return lastSlashIndex === -1 ? prefix : `${prefix}${currentFileName.substring(0, lastSlashIndex)}/`;
  }, [currentFileName]);

  const processedMarkdown = useMemo(() => debouncedMarkdown, [debouncedMarkdown]);

  // 'markdown' = slide deck → split on `---`. 'doc' = a plain markdown file →
  // ONE block (so `---` stays an <hr>, not a slide break) rendered through the SAME
  // pipeline (modules, KaTeX, mermaid, plantuml, charts, image refs) as slides.
  const blocks = useMemo(() => {
    try {
      if (currentFileType === 'markdown') return splitMarkdownToBlocks(processedMarkdown);
      // The generator treats block[0] as the meta/preamble page and renders content
      // from block[1] on. A document has no preamble, so prepend an empty one and put
      // the whole file in block[1] (one HTML output, `---` kept as <hr>).
      if (currentFileType === 'doc') return [
        { id: 'doc-pre', rawContent: '', startLine: 1, endLine: 1 },
        { id: 'doc', rawContent: processedMarkdown, startLine: 1, endLine: processedMarkdown.split('\n').length },
      ];
      return [];
    } catch (e) {
      // A malformed document must never crash the render — fall back to a single
      // content block so the preview still shows the text (and can be fixed).
      console.error('[MDP] slide split failed:', e);
      return [
        { id: 'err-pre', rawContent: '', startLine: 1, endLine: 1 },
        { id: 'err', rawContent: processedMarkdown, startLine: 1, endLine: 1 },
      ];
    }
  }, [processedMarkdown, currentFileType]);

  const globalContext = useMemo(() => {
    try { return parseGlobalContext(blocks.length > 0 ? blocks[0].rawContent : ""); }
    catch (e) { console.error('[MDP] meta parse failed:', e); return parseGlobalContext(""); }
  }, [blocks]);

  const rawSlides = useSlideGenerator(blocks, globalContext, baseUrl, lastUpdated, moduleEpoch);

  // Rendered HTML for a plain markdown document (empty unless type === 'doc').
  const docHtml = useMemo(() => (currentFileType === 'doc' ? (rawSlides[0]?.html || '') : ''), [currentFileType, rawSlides]);

  const slides = useMemo(() => {
    // A document is not a slide deck — keep `slides` empty so nothing treats it as
    // presentable (no slideshow / thumbnails / export).
    if (currentFileType === 'doc') return [];
    const offset = blocks.length - rawSlides.length;
    let logicalPageCount = 0;
    const numbered = rawSlides.map((slide, index) => {
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

    // Resolve page REFERENCES: `[](#intro)` prints the number shown bottom-right
    // on the slide tagged `<!-- @id intro -->`. This can only happen here — a page
    // number depends on how many earlier slides are hidden or covers, so it is a
    // whole-deck fact the per-slide markdown pass cannot know. Targets that cannot
    // be resolved (another deck, a hidden/cover slide, an unknown id) keep their
    // '?' placeholder rather than silently rendering a wrong number.
    if (!numbered.some((s) => s.html.includes('mdp-pageref'))) return numbered;
    const pageOfId = new Map<string, number>();
    for (const s of numbered) if (s.id && s.pageNumber) pageOfId.set(s.id, s.pageNumber);
    const REF_RE = /(<a\b[^>]*\bmdp-pageref\b[^>]*data-mdp-target="([^"]*)"[^>]*>)([^<]*)(<\/a>)/g;
    return numbered.map((slide) => ({
      ...slide,
      html: slide.html.replace(REF_RE, (whole, open, target, _inner, close) => {
        const raw = String(target || '').replace(/&amp;/g, '&');
        if (!raw.startsWith('#')) return whole;   // cross-deck: numbering unknown here
        const anchor = raw.slice(1);
        const n = /^\d+$/.test(anchor) ? Number(anchor) : pageOfId.get(anchor);
        return n ? open + n + close : whole;
      }),
    }));
  }, [rawSlides, blocks, currentFileType]);

  // The canvas is BASE_HEIGHT tall by default — @aspect only sets its shape.
  // @resolution asks for more CSS pixels of the SAME shape.
  //
  // It matters on dense pages: an A0 poster at the default 509x720 has to run its
  // body type near 6px, and nothing can rasterise thinner than one pixel, so a
  // hairline (the KaTeX fraction rule, a table border) prints at ~1.6mm — four
  // times what its 0.04em asks for. More pixels shrink one pixel relative to the
  // type; the design itself is untouched, because everything sized in the slide
  // follows `--slide-scale` (themes via their own variables, modules and the base
  // stylesheet via `--mdp-px` / `--mdp-u`).
  const slideSize = useMemo(() => {
    const [aspectW, aspectH] = globalContext.aspectRatio;
    const ratio = (aspectW || 16) / (aspectH || 9);
    const res = globalContext.resolution;
    const height = res?.height && res.height > 0 ? res.height : BASE_HEIGHT;
    const width = res?.width && res.width > 0 ? res.width : height * ratio;
    return { width, height };
  }, [globalContext.aspectRatio, globalContext.resolution]);

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
        const prefix = isElectron() ? 'mdp-file://' : FILES_PREFIX;
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
          // Empty-authority form for a custom theme under `.mdp/themes/…` — otherwise
          // the leading `.mdp` is parsed as an invalid hostname and the CSS 404s.
          targetCssUrl = theme.isCustom ? `mdp-file:///${theme.path}` : `app-asset://${theme.path}`;
        } else {
          targetCssUrl = theme.isCustom ? `${FILES_PREFIX}${theme.path}` : `${WEB_BASE}/${theme.path}`;
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