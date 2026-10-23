// Glossaries — how the narrator reads a field's terms (app/glossary.cjs reads the
// files: `<cdir>/glossary/<name>.md`, a table of 用語 | 読み). A deck gets every
// glossary of its `.mdp` chain, a nearer one winning on a term, and its narration
// reads each term as if the script had a ruby there — [[SHAP|シャップ]] — so no slide
// has to spell the readings out. A ruby written in the script still wins (it is
// left alone), and nothing else changes: captions, the talk time and the presenter
// pane show the words as written.
import { useSyncExternalStore } from 'react';

export interface GlossaryTerm { term: string; reading: string; note?: string }
/** One glossary file, as the backend reads it (listGlossaries). */
export interface GlossaryFile {
  name: string;
  path: string;
  configDir: string;
  description: string;
  /** The narration language its readings are for ('' = any). */
  lang: string;
  langInferred?: boolean;
  terms: GlossaryTerm[];
  problems: string[];
  truncated?: boolean;
}
/** An edit of a glossary file from the app (apiClient.glossaryEdit ≡ app/glossary.cjs editGlossaryText). */
export interface GlossaryEditArgs {
  path: string;                                  // <folder>/.mdp/glossary/<name>.md
  set?: { term: string; reading: string; note?: string }[];
  remove?: string[];
  description?: string;
  lang?: string;
  create?: boolean;                              // make the file when it is not there
}
export interface GlossaryEditResult {
  path: string; updated: number; added: number; removed: number; missing: string[]; created: boolean;
  glossary: GlossaryFile;
}
export interface GlossaryEntry { term: string; reading: string; lang: string; from: string }
/** The terms in effect for a deck (plain data: it travels to the video windows). */
export interface DeckGlossary { entries: GlossaryEntry[] }

export const NO_GLOSSARY: DeckGlossary = { entries: [] };

const primary = (lang: string) => String(lang || '').toLowerCase().split(/[-_]/)[0];

/** The language a narration text is read in, for choosing its glossaries: kana →
 *  ja; Han characters alone → '' (Japanese or Chinese — every glossary may read
 *  it); Latin → en (a ja glossary never turns an English line into katakana). */
export function narrationLang(text: string): string {
  const s = String(text || '');
  if (/[぀-ヿ]/.test(s)) return 'ja';
  if (/[가-힯]/.test(s)) return 'ko';
  if (/[㐀-鿿]/.test(s)) return '';
  return /[A-Za-z]/.test(s) ? 'en' : '';
}

/** Every glossary of the chain merged (they come root→nearest): a later one wins on
 *  a term of its language (a ja and an en reading of one term both stay). */
export function mergeGlossaries(files: readonly GlossaryFile[]): DeckGlossary {
  const map = new Map<string, GlossaryEntry>();
  for (const f of files) for (const t of f.terms || []) {
    if (t && t.term && t.reading) map.set(`${primary(f.lang)}\u0000${t.term}`, { term: t.term, reading: t.reading, lang: f.lang || '', from: f.name });
  }
  return map.size ? { entries: [...map.values()] } : NO_GLOSSARY;
}

// ---- reading a text with a glossary -------------------------------------------------
const LATIN = /[A-Za-z0-9]/;
const CJK = /[぀-ヿ㐀-鿿＀-￯]/;
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A term as a pattern: a space in it matches any run of spaces; where Latin meets
 *  Japanese ("Shapley値") a space may stand or not ("Shapley 値"); a Latin term is a
 *  whole word ("SHAP" is not read inside "SHAPE"). */
function termPattern(term: string): string {
  const chars = [...term];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) {
      out += '\\s+';
      while (i + 1 < chars.length && /\s/.test(chars[i + 1])) i++;
      continue;
    }
    out += escRe(c);
    const n = chars[i + 1];
    if (n && !/\s/.test(n) && LATIN.test(c) !== LATIN.test(n) && (CJK.test(c) || CJK.test(n))) out += '[ \\t\\u3000]?';
  }
  if (LATIN.test(chars[0])) out = `(?<![A-Za-z0-9])${out}`;
  if (LATIN.test(chars[chars.length - 1])) out = `${out}(?![A-Za-z0-9])`;
  return out;
}

interface Matcher { re: RegExp; entries: GlossaryEntry[] }
const matchers = new WeakMap<DeckGlossary, Map<string, Matcher | null>>();

/** The deck's terms for a narration language, longest first (so "Shapley値" is
 *  read before "Shapley"), as one pattern. */
function matcherFor(glossary: DeckGlossary, lang: string): Matcher | null {
  let byLang = matchers.get(glossary);
  if (!byLang) { byLang = new Map(); matchers.set(glossary, byLang); }
  const key = primary(lang);
  if (byLang.has(key)) return byLang.get(key)!;
  // One reading per term: a glossary for this language before one for every language.
  const byTerm = new Map<string, GlossaryEntry>();
  for (const e of glossary.entries) {
    if (!e.term || !e.reading || /[[\]|\n]/.test(e.term) || /[[\]|\n]/.test(e.reading)) continue;
    if (e.lang && key && primary(e.lang) !== key) continue;
    const prev = byTerm.get(e.term);
    if (!prev || (!prev.lang && e.lang)) byTerm.set(e.term, e);
  }
  const usable = [...byTerm.values()].sort((a, b) => [...b.term].length - [...a.term].length);
  const m = usable.length
    ? { re: new RegExp(usable.map((e) => `(${termPattern(e.term)})`).join('|'), 'gu'), entries: usable }
    : null;
  byLang.set(key, m);
  return m;
}

// Never read into: a ruby or any other [[…]] marker, a formula, a code span.
const KEEP = /\[\[[\s\S]*?\]\]|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|`[^`\n]*`/g;

/** The text with every glossary term of its words made a ruby — [[term|reading]] —
 *  as if the author had written one — and the terms it read. `lang`: the line's
 *  language ('' = any). */
export function readWithGlossary(text: string, glossary: DeckGlossary | null | undefined, lang = ''): { text: string; hits: GlossaryEntry[] } {
  const s = String(text || '');
  if (!glossary || !glossary.entries.length || !s) return { text: s, hits: [] };
  const m = matcherFor(glossary, lang);
  if (!m) return { text: s, hits: [] };
  const hits = new Map<string, GlossaryEntry>();
  const plain = (part: string) => part.replace(m.re, (...args: unknown[]) => {
    const groups = args.slice(1, 1 + m.entries.length) as (string | undefined)[];
    const k = groups.findIndex((g) => g !== undefined);
    if (k < 0) return args[0] as string;
    hits.set(m.entries[k].term, m.entries[k]);
    return `[[${args[0] as string}|${m.entries[k].reading}]]`;
  });
  let out = '';
  let last = 0;
  for (const k of s.matchAll(KEEP)) {
    out += plain(s.slice(last, k.index)) + k[0];
    last = (k.index || 0) + k[0].length;
  }
  return { text: out + plain(s.slice(last)), hits: [...hits.values()] };
}

export const applyGlossary = (text: string, glossary: DeckGlossary | null | undefined, lang = ''): string =>
  readWithGlossary(text, glossary, lang).text;

/** The glossary's entry for exactly this text (a ruby's base: is the ruby needed?). */
export function glossaryEntryOf(text: string, glossary: DeckGlossary | null | undefined, lang = ''): GlossaryEntry | null {
  const s = String(text || '').trim();
  const r = readWithGlossary(s, glossary, lang);
  return r.hits.length === 1 && r.text === `[[${s}|${r.hits[0].reading}]]` ? r.hits[0] : null;
}

/** Plain words as SPOKEN with the glossary (a module's line for mdpTts): each term
 *  replaced by its reading — and a map from a place in the spoken text back to the
 *  written one, so read-along highlighting stays on the right word. */
export function speakWithGlossary(text: string, glossary: DeckGlossary | null | undefined, lang = ''): { text: string; toWritten: (i: number) => number } {
  const s = String(text || '');
  const same = { text: s, toWritten: (i: number) => i };
  if (!glossary || !glossary.entries.length || !s) return same;
  const m = matcherFor(glossary, lang);
  if (!m) return same;
  const pieces: { from: number; to: number; at: number; len: number }[] = [];
  let out = '';
  let last = 0;
  for (const x of s.matchAll(m.re)) {
    const k = x.slice(1, 1 + m.entries.length).findIndex((g) => g !== undefined);
    if (k < 0 || x.index === undefined) continue;
    out += s.slice(last, x.index);
    const reading = m.entries[k].reading;
    pieces.push({ from: x.index, to: x.index + x[0].length, at: out.length, len: reading.length });
    out += reading;
    last = x.index + x[0].length;
  }
  if (!pieces.length) return same;
  out += s.slice(last);
  const toWritten = (i: number) => {
    let delta = 0;
    for (const p of pieces) {
      if (i < p.at) break;
      if (i < p.at + p.len) return p.from;       // inside a reading: its term's start
      delta = p.to - (p.at + p.len);
    }
    return i + delta;
  };
  return { text: out, toWritten };
}

// ---- the deck being narrated ------------------------------------------------------
// The main window's open deck (EditorPage sets it from the deck's `.mdp` chain); the
// narration reads with it unless given another (a video job keeps its own snapshot,
// the export window receives one).
let current: DeckGlossary = NO_GLOSSARY;
const subscribers = new Set<() => void>();
export const getDeckGlossary = (): DeckGlossary => current;
export function setDeckGlossary(g: DeckGlossary | null | undefined): void {
  const next = g && g.entries && g.entries.length ? g : NO_GLOSSARY;
  if (next === current || (next.entries.length === 0 && current.entries.length === 0)) { current = next; return; }
  current = next;
  subscribers.forEach((f) => f());
}
export function subscribeDeckGlossary(f: () => void): () => void {
  subscribers.add(f);
  return () => { subscribers.delete(f); };
}
/** The deck's glossary, for a component whose narration must follow its changes. */
export const useDeckGlossary = (): DeckGlossary => useSyncExternalStore(subscribeDeckGlossary, getDeckGlossary);
