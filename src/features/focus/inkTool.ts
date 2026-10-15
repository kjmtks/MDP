import { useSyncExternalStore } from 'react';

// The preview toolbar's "add ink" tool: the shape the next drawing on the slide makes
// (null: none) — set by the toolbar (DockPanels), taken by the edit-layout mode's ink
// layer (InkEditLayer), which clears it once the ink is made or given up.

let tool: string | null = null;
const listeners = new Set<() => void>();

export const getInkTool = (): string | null => tool;

export function setInkTool(shape: string | null): void {
  if (tool === shape) return;
  tool = shape;
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => { listeners.delete(f); };
};

export const useInkTool = (): string | null => useSyncExternalStore(subscribe, getInkTool);
