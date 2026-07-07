import { marked } from 'marked';
import { slideRenderer } from './markedExtensions';
import { parseCommand } from './slideCommands';
import { splitTags } from './tags';
import { createDefaultContext } from './SlideContext';
import type { SlideContext, MotionSpec } from './SlideContext';
import type { Stroke } from '../../drawing/components/DrawingOverlay';
import { applyModulesToMarkdown, parseArguments } from '../../modules/moduleProcessor';
import { applyBuildsToMarkdown } from './buildProcessor';
import markedKatex from "marked-katex-extension";
import { registerMdpKatex } from "./katexExtensions";

marked.use(markedKatex({
  throwOnError: false,
  output: 'html'
}));
// `\( … \)` / `\[ … \]` with unrestricted neighbours (marked-katex only does `$…$`).
registerMdpKatex();

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
  id?: string;                 // `<!-- @id name -->` — hyperlink anchor target
  range: { startLine: number; endLine: number };
  header?: string;
  footer?: string;
  drawingData?: Stroke[];
  transition?: MotionSpec;
  stepCount: number;
}

// Track whether we're inside an unterminated HTML comment after `line`, given the
// state before it. A multi-line `<!-- @note: … -->` (a speaker script) can contain
// a bare `---` line; without this a `---` inside the comment would be mistaken for a
// slide separator, splitting the comment and swallowing the rest of the deck into an
// unclosed `<!--` (slides render blank). Mirrors the code-fence guard.
const advanceCommentState = (line: string, inComment: boolean): boolean => {
  let i = 0;
  while (i < line.length) {
    if (!inComment) {
      const open = line.indexOf('<!--', i);
      if (open === -1) break;
      inComment = true; i = open + 4;
    } else {
      const close = line.indexOf('-->', i);
      if (close === -1) return true; // comment continues onto the next line
      inComment = false; i = close + 3;
    }
  }
  return inComment;
};

export const splitMarkdownToBlocks = (markdown: string): RawBlock[] => {
  const lines = markdown.split(/\r?\n/);
  const blocks: RawBlock[] = [];
  let currentLines: string[] = [];
  let blockStartLine = 1;
  let inCodeBlock = false;
  let inComment = false;
  lines.forEach((line, index) => {
    const currentLineNumber = index + 1;
    if (line.trim().startsWith('```')) inCodeBlock = !inCodeBlock;
    // `---` only separates when NOT inside a code fence NOR an HTML comment.
    const isSeparator = /^---$/.test(line.trim()) && !inCodeBlock && !inComment;
    if (!inCodeBlock) inComment = advanceCommentState(line, inComment);
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

// Mask code — both FENCED blocks (line-based toggle like splitMarkdownToBlocks) and
// INLINE code spans — so the PRE-markdown directive scans below (header/footer, @note,
// @pageclass, @cover, @transition, global @theme/@aspect, ...) never interpret a
// `<!-- @... -->` written as code to be DISPLAYED. Restored before the module/markdown
// pipeline, so code still renders as code.
const protectFences = (md: string): { masked: string; restore: (s: string) => string } => {
  const store: string[] = [];
  // Unique ASCII placeholder — contains no `<!--`, so the directive scans skip it,
  // and it is restored before marked, so it never reaches the rendered output.
  const stash = (s: string) => { const t = '[[[MDPCODE' + store.length + ']]]'; store.push(s); return t; };
  // 1) fenced code blocks
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith('```')) {
      const buf = [lines[i]]; i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++; }
      if (i < lines.length) { buf.push(lines[i]); i++; } // closing fence (if any)
      out.push(stash(buf.join('\n')));
    } else {
      out.push(lines[i]); i++;
    }
  }
  // 2) inline code spans (single line; matching backtick runs) — so a directive
  //    written as `inline code` to be DISPLAYED is not consumed by a scan above.
  const masked = out.join('\n').replace(/(`+)([^\n]*?)\1/g, (m) => stash(m));
  const restore = (s: string) => s.replace(/\[\[\[MDPCODE(\d+)\]\]\]/g, (_m, n) => store[Number(n)] ?? '');
  return { masked, restore };
};

export const parseGlobalContext = (preambleRaw: string): SlideContext => {
  const context = createDefaultContext();
  // Meta-page @header / @footer apply to ALL slides. Extract the block (or inline
  // shorthand) first and stash the RAW content; renderSlideHTML renders it per
  // slide. Then process the remaining single-line global commands.
  // Mask fenced code blocks so a `<!-- @header -->` / `<!-- @theme -->` etc. written
  // as EXAMPLE code on the meta page stays literal instead of being interpreted.
  const { masked, restore } = protectFences(preambleRaw);
  let pre = masked;
  const h = extractDirectiveBlock(pre, 'header');
  if (h.content !== undefined) context.header = restore(h.content);
  pre = h.rest;
  const f = extractDirectiveBlock(pre, 'footer');
  if (f.content !== undefined) context.footer = restore(f.content);
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
  // Mask fenced code blocks while the pre-markdown directive scans run (so a
  // `<!-- @header -->`/`<!-- @note: … -->`/etc. shown as EXAMPLE code is left
  // literal); the body is un-masked again before the module/markdown pipeline.
  const { masked, restore } = protectFences(block.rawContent);
  let slideMarkdown = masked;
  const extractedNotes: string[] = [];
  let pageClassName = "normal";
  let slideId: string | undefined = undefined;
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
  const noteMarkdown = restore(extractedNotes.join('\n\n'));
  const pageClassRegex = /<!--\s*@pageclass\s*([\s\S]*?)\s*-->/g;
  slideMarkdown = slideMarkdown.replace(pageClassRegex, (_, pageClassContent) => {
    pageClassName = pageClassContent.trim();
    return "";
  });
  // `<!-- @id name -->` — a stable anchor a hyperlink can target (`[x](#name)`).
  const idRegex = /<!--\s*@id\s+([\w-]+)\s*-->/g;
  slideMarkdown = slideMarkdown.replace(idRegex, (_, idVal) => {
    slideId = idVal.trim();
    return "";
  });
  if (/<!--\s*@cover\s*-->/.test(slideMarkdown)) {
    pageClassName = 'cover';
  }
  // Block-form (or inline-shorthand) @header / @footer scoped to THIS slide.
  // Defined content (incl. empty = suppress) overrides the global one.
  const headerEx = extractDirectiveBlock(slideMarkdown, 'header');
  if (headerEx.content !== undefined) localHeader = restore(headerEx.content);
  slideMarkdown = headerEx.rest;
  const footerEx = extractDirectiveBlock(slideMarkdown, 'footer');
  if (footerEx.content !== undefined) localFooter = restore(footerEx.content);
  slideMarkdown = footerEx.rest;

  // Per-slide transition (overrides the global one for the transition INTO this slide).
  let localTransition: MotionSpec | undefined = undefined;
  const transitionMatch = slideMarkdown.match(/<!--\s*@transition\s+([^\s]+)\s*([\s\S]*?)\s*-->/);
  if (transitionMatch) {
    localTransition = { name: transitionMatch[1].trim(), args: parseArguments(transitionMatch[2] || '') };
    slideMarkdown = slideMarkdown.replace(transitionMatch[0], "");
  }

  // Directive scans are done — un-mask the fenced code blocks so the module and
  // markdown pipeline (which do their OWN fence handling) see real fences.
  slideMarkdown = restore(slideMarkdown);

  // `\(…\)` / `\[…\]` are rendered by the marked katex extensions (katexExtensions.ts)
  // — no `$…$` conversion, so any neighbouring character is allowed.
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
    const chromeMd = applyModulesToMarkdown(content);
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
    id: slideId,
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
        if (key === 'tags') {
          context.meta.tags = splitTags(value);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (context.meta as any)[key] = value;
        }
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