import type { EditorView } from '@codemirror/view';
import { TAGS_DIRECTIVE_RE, splitTags, serializeTags } from './tags';

// Read / write the deck's `<!-- @tags ... -->` directive on the meta page (block 0)
// via a single CodeMirror transaction (preserves undo + the in-memory tab content,
// unlike a whole-file saveFile). Mirrors moduleDocEdits / imageDocEdits.

/** Char range [from, to) of the meta page: everything before the first `---`
 *  separator line (fences respected), or the whole doc if there is none. */
const metaPageRange = (doc: string): { from: number; to: number } => {
  const lines = doc.split('\n'); // a trailing '\r' stays on each line; trim() handles it
  let inCode = false;
  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) inCode = !inCode;
    if (!inCode && /^---$/.test(trimmed)) return { from: 0, to: offset };
    offset += line.length + 1; // + the '\n' consumed by split
  }
  return { from: 0, to: doc.length };
};

const TITLE_LINE_RE = /<!--\s*@title(?:\s+[^\n]*?)?\s*-->/;

/** The deck's current tags, parsed from the meta page (empty if none). */
export const readTagsFromDoc = (doc: string): string[] => {
  const { from, to } = metaPageRange(doc);
  const m = TAGS_DIRECTIVE_RE.exec(doc.slice(from, to));
  return m ? splitTags(m[1]) : [];
};

/** Insert, replace, or remove the meta-page `@tags` directive to match `tags`. */
export const upsertTags = (view: EditorView, tags: string[]): void => {
  const doc = view.state.doc.toString();
  const { from, to } = metaPageRange(doc);
  const metaText = doc.slice(from, to);
  const directive = `<!-- @tags ${serializeTags(tags)} -->`;

  const existing = TAGS_DIRECTIVE_RE.exec(metaText);
  if (existing) {
    const start = from + existing.index;
    const end = start + existing[0].length;
    if (tags.length === 0) {
      // Remove the directive and its trailing newline so no blank line remains.
      let lineEnd = end;
      if (doc[lineEnd] === '\r') lineEnd++;
      if (doc[lineEnd] === '\n') lineEnd++;
      view.dispatch({ changes: { from: start, to: lineEnd, insert: '' } });
    } else {
      view.dispatch({ changes: { from: start, to: end, insert: directive } });
    }
    return;
  }

  if (tags.length === 0) return; // nothing to add

  // No existing directive: add it after the @title line if present, else at the
  // very top of the meta page.
  const titleMatch = TITLE_LINE_RE.exec(metaText);
  let insertAt = from;
  if (titleMatch) {
    let pos = from + titleMatch.index + titleMatch[0].length;
    if (doc[pos] === '\r') pos++;
    if (doc[pos] === '\n') pos++;
    insertAt = pos;
  }
  view.dispatch({ changes: { from: insertAt, insert: `${directive}\n` } });
};
