// Workspace-wide deck search index — a module-level singleton (mirrors the
// imageRegistry / loadedModules pattern). One builder (useDeckIndexBuilder, mounted
// once in EditorPage) writes it; any number of components read it via useDeckIndex.
//
// getSnapshot returns a stable, immutable object that is replaced only when the
// index actually changes, satisfying useSyncExternalStore's contract.

import { splitMarkdownToBlocks, parseGlobalContext } from '../slide/parser/slideParser';
import { extractBookmarkTitle, extractBookmarkSubtitle, type BookmarkTitle } from '../fileTree/bookmarkTitle';
import { buildBodyText } from './contentClean';

export interface DeckIndexEntry {
  path: string;
  name: string;                    // base file name
  title?: string;                  // raw @title (display fallback / sort)
  subtitle?: string;               // raw @subtitle
  tags: string[];                  // original casing (display + chips)
  titleDisplay: BookmarkTitle;     // sanitised, KaTeX-safe HTML for the result row
  subtitleDisplay: string | null;  // sanitised HTML, or null
  // normalised (NFKC + lowercase) fields for matching:
  titleNorm: string;
  subtitleNorm: string;
  tagsNorm: string[];
  bodyText: string;                // normalised body (matching)
  bodyDisplay: string;             // NFKC body, original case (snippets)
  slideOffsets: number[];
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
  const tags = ctx.meta.tags ?? [];
  const { bodyText, bodyDisplay, slideOffsets } = buildBodyText(rawText);
  return {
    path,
    name: baseName(path),
    title,
    subtitle,
    tags,
    titleDisplay: extractBookmarkTitle(rawText),
    subtitleDisplay: extractBookmarkSubtitle(rawText),
    titleNorm: norm(title),
    subtitleNorm: norm(subtitle),
    tagsNorm: tags.map((t) => norm(t)),
    bodyText,
    bodyDisplay,
    slideOffsets,
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
