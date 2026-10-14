import type { EditorView } from '@codemirror/view';
import { findImageDefRanges } from './imageRegistry';

// Targeted in-file `@image` definition edits via single CodeMirror transactions
// (preserves native undo and the user's cursor/scroll — unlike a whole-document
// replace). Used by the Images panel.

// Strip `;` and the comment terminator so a description can't break the directive.
const sanitize = (s: string) => s.replace(/-->/g, '→').replace(/;/g, ',').replace(/[\r\n]+/g, ' ').trim();

const buildBlock = (alias: string, value: string, description?: string, tags?: string[]) => {
  const parts: string[] = [];
  if (description && description.trim()) parts.push(`desc: ${sanitize(description)}`);
  const cleanTags = (tags || []).map((t) => t.trim().replace(/[,;]/g, '')).filter(Boolean);
  if (cleanTags.length) parts.push(`tags: ${cleanTags.join(', ')}`);
  const args = parts.length ? ' ' + parts.join('; ') : '';
  return `<!-- @image ${alias}${args} -->\n${value}\n<!-- @end -->`;
};

/** Insert a new def block at the top of the document. */
export const addFileImageDef = (view: EditorView, alias: string, value: string, description?: string, tags?: string[]) => {
  view.dispatch({ changes: { from: 0, insert: buildBlock(alias, value, description, tags) + '\n\n' } });
};

// The `nth` definition of `alias` (0 = the first, the one that is used).
const nthDef = (doc: string, alias: string, nth = 0) => findImageDefRanges(doc).filter((x) => x.alias === alias)[nth];

/** Replace an existing def block (no-op if the alias isn't found). */
export const editFileImageDef = (view: EditorView, alias: string, value: string, description?: string, tags?: string[], nth = 0) => {
  const r = nthDef(view.state.doc.toString(), alias, nth);
  if (!r) return;
  view.dispatch({ changes: { from: r.from, to: r.to, insert: buildBlock(alias, value, description, tags) } });
};

/** Remove a def block (and up to two trailing newlines so no blank gap remains). */
export const deleteFileImageDef = (view: EditorView, alias: string, nth = 0) => {
  const doc = view.state.doc.toString();
  const r = nthDef(doc, alias, nth);
  if (!r) return;
  let to = r.to;
  if (doc[to] === '\r') to++;
  if (doc[to] === '\n') to++;
  if (doc[to] === '\r') to++;
  if (doc[to] === '\n') to++;
  view.dispatch({ changes: { from: r.from, to, insert: '' } });
};
