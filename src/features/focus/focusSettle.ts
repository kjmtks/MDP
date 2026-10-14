import { flushSync } from 'react-dom';

// The focus layers on the page, each with a way to measure it again. A layer
// measures itself whenever its slide changes (FocusLayer), but a still picture
// cannot wait on that: the capture window and the MCP renders call
// settleFocusLayers once their fonts and images are in, right before the picture
// is taken, and get the layer measured and committed at once.
const live = new Map<HTMLElement, () => void>();

export function registerFocusLayer(root: HTMLElement, measure: () => void): () => void {
  live.set(root, measure);
  return () => { if (live.get(root) === measure) live.delete(root); };
}

/** Measure every focus layer inside `node` NOW and commit what it draws. */
export function settleFocusLayers(node: HTMLElement): void {
  live.forEach((measure, root) => { if (node.contains(root)) flushSync(measure); });
}
