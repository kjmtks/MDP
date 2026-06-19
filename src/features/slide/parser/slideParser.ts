import { marked } from 'marked';
import { slideRenderer } from './markedExtensions';
import { parseCommand } from './slideCommands';
import { createDefaultContext } from './SlideContext';
import type { SlideContext, MotionSpec } from './SlideContext';
import type { Stroke } from '../../drawing/components/DrawingOverlay';
import { applyModulesToMarkdown, parseArguments } from '../../modules/moduleProcessor';
import { applyBuildsToMarkdown } from './buildProcessor';
import markedKatex from "marked-katex-extension";

marked.use(markedKatex({
  throwOnError: false,
  output: 'html'
}));

export interface RawBlock {
  id: string;
  rawContent: string;
  startLine: number;
  endLine: number;
}

export interface SlideData {
  html: string;
  noteHtml: string;
  raw: string;
  className: string;
  range: { startLine: number; endLine: number };
  header?: string;
  footer?: string;
  drawingData?: Stroke[];
  transition?: MotionSpec;
  stepCount: number;
}

export const splitMarkdownToBlocks = (markdown: string): RawBlock[] => {
  const lines = markdown.split(/\r?\n/);
  const blocks: RawBlock[] = [];
  let currentLines: string[] = [];
  let blockStartLine = 1;
  let inCodeBlock = false;
  lines.forEach((line, index) => {
    const currentLineNumber = index + 1;
    if (line.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
    const isSeparator = /^---$/.test(line.trim()) && !inCodeBlock;
    if (isSeparator) {
      blocks.push({
        id: `block-${blocks.length}`,
        rawContent: currentLines.join('\n'),
        startLine: blockStartLine,
        endLine: currentLineNumber - 1
      });
      currentLines = [];
      blockStartLine = currentLineNumber + 1;
    } else {
      currentLines.push(line);
    }
  });
  blocks.push({
    id: `block-${blocks.length}`,
    rawContent: currentLines.join('\n'),
    startLine: blockStartLine,
    endLine: lines.length
  });

  return blocks;
};

export const parseGlobalContext = (preambleRaw: string): SlideContext => {
  const context = createDefaultContext();
  // Meta-page @header / @footer apply to ALL slides. Extract the block (or inline
  // shorthand) first and stash the RAW content; renderSlideHTML renders it per
  // slide. Then process the remaining single-line global commands.
  let pre = preambleRaw;
  const h = extractDirectiveBlock(pre, 'header');
  if (h.content !== undefined) context.header = h.content;
  pre = h.rest;
  const f = extractDirectiveBlock(pre, 'footer');
  if (f.content !== undefined) context.footer = f.content;
  pre = f.rest;
  applyGlobalCommands(pre, context);
  return context;
};

// Extract a `@header` / `@footer` BLOCK region (`<!-- @header --> … <!-- @end -->`).
// Returns the raw inner content (markdown + possibly already-expanded module HTML)
// and `md` with the region removed. EMPTY content (`<!-- @header --><!-- @end -->`)
// returns content === '' — meaningful: it SUPPRESSES an inherited global
// header/footer on that slide. A bare opener with no `@end` is dropped (content
// undefined → inherit). There is no inline `<!-- @header CONTENT -->` shorthand.
export const extractDirectiveBlock = (md: string, name: 'header' | 'footer'): { content?: string; rest: string } => {
  const block = new RegExp(`<!--\\s*@${name}\\s*-->([\\s\\S]*?)<!--\\s*@end\\s*-->`, 'i');
  const bm = md.match(block);
  if (bm) return { content: bm[1].trim(), rest: md.replace(bm[0], '') };
  // A bare opener (no `@end`, no content after `@header`) is just dropped.
  const bare = new RegExp(`<!--\\s*@${name}\\s*-->`, 'i');
  const barem = md.match(bare);
  if (barem) return { content: undefined, rest: md.replace(barem[0], '') };
  return { content: undefined, rest: md };
};

export const renderSlideHTML = (block: RawBlock, globalContext: SlideContext, pageIndex: number, baseUrl: string, lastUpdated: number): SlideData => {
  let slideMarkdown = block.rawContent;
  const extractedNotes: string[] = [];
  let pageClassName = "normal";
  let localHeader: string | undefined = undefined;
  let localFooter: string | undefined = undefined;
  let drawingData: Stroke[] = [];

  const drawRegex = /<!--\s*@draw:\s*([\s\S]*?)\s*-->/;
  const drawMatch = slideMarkdown.match(drawRegex);
  if (drawMatch) {
    try {
      const base64 = drawMatch[1].trim();
      if (base64) {
        const json = decodeURIComponent(escape(atob(base64)));
        drawingData = JSON.parse(json);
      }
    } catch (e) {
      console.error("Failed to parse drawing data", e);
    }
    slideMarkdown = slideMarkdown.replace(drawMatch[0], "");
  }

  const noteRegex = /<!--\s*@note:\s*([\s\S]*?)\s*-->/g;
  slideMarkdown = slideMarkdown.replace(noteRegex, (_, noteContent) => {
    extractedNotes.push(noteContent.trim());
    return "";
  });
  const noteMarkdown = extractedNotes.join('\n\n');
  const pageClassRegex = /<!--\s*@pageclass\s*([\s\S]*?)\s*-->/g;
  slideMarkdown = slideMarkdown.replace(pageClassRegex, (_, pageClassContent) => {
    pageClassName = pageClassContent.trim();
    return "";
  });
  if (/<!--\s*@cover\s*-->/.test(slideMarkdown)) {
    pageClassName = 'cover';
  }
  // Block-form (or inline-shorthand) @header / @footer scoped to THIS slide.
  // Defined content (incl. empty = suppress) overrides the global one.
  const headerEx = extractDirectiveBlock(slideMarkdown, 'header');
  if (headerEx.content !== undefined) localHeader = headerEx.content;
  slideMarkdown = headerEx.rest;
  const footerEx = extractDirectiveBlock(slideMarkdown, 'footer');
  if (footerEx.content !== undefined) localFooter = footerEx.content;
  slideMarkdown = footerEx.rest;

  // Per-slide transition (overrides the global one for the transition INTO this slide).
  let localTransition: MotionSpec | undefined = undefined;
  const transitionMatch = slideMarkdown.match(/<!--\s*@transition\s+([^\s]+)\s*([\s\S]*?)\s*-->/);
  if (transitionMatch) {
    localTransition = { name: transitionMatch[1].trim(), args: parseArguments(transitionMatch[2] || '') };
    slideMarkdown = slideMarkdown.replace(transitionMatch[0], "");
  }

  slideMarkdown = slideMarkdown
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
  const localContext: SlideContext = {
    ...globalContext,
    numberOfPages: pageIndex,
    caption: undefined,
    columnsRatio: undefined,
    columnIndex: undefined,
  };
  const renderer = new marked.Renderer();
  const customRenderer = slideRenderer(localContext, baseUrl, lastUpdated);
  Object.assign(renderer, customRenderer);
  // Modules first (they consume their own @end), THEN in-slide builds — so a
  // @build wrapping a block module isn't terminated by that module's @end.
  const moduleProcessed = applyModulesToMarkdown(slideMarkdown);
  const built = applyBuildsToMarkdown(moduleProcessed, globalContext.build?.args || {});
  const processedMarkdown = built.markdown;
  const slideHtml = marked.parse(processedMarkdown, {
    renderer: renderer,
    breaks: true,
    gfm: true,
    async: false
  }) as string;
  const noteHtml = noteMarkdown ? marked.parse(noteMarkdown, {
    breaks: true,
    gfm: true,
    async: false
  }) as string : "";

  // Header/footer are now full block regions: run modules then markdown so a
  // module (e.g. @stamp, @qr) placed inside renders. Idempotent if the document
  // was already module-expanded upstream (directives are consumed on first pass).
  const renderChrome = (content: string): string => {
    if (!content) return '';
    const chromeMd = applyModulesToMarkdown(content)
      .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
      .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
    return marked.parse(chromeMd, { renderer, breaks: true, gfm: true, async: false }) as string;
  };
  const finalHeaderRaw = localHeader !== undefined ? localHeader : globalContext.header;
  const finalFooterRaw = localFooter !== undefined ? localFooter : globalContext.footer;
  const finalHeader = finalHeaderRaw ? renderChrome(finalHeaderRaw) : undefined;
  const finalFooter = finalFooterRaw ? renderChrome(finalFooterRaw) : undefined;

  return {
    html: slideHtml,
    noteHtml: noteHtml,
    raw: block.rawContent,
    range: { startLine: block.startLine, endLine: block.endLine },
    className: pageClassName,
    header: finalHeader,
    footer: finalFooter,
    drawingData,
    transition: localTransition,
    stepCount: built.stepCount,
  };
};

const applyGlobalCommands = (text: string, context: SlideContext) => {
  const matches = text.matchAll(/<!--\s*([\s\S]*?)\s*-->/g);
  for (const match of matches) {
    const content = match[1];
    const command = parseCommand(content);
    if (command && command.scope === 'GLOBAL') {
      if (command.type === 'ASPECT') {
        context.aspectRatio = command.params as [number, number];
      }
      if (command.type === 'THEME') {
        context.themeName = command.params as string;
      }
      if (command.type === 'CSS') {
        context.cssPath = command.params as string;
      }
      if (command.type === 'META') {
        const { key, value } = command.params;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (context.meta as any)[key] = value;
      }
      // HEADER / FOOTER are handled by extractDirectiveBlock in parseGlobalContext
      // (block form + inline shorthand), so they are intentionally not applied here.
      else if (command.type === 'TRANSITION') {
        context.transition = { name: command.params.name, args: parseArguments(command.params.argsStr || '') };
      }
      else if (command.type === 'BUILD') {
        context.build = { name: '', args: parseArguments(command.params.argsStr || '') };
      }
    }
  }
};