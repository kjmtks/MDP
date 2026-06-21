import { useSyncExternalStore } from 'react';
import { deckIndexStore, type DeckIndexEntry, type IndexStatus } from './deckIndexStore';

/** Subscribe to the workspace deck index. Returns the current entries + build status. */
export const useDeckIndex = (): { entries: DeckIndexEntry[]; status: IndexStatus } => {
  const snap = useSyncExternalStore(
    deckIndexStore.subscribe,
    deckIndexStore.getSnapshot,
    deckIndexStore.getSnapshot,
  );
  return { entries: snap.entries, status: snap.status };
};
