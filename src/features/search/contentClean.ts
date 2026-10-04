// Turn a raw `.slide.md` deck into per-slide searchable text.
//
// What is searched is what the AUDIENCE sees: the meta page's title/subtitle
// (indexed separately via parseGlobalContext) and each slide's visible text. Not
// searched: speaker notes (`@note:`), the read-aloud script (`@script:`) and every
// other HTML-comment directive, raw HTML tags, and the heavy non-textual payloads
// (base64 images, inline drawio SVG, `@image` def bodies). A `@caption` is shown on
// the slide, so its text is kept.
//
// Each slide keeps its first heading apart (the label of a search hit) and the rest
// as text. `heading`/`text` are NFKC-normalised with the original case (display and
// snippets); the `…Norm` twins are the same lowercased (matching) — equal lengths, so
// a match offset maps 1:1 onto the displayed string for highlighting.

import { findImageDefRanges } from '../images/imageRegistry';

export interface SlideText {
  index: number;        // 0-based slide index (the blocks after the meta page)
  heading: string;      // its first heading ('' = none)
  headingNorm: string;
  text: string;         // the rest of its visible text
  textNorm: string;
  hidden: boolean;      // `<!-- @hide -->`: in the deck, but not shown
}

const BASE64_RE = /data:[a-zA-Z0-9+./-]+;base64,[A-Za-z0-9+/=]+/g;
const SVG_RE = /<svg[\s\S]*?<\/svg>/gi;
const CAPTION_RE = /<!--\s*@caption\s+([\s\S]*?)\s*-->/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const HIDE_RE = /<!--\s*@hide\s*-->/i;
const MD_IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g;
const MD_LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m;

/** A slide's visible text, as plain lines (markdown markers dropped). */
const visibleText = (raw: string): string => {
  let s = raw || '';
  // `@image … @end` def blocks hold base64/SVG payloads, not text.
  const ranges = findImageDefRanges(s);
  for (const r of [...ranges].sort((a, b) => b.from - a.from)) s = s.slice(0, r.from) + s.slice(r.to);
  return s
    .replace(BASE64_RE, ' ')
    .replace(SVG_RE, ' ')
    .replace(CAPTION_RE, (_m, caption: string) => `\n${caption || ''}\n`)
    .replace(COMMENT_RE, ' ')                     // notes, scripts, every other directive
    .replace(MD_IMAGE_RE, '$1')                   // an image → its alt text
    .replace(MD_LINK_RE, '$1')                    // a link → its text
    .replace(HTML_TAG_RE, ' ')
    .replace(/^[ \t]*```.*$/gm, ' ')              // code fences (the code itself is shown)
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '') // list markers
    .replace(/^[ \t]*>[ \t]?/gm, '')              // quote markers
    .replace(/^[ \t|:-]*-{3,}[ \t|:-]*$/gm, ' ')   // table rule rows
    .replace(/\*\*|__|~~|`/g, '')                 // emphasis and code ticks
    .replace(/\|/g, ' ');                         // table cells
};

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** One slide's searchable text (pure). `index`: its 0-based place in the deck. */
export const slideText = (raw: string, index: number): SlideText => {
  const visible = visibleText(raw);
  const m = visible.match(HEADING_RE);
  const heading = squash(m ? m[1] : '').normalize('NFKC');
  const rest = m ? visible.slice(0, m.index) + visible.slice((m.index ?? 0) + m[0].length) : visible;
  const text = squash(rest).normalize('NFKC');
  return {
    index, heading, headingNorm: heading.toLowerCase(), text, textNorm: text.toLowerCase(),
    hidden: HIDE_RE.test(raw || ''),
  };
};
