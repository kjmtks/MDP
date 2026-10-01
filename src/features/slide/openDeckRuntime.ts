// The deck open in the editor, for surfaces mounted OUTSIDE the editor's tree —
// the Settings overlay reads its @script for the reading-speed calibration.
// EditorPage publishes references only (no copying), so an update costs nothing.

export interface OpenDeckSlide { raw?: string; isHidden?: boolean }
export interface OpenDeck { fileName: string; slides: readonly OpenDeckSlide[]; index: number }

let state: OpenDeck = { fileName: '', slides: [], index: 0 };
const listeners = new Set<() => void>();

export const getOpenDeck = (): OpenDeck => state;

export function setOpenDeck(next: OpenDeck): void {
  if (next.fileName === state.fileName && next.slides === state.slides && next.index === state.index) return;
  state = next;
  listeners.forEach((l) => { try { l(); } catch { /* keep notifying */ } });
}

export function subscribeOpenDeck(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
