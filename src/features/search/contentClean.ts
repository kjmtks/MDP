// Turn a raw `.slide.md` deck into searchable body text.
//
// The meta page (block 0) is excluded here — its title/subtitle/tags are indexed
// separately via parseGlobalContext. From the slide blocks we strip the heavy,
// non-textual payloads (base64 images, drawio SVG/strokes, `@image` def bodies,
// HTML-comment directives) so full-text matches are meaningful and the index stays
// small. Speaker-note text (`@note:`) is kept since authors search it.
//
// bodyDisplay is NFKC-normalised but keeps original case (used for snippets);
// bodyText is bodyDisplay.toLowerCase() (used for matching). Keeping them the same
// length means a match offset in bodyText maps 1:1 into bodyDisplay and onto a
// slide via slideOffsets.

import { splitMarkdownToBlocks } from '../slide/parser/slideParser';
import { findImageDefRanges } from '../images/imageRegistry';

const BASE64_RE = /data:[a-zA-Z0-9+./-]+;base64,[A-Za-z0-9+/=]+/g;
const SVG_RE = /<svg[\s\S]*?<\/svg>/gi;
const DRAW_RE = /<!--\s*@draw(?:ing)?:[\s\S]*?-->/gi;
const NOTE_RE = /<!--\s*@note:\s*([\s\S]*?)\s*-->/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const MD_IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g;

export interface CleanedBody {
  bodyDisplay: string;     // NFKC, original case — for snippets
  bodyText: string;        // NFKC + lowercase — for matching (same length as bodyDisplay)
  slideOffsets: number[];  // start offset (in bodyDisplay/bodyText) of each content slide
}

/** Clean a single slide block to plain searchable text. */
const cleanSlide = (text: string): string => {
  let s = text || '';
  // 1. Drop whole `@image … @end` def blocks (bodies hold base64/SVG payloads).
  const ranges = findImageDefRanges(s);
  for (const r of [...ranges].sort((a, b) => b.from - a.from)) {
    s = s.slice(0, r.from) + s.slice(r.to);
  }
  // 2. Strip base64 data URIs and inline drawio SVG (these are NOT inside comments).
  s = s.replace(BASE64_RE, ' ').replace(SVG_RE, ' ');
  // 3. Strip `@draw:` / `@drawing:` stroke directives.
  s = s.replace(DRAW_RE, ' ');
  // 4. Keep `@note:` text (drop the wrapper), then drop all other HTML-comment directives.
  s = s.replace(NOTE_RE, (_m, inner: string) => ` ${inner || ''} `).replace(COMMENT_RE, ' ');
  // 5. Markdown images → keep alt text, drop the URL.
  s = s.replace(MD_IMAGE_RE, '$1');
  // 6. Collapse whitespace.
  return s.replace(/\s+/g, ' ').trim();
};

export const buildBodyText = (raw: string): CleanedBody => {
  const blocks = splitMarkdownToBlocks(raw || '');
  // blocks[0] is the meta page; every block after it is one rendered slide, so the
  // array index here matches the deck's 0-based slide index.
  const slides = blocks.slice(1).map((b) => cleanSlide(b.rawContent));

  const sep = '\n';
  const slideOffsets: number[] = [];
  let acc = '';
  slides.forEach((s, i) => {
    if (i > 0) acc += sep;
    slideOffsets[i] = acc.length;
    acc += s;
  });

  const bodyDisplay = acc.normalize('NFKC');
  return { bodyDisplay, bodyText: bodyDisplay.toLowerCase(), slideOffsets };
};
