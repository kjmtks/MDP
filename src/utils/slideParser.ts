import { marked } from 'marked';
import { slideRenderer } from './markedExtensions';
import { parseCommand } from './slideCommands';
import { createDefaultContext } from './SlideContext';
import type { SlideContext } from './SlideContext';
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
  applyGlobalCommands(preambleRaw, context);
  return context;
};

export const renderSlideHTML = (block: RawBlock, globalContext: SlideContext, pageIndex: number, baseUrl: string, lastUpdated: number): SlideData => {
  let slideMarkdown = block.rawContent;
  const extractedNotes: string[] = [];
  let pageClassName = "normal";
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
  slideMarkdown = slideMarkdown
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$') 
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$');
  const localContext: SlideContext = {
    ...globalContext,
    numberOfPages: pageIndex,
    caption: undefined,
    columnsRatio: undefined,
    columnIndex: undefined,
    addclasses: {},
    addstyles: {},
  };
  const renderer = new marked.Renderer();
  const customRenderer = slideRenderer(localContext, baseUrl, lastUpdated);
  Object.assign(renderer, customRenderer);
  const slideHtml = marked.parse(slideMarkdown, {
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
  return {
    html: slideHtml,
    noteHtml: noteHtml,
    raw: block.rawContent,
    range: { startLine: block.startLine, endLine: block.endLine },
    className: pageClassName
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
        context.themeCss = command.params as string;
      }
      if (command.type === 'META') {
        const { key, value } = command.params;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (context.meta as any)[key] = value;
      }
    }
  }
};