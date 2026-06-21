// Pure, React-free deck search. Matching is case-insensitive substring over
// NFKC-normalised fields (so Japanese / full-width text matches without a
// tokenizer; a bigram index is a possible future refinement). Terms are AND-ed;
// a term may match in any field. Tag filters are AND-ed and matched exactly.

import type { DeckIndexEntry } from './deckIndexStore';

export interface Highlight { start: number; end: number; }
export interface Snippet { text: string; highlights: Highlight[]; }
export interface SearchResult {
  entry: DeckIndexEntry;
  score: number;
  snippet?: Snippet;
  matchedSlideIndex?: number;
}

export interface ParsedQuery { terms: string[]; tagFilters: string[]; }

const normalize = (s: string): string => (s || '').normalize('NFKC').toLowerCase();

// Field weights: a hit in the title counts most, then tags, subtitle, body.
const W_TITLE = 100;
const W_TAGS = 60;
const W_SUBTITLE = 40;
const W_BODY = 10;
const BONUS_PREFIX = 20;   // term is a prefix of the title
const BONUS_EXACT_TAG = 20; // term exactly equals a tag
const SNIPPET_RADIUS = 40;

/** Split a raw query into terms + inline `tag:foo` filters (single-word tags only;
 *  multi-word tags are filtered via the separate tagFilters argument to searchDecks). */
export const parseQuery = (raw: string): ParsedQuery => {
  const terms: string[] = [];
  const tagFilters: string[] = [];
  const normalized = normalize(raw).trim();
  if (!normalized) return { terms, tagFilters };
  for (const tok of normalized.split(/\s+/)) {
    if (!tok) continue;
    if (tok.startsWith('tag:') && tok.length > 4) tagFilters.push(tok.slice(4));
    else terms.push(tok);
  }
  return { terms, tagFilters };
};

/** Score an entry against the terms (AND). Returns null if any term matches nothing. */
const scoreEntry = (entry: DeckIndexEntry, terms: string[]): number | null => {
  if (terms.length === 0) return 0;
  let score = 0;
  for (const term of terms) {
    let best = 0;
    if (entry.titleNorm.includes(term)) {
      best = Math.max(best, W_TITLE + (entry.titleNorm.startsWith(term) ? BONUS_PREFIX : 0));
    }
    if (entry.tagsNorm.some((t) => t.includes(term))) {
      best = Math.max(best, W_TAGS + (entry.tagsNorm.some((t) => t === term) ? BONUS_EXACT_TAG : 0));
    }
    if (entry.subtitleNorm.includes(term)) best = Math.max(best, W_SUBTITLE);
    if (entry.bodyText.includes(term)) best = Math.max(best, W_BODY);
    if (best === 0) return null; // AND: this term hit no field → drop the deck
    score += best;
  }
  return score;
};

/** Build a body snippet around the earliest body match, with highlight ranges for
 *  every term, plus the slide index that match falls in. */
const buildSnippet = (
  entry: DeckIndexEntry,
  terms: string[],
): { snippet?: Snippet; matchedSlideIndex?: number } => {
  const { bodyText, bodyDisplay, slideOffsets } = entry;
  let firstPos = -1;
  let firstLen = 0;
  for (const t of terms) {
    const p = bodyText.indexOf(t);
    if (p !== -1 && (firstPos === -1 || p < firstPos)) { firstPos = p; firstLen = t.length; }
  }
  if (firstPos === -1) return {};

  const from = Math.max(0, firstPos - SNIPPET_RADIUS);
  const to = Math.min(bodyDisplay.length, firstPos + firstLen + SNIPPET_RADIUS);
  const lead = from > 0 ? '…' : '';
  const trail = to < bodyDisplay.length ? '…' : '';
  // newline → space is length-preserving, so offsets in `window` map onto `core`.
  const core = bodyDisplay.slice(from, to).replace(/\s+/g, ' ');
  const window = bodyText.slice(from, to);

  const raw: Highlight[] = [];
  for (const t of terms) {
    let i = 0;
    for (;;) {
      const idx = window.indexOf(t, i);
      if (idx === -1) break;
      raw.push({ start: idx + lead.length, end: idx + t.length + lead.length });
      i = idx + t.length;
    }
  }
  raw.sort((a, b) => a.start - b.start);
  const highlights: Highlight[] = [];
  for (const h of raw) {
    const last = highlights[highlights.length - 1];
    if (last && h.start <= last.end) last.end = Math.max(last.end, h.end);
    else highlights.push({ ...h });
  }

  let matchedSlideIndex = 0;
  for (let i = 0; i < slideOffsets.length; i++) {
    if (slideOffsets[i] <= firstPos) matchedSlideIndex = i;
    else break;
  }

  return { snippet: { text: lead + core + trail, highlights }, matchedSlideIndex };
};

/**
 * Search the index. `extraTagFilters` (exact, e.g. from clicked tag chips) are
 * combined with any inline `tag:` filters. Returns results sorted by score desc.
 */
export const searchDecks = (
  entries: DeckIndexEntry[],
  rawQuery: string,
  extraTagFilters: string[] = [],
): SearchResult[] => {
  const { terms, tagFilters } = parseQuery(rawQuery);
  const allTagFilters = [...tagFilters, ...extraTagFilters.map(normalize)].filter(Boolean);
  if (!terms.length && !allTagFilters.length) return [];

  const results: SearchResult[] = [];
  for (const entry of entries) {
    if (allTagFilters.length && !allTagFilters.every((tf) => entry.tagsNorm.includes(tf))) continue;
    const base = scoreEntry(entry, terms);
    if (base === null) continue;
    const { snippet, matchedSlideIndex } = terms.length ? buildSnippet(entry, terms) : {};
    results.push({ entry, score: base, snippet, matchedSlideIndex });
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      (a.entry.title || a.entry.name).localeCompare(b.entry.title || b.entry.name),
  );
  return results;
};

/** Union of all tags across entries, de-duped case-insensitively, sorted. Used for
 *  the tag-chip filter row and the tag editor's autocomplete suggestions. */
export const allTagsOf = (entries: DeckIndexEntry[]): string[] => {
  const seen = new Map<string, string>();
  for (const e of entries) {
    for (const t of e.tags) {
      const key = normalize(t);
      if (!seen.has(key)) seen.set(key, t);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
};
