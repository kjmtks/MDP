import { useEffect, useRef } from 'react';
import type { FileNode } from '../../types';
import { apiClient } from '../../api/apiClient';
import { deckIndexStore, buildEntry } from './deckIndexStore';

// Mount ONCE (in EditorPage). Builds and maintains the workspace deck index:
//  - reconciles against the file tree (handles create / rename / delete)
//  - reads + indexes any not-yet-known `.slide.md` with bounded concurrency
//  - refreshes a single entry on save from the 'mdp-file-saved' payload (no re-read)

const SLIDE_EXT = '.slide.md';

const collectSlidePaths = (nodes: FileNode[], acc: string[]): void => {
  for (const n of nodes) {
    if (n.type === 'file' && n.path.endsWith(SLIDE_EXT)) acc.push(n.path);
    if (n.children) collectSlidePaths(n.children, acc);
  }
};

/** Map over items with at most `limit` in flight at once. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const useDeckIndexBuilder = (fileTree: FileNode[]): void => {
  const runId = useRef(0);

  // Build / reconcile whenever the file tree changes.
  useEffect(() => {
    const paths: string[] = [];
    collectSlidePaths(fileTree || [], paths);
    deckIndexStore.reconcilePaths(paths);

    const missing = paths.filter((p) => !deckIndexStore.has(p));
    if (missing.length === 0) {
      if (paths.length > 0 && deckIndexStore.getStatus() !== 'ready') deckIndexStore.setStatus('ready');
      return;
    }

    const myRun = ++runId.current;
    let cancelled = false;
    deckIndexStore.setStatus('indexing');

    (async () => {
      const results = await mapPool(missing, 6, async (path) => {
        try {
          const text = await apiClient.readFileText(path);
          return [path, buildEntry(path, text)] as [string, ReturnType<typeof buildEntry>];
        } catch {
          return null;
        }
      });
      if (cancelled || myRun !== runId.current) return;
      deckIndexStore.upsertMany(results.filter((r): r is [string, ReturnType<typeof buildEntry>] => r !== null));
      deckIndexStore.setStatus('ready');
    })();

    return () => { cancelled = true; };
  }, [fileTree]);

  // Refresh a single entry when a deck is saved (use the event payload, no re-read).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; content?: string } | undefined;
      if (!detail?.path || detail.content == null) return;
      if (!detail.path.endsWith(SLIDE_EXT)) return;
      deckIndexStore.upsert(detail.path, buildEntry(detail.path, detail.content));
    };
    window.addEventListener('mdp-file-saved', handler);
    return () => window.removeEventListener('mdp-file-saved', handler);
  }, []);
};
