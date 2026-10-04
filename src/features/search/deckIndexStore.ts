// Workspace-wide deck search index — a module-level singleton (mirrors the
// imageRegistry / loadedModules pattern). One builder (useDeckIndexBuilder, mounted
// once in EditorPage) writes it; any number of components read it via useDeckIndex.
//
// getSnapshot returns a stable, immutable object that is replaced only when the
// index actually changes, satisfying useSyncExternalStore's contract.

import { splitMarkdownToBlocks, parseGlobalContext } from '../slide/parser/slideParser';
import { extractBookmarkTitle, extractBookmarkSubtitle, type BookmarkTitle } from '../fileTree/bookmarkTitle';
import { slideText, type SlideText } from './contentClean';

export interface DeckIndexEntry {
  path: string;
  name: string;                    // base file name
  title?: string;                  // raw @title (display fallback / sort)
  subtitle?: string;               // raw @subtitle
  titleDisplay: BookmarkTitle;     // sanitised, KaTeX-safe HTML for the result row
  subtitleDisplay: string | null;  // sanitised HTML, or null
  // normalised (NFKC + lowercase) fields for matching:
  titleNorm: string;
  subtitleNorm: string;
  slides: SlideText[];             // each slide's heading and visible text
}

export type IndexStatus = 'idle' | 'indexing' | 'ready';

const norm = (s: string | undefined): string => (s || '').normalize('NFKC').toLowerCase();
const baseName = (path: string): string => path.split('/').pop() || path;

/** Build an index entry from a deck's raw markdown (pure). */
export const buildEntry = (path: string, rawText: string): DeckIndexEntry => {
  const blocks = splitMarkdownToBlocks(rawText || '');
  const ctx = parseGlobalContext(blocks[0]?.rawContent ?? '');
  const title = ctx.meta.title;
  const subtitle = ctx.meta.subtitle;
  return {
    path,
    name: baseName(path),
    title,
    subtitle,
    titleDisplay: extractBookmarkTitle(rawText),
    subtitleDisplay: extractBookmarkSubtitle(rawText),
    titleNorm: norm(title),
    subtitleNorm: norm(subtitle),
    // blocks[0] is the meta page; the slides follow it, so the index matches the
    // deck's 0-based slide index.
    slides: blocks.slice(1).map((b, i) => slideText(b.rawContent, i)),
  };
};

interface Snapshot {
  version: number;
  status: IndexStatus;
  entries: DeckIndexEntry[];
}

let entries = new Map<string, DeckIndexEntry>();
let status: IndexStatus = 'idle';
let version = 0;
let snapshot: Snapshot = { version, status, entries: [] };
const listeners = new Set<() => void>();

const bump = () => {
  version += 1;
  snapshot = { version, status, entries: Array.from(entries.values()) };
  listeners.forEach((l) => l());
};

export const deckIndexStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  getSnapshot(): Snapshot {
    return snapshot;
  },
  getEntries(): DeckIndexEntry[] {
    return snapshot.entries;
  },
  getStatus(): IndexStatus {
    return status;
  },
  has(path: string): boolean {
    return entries.has(path);
  },
  setStatus(s: IndexStatus): void {
    if (s !== status) { status = s; bump(); }
  },
  upsert(path: string, entry: DeckIndexEntry): void {
    entries.set(path, entry);
    bump();
  },
  /** Set many entries, notifying subscribers only once (used for the initial build). */
  upsertMany(items: Array<[string, DeckIndexEntry]>): void {
    if (!items.length) return;
    for (const [path, entry] of items) entries.set(path, entry);
    bump();
  },
  remove(path: string): void {
    if (entries.delete(path)) bump();
  },
  /** Drop entries whose path is no longer present. Returns true if anything changed. */
  reconcilePaths(paths: string[]): boolean {
    const keep = new Set(paths);
    let changed = false;
    for (const p of Array.from(entries.keys())) {
      if (!keep.has(p)) { entries.delete(p); changed = true; }
    }
    if (changed) bump();
    return changed;
  },
  clear(): void {
    entries = new Map();
    status = 'idle';
    bump();
  },
};
