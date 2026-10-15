import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import { splitMarkdownToBlocks } from '../slide/parser/slideParser';
import { inkMarkers } from './ink';

// Targeted edits of one [[ink: …]] marker in the editor, by single CodeMirror
// transactions (native undo, the caret kept) — what the preview's ink editing
// (InkEditLayer, in the edit-layout mode) writes. An ink is addressed as the n-th
// [[ink]] of a slide's @script (inkMarkers), the order its cues are read in; slide
// i is the document's block i + 1 (block 0 is the meta page).

/** Where the n-th ink marker of slide `slide` is in the document; null when there
 *  is none (the text changed meanwhile). */
export function inkMarkerAt(doc: Text, slide: number, nth: number): { from: number; to: number } | null {
  const block = splitMarkdownToBlocks(doc.toString())[slide + 1];
  if (!block || block.endLine < block.startLine || block.startLine > doc.lines) return null;
  const from = doc.line(block.startLine).from;
  const to = doc.line(Math.min(block.endLine, doc.lines)).to;
  const m = inkMarkers(doc.sliceString(from, to))[nth];
  return m ? { from: from + m.from, to: from + m.to } : null;
}

/** Rewrite the marker as `text` — or take it out (null). Returns whether it was found. */
export function replaceInkMarker(view: EditorView, slide: number, nth: number, text: string | null): boolean {
  const at = inkMarkerAt(view.state.doc, slide, nth);
  if (!at) return false;
  view.dispatch({ changes: { from: at.from, to: at.to, insert: text ?? '' } });
  return true;
}

/** Put the editor's caret on the marker (without taking the focus from the preview). */
export function selectInkMarker(view: EditorView, slide: number, nth: number): void {
  const at = inkMarkerAt(view.state.doc, slide, nth);
  if (at) view.dispatch({ selection: { anchor: at.from }, scrollIntoView: true });
}
