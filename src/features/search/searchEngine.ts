// Pure, React-free slide search over the workspace deck index. Matching is
// case-insensitive substring over NFKC-normalised text (so Japanese / full-width
// text matches without a tokenizer). Terms are AND-ed.
//
// A slide is a hit when every term is found in it — its heading or visible text —
// or in its deck's title/subtitle, and at least one term in the slide itself (so
// "BRONZE 予測" finds the slides about 予測 in the BRONZE deck). A deck whose
// title/subtitle hold every term is listed even without a matching slide. What is
// searched is what the audience sees: speaker notes and scripts are not indexed
// (contentClean.ts).

import type { DeckIndexEntry } from './deckIndexStore';
import type { SlideText } from './contentClean';

export interface Highlight { start: number; end: number; }
export interface Snippet { text: string; highlights: Highlight[]; }

export interface SlideHit {
  slide: SlideText;
  score: number;
  heading: Snippet;     // the slide's heading, its matches marked
  snippet?: Snippet;    // around the first match in its text
}

export interface DeckResult {
  entry: DeckIndexEntry;
  score: number;
  titleMatch: boolean;  // every term is in the deck's title/subtitle
  hits: SlideHit[];     // in slide order
}

const normalize = (s: string): string => (s || '').normalize('NFKC').toLowerCase();

// A hit in a slide's heading counts more than one in its text; a deck whose title
// holds the query, or with many matching slides, ranks a little higher.
const W_HEADING = 30;
const W_TEXT = 10;
const W_TITLE = 20;
const SNIPPET_RADIUS = 40;

/** The query's terms (NFKC, lowercase, whitespace-separated). */
export const parseQuery = (raw: string): string[] => normalize(raw).split(/\s+/).filter(Boolean);

// Every occurrence of every term in `norm` (offsets valid for its display twin),
// merged into sorted, non-overlapping ranges shifted by `offset`.
const marks = (norm: string, terms: string[], offset = 0): Highlight[] => {
  const raw: Highlight[] = [];
  for (const t of terms) {
    for (let i = norm.indexOf(t); i !== -1; i = norm.indexOf(t, i + t.length)) {
      raw.push({ start: i + offset, end: i + t.length + offset });
    }
  }
  raw.sort((a, b) => a.start - b.start);
  const out: Highlight[] = [];
  for (const h of raw) {
    const last = out[out.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else out.push({ ...h });
  }
  return out;
};

// The text around the first match, with every match in it marked.
const snippetOf = (display: string, norm: string, terms: string[]): Snippet | undefined => {
  let first = -1;
  let len = 0;
  for (const t of terms) {
    const p = norm.indexOf(t);
    if (p !== -1 && (first === -1 || p < first)) { first = p; len = t.length; }
  }
  if (first === -1) return undefined;
  const from = Math.max(0, first - SNIPPET_RADIUS);
  const to = Math.min(display.length, first + len + SNIPPET_RADIUS);
  const lead = from > 0 ? '…' : '';
  const trail = to < display.length ? '…' : '';
  return {
    text: lead + display.slice(from, to) + trail,
    highlights: marks(norm.slice(from, to), terms, lead.length),
  };
};

/** Search the index: decks best first, each with its matching slides. */
export const searchSlides = (entries: DeckIndexEntry[], rawQuery: string): DeckResult[] => {
  const terms = parseQuery(rawQuery);
  if (!terms.length) return [];
  const results: DeckResult[] = [];
  for (const entry of entries) {
    const inDeck = (t: string) => entry.titleNorm.includes(t) || entry.subtitleNorm.includes(t);
    const titleMatch = terms.every(inDeck);
    const hits: SlideHit[] = [];
    for (const slide of entry.slides) {
      let score = 0;
      let own = 0;
      let all = true;
      for (const t of terms) {
        const inHeading = slide.headingNorm.includes(t);
        if (inHeading || slide.textNorm.includes(t)) { own++; score += inHeading ? W_HEADING : W_TEXT; }
        else if (!inDeck(t)) { all = false; break; }
      }
      if (!all || !own) continue;
      hits.push({
        slide, score,
        heading: { text: slide.heading, highlights: marks(slide.headingNorm, terms) },
        snippet: snippetOf(slide.text, slide.textNorm, terms),
      });
    }
    if (!hits.length && !titleMatch) continue;
    const best = hits.reduce((m, h) => Math.max(m, h.score), 0);
    results.push({ entry, titleMatch, hits, score: best + (titleMatch ? W_TITLE : 0) + Math.min(hits.length, 10) });
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      (a.entry.title || a.entry.name).localeCompare(b.entry.title || b.entry.name),
  );
  return results;
};
