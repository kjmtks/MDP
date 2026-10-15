import type { EditorView } from '@codemirror/view';
import type { Text } from '@codemirror/state';
import { splitMarkdownToBlocks } from '../slide/parser/slideParser';
import { inkMarkers } from './ink';
import { lineAtOffset, lineStart, narrationLines, scriptEnd, type NarrationLine } from './inkLines';

// Targeted edits of [[ink: …]] markers in the editor, by single CodeMirror
// transactions (native undo, the caret kept) — what the preview's ink editing
// (InkEditLayer, in the edit-layout mode) writes. An ink is addressed as the n-th
// [[ink]] of a slide's @script (inkMarkers), the order its cues are read in; slide
// i is the document's block i + 1 (block 0 is the meta page).

/** Slide `slide`'s text in the document, and where it starts. */
function slideBlock(doc: Text, slide: number): { from: number; to: number; text: string } | null {
  const block = splitMarkdownToBlocks(doc.toString())[slide + 1];
  if (!block || block.endLine < block.startLine || block.startLine > doc.lines) return null;
  const from = doc.line(block.startLine).from;
  const to = doc.line(Math.min(block.endLine, doc.lines)).to;
  return { from, to, text: doc.sliceString(from, to) };
}

/** Where the n-th ink marker of slide `slide` is in the document; null when there
 *  is none (the text changed meanwhile). */
export function inkMarkerAt(doc: Text, slide: number, nth: number): { from: number; to: number } | null {
  const b = slideBlock(doc, slide);
  const m = b ? inkMarkers(b.text)[nth] : undefined;
  return b && m ? { from: b.from + m.from, to: b.from + m.to } : null;
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

/** The slide's narration lines, and the one to offer first: the line the editor's
 *  caret is in (when it is in the slide's script), else the first without an emphasis. */
export function inkLinesOf(view: EditorView, slide: number): { lines: NarrationLine[]; suggest: number } | null {
  const b = slideBlock(view.state.doc, slide);
  if (!b) return null;
  const lines = narrationLines(b.text);
  const caret = view.state.selection.main.head;
  let suggest = caret >= b.from && caret <= b.to ? lineAtOffset(b.text, caret - b.from) : -1;
  if (suggest < 0) suggest = lines.findIndex((l) => !l.emphases);
  return { lines, suggest: Math.max(0, suggest) };
}

/** A new ink marker for line `line` of slide `slide`, written right before the line's
 *  first word — or, for no line (-1, a slide without narration), at the end of its
 *  script, or in a new script. Returns its place among the slide's inks (nth). */
export function insertInkMarker(view: EditorView, slide: number, line: number, text: string): number | null {
  const b = slideBlock(view.state.doc, slide);
  if (!b) return null;
  let at = line >= 0 ? lineStart(b.text, line) : null;
  let insert = text;
  if (at === null) at = scriptEnd(b.text);
  if (at === null) {
    // No script yet: one with just this ink, at the end of the slide.
    at = b.text.replace(/\s+$/, '').length;
    insert = `\n\n<!-- @script: ${text} -->`;
  }
  view.dispatch({ changes: { from: b.from + at, insert } });
  const after = b.text.slice(0, at) + insert + b.text.slice(at);
  const nth = inkMarkers(after).findIndex((m) => m.from >= at! && m.to <= at! + insert.length);
  return nth < 0 ? null : nth;
}
